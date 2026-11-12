"""Original-resource coverage, damaged inputs and static frame identity.

These checks do not provide 2016 client combat or GPU ground truth.
"""
import hashlib
import json
import struct
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'assets'))
from pvp_scene_pool import inventory, scene_id
from scene_build import Catalog, line_map, scene_objects
from scene_kl import recover, vector
from scene_gltf import Exporter, parse_strict

SOURCE = Path('asset_sources/upstream')


class Coverage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = Catalog(SOURCE)
        cls.entries, cls.registry_sources = inventory(SOURCE)
        cls.pool = json.loads((ROOT / 'artifacts/scene/catalog.json').read_text(encoding='utf-8'))

    def test_ui_list_plus_packaged_variants_and_non_pvp_names(self):
        self.assertEqual(len(self.entries), 16)
        self.assertEqual(sum(e['classification'] == 'original-pvp-list' for e in self.entries), 14)
        names = {e['sourceScene'] for e in self.entries}
        self.assertTrue({'ElTreeDown.lua', 'Elder_Benders_Cave_Stage3.lua',
            'Elder_Wally_Castle_Center_Stage4.lua', 'Elder_Wally_Castle_Roof_Stage4.lua',
            'SUMMER_2008_PVP_Test.lua', 'Elder_Druid_Forest_Stage_Pvp.lua'}.issubset(names))
        self.assertEqual(len({e['sceneId'] for e in self.entries}), 16)
        self.assertEqual(scene_id('Sander_Garpai_Rock_Pvpmap.lua'), 'sander-garpai-rock-pvp')
        self.assertFalse(any('TrainingCenter' in name for name in names))

    def test_every_map_preserves_original_lines_and_spawn_coordinates(self):
        for entry in self.entries:
            with self.subTest(map=entry['sourceScene']):
                calls = recover(self.catalog.lookup(entry['sourceLineMap']).read_bytes())['calls']
                collision = json.loads((ROOT / 'artifacts/scene' / entry['sceneId'] / 'collision.json').read_text(encoding='utf-8'))
                self.assertEqual(collision['sceneId'], entry['sceneId'])
                lines = [c['arguments'][0] for c in calls if c['callee'] == 'AddLine_LUA']
                self.assertEqual(len(lines), len(collision['lines']))
                for source, converted in zip(lines, collision['lines']):
                    self.assertEqual(source['LINE_NUM'], converted['lineId'])
                    self.assertEqual(vector(source['START_POS']), converted['start'])
                    self.assertEqual(vector(source['END_POS']), converted['end'])
                starts = [c for c in calls if c['callee'] in ('SetTeamStartPos', 'AddStartPos')]
                self.assertEqual(len(starts), len(collision['spawns']))
                for source, converted in zip(starts, collision['spawns']):
                    self.assertEqual(vector(source['arguments'][1]), converted['position'])
                    self.assertEqual(source['arguments'][3], converted['lineId'])

    def test_all_published_files_match_hashes_and_have_no_layout_adaptation(self):
        self.assertEqual(self.pool['convertedCount'], 16)
        self.assertEqual(self.pool['failures'], [])
        for entry in self.pool['maps']:
            folder = ROOT / 'artifacts/scene' / entry['sceneId']
            raw = (folder / 'manifest.json').read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), entry['manifestSha256'])
            manifest = json.loads(raw)
            self.assertFalse(manifest['originalLayoutAdapted'])
            self.assertFalse(manifest['camera']['dynamicEnabled'])
            for file in manifest['outputs']:
                self.assertEqual(hashlib.sha256((folder / file['path']).read_bytes()).hexdigest(), file['sha256'])

    def test_original_corrupt_mesh_fails_closed_and_gap_is_explicit(self):
        name = 'Besma_BesmaLake_PVPMap_Tower03.Y'
        with self.assertRaisesRegex(ValueError, 'Damaged MSZIP'):
            parse_strict(self.catalog.lookup(name))
        entry = next(e for e in self.pool['maps'] if e['sourceScene'] == 'Besma_Besma_Lake_PvpMap.lua')
        self.assertEqual(entry['conversionGaps'][0]['resource'], name)
        self.assertFalse(entry['originalClientMeasured'])

    def test_resource_alias_and_missing_audio_are_not_native_proof(self):
        winter = next(e for e in self.pool['maps'] if e['sourceScene'] == 'pvp_winter_Velder.lua')
        self.assertTrue(any(a['requested'] == 'pvp_Winter_Tree .dds' for a in winter['textureAliases']))
        summer = next(e for e in self.pool['maps'] if e['sourceScene'] == 'SUMMER_2008_PVP_Test.lua')
        self.assertEqual(summer['conversionGaps'][0]['kind'], 'missing-audio')

    def test_empty_linemap_and_truncated_actual_variants_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Empty original line map'):
            line_map({'calls': []}, {})
        for name in ['ElTreeDown.lua', 'pvp_winter_Velder.lua', 'SUMMER_2008_PVP_Test.lua']:
            raw = self.catalog.lookup(name).read_bytes()
            with self.subTest(name=name), self.assertRaises(ValueError):
                recover(raw[:-1])

    def test_world_color_opt_out_is_preserved_in_original_objects_and_gltf_parent_metadata(self):
        count = 0
        for entry in self.pool['maps']:
            folder = ROOT / 'artifacts/scene' / entry['sceneId']
            manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
            original = recover(self.catalog.lookup(entry['sourceScene']).read_bytes())
            objects = scene_objects(original)
            raw = (folder / 'scene.glb').read_bytes()
            size = struct.unpack_from('<I', raw, 12)[0]
            gltf = json.loads(raw[20:20 + size])
            material_groups = {True: set(), False: set()}
            def visit(index, enabled):
                node = gltf['nodes'][index]
                if 'mesh' in node:
                    material_groups[enabled].update(p['material'] for p in gltf['meshes'][node['mesh']]['primitives'] if 'material' in p)
                for child in node.get('children', []):
                    visit(child, enabled)
            for obj, source in zip(manifest['objects'], objects):
                self.assertEqual(obj['useWorldColor'], source['useWorldColor'])
                if 'gltfNode' in obj:
                    self.assertEqual(gltf['nodes'][obj['gltfNode']]['extras']['nativeUseWorldColor'], source['useWorldColor'])
                    visit(obj['gltfNode'], source['useWorldColor'])
                if not source['useWorldColor']:
                    count += 1
                    self.assertEqual(source['useWorldColorEvidence'], 'target2016 explicit SetUseWorldColor declaration')
            self.assertTrue(material_groups[True].isdisjoint(material_groups[False]), 'WorldColor opt-out material must not be shared with tinted world: ' + entry['sceneId'])
        self.assertGreater(count, 0)


class StaticFrameIdentity(unittest.TestCase):
    def test_world_color_default_reference_and_explicit_false_do_not_guess_unknown_symbols(self):
        constructor = {'id': 1, 'callee': 'CreateObjectMesh', 'pc': 1, 'target': {}, 'arguments': []}
        setter = {'id': 2, 'callee': 'SetUseWorldColor', 'pc': 2, 'target': {'$result': 1}, 'arguments': [False]}
        base = {'calls': [constructor], 'fields': []}
        self.assertTrue(scene_objects(base)[0]['useWorldColor'])
        base['calls'].append(setter)
        self.assertFalse(scene_objects(base)[0]['useWorldColor'])
        setter['arguments'] = [{'$symbol': 'UNKNOWN_WORLD_COLOR'}]
        with self.assertRaisesRegex(ValueError, 'Unresolved SetUseWorldColor'):
            scene_objects(base)

    def fixture(self, skinned=False):
        triangle = 'Mesh tri {3;0;0;0;,1;0;0;,0;1;0;;1;3;0,1,2;;%s}'
        skin = 'SkinWeights {"Repeated";3;0,1,2;1,1,1;1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1;;}' if skinned else ''
        def frame(x):
            return ('Frame Repeated {FrameTransformMatrix {1,0,0,0,0,1,0,0,0,0,1,0,%s,0,0,1;;}%s}'
                % (x, triangle % skin))
        return 'xof 0303txt 0032\n' + frame(10) + frame(20)

    def test_repeated_static_names_keep_two_parents_and_authored_positions(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'legal.x'
            path.write_text(self.fixture())
            exporter = Exporter('legal', {})
            exporter.add(path, Path(folder))
            roots = exporter.doc['scenes'][0]['nodes']
            self.assertEqual(len(roots), 2)
            self.assertEqual([exporter.doc['nodes'][i]['matrix'][12] for i in roots], [10, 20])
            self.assertEqual(len(exporter.doc['meshes']), 2)
            self.assertNotEqual(exporter.doc['nodes'][roots[0]]['mesh'], exporter.doc['nodes'][roots[1]]['mesh'])

    def test_ambiguous_skin_binding_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'ambiguous.x'
            path.write_text(self.fixture(skinned=True))
            with self.assertRaisesRegex(ValueError, 'Ambiguous skin frame'):
                Exporter('ambiguous', {}).add(path, Path(folder))


if __name__ == '__main__':
    unittest.main()

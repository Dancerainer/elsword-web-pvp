"""Convert one real 2016 PvP scene and its original line map.

No executable, script VM, native callback or source mutation is involved.
The output preserves native layout; unsupported behavior is explicit metadata.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import struct
import warnings

import numpy as np

from scene_animation import decode_animations, walk
from scene_gltf import Exporter, parser, flat, parse_strict
from scene_kl import recover, vector, display

TOOL_VERSION = 'pvp-scene-v3'
DEFAULT_SCENE = 'Sander_Garpai_Rock_Pvpmap.lua'
SCENE_ID = 'sander-garpai-rock-pvp'
EXCEPTIONS_PATH = Path(__file__).resolve().parents[2] / 'contracts' / 'pvp-map-resource-exceptions.json'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


class Catalog:
    _indexes = {}

    def __init__(self, source_root):
        self.root = source_root / 'asset_work'
        self.db = sqlite3.connect((self.root / 'catalog.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
        self.db.row_factory = sqlite3.Row
        key = self.root.resolve()
        if key not in self._indexes:
            index = collections.defaultdict(list)
            for row in self.db.execute('SELECT * FROM assets'):
                index[row['name'].casefold()].append(row)
            self._indexes[key] = index
        self.index = self._indexes[key]
        self.used = {}
        self.loose = json.loads((source_root / 'reports' / 'source-files.json').read_text(encoding='utf-8'))

    def lookup(self, name):
        basename = Path(name.replace('\\', '/')).name
        rows = self.index.get(basename.casefold(), [])
        if not rows:
            candidates = [r for r in self.loose if Path(r['path']).name.casefold() == basename.casefold()]
            if not candidates or len(set(r['sha256'] for r in candidates)) != 1:
                raise ValueError('Missing or ambiguous original dependency: ' + name)
            selected = candidates[0]
            path = self.root / 'loose' / selected['path']
            if not path.is_file() or sha(path) != selected['sha256']:
                raise ValueError('Original loose dependency hash mismatch: ' + name)
            self.used[basename.casefold()] = {'name': path.name, 'sha256': selected['sha256'],
                'archive': None, 'ordinal': None, 'rawPath': 'loose/' + selected['path'],
                'bytes': path.stat().st_size, 'sourceKind': 'original loose file',
                'equivalentSources': [{'path': r['path']} for r in candidates]}
            return path
        if len(set(r['sha256'] for r in rows)) != 1:
            raise ValueError('Ambiguous original dependency: ' + name)
        selected = rows[0]
        path = self.root / selected['raw_path']
        if not path.is_file() or sha(path) != selected['sha256']:
            raise ValueError('Original dependency hash mismatch: ' + name)
        self.used[basename.casefold()] = {'name': selected['name'], 'sha256': selected['sha256'],
            'archive': selected['archive'], 'ordinal': selected['ordinal'],
            'rawPath': selected['raw_path'], 'bytes': path.stat().st_size,
            'equivalentSources': [{'archive': r['archive'], 'ordinal': r['ordinal']} for r in rows]}
        return path


def simplify(value):
    if isinstance(value, dict):
        if '$constructor' in value:
            return value['values']
        if '$symbol' in value or '$field' in value:
            return {'symbol': display(value), 'resolved': False}
        return {str(k): simplify(v) for k, v in value.items()}
    if isinstance(value, list):
        return [simplify(v) for v in value]
    return value


def scene_objects(rec):
    objects, handles, render_handles = [], {}, {}
    for call in rec['calls']:
        method = call['callee']
        if method in ('CreateObjectMesh', 'CreateObjectSkinMesh', 'CreateSkyDome',
                      'CreateWorldLayer', 'CreateObjectParticle', 'CreateLensFlare'):
            obj = {'id': 'object-' + str(call['id']), 'kind': method, 'sourcePc': call['pc'],
                   'declarations': [], 'renderParameters': {}, 'nativePosition': None,
                   'nativeScale': None, 'rotation': None, 'useWorldColor': True,
                   'useWorldColorEvidence': 'fixedV5 CX2WorldObject constructor m_bUseWorldColor(true); blob 56ecae457beed4c973f4d393187dcfb1a604d0b8; target client unmeasured'}
            handles[call['id']] = obj
            objects.append(obj)
        target_id = call['target'].get('$result') if isinstance(call['target'], dict) else None
        obj = handles.get(target_id)
        if obj is None:
            continue
        obj['declarations'].append({'callee': method, 'arguments': simplify(call['arguments']), 'pc': call['pc']})
        args = call['arguments']
        if method in ('SetXMesh', 'SetDomeMesh'):
            obj['mesh'] = args[0]
        elif method == 'AddXSkinModel':
            obj.setdefault('skinModels', []).append(args[0])
        elif method == 'SetXSkinMotion':
            obj['motion'] = args[0]
        elif method == 'SetPos':
            obj['nativePosition'] = vector(args[0]) if len(args) == 1 else args
        elif method == 'SetScale':
            obj['nativeScale'] = vector(args[0]) if len(args) == 1 else args
        elif method == 'SetRotation':
            obj['rotation'] = simplify(args)
        elif method == 'SetLayer':
            obj['layer'] = display(args[0])
        elif method == 'SetColorFactor':
            obj['colorFactor'] = simplify(args[0])
        elif method == 'SetAlphaObject':
            obj['alphaObject'] = args[0]
        elif method == 'SetUseWorldColor':
            value = args[0]
            if isinstance(value, dict):
                value = value.get('$symbol')
            if value in (True, 1, 'TRUE'):
                obj['useWorldColor'] = True
            elif value in (False, 0, 'FALSE'):
                obj['useWorldColor'] = False
            else:
                raise ValueError('Unresolved SetUseWorldColor declaration')
            obj['useWorldColorEvidence'] = 'target2016 explicit SetUseWorldColor declaration'
        elif method == 'GetRenderParam' and 'result' in call:
            render_handles[call['id']] = obj
    for field in rec['fields']:
        rid = field['target'].get('$result') if isinstance(field['target'], dict) else None
        if rid in render_handles:
            render_handles[rid]['renderParameters'][field['field']] = simplify(field['value'])
    return objects


def line_map(rec, source, scene_id=SCENE_ID):
    lines, starts, cameras, settings = [], [], [], []
    for call in rec['calls']:
        method, args = call['callee'], call['arguments']
        if method == 'AddLine_LUA':
            row = args[0]
            start, end = vector(row.get('START_POS')), vector(row.get('END_POS'))
            if not isinstance(start, list) or not isinstance(end, list) or len(start) != 3 or len(end) != 3:
                raise ValueError('Unresolved line endpoint')
            lines.append({'lineId': row['LINE_NUM'], 'start': start, 'end': end,
                          'type': display(row['LINE_TYPE']), 'beforeLine': row.get('BEFORE_LINE'),
                          'nextLine': row.get('NEXT_LINE'), 'lineSet': row.get('LINE_SET'),
                          'nativeFields': simplify(row), 'sourcePc': call['pc']})
        elif method in ('SetTeamStartPos', 'AddStartPos'):
            starts.append({'kind': method, 'index': len(starts), 'position': vector(args[1]),
                           'facingRight': args[2], 'lineId': args[3],
                           'parameterNameEvidence': 'V5 KTDGLineMap.h bRight; 2016 client unmeasured',
                           'teamFlag': args[0] if method == 'SetTeamStartPos' else None,
                           'spawnNumber': args[0] if method == 'AddStartPos' else None,
                           'arguments': simplify(args), 'sourcePc': call['pc']})
        elif method == 'AddCameraData_LUA':
            cameras.append({'index': len(cameras), 'nativeFields': simplify(args[0]),
                            'sourcePc': call['pc'], 'runtimeEnabled': False})
        elif method != 'D3DXVECTOR3':
            settings.append({'callee': method, 'arguments': simplify(args), 'sourcePc': call['pc']})
    ids = [x['lineId'] for x in lines]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate line number')
    for s in starts:
        if s['lineId'] not in ids:
            raise ValueError('Start point references unknown line')
    points = [p for line in lines for p in (line['start'], line['end'])]
    if not points:
        raise ValueError('Empty original line map')
    return {'schemaVersion': 1, 'sceneId': scene_id, 'coordinateSystem': 'nativeXYZ',
            'source': source, 'lines': lines, 'starts': starts, 'spawns': starts, 'cameraSlots': cameras,
            'worldSettings': settings, 'bounds': {'min': [min(p[i] for p in points) for i in range(3)],
                                                'max': [max(p[i] for p in points) for i in range(3)]},
            'unknownSemantics': ['2016 native platform collision algorithm and tolerances',
                                 'LT_JUMP_UP_REL activation/velocity/input semantics',
                                 'native defaults for omitted line fields',
                                 'teamFlag false/true mapping to red/blue names'],
            'evidence': 'original KL82 declaration recovery; client unmeasured',
            'nativeExecuted': False}


def write_glb(exporter, path, extras):
    exporter.doc['buffers'] = [{'byteLength': len(exporter.buffer)}]
    exporter.doc['extensionsUsed'] = ['KHR_materials_unlit']
    exporter.doc['extras'] = extras
    for material in exporter.doc['materials']:
        material['extensions'] = {'KHR_materials_unlit': {}}
    doc = {k: v for k, v in exporter.doc.items() if not isinstance(v, list) or v}
    data = json.dumps(doc, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
    data += b' ' * (-len(data) % 4)
    buf = bytes(exporter.buffer)
    buf += b'\0' * (-len(buf) % 4)
    path.write_bytes(struct.pack('<3I', 0x46546c67, 2, 28 + len(data) + len(buf)) +
                     struct.pack('<2I', len(data), 0x4e4f534a) + data +
                     struct.pack('<2I', len(buf), 0x004e4942) + buf)


def build(source_root, output, source_scene=DEFAULT_SCENE, scene_id=SCENE_ID):
    source_root, output = source_root.resolve(), output.resolve()
    own_root = Path(__file__).resolve().parents[2]
    if not output.is_relative_to(own_root / 'artifacts' / 'scene'):
        raise ValueError('Generated output must remain inside this worktree artifacts/scene')
    output.mkdir(parents=True, exist_ok=True)
    catalog = Catalog(source_root)
    scene_path = catalog.lookup(source_scene)
    scene = recover(scene_path.read_bytes())
    line_name = next(c['arguments'][0] for c in scene['calls'] if c['callee'] == 'SetLineMap')
    line_path = catalog.lookup(line_name)
    rec_lines = recover(line_path.read_bytes())
    objects = scene_objects(scene)
    exceptions = json.loads(EXCEPTIONS_PATH.read_text(encoding='utf-8'))
    conversion_gaps, texture_aliases = [], []
    coll = line_map(rec_lines, catalog.used[Path(line_name).name.casefold()], scene_id)
    dump(output / 'collision.json', coll)
    dump(output / 'declarations.json', {'scene': scene, 'lineMap': rec_lines})
    textures, trees, model_evidence = {}, {}, []
    refs = sorted(set(ref for o in objects for ref in ([o['mesh']] if 'mesh' in o else o.get('skinModels', []))))
    for ref in refs:
        p = catalog.lookup(ref)
        exception = exceptions['unsupportedMeshes'].get(ref.casefold())
        if exception:
            if sha(p) != exception['sha256']:
                raise ValueError('Unsupported mesh source changed; re-audit required: ' + ref)
            conversion_gaps.append({'kind': 'unsupported-mesh', 'resource': ref, **exception})
            continue
        tree = parse_strict(p)
        nodes = list(walk(tree))
        if any(n.kind == 'Mesh' and n.child('DeclData') for n in nodes):
            raise ValueError('DeclData requires explicit vertex declaration decoding')
        for n in nodes:
            if n.kind in ('TextureFilename', 'TextureFileName'):
                for t in n.strings():
                    if t:
                        key = Path(t.replace('\\', '/')).name.casefold()
                        alias = exceptions['textureAliases'].get(key)
                        texture = catalog.lookup(alias['resource'] if alias else t)
                        if alias:
                            if sha(texture) != alias['sha256']:
                                raise ValueError('Texture alias source changed: ' + t)
                            texture_aliases.append({'requested': t, **alias})
                        textures[key] = texture
        trees[ref.casefold()] = tree
        frames = [{'name': n.name, 'matrix': n.child('FrameTransformMatrix').nums()
                   if n.child('FrameTransformMatrix') else None} for n in nodes if n.kind == 'Frame']
        clips = decode_animations(tree, include_native_matrices=True)
        model_evidence.append({'source': catalog.used[ref.casefold()], 'nodeKinds': dict(collections.Counter(n.kind for n in nodes)),
                               'nativeFrameMatrices': frames, 'animationEvidence': clips})
    exporter = Exporter(scene_id, textures)
    for obj in objects:
        refs = [obj['mesh']] if 'mesh' in obj else obj.get('skinModels', [])
        if not refs:
            obj['conversionStatus'] = 'unsupported object type retained as declaration'
            continue
        if any(ref.casefold() not in trees for ref in refs):
            obj['conversionStatus'] = 'unsupported original mesh; declaration retained; no substitute'
            continue
        if obj['rotation'] is not None:
            raise ValueError('Unconfirmed object rotation declaration')
        root_start = len(exporter.doc['scenes'][0]['nodes'])
        material_start = len(exporter.doc['materials'])
        for ref in refs:
            exporter.add(catalog.lookup(ref), output, tree=trees[ref.casefold()])
        roots = exporter.doc['scenes'][0]['nodes'][root_start:]
        del exporter.doc['scenes'][0]['nodes'][root_start:]
        position = obj['nativePosition']
        if position is None:
            raise ValueError('No confirmed object position')
        scale = obj['nativeScale'] or [1, 1, 1]
        # Absence of an explicit source scale is kept in evidence. Identity here
        # is a neutral glTF container transform, not an inferred world rescale.
        obj_index = len(exporter.doc['nodes'])
        exporter.doc['nodes'].append({'name': obj['id'], 'translation': [position[0], position[1], -position[2]],
            'scale': scale, 'children': roots, 'extras': {'nativeObject': obj['id'], 'nativePosition': position,
                                                       'nativeScaleDeclaration': obj['nativeScale'],
                                                       'nativeUseWorldColor': obj['useWorldColor']}})
        exporter.doc['scenes'][0]['nodes'].append(obj_index)
        obj['gltfNode'] = obj_index
        obj['conversionStatus'] = 'geometry and authored transforms converted'
        if obj.get('renderParameters', {}).get('bAlphaBlend') or obj.get('alphaObject'):
            for material in exporter.doc['materials'][material_start:]:
                material['alphaMode'] = 'BLEND'
                material.pop('alphaCutoff', None)
        elif obj.get('renderParameters', {}).get('bAlphaTestEnable'):
            for material in exporter.doc['materials'][material_start:]:
                material['alphaMode'] = 'MASK'
                material['alphaCutoff'] = .5
        if 'colorFactor' in obj:
            for material in exporter.doc['materials'][material_start:]:
                material['pbrMetallicRoughness']['baseColorFactor'] = [
                    a * b for a, b in zip(material['pbrMetallicRoughness']['baseColorFactor'], obj['colorFactor'])]
    if exporter.missing_textures:
        raise ValueError('Missing active mesh textures: ' + repr(exporter.missing_textures))
    preview_policy = {'lighting': 'KHR_materials_unlit preview; native lighting/fog not reproduced',
                      'alphaCutoff': .5, 'alphaCutoffEvidence': 'glTF preview parameter; original native default not measured',
                      'doubleSided': True, 'doubleSidedEvidence': 'preview policy; native cull state not measured',
                      'implicitObjectScale': 'identity glTF parent when source scale declaration absent',
                      'windAnimation': 'source native matrices/ticks retained; no guessed tick rate'}
    write_glb(exporter, output / 'scene.glb', {'toolVersion': TOOL_VERSION, 'sceneId': scene_id,
                                            'coordinateConversion': 'source unit retained; Z reflected; triangle winding reversed',
                                            'originalLayoutAdapted': False, 'previewPolicy': preview_policy})
    dump(output / 'model-evidence.json', model_evidence)
    audio = []
    for call in scene['calls']:
        if call['callee'] in ('SetBGM', 'AddEffectBGM_LUA', 'Add3DEffectBGM_LUA'):
            name = call['arguments'][0]
            missing = exceptions['missingAudio'].get(name.casefold())
            if missing:
                # If a later source provides the dependency, fail this old
                # exception instead of hiding it as unavailable indefinitely.
                if catalog.index.get(name.casefold()) or any(Path(r['path']).name.casefold() == name.casefold() for r in catalog.loose):
                    raise ValueError('Previously missing audio is available; re-audit exception: ' + name)
                conversion_gaps.append({'kind': 'missing-audio', 'resource': name, **missing})
                audio.append({'callee': call['callee'], 'arguments': simplify(call['arguments']),
                    'url': None, 'sourcePc': call['pc'], 'playbackEnabled': False, 'missing': True})
                continue
            p = catalog.lookup(name)
            dest = output / 'audio' / p.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(p, dest)
            audio.append({'callee': call['callee'], 'arguments': simplify(call['arguments']),
                          'url': dest.relative_to(output).as_posix(), 'sha256': sha(dest),
                          'sourcePc': call['pc'], 'playbackEnabled': False})
    world_settings = [{'callee': c['callee'], 'arguments': simplify(c['arguments']), 'sourcePc': c['pc']}
                      for c in scene['calls'] if c['target'] == {'$symbol': 'g_pWorld'}
                      and not c['callee'].startswith('Create')]
    tools = [Path(__file__), EXCEPTIONS_PATH, Path(__file__).with_name('scene_kl.py'),
             Path(__file__).with_name('scene_gltf.py'), Path(__file__).with_name('scene_animation.py'),
             Path(__file__).with_name('scene_vendor') / 'parser.py']
    outputs = [{'path': p.relative_to(output).as_posix(), 'bytes': p.stat().st_size, 'sha256': sha(p)}
               for p in sorted(output.rglob('*')) if p.is_file() and p.name != 'manifest.json']
    manifest = {'schemaVersion': 1, 'sceneId': scene_id, 'sourceScene': source_scene,
                'referenceVersion': 'NA-2016-V6.0420.5-resources', 'toolVersion': TOOL_VERSION,
                'evidence': 'original configuration and mesh resources; native client unmeasured',
                'sourceInputsReadOnly': True, 'originalLayoutAdapted': False,
                'coordinates': {'native': 'Y-up, DirectX left-handed, original resource units',
                                'gltf': 'Y-up right-handed, original resource units',
                                'pointNativeToGltf': '[x, y, -z]', 'unitScale': 1,
                                'meterRelation': 'unconfirmed', 'uv': 'original values retained',
                                'matrices': 'C * transpose(native row matrix) * C, C=diag(1,1,-1,1)'},
                'geometry': {'url': 'scene.glb', 'sha256': sha(output / 'scene.glb'),
                             'meshCount': len(exporter.doc['meshes']), 'skinCount': len(exporter.doc['skins']),
                             'triangles': sum(len(m['triangles']) for m in exporter.render_meshes)},
                'collision': {'url': 'collision.json', 'sha256': sha(output / 'collision.json'),
                              'coordinateSystem': 'nativeXYZ', 'bounds': coll['bounds'], 'lineCount': len(coll['lines'])},
                'objects': objects, 'worldSettings': world_settings, 'audio': audio,
                'conversionGaps': conversion_gaps, 'textureAliases': texture_aliases,
                'camera': {'mode': 'fixed', 'dynamicEnabled': False, 'skillCameraEnabled': False,
                           'sourceSlots': coll['cameraSlots'],
                           'sourceSlotsUsage': 'authored line references retained; not established as map default camera',
                           'projectionDeclaration': next((x for x in world_settings if x['callee'] == 'SetProjection'), None),
                           'fixedViewerPose': None, 'fixedViewerPoseEvidence': 'set explicitly by internal viewer; not a client measurement'},
                'previewPolicy': preview_policy,
                'unknowns': coll['unknownSemantics'] + ['native default camera and projection parameter meanings',
                                                      'wind tick rate and Normal/nomal animation alias',
                                                      'fog, source layer/cull/lighting and alpha native defaults'],
                'sources': sorted(catalog.used.values(), key=lambda x: (x['archive'] or '', x['ordinal'] or 0, x['name'])),
                'converters': [{'path': str(p.relative_to(own_root)).replace('\\', '/'), 'sha256': sha(p)} for p in tools],
                'outputs': outputs}
    dump(output / 'manifest.json', manifest)
    return manifest


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source-root', type=Path, default=Path('asset_sources/upstream'))
    ap.add_argument('--output', type=Path, default=Path('artifacts/scene') / SCENE_ID)
    args = ap.parse_args()
    result = build(args.source_root, args.output)
    print(json.dumps({'sceneId': result['sceneId'], 'geometry': result['geometry'],
                      'collision': result['collision'], 'sources': len(result['sources']),
                      'unknowns': result['unknowns']}, ensure_ascii=False))


if __name__ == '__main__':
    main()

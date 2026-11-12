import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('awakening_bead_v14', ROOT / 'tools/assets/build_awakening_bead_v14.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SOURCE = Path('asset_work/raw/data')

class AwakeningBead(unittest.TestCase):
    def test_actual2016_particle_declaration_and_decoded_texture_match_contract(self):
        raw = (SOURCE / 'data036.kom/GameMajorParticle7.txt').read_bytes()
        template, match = module.parse(raw)
        contract = json.loads((ROOT / 'contracts/rf-awakening-bead-fx-v14.json').read_text('utf-8'))
        frozen = contract['templates'][module.NAME]
        self.assertEqual(template['fields'], frozen['fields'])
        self.assertEqual(template['events'], frozen['events'])
        self.assertEqual(module.digest(raw), module.PARTICLE_SHA)
        self.assertEqual(module.digest(match[0].encode('latin1')), frozen['declarationSha256'])
        texture = next(iter(frozen['textures'].values()))
        self.assertEqual(module.digest((ROOT / 'artifacts/ui/awakening-bead' / texture['file']).read_bytes()), texture['outputSha256'])
        self.assertFalse(contract['clientMeasured'])

    def test_actual_new_hud_center_comes_from_lua_top_left_and_original_tet_size(self):
        layout = module.inspect_layout(SOURCE / 'data034.kom/DLG_PVP_Game_My_State_NEW.lua',
            SOURCE / 'data057.kom/DLG_UI_Common_Texture25_NEW.TET')
        self.assertEqual(layout['leftTop'], [57,59])
        self.assertEqual(layout['size'], [42,34])
        self.assertEqual(layout['center'], [78,76,0])
        self.assertEqual(layout['sha256'], '84fc0f0d865738c2b6306ab148e3d9389f11189ec4856eae0ab8cb18af00158c')

    def test_missing_duplicate_and_changed_particle_inputs_are_rejected(self):
        raw = (SOURCE / 'data036.kom/GameMajorParticle7.txt').read_bytes()
        _, match = module.parse(raw)
        declaration = match[0].encode('latin1')
        for data in (b'', declaration + declaration,
                     declaration.replace(b'Emitrate\t\t\t= 20', b'Emitrate\t\t\t= 30'),
                     declaration.replace(b'PT_2D_PLANE', b'PT_MESH')):
            with self.assertRaises(ValueError): module.parse(data)

if __name__ == '__main__': unittest.main()

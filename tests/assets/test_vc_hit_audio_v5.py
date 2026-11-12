import importlib.util, json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets'))
spec = importlib.util.spec_from_file_location('vc_hit_audio', ROOT/'tools/assets/build_vc_hit_audio_v5.py')
tool = importlib.util.module_from_spec(spec); spec.loader.exec_module(tool)
import audio
SOURCE = Path('asset_work')
CONTRACT = json.loads((ROOT/'contracts/vc-hit-audio-source-v5.json').read_bytes())


class VcHitAudioTest(unittest.TestCase):
    def test_actual_target_records_are_independently_decoded_and_share_exact_damage_sound_table(self):
        catalog = tool.Catalog(SOURCE)
        enum = tool.read_declarations(catalog.path('Enum.lua'))['globals']
        damage = tool.read_declarations(catalog.path('DamageEffect.lua'), enum, True, True)['globals']
        for name, records in CONTRACT['effectSounds'].items():
            self.assertEqual(records, {k:v for k,v in damage[name].items() if k.startswith('SOUND') and k[5:].isdigit()})
            for row in records.values():
                self.assertEqual(row.get('RATE', 100), 100)
        self.assertEqual(len(CONTRACT['effectSounds']), 34)
        self.assertEqual(sum(map(len, CONTRACT['effectSounds'].values())), 37)
        for row in CONTRACT['sources']:
            self.assertEqual(tool.digest((SOURCE/row['rawPath']).read_bytes()), row['sha256'])
        rf = json.loads((ROOT/'contracts/rf-hit-audio-source-v17.json').read_bytes())
        self.assertEqual(CONTRACT['damageSoundTables'], rf['bindings']['damageSoundTables'])

    def test_exact_original_effect_sound_bytes_and_damaged_ogg(self):
        manifest = json.loads((ROOT/'artifacts/vc/audio/manifest.json').read_bytes())
        names = {row['FILE_NAME'] for records in CONTRACT['effectSounds'].values() for row in records.values()}
        names.update(row['name'] for row in manifest['referenceTriggers']['files'])
        for name in names:
            record = manifest['files'][name]
            original = (SOURCE/record['source']['raw_path']).read_bytes()
            actual = (ROOT/'artifacts/vc'/record['file']).read_bytes()
            self.assertEqual(actual, original, name)
            self.assertEqual(tool.digest(actual), record['sha256'])
            self.assertEqual(len(actual), record['bytes'])
            self.assertTrue(audio.inspect_ogg(actual)['crcValidated'])
        crow = (SOURCE/manifest['files']['Raven_IgnitionCrowBang.ogg']['source']['raw_path']).read_bytes()
        for bad in (crow[:12], crow[:-1], crow[:-1]+bytes([crow[-1]^1])):
            with self.assertRaises(ValueError): audio.inspect_ogg(bad)

    def test_finite_dependency_extraction_captures_mesh_sound_without_deduplicating_runtime_records(self):
        profile = {'states': {'S': {'raw': {'SOUND_PLAY0': {'1':.01, '2':'State.ogg'}}}},
                   'damageEffects': {'D': {'raw': {'SOUND0': {'FILE_NAME':'Impact.ogg'},
                     'SOUND1': {'FILE_NAME':'Impact.ogg'}, 'UNRELATED':'DoNotCopy.ogg'}}}}
        self.assertEqual(audio.sound_references(profile)[1], ['Impact.ogg','State.ogg'])
        self.assertEqual(len(audio.effect_sound_references(profile)['D']), 2)
        profile['damageEffects']['D']['raw']['SOUND0']['FILE_NAME'] = '../escape.ogg'
        with self.assertRaises(ValueError): audio.sound_references(profile)
        with self.assertRaises(ValueError): audio.sound_references({'states':{}}, {'evidence':'guess','files':[]})

    def test_raven_core_callback_roots_apply_to_both_professions_only_and_match_frozen_consumer(self):
        expected = {'Raven_NasodCore_Trans_Attack.ogg','Raven_NasodCore_Attack.ogg'}
        for unit in [107,115]:
            merged = audio.reference_sound_contract({'target':{'unitClass':unit}})
            self.assertEqual({r['name'] for r in merged['files']}, expected)
            self.assertEqual(merged['evidence'], 'reference-v5; target triggers unmeasured')
        self.assertIsNone(audio.reference_sound_contract({'target':{'unitClass':2}}))
        row = next(r for r in CONTRACT['cppSources'] if r['path']=='X2Lib/X2GURaven.cpp')
        raw = (ROOT/row['localPath']).read_bytes();self.assertEqual(tool.digest(raw),row['sha256'])
        text = raw.decode('latin1').splitlines()
        self.assertIn('PlaySound( L"Raven_NasodCore_Trans_Attack.ogg" );', text[14371])
        self.assertIn('PlaySound( L"Raven_NasodCore_Attack.ogg" );', text[14489])


if __name__ == '__main__': unittest.main()

import importlib.util, json, sys, tempfile, unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets'))
spec=importlib.util.spec_from_file_location('hit_audio',ROOT/'tools/assets/build_hit_audio_v17.py')
tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)
from kl82_static import parse, read_declarations
SOURCE=Path('asset_work')
CONTRACT=json.loads((ROOT/'contracts/rf-hit-audio-source-v17.json').read_bytes())


class HitAudioTest(unittest.TestCase):
    def test_actual_target_damage_sound_table_enum_and_rf_material_are_independent_inputs(self):
        catalog=tool.Catalog(SOURCE)
        enum=read_declarations(catalog.path('Enum.lua'))['globals']
        raw=read_declarations(catalog.path('DamageSound.lua'))['globals']
        tables={str(enum['HIT_TYPE'][key]):{str(enum['HITTED_TYPE'][k]):v for k,v in value.items()}
            for key,value in raw.items() if key in enum['HIT_TYPE']}
        self.assertEqual(CONTRACT['bindings']['damageSoundTables'],tables)
        self.assertEqual(enum['HIT_TYPE']['HT_SWORD_SLASH'],1);self.assertEqual(enum['HITTED_TYPE']['HTD_MEAT'],1)
        self.assertEqual(raw['HT_SWORD_SLASH']['HTD_MEAT'],'HitSlash.wav')
        self.assertEqual(raw['HT_SWORD_SLASH2']['HTD_MEAT'],'HitSlash2.wav')
        self.assertEqual(CONTRACT['bindings']['rfHittedType'],1)
        for record in CONTRACT['targetSources']:
            self.assertEqual(tool.digest((SOURCE/record['rawPath']).read_bytes()),record['sha256'])

    def test_frozen_consumers_separate_hit_lookup_from_mesh_sound_and_preserve_guards_defaults(self):
        docs={r['path']:(ROOT/r['localPath']).read_bytes() for r in CONTRACT['cppSources']}
        for record in CONTRACT['cppSources']:
            self.assertEqual(tool.digest(docs[record['path']]),record['sha256'])
        user=docs['X2Lib/X2GUUser.cpp'].decode('latin1')
        block='\n'.join(user.splitlines()[8325:8354])
        self.assertIn('RT_NO_DAMAGE',block);self.assertIn('RT_SENSOR',block)
        self.assertIn('GetDamageSound( pDamageData->hitType, m_HittedType )',block)
        self.assertIn('PlaySound( wszSoundName );',block);self.assertNotIn('RT_DUMMY_DAMAGE',block)
        manager=docs['X2Lib/X2DamageManager.cpp'].decode('latin1')
        self.assertIn('HT_NO_SOUND == hitType',manager);self.assertIn('HTD_NO_SOUND == hittedType',manager)
        self.assertIn('m_DamageSoundName[hitType][HTD_DEFAULT]',manager)
        self.assertIn('m_DamageSoundName[HT_DEFAULT][HTD_DEFAULT]',manager)
        effect=docs['X2Lib/X2DamageEffect.cpp'].decode('latin1')
        self.assertIn('pSoundData->fEventTime < pMeshInst->GetGlobalTime()',effect)
        self.assertIn('pMeshInst->GetXSkinAnim()->EventTimer( pSoundData->fEventTime )',effect)
        self.assertIn('m_SoundDataList.erase( m_SoundDataList.begin() + i );',effect)
        self.assertIn('data.iRate,\t\t\t\t100',effect)
        self.assertIn('PlaySound(L"Raven_ElectricAura_Disappear.ogg");',docs['X2Lib/X2GURaven.cpp'].decode('latin1'))

    def test_actual_black_spine_literals_and_all_effect_sound_rates_are_confirmed(self):
        enum=read_declarations(SOURCE/'raw/data/data036.kom/Enum.lua')['globals']
        damage=read_declarations(SOURCE/'raw/data/data036.kom/DamageEffect.lua',enum,True,True)['globals']
        for name in ('DamageEffect_RSI_OVER_TAKER_BIG_SPINE','DamageEffect_RSI_OVER_TAKER_UP_SPINE'):
            self.assertEqual(damage[name]['SOUND0'],{'EVENT_TIME':.01,'FILE_NAME':'Raven_OT_ComboX3Front.ogg'})
            self.assertEqual(CONTRACT['bindings']['effectSounds'][name]['SOUND0'],damage[name]['SOUND0'])
        for records in CONTRACT['bindings']['effectSounds'].values():
            for record in records.values(): self.assertEqual(record.get('RATE',100),100)

    def test_actual_wav_ogg_files_copy_exact_bytes_and_corrupt_containers_and_kl_are_rejected(self):
        report=json.loads((ROOT/'reports/rf-hit-audio-assets-v17.json').read_bytes())
        for name,record in report['addedOrVerifiedFiles'].items():
            raw=(SOURCE/record['source']['rawPath']).read_bytes()
            self.assertEqual(raw,(ROOT/'artifacts/audio'/record['file']).read_bytes())
            self.assertEqual(tool.digest(raw),record['sha256'])
            inspect=tool.inspect_ogg if name.lower().endswith('.ogg') else tool.inspect_wave
            self.assertEqual(inspect(raw),record['format'])
        slash=(ROOT/'artifacts/audio/HitSlash.wav').read_bytes()
        for broken in (slash[:12],slash[:-1],b'NOPE'+slash[4:]):
            with self.assertRaises(ValueError):tool.inspect_wave(broken)
        spine=(ROOT/'artifacts/audio/Raven_OT_ComboX3Front.ogg').read_bytes()
        for broken in (spine[:12],spine[:-1],spine[:-1]+bytes([spine[-1]^1])):
            with self.assertRaises(ValueError):tool.inspect_ogg(broken)
        raw=(SOURCE/'raw/data/data036.kom/DamageSound.lua').read_bytes()
        for broken in (raw[:8],raw[:-1],b'bad!'+raw[4:]):
            with self.assertRaises((ValueError,IndexError)):parse(broken)

    def test_full52_source_coverage_and_deterministic_asset_handover(self):
        report=json.loads((ROOT/'reports/rf-hit-audio-coverage-v17.json').read_bytes())
        combos=json.loads((ROOT/'reports/rf-all-combo-source-audit-v9.json').read_bytes())['rows']
        self.assertEqual([r['id'] for r in report['rows'] if r['kind']=='combo'],[r['state'] for r in combos if r['presentAtBaseline']])
        skills=json.loads((ROOT/'reports/rf-full-skill-catalog-v1.json').read_bytes())['highestSkills']
        self.assertEqual([r['id'] for r in report['rows'] if r['kind']=='active'],[r['skillId'] for r in skills if not r['passive']])
        self.assertEqual(report['counts'],{'combos':32,'actives':20})
        prior=(ROOT/'artifacts/audio/manifest.json').read_bytes()
        frozen_contract=(ROOT/'contracts/rf-hit-audio-source-v17.json').read_bytes()
        (ROOT/'runtime').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='hit-audio-test-',dir=ROOT/'runtime') as directory:
            project=Path(directory);output=project/'audio';output.mkdir()
            (output/'manifest.json').write_bytes(prior)
            tool.build(SOURCE,output,output_root=project,project_root=project)
            self.assertEqual((output/'manifest.json').read_bytes(),prior)
            self.assertEqual((project/'contracts/rf-hit-audio-source-v17.json').read_bytes(),frozen_contract)
            self.assertEqual(json.loads((project/'reports/rf-hit-audio-coverage-v17.json').read_bytes()),report)
            handover=json.loads((ROOT/'reports/rf-hit-audio-assets-v17.json').read_bytes())
            for name,record in handover['files'].items():
                data=(output/name).read_bytes()
                if name=='manifest.json':
                    # The v17 receipt predates later original audio additions.
                    # Rebuilding against the current sealed manifest must keep
                    # its exact input bytes; historical audio hashes below stay
                    # pinned independently of this generator.
                    self.assertEqual(data,prior)
                else:
                    self.assertEqual(len(data),record['bytes']);self.assertEqual(tool.digest(data),record['sha256'])
                self.assertEqual(data,(ROOT/'artifacts/audio'/name).read_bytes())
        self.assertEqual((ROOT/'artifacts/audio/manifest.json').read_bytes(),prior)
        self.assertEqual((ROOT/'contracts/rf-hit-audio-source-v17.json').read_bytes(),frozen_contract)

    def test_isolated_output_cannot_write_reports_into_published_project(self):
        with self.assertRaisesRegex(ValueError,'Isolated audio reports'):
            tool.build(SOURCE,ROOT/'runtime/audio-no-write/audio',output_root=ROOT/'runtime/audio-no-write')
        self.assertFalse((ROOT/'runtime/audio-no-write').exists())


if __name__=='__main__':unittest.main()

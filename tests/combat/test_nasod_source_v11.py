"""Read actual target2016 bytes and fixed-reference consumers independently."""
from pathlib import Path
import hashlib,json,re,sys,unittest
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/combat'))
from kl82_static import read_declarations
class NasodSource(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.target=json.loads((ROOT/'contracts/rf-nasod-target-v11.json').read_bytes())
        cls.fx=json.loads((ROOT/'contracts/rf-core-shield-fx-index-v11.json').read_bytes())
        cls.reference=json.loads((ROOT/'contracts/rf-native-nasod-v11.json').read_bytes())
        cls.enum=read_declarations(Path(cls.target['declarationSources'][2]['path']))
    def test_actual_target_small_state_and_original_set(self):
        raven=read_declarations(Path(self.target['declarationSources'][0]['path']),self.enum['globals'],capture_unresolved=True)
        self.assertEqual(json.loads(json.dumps(raven['globals']['RSI_PARRYING_SMALL'])),self.target['smallState']['raw'])
        effect=read_declarations(Path(self.target['declarationSources'][1]['path']),self.enum['globals'],capture_calls=True,capture_unresolved=True)
        calls=[call for call in effect['nativeCalls'] if call['target']=='g_pEffectSet.AddEffectSetTemplet_LUA'
             and isinstance(call['args'][-1],dict) and call['args'][-1].get('NAME')=='EffectSet_RAVEN_PARRING']
        self.assertEqual(len(calls),1);self.assertEqual(calls[0]['args'][-1],self.target['effectSet']['raw'])
    def test_actual_enum_and_all_declared_target_hashes(self):
        for source in self.target['declarationSources']:
            self.assertEqual(hashlib.sha256(Path(source['path']).read_bytes()).hexdigest(),source['sha256'])
        for name,value in self.target['blockedExtraTypes'].items():self.assertEqual(self.enum['globals']['EXTRA_DAMAGE_TYPE'][name],value)
    def test_actual_particle_declaration_spans_and_dds_bytes(self):
        for name,record in self.fx['templates'].items():
            raw=(Path('asset_work')/record['source']['rawPath']).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(),record['source']['sha256'])
            text=raw.decode('latin1');pattern=r'eventsequence\s+"'+re.escape(name)+r'"\s*\{([^{}]*)\}'
            matches=list(re.finditer(pattern,text));self.assertEqual(len(matches),1)
            self.assertEqual(hashlib.sha256(matches[0][0].encode('latin1')).hexdigest(),record['declarationSha256'])
            self.assertEqual(matches[0].start(),record['source']['byteOffset'])
            for texture in record['textures'].values():
                dds=(Path('asset_work')/texture['source']['rawPath']).read_bytes()
                self.assertEqual(hashlib.sha256(dds).hexdigest(),texture['source']['sha256'])
    def test_fixed_consumer_custom_position_and_now_foot_order(self):
        for source in self.reference['referenceFiles']:
            self.assertEqual(hashlib.sha256((ROOT/'.cache/native-source-runtime'/source['relativePath']).read_bytes()).hexdigest(),source['sha256'])
        effect=(ROOT/'.cache/native-source-runtime/X2Lib/X2EffectSet.cpp').read_bytes().decode('latin1').splitlines()
        custom='\n'.join(effect[2789:2802]);self.assertIn('m_bCustomPosition',custom);self.assertIn('vPos = m_vPosition;',custom);self.assertIn('return vPos;',custom)
        user=(ROOT/'.cache/native-source-runtime/X2Lib/X2GUUser.cpp').read_bytes().decode('latin1').splitlines()
        self.assertIn('< LINE_RADIUS','\n'.join(user[17461:17468]))
        reaction='\n'.join(user[11395:11411]);self.assertIn('CanParrying() == false',reaction);self.assertIn('RSI_PARRYING_SMALL',reaction)
if __name__=='__main__':unittest.main()

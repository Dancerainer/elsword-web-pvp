"""Original literal expectations and malformed-input tests, not game-runtime tests."""
from pathlib import Path
import hashlib
import os
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/combat'))
from kl82_static import parse, declarations, read_declarations, Reader, Unsupported, arithmetic


def uleb(v):
    out = bytearray()
    while v > 127:
        out.append((v & 127) | 128); v >>= 7
    out.append(v)
    return bytes(out)


def mini(words=None):
    # Self-authored KL82 sample: sample = -3, then return. Not copied client bytes.
    words = words or [0x16 | (0xfffd << 16), 0x3d, 0x47]
    prototype = b'\0\0\1\0' + uleb(1) + uleb(0) + uleb(len(words))
    prototype += struct.pack('<'+'I'*len(words), *words) + uleb(11) + b'sample'
    return b'\x1bKL\x82\2' + uleb(len(prototype)) + prototype + b'\0'


class ParserTests(unittest.TestCase):
    def test_self_authored_signed_declaration(self):
        data = mini(); result, positions, calls = declarations(parse(data))
        self.assertEqual(result, {'sample': -3})
        self.assertEqual(positions['sample']['assignmentInstruction'], 1)
        self.assertEqual(calls, [])

    def test_all_truncations_rejected(self):
        data = mini()
        for end in range(len(data)):
            with self.subTest(end=end), self.assertRaises(ValueError): parse(data[:end])

    def test_magic_flags_and_trailing_data_rejected(self):
        for data in [b'\x1bLJ\x82'+mini()[4:],mini()[:4]+b'\x03'+mini()[5:],mini()+b'x']:
            with self.assertRaises(ValueError): parse(data)

    def test_unknown_opcode_and_branch_rejected(self):
        for word in [0x55, 0x38, 0x2c]:
            with self.assertRaises(Unsupported): declarations(parse(mini([word,0x47])))

    def test_register_bounds_primitive_gc_and_num_bounds(self):
        for word in [0x0c|(0xffff<<16),0x18|(4<<16),0x17,0x14|(5<<16)]:
            with self.assertRaises(ValueError): declarations(parse(mini([word,0x47])))

    def test_uleb32_and_tagged33_bit(self):
        with self.assertRaises(ValueError): Reader(uleb(1<<32)).uleb()
        self.assertEqual(Reader(uleb((1<<33)-1)).uleb(bits=33),(1<<33)-1)

    def test_unresolved_arithmetic_not_guessed(self):
        value = arithmetic('ADDVV', {'$symbol':'unknown'}, 2)
        self.assertIn('$unsupported', value)
        self.assertIn('$unsupported', arithmetic('ADDVV', True, 2))
        with self.assertRaises(ValueError): arithmetic('DIVVV', 4, 0)


class ActualTargetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = Path(os.environ.get('ELSWORD_TARGET_RAW','asset_work/raw/data/data036.kom'))
        if not cls.raw.is_dir(): raise unittest.SkipTest('Read-only original target cache is not present')
        cls.enums = read_declarations(cls.raw/'Enum.lua')['globals']

    def test_target_enum_mapping_and_hash(self):
        p = self.raw/'Enum.lua'
        self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),'e5c98600ea7dafe8a4bc9d45fbd473cd0f6b91b4e3073017ec2d88ed76eb1eb6')
        self.assertEqual(self.enums['UNIT_CLASS']['UC_RAVEN_RECKLESS_FIST'],107)
        self.assertEqual(self.enums['EFFECT_SET_TIMER_TYPE'],{'ESTT_ANIM':0,'ESTT_CUSTOM':1})
        self.assertEqual(self.enums['DELETE_CONDITION_EFFECT_SET']['DCES_STATE_END'],2)
        self.assertEqual(self.enums['FALSE'],0)

    def test_target_rf_literal_fields(self):
        p=self.raw/'RAVEN_FIGHTER.lua'; result=read_declarations(p,self.enums)
        self.assertEqual(result['source']['sha256'],'a5c3a8abf0f6c9c7d6fa185e20bdf7d43c0f2b463a3a98168bf9c7e0f92552e3')
        r=result['globals']; self.assertEqual(len(r),308)
        self.assertEqual(r['INIT_PHYSIC']['RUN_SPEED'],725)
        self.assertAlmostEqual(r['RSI_COMBO_ZZ']['ATTACK_TIME0'][1],.176)
        self.assertEqual(r['RSI_HYPER_MODE']['ANIM_NAME'],'BoostPower')

    def test_target_rf_tree_and_enhanced_ownership(self):
        result=read_declarations(self.raw/'NewSkillTempletVer2.lua',self.enums,capture_calls=True)
        nodes=[c['args'][-1] for c in result['nativeCalls'] if c['target'].endswith('AddSkillTreeTemplet_LUA') and c['args'][-1].get('m_eUnitClass')==107]
        owned={n['m_iSkillID'] for n in nodes};self.assertIn(24027,owned);self.assertIn(24203,owned);self.assertNotIn(24216,owned)
        temps={c['args'][-1]['m_eID']:c['args'][-1] for c in result['nativeCalls'] if c['target'].endswith('AddSkillTemplet_LUA')}
        self.assertEqual(temps[24027]['m_DeleteSkillIDByUpgrade'],24002)
        self.assertEqual(temps[24027]['SA_ULTIMATE_STRENGTHENED_SKILL_POWERRATE'][1],1.2)

    def test_damage_and_effect_set_literal_clocks(self):
        d=read_declarations(self.raw/'DamageEffect.lua',self.enums,capture_calls=True,capture_unresolved=True)['globals']
        self.assertEqual(d['DamageEffect_RF_COMBO_Z']['USE_GLOBAL_TIME'],1)
        self.assertAlmostEqual(d['DamageEffect_RF_COMBO_Z']['ATTACK_TIME_START'],.092)
        self.assertEqual(d['RAVEN_NASOD_BALL']['DAMAGE_DATA']['IGNORE_DEFENCE_ON_PVP'],0)
        e=read_declarations(self.raw/'EffectSet.lua',self.enums,capture_calls=True,capture_unresolved=True)
        z=next(c['args'][-1] for c in e['nativeCalls'] if isinstance(c['args'][-1],dict) and c['args'][-1].get('NAME')=='EffectSet_RF_COMBO_Z')
        self.assertEqual(z['EFFECT0']['SCALE_X'],2.6)


if __name__ == '__main__': unittest.main()

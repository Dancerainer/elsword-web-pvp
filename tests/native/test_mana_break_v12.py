"""Pinned actual source extraction and target KL; no original client execution."""
from pathlib import Path
import hashlib, json, os, shutil, sys, tempfile, unittest
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/native'));sys.path.insert(0,str(ROOT/'tools/combat'))
import build_mana_break as builder
from kl82_static import read_declarations

class ManaSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cache=ROOT/'.cache/mana-source'
        if not cls.cache.is_dir():raise unittest.SkipTest('Verified private Mana source cache absent')
        cls.records,cls.pieces,cls.macros,cls.constants=builder.fragments(cls.cache)

    def test_original_six_bodies_and_declared_macros_are_frozen_independently(self):
        self.assertEqual(len(self.pieces),6)
        self.assertEqual(self.constants,b'#define ONE_CHARGE 100.0f\n#define TWO_CHARGE 200.0f\n#define THREE_CHARGE 300.0f\n')
        expected=['56c117b2e9b638e0e357902a5c7bd5fd53759af793a25a249d220c70200e1d3a',
                  'e9b70eaf97e0bcf8656e11607edc8adcaabe2e28819320175b4caaf3caa2919a',
                  'd603d62631dd1de747532ac6005f883d33503435ec6d9aee78d0b293a6f678a4',
                  '9f28c9c3783b6b6c893a36c45045355e8bc87251cc74d711b02d4b96c3904960',
                  'f474e1aed7de34ae80c0a0631679cfce52b69974cb73016e0f2d327e5ed37b31',
                  '53009be5d2cee353b64086248ef7429de6bbed6f1d62d1fcbc02dd5df9a6367d']
        self.assertEqual([hashlib.sha256(p[1]).hexdigest() for p in self.pieces],expected)
        self.assertIn('FIX_FORCE_DOWN_AND_DETONATION_BUG',self.macros)
        self.assertIn('SERV_9TH_NEW_CHARACTER',self.macros)

    def test_corrupt_actual_source_and_missing_header_are_rejected_without_repair(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'source';shutil.copytree(self.cache,target)
            path=target/'X2Lib/X2GageData.cpp';original=path.read_bytes();path.write_bytes(original+b'\n')
            with self.assertRaisesRegex(ValueError,'Source hash mismatch'):builder.fragments(target)
            self.assertEqual(path.read_bytes(),original+b'\n')
            path.write_bytes(original);(target/'X2Lib/X2GageUI.h').unlink()
            # Flat fallback copies are excluded from this corruption fixture.
            fallback=target/'X2GageUI.h'
            if fallback.exists():fallback.unlink()
            with self.assertRaises(FileNotFoundError):builder.fragments(target)

    def test_target2016_charge_rate_is_read_again_from_original_KL_not_the_runtime(self):
        raw=Path(os.environ.get('ELSWORD_TARGET_RAW','asset_work/raw/data/data036.kom'))
        raven=raw/'RAVEN_FIGHTER.lua'
        if not raven.is_file():self.skipTest('Actual target KL absent')
        self.assertEqual(hashlib.sha256(raven.read_bytes()).hexdigest(),'a5c3a8abf0f6c9c7d6fa185e20bdf7d43c0f2b463a3a98168bf9c7e0f92552e3')
        enum=read_declarations(raw/'Enum.lua')['globals']
        self.assertEqual(read_declarations(raven,enum)['globals']['INIT_COMPONENT']['MP_CHARGE_RATE'],130)

if __name__=='__main__':unittest.main()

"""Small actual-source and damaged-input checks, independent of the JS runtime."""
import sys, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/native'))
from check_rf_direction_source_v16 import method,HASHES,digest

class SourceChecks(unittest.TestCase):
    def test_actual_fixed_source_methods(self):
        for rel,names in {'X2Lib/X2GUUser.cpp':['WalkFrameMoveFuture','StateChangeDashIfPossible'],
                          'X2Lib/X2GURaven.cpp':['RSI_DASH_END_EventProcess']}.items():
            data=(ROOT/'.cache/native-source-runtime'/rel).read_bytes()
            self.assertEqual(digest(data),HASHES[rel])
            for name in names:
                body,first,last=method(data,name)
                self.assertTrue(body.startswith(b'void '));self.assertGreater(last,first)
    def test_missing_duplicate_and_truncated_methods(self):
        data=(ROOT/'.cache/native-source-runtime/X2Lib/X2GUUser.cpp').read_bytes()
        body,_,_=method(data,'WalkFrameMoveFuture')
        for invalid in [b'',body+body,body[:-1]]:
            with self.assertRaises(ValueError):method(invalid,'WalkFrameMoveFuture')
    def test_ground_priority_and_no_dash_facing_assignment(self):
        data=(ROOT/'.cache/native-source-runtime/X2Lib/X2GUUser.cpp').read_bytes()
        walk,_,_=method(data,'WalkFrameMoveFuture');dash,_,_=method(data,'StateChangeDashIfPossible')
        self.assertLess(walk.index(b'm_InputData.pureRight'),walk.index(b'm_InputData.pureLeft'))
        self.assertNotIn(b'bIsRight',dash)

if __name__=='__main__':unittest.main()

import sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/native'))
from check_rf_keyboard_source_v19 import PINS,sha,fragment
from check_rf_state_schedule_v19 import PIN

class SourceTests(unittest.TestCase):
 def test_actual_fixed_files_and_six_fragments(self):
  for name,pin in PINS.items():
   data=(ROOT/'.cache/native-source-runtime'/name).read_bytes();self.assertEqual(sha(data),pin)
  device=(ROOT/'.cache/native-source-runtime/KTDXLIB/KTDIDeviceWinKey.cpp').read_bytes()
  for name in ['Read','GetKeyState','GetPureKeyState','GetDoubleKeyPureState','GetDoubleKeyState']:
   body,first,last=fragment(device,rb'BOOL\s+CKTDIDeviceWinKey::'+name.encode()+rb'\([^)]*\)');self.assertTrue(body.endswith(b'}'));self.assertGreater(last,first)
  game=(ROOT/'.cache/native-source-runtime/X2Lib/X2Game.h').read_bytes()
  self.assertGreater(len(fragment(game,rb'inline void InputData\([^)]*\)')[0]),400)
  user=(ROOT/'.cache/native-source-runtime/X2Lib/X2GUUser.cpp').read_bytes();self.assertEqual(sha(user),PIN)
 def test_fixed_manager_files_macros_and_getters(self):
  folder=ROOT/'.cache/input-manager-source-v19';cpp=(folder/'KTDIManager.cpp').read_bytes();header=(folder/'KTDIManager.h').read_bytes()
  self.assertEqual(sha(cpp),'df4e04a9195146450421a56d89ef0099efe99ba2e54cb9949818518008799820')
  self.assertEqual(sha(header),'67624f15256381c81fe8493a29718acbe4432e79aacaee4a3b63cdaf66f645c9')
  self.assertEqual(header.count(b'#define GET_DOUBLEKEYPURE_STATE'),2)
  for name in ['GetActionState','GetPureActionState','GetDoubleActionPureState','GetDoubleActionState','ApplyActionInput','HandleAction','SetActionState','UpdateData']:
   self.assertTrue(fragment(cpp,rb'(?:BOOL|void)\s+CKTDIManager::'+name.encode()+rb'\([^)]*\)')[0].endswith(b'}'))
 def test_missing_duplicate_and_truncated_fragment_rejected(self):
  data=b'BOOL CKTDIDeviceWinKey::Read(int v){if(v){return 1;}return 0;}'
  pattern=rb'BOOL CKTDIDeviceWinKey::Read\([^)]*\)'
  for broken in [b'',data+data,data[:-1]]:
   with self.assertRaises(ValueError):fragment(broken,pattern)

if __name__=='__main__':unittest.main()

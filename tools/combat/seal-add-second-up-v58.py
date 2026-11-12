"""Bounded static seal of original Add second-UP predicates; never execute target."""
from pathlib import Path
import hashlib,json,struct,sys
sys.dont_write_bytecode=True;sys.path.insert(0,'asset_sources/analysis/offline-libs')
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
ROOT=Path(__file__).resolve().parents[2]
source=Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe');raw=source.read_bytes()
sha=lambda b:hashlib.sha256(b).hexdigest()
expected='b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba';assert sha(raw)==expected
pe=struct.unpack_from('<I',raw,60)[0];opt=pe+24;base=struct.unpack_from('<I',raw,opt+28)[0]
count,size=struct.unpack_from('<H',raw,pe+6)[0],struct.unpack_from('<H',raw,pe+20)[0]
sections=[struct.unpack_from('<IIII',raw,opt+size+i*40+8) for i in range(count)]
def offset(a):
 for vs,rva,rs,start in sections:
  if base+rva<=a<base+rva+min(vs,rs):return start+a-base-rva
 raise ValueError(hex(a))
def block(a,n,purpose):
 b=raw[offset(a):offset(a)+n];rows=[{'address':hex(i.address),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str} for i in Cs(CS_ARCH_X86,CS_MODE_32).disasm(b,a)]
 assert sum(len(bytes.fromhex(r['bytes'])) for r in rows)==n
 return {'address':hex(a),'bytes':n,'fileOffset':offset(a),'sha256':sha(b),'hex':b.hex(),'purpose':purpose,'instructions':rows}
reference=Path('./runtime/add-feedback-v37/X2GUAdd.cpp')
ref=reference.read_bytes();refsha='b9ea0a23c074dfb366a9886823d046ad419acc474c53ae6ccd5c71ab3071de6a';assert sha(ref)==refsha
lines=ref.splitlines(keepends=True)
sectionsref=[{'firstLine':a,'lastLine':b,'sha256':sha(b''.join(lines[a-1:b]))} for a,b in [(2783,2796),(5337,5430),(5937,6012)]]
out={'schemaVersion':1,'id':'add-second-up-v58','originalClientExecuted':False,'rawConfigurationChanged':False,
 'source':{'path':str(source),'sha256':expected,'originalClientSha256':'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
  'qualification':'Existing static analysis late snapshot3 is a distinct possibly non-atomic derived artifact, not original-client execution.'},
 'fixedReference':{'path':str(reference),'sha256':refsha,'commit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633','sections':sectionsref,
  'qualification':'Version-qualified V5 reference includes2026 reconstruction; original direct native predicates below take priority.'},
 'blocks':[
  block(0x32769947,0x2d,'ANSI_JUMP_UP state16 registration: event327741e0'),
  block(0x32769a0d,0x2d,'ANSI_JUMP_DOWN state17 registration: event32774670'),
  block(0x327741e0,5,'JumpUp thunk to3272bab0'),block(0x32774670,5,'JumpDown thunk to3272f350'),
  block(0x3272bab0,0xde,'Entire JumpUp direct body: air dash, skill, oneUp644b/oneDoubleUp644d with eligibility6fbd, then Z/X/vertical zero/riding; no position-height predicate'),
  block(0x3272f350,0xec,'Entire JumpDown direct body: same UP/eligibility branch before support/Z/X/vertical/riding, no position-height predicate')],
 'findings':['Original2016 JumpUp/Down have no second-UP height threshold. They select state123 and clear eligibility on fresh UP or oneDoubleUP.',
  'Current source-level final-keyboard sampling collapses release/down within one packet and may miss a complete short second tap. This is independently reproduced at public UI input API.',
  'A scoped local Add project adapter recovers one real coalesced UP down edge while free in JumpUp/Down with eligibility, or LevitationWait. It does not alter source sampled defaults or jump speed.',
  'Ground/initial same-packet doubles, skill/lock/hitstop/death, other professions, inspector taps, no-real-edge repeats and already pressed UP are unchanged.',
  'Corrected existing pressed input is sent/recorded; receiver/replay need no DOM edges or new network schema. No future-packet requeue is used.'],
 'limits':['Project usability exception is not original2016 input fidelity.',
  'Native direct callbacks are sealed statically, not executed in the original client.',
  'Entire two-tap gestures before the initial jump has entered free air are deliberately not split into a later artificial second jump.']}
(ROOT/'contracts/add-second-up-v58.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n','utf8',newline='\n')
print(json.dumps({'blocks':len(out['blocks']),'originalClientExecuted':False}))

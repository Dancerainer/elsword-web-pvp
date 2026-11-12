"""Read-only bounded original Add spans. Never execute the derived target."""
from pathlib import Path
import hashlib,json,struct,sys
sys.dont_write_bytecode=True
sys.path.insert(0,'asset_sources/analysis/offline-libs')
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
ROOT=Path(__file__).resolve().parents[2]
source=Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe')
raw=source.read_bytes();sha=lambda b:hashlib.sha256(b).hexdigest()
expected='b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba'
assert sha(raw)==expected
pe=struct.unpack_from('<I',raw,60)[0];opt=pe+24;base=struct.unpack_from('<I',raw,opt+28)[0]
count,size=struct.unpack_from('<H',raw,pe+6)[0],struct.unpack_from('<H',raw,pe+20)[0]
sections=[struct.unpack_from('<IIII',raw,opt+size+i*40+8) for i in range(count)]
def off(a):
 for vs,rva,rs,start in sections:
  if base+rva<=a<base+rva+min(vs,rs):return start+a-base-rva
 raise ValueError(hex(a))
def block(a,n,purpose):
 b=raw[off(a):off(a)+n]
 rows=[{'address':hex(i.address),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str} for i in Cs(CS_ARCH_X86,CS_MODE_32).disasm(b,a)]
 assert sum(len(bytes.fromhex(r['bytes'])) for r in rows)==n
 return {'address':hex(a),'fileOffset':off(a),'bytes':n,'sha256':sha(b),'hex':b.hex(),'purpose':purpose,'instructions':rows}
spans=[(0x3276b266,0x29,'ThirdZ registration'),(0x327747b0,5,'ThirdZ thunk'),(0x327308f0,0x316,'ThirdZ complete event body ending tail-jump: off-support state17,Y-=30,localVX550'),
 (0x3276b44a,0xd2,'XXZZ registrations0x88..8a'),(0x327747f0,5,'Start event thunk'),(0x327313a0,0x5f,'Start event complete .456'),
 (0x32774800,5,'Loop start thunk'),(0x32731400,0x16,'Loop start complete: receivedCommonStart, noDetonation=1'),
 (0x32778df0,5,'Loop post thunk'),(0x32765210,0x190,'Loop post complete: increment; count<2 or count<=8 and fresh-Z flag repeats'),
 (0x32776380,5,'Loop Now-frame thunk'),(0x32756580,0x20c,'Loop Now-frame complete: .01 timer, shared resource gate1 and original set'),
 (0x32774810,5,'Loop end thunk'),(0x32731420,0x16,'Loop end complete: receivedCommonEnd, noDetonation=0'),
 (0x32778e00,5,'Finish StartFuture thunk'),(0x327653a0,0xb7,'Finish StartFuture complete: resetcount/loop sound'),
 (0x3276b555,0x39,'JumpX registration'),(0x32774820,5,'JumpZ post thunk'),(0x32731440,0x18f,'JumpZ post complete: support->ordinaryJUMPLANDING'),
 (0x32774830,5,'JumpX Future thunk'),(0x327315d0,0x1ad,'JumpX complete Future: pureDown&&!pureUp extra gravity and flag before commonFuture'),
 (0x32774840,5,'JumpX post thunk'),(0x32731780,0x18f,'JumpX complete post: support->ordinaryJUMPLANDING before cancellation'),
 (0x32774ee0,5,'Hover post thunk'),(0x3273e660,0x282,'Hover complete post ordering'),
 (0x32769e2b,0x31,'AirDash registration'),(0x32774eb0,5,'AirDash post thunk'),(0x3273e0f0,0x217,'AirDash complete post: .45 duration/attack/Up/direction/Down, no support-to-landing guard'),
 (0x3305f610,4,'550f'),(0x32fe7800,8,'loop lower comparison2double'),(0x32fe9cb0,8,'loop extension cap8double')]
# Scalar spans are data, not disassembled instructions.
blocks=[]
for a,n,why in spans:
 if why.endswith(('f','double')):
  b=raw[off(a):off(a)+n];blocks.append({'address':hex(a),'bytes':n,'sha256':sha(b),'hex':b.hex(),'purpose':why,'value':struct.unpack('<f' if n==4 else '<d',b)[0]})
 else:blocks.append(block(a,n,why))
out={'schemaVersion':1,'id':'add-movement-command-v61','originalClientExecuted':False,
 'source':{'path':str(source),'sha256':expected,'originalClientSha256':'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
 'qualification':'Existing static analysis late-snapshot3 is a distinct possibly non-atomic derived artifact; this is static evidence only.'},
 'blocks':blocks,'findings':['Third Z walk-off explicitly sets localVX550, replacing preceding raw3000.',
 'XXZZ requires2minimum/9maximum LOOP entries before Finish; raw start/finish damage declarations remain independent.',
 'Original extension tests fresh oneZ and retains its flag for this LOOP; held pureZ alone is not an extension condition.',
 'Original LOOP uses a registered Now frame at .01 with gate argument1, unlike the2026 V5 Start/DP2 reconstruction.',
  'JumpX Future consumes pureDown&&!pureUp extra gravity; JumpX post chooses ordinary JUMPLANDING when supported.',
  'Hover Down/lowMP precedes support-to-landing. Original free JumpUp/Down UP branches precede support; see unchanged add-second-up-v58 original complete callbacks.',
  'AirDash has no early support landing guard and consumes Down->DASHJUMP after CanDown; other native riding/wall special cases remain outside this bridge.'],
 'limits':['No original-client dynamic trajectory was measured.','Low88Z/input sampling investigation remains separate.']}
(ROOT/'contracts/add-movement-command-v61.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n','utf8',newline='\n')
print(json.dumps({'spans':len(blocks)}))

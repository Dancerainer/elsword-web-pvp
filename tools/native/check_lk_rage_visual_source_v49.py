"""Read-only narrow target2016 visual calls; no executable/client execution."""
from pathlib import Path
import argparse,hashlib,json,struct,sys
parser=argparse.ArgumentParser()
parser.add_argument('--snapshot',type=Path,default=Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe'))
parser.add_argument('--libraries',type=Path,default=Path('asset_sources/analysis/offline-libs'))
parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[2]/'contracts/lk-rage-visual-native-v49.json')
args=parser.parse_args();sys.path.insert(0,str(args.libraries))
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
data=args.snapshot.read_bytes();sha=lambda b:hashlib.sha256(b).hexdigest()
expected='b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba'
if sha(data)!=expected:raise ValueError('Pinned derived snapshot changed')
pe=struct.unpack_from('<I',data,60)[0];opt=pe+24;base=struct.unpack_from('<I',data,opt+28)[0]
count=struct.unpack_from('<H',data,pe+6)[0];opt_size=struct.unpack_from('<H',data,pe+20)[0]
sections=[struct.unpack_from('<IIII',data,opt+opt_size+i*40+8)for i in range(count)]
def offset(address):
 for vs,rva,rs,ro in sections:
  if base+rva<=address<base+rva+min(rs,vs):return address-base-rva+ro
 raise ValueError(hex(address))
def read(address,size):return data[offset(address):offset(address)+size]
cs=Cs(CS_ARCH_X86,CS_MODE_32);address=0x3296ac20;body=read(address,747)
if sha(body)!='c12105316aac558718176b27b065efce849fae9a10198ae08a38f468cdcea45f':raise ValueError('Rage consumer changed')
roots=[]
for name,string_at,push_at,call_at,callee in[
 ('MonsterAngryWind',0x33046dd0,0x3296add1,0x3296add7,0x31ce4890),
 ('Counter_Particle01',0x33046da8,0x3296ae25,0x3296ae2b,0x31ce4890),
 ('ELSWORD_ANGRY_WIND',0x33094ee0,0x3296aedb,0x3296aee1,0x31f0a1e0)]:
 literal=read(string_at,len(name)*2+2)
 if literal!=name.encode('utf-16le')+b'\0\0':raise ValueError('Original visual literal changed')
 if read(push_at,5)!=b'\x68'+struct.pack('<I',string_at):raise ValueError('Visual literal reference changed')
 displacement=struct.unpack('<i',read(call_at+1,4))[0]
 if read(call_at,1)!=b'\xe8' or call_at+5+displacement!=callee:raise ValueError('Visual call changed')
 roots.append(dict(name=name,stringAddress=hex(string_at),pushAddress=hex(push_at),callAddress=hex(call_at),callee=hex(callee),stringSha256=sha(literal)))
constants=dict(modelYAdd=struct.unpack('<d',read(0x32fe8088,8))[0],rageDuration=struct.unpack('<f',read(0x330922c4,4))[0])
if constants!={'modelYAdd':80.,'rageDuration':6.}:raise ValueError('Original Rage constants changed')
result=dict(schemaVersion=1,targetExecuted=False,targetClientMeasured=False,
 evidenceClass='offline source-bound static decode; actual Web execution is separate',
 source=dict(path=str(args.snapshot),sha256=expected,bytes=len(data),
  originalClientSha256='edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
  qualification='Existing late snapshot3 derived PE may be non-atomic; original input identity is separate. Static inspection confirmed this target hash; no decompilation completion is claimed.'),
 consumer=dict(address=hex(address),fileOffset=offset(address),bytes=len(body),sha256=sha(body),hex=body.hex(),
  instructions=[dict(address=hex(i.address),bytes=i.bytes.hex(),mnemonic=i.mnemonic,operands=i.op_str)for i in cs.disasm(body,address)]),
 visualRoots=roots,constants=constants,
 scope='This exact reaction consumer creates two particles and one damage effect. It is not evidence that every skill/HUD icon path is correct.',
 limitations=['No original-client execution, GPU pixel comparison or identification of the player-reported icon.',
  'Counter Attack skill21206/RevengeWait minor particle and status HUD are separate paths; do not replace Rage particles with guessed icons.'])
args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(dict(output=str(args.output),address=hex(address),roots=[r['name']for r in roots],targetExecuted=False)))

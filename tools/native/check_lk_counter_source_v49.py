"""Freeze the original2016 Counter Attack minor-particle callback, read-only."""
from pathlib import Path
import hashlib,json,struct,sys
sys.path.insert(0,'asset_sources/analysis/offline-libs')
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
ROOT=Path(__file__).resolve().parents[2];path=Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe');data=path.read_bytes();sha=lambda b:hashlib.sha256(b).hexdigest()
if sha(data)!='b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba':raise ValueError('Target snapshot drift')
pe=struct.unpack_from('<I',data,60)[0];opt=pe+24;base=struct.unpack_from('<I',data,opt+28)[0];count=struct.unpack_from('<H',data,pe+6)[0];size=struct.unpack_from('<H',data,pe+20)[0]
sections=[struct.unpack_from('<IIII',data,opt+size+i*40+8)for i in range(count)]
def off(a):
 for vs,rva,rs,ro in sections:
  if base+rva<=a<base+rva+min(vs,rs):return a-base-rva+ro
 raise ValueError(hex(a))
def read(a,n):return data[off(a):off(a)+n]
cs=Cs(CS_ARCH_X86,CS_MODE_32)
def block(a,n,label):
 b=read(a,n);return dict(label=label,address=hex(a),fileOffset=off(a),bytes=n,sha256=sha(b),hex=b.hex(),instructions=[dict(address=hex(i.address),bytes=i.bytes.hex(),mnemonic=i.mnemonic,operands=i.op_str)for i in cs.disasm(b,a)])
constants={key:struct.unpack(fmt,read(a,struct.calcsize(fmt)))[0]for key,a,fmt in[
 ('animationTrigger',0x3307ba68,'<f'),('questionTrigger',0x32ff7ac8,'<f'),('height',0x33010f68,'<d'),('forward',0x32fdf380,'<d'),('backward',0x33011508,'<d'),('emitRate',0x32ff5a04,'<f')]}
if constants!={'animationTrigger':struct.unpack('<f',struct.pack('<f',.09))[0],'questionTrigger':struct.unpack('<f',struct.pack('<f',.7))[0],'height':70.,'forward':100.,'backward':-100.,'emitRate':10.}:raise ValueError(constants)
if read(0x32976e30,5)!=bytes.fromhex('e98ba8fdff')or read(0x329736b2,5)!=bytes.fromhex('b8306e9732'):raise ValueError('Counter callback registration drift')
if read(0x33065ef8,24)!='RevengeWait'.encode('utf-16le')+b'\0\0':raise ValueError('Minor particle literal drift')
result=dict(schemaVersion=1,targetExecuted=False,targetClientMeasured=False,source=dict(path=str(path),sha256=sha(data),bytes=len(data),qualification='Existing source-bound derived PE; may be non-atomic; no target execution'),
 blocks=[block(0x32973689,136,'ESSI_REVENGE_WAIT registration, normal and hyper frame32976e30'),block(0x32976e30,5,'Frame thunk to329516c0'),block(0x32960600,74,'Minor constructor literalRevengeWait slot11 trigger-wait'),block(0x329516c0,646,'FrameMove .09 RevengeWait, .7 QuestionMark, then CommonFrameMove')],
 constants=constants,implemented=dict(template='RevengeWait',registry='GameMinorParticle',triggerCount=5,emitRate=[10,10],position='actor xyz + world Y70 + saved original line dir * facing100',addRotate='[0, saved line yaw including facing180 +70, 0]'),
 remaining=['The separate .7 QuestionMark path uses a persistent common sequence position; its complete head/bone-position lifetime is not reconstructed here.'])
output=ROOT/'contracts/lk-counter-native-v49.json';output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps(dict(output=str(output),constants=constants)))

"""Original input/Gauge/Detonation static spans; never execute target."""
from pathlib import Path
import hashlib,json,struct,sys,subprocess
sys.dont_write_bytecode=True;sys.path.insert(0,'asset_sources/analysis/offline-libs')
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
ROOT=Path(__file__).resolve().parents[2]
source=Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe');raw=source.read_bytes()
sha=lambda b:hashlib.sha256(b).hexdigest();expected='b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba';assert sha(raw)==expected
pe=struct.unpack_from('<I',raw,60)[0];opt=pe+24;base=struct.unpack_from('<I',raw,opt+28)[0]
count,size=struct.unpack_from('<H',raw,pe+6)[0],struct.unpack_from('<H',raw,pe+20)[0]
sections=[struct.unpack_from('<IIII',raw,opt+size+i*40+8) for i in range(count)]
def off(a):
 for vs,rva,rs,start in sections:
  if base+rva<=a<base+rva+min(vs,rs):return start+a-base-rva
 raise ValueError(hex(a))
def block(a,n,why,kind='code'):
 b=raw[off(a):off(a)+n];r={'address':hex(a),'fileOffset':off(a),'bytes':n,'sha256':sha(b),'hex':b.hex(),'purpose':why}
 if kind=='code':
  rows=[{'address':hex(i.address),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str} for i in Cs(CS_ARCH_X86,CS_MODE_32).disasm(b,a)]
  assert sum(len(bytes.fromhex(v['bytes'])) for v in rows)==n;r['instructions']=rows
 return r
blocks=[block(a,n,why) for a,n,why in [
 (0x31c445a0,0x10,'Manager pure action complete: manager49[index]!=0; no duration'),
 (0x31d08cd0,0x13,'Default keyboard device held branch: action518 mapping ->device10[key]!=0; device mode3 axis branches separate'),
 (0x320cfdc0,0x7c,'Game input helper complete: four ordered getters; pure manager output stored in provided third pointer'),
 (0x320c108a,0x25,'Logical X action1 callsite; Z0 preceding320c1085 is independently sealed in fixed static analysis input report'),
 (0x31f66b80,0x2c,'SetInputData prefix preserves all80B unfiltered raw input at6492 before attack suppression'),
 (0x31f6c7a0,0x67,'User Event complete: unsuppressed pureZ64a2/pureX64a6 latchf2, noDetonation580c clearscharge andf2; no holding timer'),
 (0x3277a920,0x118,'Base Gauge Frame complete: f2, currentMPmax, rate*elapsed, clamp currentMP/zero, clearf2; no independent holding timer'),
 (0x327798e0,0x4c,'Base Gauge request complete: charge>=100 ->reserve fullcharge andactivate; noKD operation'),
 (0x3277cbb0,0x95,'UpCharge complete: plainfloat addition/encryptedstore, no300 cap'),
 (0x31fc1650,0x8b,'SetMax complete: plainencryptedstore, no300 cap'),
 (0x3272b9b0,5,'Add virtual3ec thunk toUser Detonation'),
 (0x31f37930,0x16a,'User Detonation complete: nonDT_BUFF ->force1 downfront/back/air then .7stop and RevengeImpactTick'),
 (0x31fabc31,0x40,'DamageReact preserves580c forDT_BUFF, otherwise copiesDamageData484 then setsdamageReactPending580d'),
 (0x3276b7c0,0x53,'AirXX charge registration selects327748b0 Start'),(0x327748b0,5,'AirXX chargeStart thunk'),
 (0x32732810,0x1e,'AirXX chargeStart complete: commonstart, chargecounter0, noDetonation=1'),
 (0x3276fbb4,0x53,'MM XXDownX LOOP registration selects32774b70 Start'),(0x32774b70,5,'MM XXDownX LOOP Start thunk'),
 (0x32735800,0x36,'MM XXDownX LOOP Start prefix: commonstart andnoDetonation=1 beforehandbone lookup'),
 ]]
blocks.extend([block(0x330625bc+0x3ec,4,'Add vtable3ec','data'),block(0x330254d4+0x30,4,'Base Gauge vtable request','data'),block(0x330254d4+0x38,4,'Base Gauge vtableFrame','data'),block(0x32fdf380,8,'request100double','data'),block(0x32ff7ac8,4,'.7stopfloat','data')])
ref='0f96f609c26cdf03afb80da7203f796a6747bc3d'
sources=[]
for p in ['docs/HIT_INPUT_CANCELLATION_2016.md','reports/analysis/hit-input-cancel-2016/input-rules.json']:
 b=subprocess.check_output(['git','-C','asset_sources/analysis-project','show',ref+':'+p]);sources.append({'repository':'asset_sources/analysis-project','commit':ref,'path':p,'bytes':len(b),'sha256':sha(b)})
out={'schemaVersion':1,'id':'mana-host-v61','originalClientExecuted':False,'source':{'path':str(source),'sha256':expected,
 'originalClientSha256':'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729','qualification':'static analysis late snapshot3 is distinct possibly non-atomic derived source.'},
 'existingReaSources':sources,'blocks':blocks,
 'confirmed':['Logical action pure is a held level; four ordered getters and raw6492 copy do not add a hold duration.',
 'The recovered User Event and base Gauge Frame have no independent initial hold delay. Source component rate130 and request100 imply approximately100/130=.76923 unfrozen charge seconds plus packet phase.',
 'Detonation requests Down with force1 then .7stop. V61 preserves last received reaction and appliesdown/consumes once after stop as an explicit Web scheduling adaptation.',
 'Ordinary hit clears the prior noDetonation flag fromDamageData; DT_BUFF does not clear an existing flag.',
 'Mana reserve/down does not clear independentKD; ordinaryRT_DOWN behavior must not accidentally resetKD when Mana takes precedence.'],
 'limits':['Original physical key mapping, device mode/heap and actual gameplay frame timings were not measured.',
 'Web Now/Future/received pose scheduling is not claimed1:1.',
 'Existing fixedV5 compiled gauge additionally capscharge300; recovered original baseFrame/UpCharge/SetMax do not. This difference is retained explicitly pending project scope decision.',
 'Elesis-specific gauge and other role overrides are not generalized from the recovered base Gauge.']}
(ROOT/'contracts/mana-host-v61.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n','utf8',newline='\n')
print(json.dumps({'blocks':len(blocks),'analysisSources':len(sources)}))

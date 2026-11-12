"""Fresh read-only2016 declaration decode and exact native cancellation seal."""
from pathlib import Path
import hashlib,json,sys,re
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/combat'))
from kl82_static import read_declarations
from prepare_lk_declarations import EnumTable
sha=lambda b:hashlib.sha256(b).hexdigest()
rawroot=Path('asset_work/raw/data/data036.kom')
expected={'Enum.lua':'e5c98600ea7dafe8a4bc9d45fbd473cd0f6b91b4e3073017ec2d88ed76eb1eb6',
 'Add_NasodRuler.lua':'47476953d8ab9fd70f518938cf1306ef719ccf58c51313d3342747c3074a243d'}
for name,digest in expected.items():assert sha((rawroot/name).read_bytes())==digest,name
enums=read_declarations(rawroot/'Enum.lua',capture_unresolved=True)
unit=read_declarations(rawroot/'Add_NasodRuler.lua',EnumTable(enums['globals']),capture_unresolved=True)
name='ANSI_ATT_DASH_JUMP_COMBO_ZX';state=unit['globals'][name]
assert state['WALK_CANCEL_AFTER']==.3 and state['DASH_CANCEL_AFTER']==.25 and state['ATTACK_CANCEL_AFTER']==.25
missing_pattern=r'^ANSI_(?:ATT|ADE)_DASH_JUMP_COMBO_ZXX'
assert not any(re.search(missing_pattern,k) for k in unit['globals'])
old=json.loads((ROOT/'contracts/add-de-command-native-v45.json').read_text('utf8'))
image=Path(old['source']['path']).read_bytes();assert sha(image)==old['source']['sha256']
for row in [old['functions']['event'],old['functions']['cancelStateGetter'],old['stateStartFuture'],old['unimplementedPhysicsPreview']]:
 b=image[row['fileOffset']:row['fileOffset']+row['bytes']];assert sha(b)==row['sha256'] and b.hex()==row['hex']
event=old['functions']['event']
def region(start,end):
 address=int(event['address'],16);off=event['fileOffset']+start-address;b=image[off:off+end-start]
 return {'address':hex(start),'fileOffset':off,'bytes':len(b),'sha256':sha(b),'hex':b.hex()}
out={'schemaVersion':1,'targetClientMeasured':False,'targetExecuted':False,
 'evidenceClass':'fresh2016 static declaration decode + original-derived native byte verification; no client execution',
 'sources':{'enum':enums['source'],'add':unit['source'],'native':old['source']},
 'state':{'name':name,'raw':state,'sourcePc':unit['locations'][name]},
 'native':{'event':{k:event[k] for k in ['address','fileOffset','bytes','sha256']},
  'walk':region(0x3273961a,0x3273967f),'dash':region(0x3273967f,0x327396e3),
  'attack':region(0x327396e3,0x32739799),'cancelGetter':old['functions']['cancelStateGetter']},
 'confirmed':{'walk':'strict animationTime>WALK_CANCEL_AFTER, grounded and either source direction level => WAIT13',
  'dash':'strict animationTime>DASH_CANCEL_AFTER, grounded and source double direction => virtual+4f0 dash request',
  'order':'animation end, other skill branches, walk, dash, attack; retains original cancellation ordering',
  'attack':'strict animationTime>ATTACK_CANCEL_AFTER and grounded pureZ/X => virtual+3e0/+3e4 both WAIT13'},
 'boundedNegativeSearch':{'input':'all freshly decoded Add_NasodRuler.lua global names','pattern':missing_pattern,'matches':[],
  'relatedNames':[k for k in unit['globals'] if re.search(r'^ANSI_(?:ATT|ADE)_DASH_JUMP_COMBO_Z',k)]},
 'limits':['Original full-client trajectories remain unmeasured.','Native327433a0 eight-step FullPhysicProcess landing preview remains unsupported; no guessed teleport/displacement added.',
  'The raw input field in327395b6..32739618 extra landing branch remains unqualified and is not guessed.','No dedicatedZXX attack state is inferred from player notation.']}
(ROOT/'contracts/de-aerial-cancel-v49.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n','utf8')
print(json.dumps({'state':name,'cancel':{k:state[k] for k in ['WALK_CANCEL_AFTER','DASH_CANCEL_AFTER','ATTACK_CANCEL_AFTER']},'source':unit['source'],'nativeEventSha256':event['sha256']}))

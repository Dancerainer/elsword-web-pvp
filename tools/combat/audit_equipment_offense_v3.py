from pathlib import Path
import hashlib,json,struct,sys
sys.path.insert(0,'tools/combat')
from kl82_static import parse
p=Path('asset_work/raw/data/data036.kom/SocketOptionForm.lua');raw=p.read_bytes()
pinned=json.loads(Path('contracts/is-additional-attack-source-v1.json').read_text())
assert hashlib.sha256(raw).hexdigest()==pinned['target']['sha256']
parsed=parse(raw)
for name,index in [('CalculateLinearAdditionalAttackValue',8),('CalculateIntermediateAdditionalAttackValue',41),('CalculateFinalAdditionalAttackValue',74)]:
 assert parsed['prototypes'][index]==pinned['target']['prototypes'][name]
base=Path('./.cache')
inputs=[(base/'native-v5-unified/X2Lib/X2GameUnit.cpp',[(12474,12474),(14297,14380)]),(base/'native-v5-unified/X2Lib/X2GUUser.cpp',[(9175,9209),(9377,9410)]),(base/'native-skills-source/X2Lib/X2BuffTemplet.h',[(892,954)]),(base/'native-source-runtime/X2Lib/X2GameUnit.h',[(2593,2593),(2620,2623)])]
files=[]
for p,ranges in inputs:
 raw=p.read_bytes()
 prior=next((row for row in pinned['reference']['files'] if Path(row['path']).name==p.name),None)
 if prior: assert hashlib.sha256(raw).hexdigest()==prior['sha256'],p.name+' fixed reference cache drift'
 lines=raw.splitlines(keepends=True);files.append({'path':p.name,'sha256':hashlib.sha256(raw).hexdigest(),'ranges':[{'firstLine':a,'lastLine':b,'sha256':hashlib.sha256(b''.join(lines[a-1:b])).hexdigest()} for a,b in ranges]})
p=Path('asset_sources/client/data/x2.exe');raw=p.read_bytes();offset=struct.unpack_from('<I',raw,60)[0];count=struct.unpack_from('<H',raw,offset+6)[0];start=offset+24+struct.unpack_from('<H',raw,offset+20)[0]
record={'schemaVersion':1,'targetSocket':pinned['target'],'targetSocketReverified':True,'originalExecutable':{'path':'data/x2.exe','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'sectionNames':[raw[start+40*i:start+40*i+8].rstrip(b'\0').decode(errors='replace') for i in range(count)],'consumerMacroVerified':False},'referenceCommit':pinned['reference']['commit'],'referenceFiles':files,'userDecisions':{'additionalConsumer':'Reuse existing IS fixed-V5 ADJUST_BUFF_CALCULATE candidate, explicitly qualified','equipmentAdditionalInput':'Final resolved ratio, not nominal socket percent','criticalBonus':'Percentage points added to basic1.5'},'additionalFormula':'1.5 * pow(recordedMotionPower,.65) * combinedAdditionalRatio * preBuffComposedAttack','stageOrder':['ordinary defence/final modifiers','critical','equipment reduction','independent additional attack'],'combination':'Invert target final curve for resolved equipment input, add IS FIX/linear points before ONE shared curve, then zero-base1 workaround','criticalFormula':'base1.5 + equipmentCriticalDamageBonus; existing critical Buff/passive/skill/defender channels remain separate','originalClientRuntimeMeasurements':0,'limits':['Target2016 consumer macro unverified; fixed V5 has alternate non-ADJUST ordinary-PvP0.15 branch','No fabricated double-attack consumer','Target raw stat versus composed preBuff attack normalization retains existing accepted PvP candidate boundary']}
Path('contracts/equipment-offense-source-v3.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('Original socket bytecode matched three pinned prototypes; offense source hashes recorded.')

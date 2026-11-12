"""Freeze VC reference consumers separately from the target2016 declarations."""
import hashlib
import json
import re
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/native'))
from run_camera_source import extract

def audit():
    source=ROOT/'.cache/native-source-runtime/X2Lib/X2GURaven.cpp'
    data=source.read_bytes()
    # Same frozen file used by RF reference consumers; no live upstream reads.
    if hashlib.sha256(data).hexdigest() != 'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237':
        raise ValueError('Fixed Raven reference source hash mismatch')
    selections=[]; methods={}
    for match in re.finditer(rb'(?:void|bool|float) CX2GURaven::([A-Za-z0-9_]+)\([^\r\n]*',data):
        name=match[1].decode('ascii')
        if not any(token in name for token in ('RWT','RVC','WEAPON_TAKER','Overheat','OverHeat','SurvivalTechnique','BreakingFist','GROUND_IMPACT','BREAKING_FIST','GigaProminence','DeadlyRaidLoop','CheckAndDoReversalSoldier')) and name not in ('GetReduceDebuffDurationRate','DamageReact','RSI_COMBO_ZZX_EventProcess','RSI_COMBO_ZZZ_EventProcess','RSI_DASH_COMBO_Z_EventProcess','RSI_SOUL_TAKER_DASH_COMBO_ZZ_EventProcess'):
            continue
        signature=match[0]
        block,start,end=extract(data,signature)
        text=block.decode('cp949',errors='replace')
        methods[name]=re.sub(r'/\*.*?\*/|//[^\n]*','',text,flags=re.S)
        selections.append({'method':name,'line':data[:start].count(b'\n')+1,
            'lastLine':data[:end].count(b'\n')+1,'sha256':hashlib.sha256(block).hexdigest(),
            'literalResources':sorted(set(re.findall(r'L"([^"\r\n]+)"',text)))})
    source_record={'path':'X2Lib/X2GURaven.cpp','sha256':hashlib.sha256(data).hexdigest(),
        'gitBlob':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest(),
        'commit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
        'evidenceClass':'fixedV5-version-reference; not target2016 runtime'}
    recovery=ROOT/'.cache/reference-combat-fixes-v11/X2GURaven.cpp'
    recovered=recovery.read_bytes()
    if hashlib.sha256(recovered).hexdigest()!='b6c8db97bea7d086a430ca069f4c047c9fb0290dc6f659906ba871e685c4e641':
        raise ValueError('Pinned recovery source hash mismatch')
    recovered_records=[]
    for match in re.finditer(rb'void CX2GURaven::(RSI_A_RVC_NAPALM_GRENADE_[A-Za-z_]+)\s*\([^\r\n]*',recovered):
        block,start,end=extract(recovered,match[0]);name=match[1].decode('ascii')
        methods[name]=re.sub(r'/\*.*?\*/|//[^\n]*','',block.decode('cp949',errors='replace'),flags=re.S)
        recovered_records.append({'method':name,'line':recovered[:start].count(b'\n')+1,'sha256':hashlib.sha256(block).hexdigest()})
    result={'schemaVersion':1,'source':source_record,'methods':selections,'clientMeasured':False,
        'recoveredReference':{'commit':'a1bcdabf39ee1699873b587b40cedefcce61c7f0','sha256':hashlib.sha256(recovered).hexdigest(),
            'evidenceClass':'2026 reconstructed 2015 reference; not target2016','methods':recovered_records},
        'targetSources':'packages/combat-core/vc-profile.json#sources',
        'limits':['Reference loop counts/old memo IDs cannot override target2016 skill data.',
            'No original client combat/GPU trajectory; current implementation tests are separate.']}
    (ROOT/'contracts/vc-reference-consumers-v1.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8')
    (ROOT/'.cache/vc/source-methods.json').write_text(json.dumps(methods,ensure_ascii=False,indent=2)+'\n','utf8')
    print(json.dumps({'methods':len(methods),'source':source_record}))

if __name__=='__main__':audit()

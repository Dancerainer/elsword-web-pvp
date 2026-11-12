"""Freeze XXX owner candidates and ordered platform-input boundaries.

Reads the target raw KL corpus and pinned local C++ references without executing
the client. The candidate owner epoch remains separate from target declarations.
"""
import argparse
import hashlib
import json
from pathlib import Path

from audit_rf_hit_sources_v14 import file_evidence, method_span

ROOT=Path(__file__).resolve().parents[2]
TARGET=Path('asset_work/raw')
TERMS=('EffectSet_A_RF_XXX','DamageEffect_RF_XXX','RAVEN_RF_XXX_ATTACK_BOX','RSI_COMBO_XXX')


def scan_target_references(target):
    corpus=hashlib.sha256();matches=[];count=0;total=0
    for path in sorted(target.rglob('*.lua'),key=lambda p:p.relative_to(target).as_posix()):
        raw=path.read_bytes();name=path.relative_to(target).as_posix()
        digest=hashlib.sha256(raw).hexdigest();count+=1;total+=len(raw)
        corpus.update(name.encode()+b'\0'+bytes.fromhex(digest))
        hits={}
        for text in TERMS:
            needle=text.encode();offsets=[];pos=raw.find(needle)
            while pos!=-1:
                offsets.append(pos);pos=raw.find(needle,pos+len(needle))
            if offsets:hits[text]=offsets
        if hits:matches.append({'relativePath':name,'bytes':len(raw),'sha256':digest,'asciiByteOccurrences':hits})
    if not count:raise ValueError('Target KL corpus is empty')
    return {'fileCount':count,'totalBytes':total,'orderedPathSha256Digest':corpus.hexdigest(),
            'method':'all raw *.lua exact ASCII byte searches; not decompilation/native xrefs',
            'terms':list(TERMS),'matchingFiles':matches,
            'limit':'Encoded/constructed native names are not excluded by absence of exact KL literals.'}


def audit(root=ROOT,target=TARGET):
    prior=json.loads((root/'contracts/rf-hits-source-v14.json').read_bytes())
    sources=[]
    selected={'X2GURaven.cpp':['void CX2GURaven::RSI_COMBO_XXX_FrameMove(',
        'void CX2GURaven::RSI_WAIT_EventProcess(','void CX2GURaven::RSI_JUMP_DOWN_EventProcess(',
        'void CX2GURaven::RSI_JUMP_COMBO_Z_EventProcess('],
      'X2GUUser.cpp':['void CX2GUUser::CommonStateStart(',
        'bool CX2GUUser::SetDamageData(','HRESULT CX2GUUser::OnFrameMove(',
        'void CX2GUUser::CommonFrameMove_TimedEvent('],
      'X2DamageManager.cpp':['bool CX2DamageManager::SetDamageDataFromLUA( DamageData* pDamageData, KLuaManager& luaManager, const char* pTableName, float fPowerRate, const bool IsEqippedMemo_ )',
        'bool CX2DamageManager::DamageCheck(','bool CX2DamageManager::CollisionDataToUnit('],
      'X2DamageManager.h':['void SimpleInit(']}
    for name,signatures in selected.items():
        path=root/'.cache/native-reference/X2Lib'/name
        expected=next(x for x in prior['sourceFiles'] if x['path'].endswith('/'+name))
        row=file_evidence(path,'.cache/native-reference/X2Lib/'+name)
        if row['sha256']!=expected['sha256']:raise ValueError('Pinned source drift: '+name)
        row['spans']=[method_span(path,s) for s in signatures];sources.append(row)
    return {'schema':'rf-xxx-candidate-v15','targetVersion':prior['targetVersion'],
      'targetClientMeasured':False,'originalClientMeasurementCount':0,
      'referenceCommit':prior['referenceCommit'],'recoveryCommit':prior['recoveryCommit'],
      'targetFiles':prior['targetFiles'],'sourceFiles':sources,
      'targetDeclarations':prior['targetXxxResources'],
      'targetXxxState':next(s['raw'] for s in prior['targetRaven']['states'] if s['name']=='RSI_COMBO_XXX'),
      'targetKlReferenceScan':scan_target_references(target),
      'damageOwnershipConclusion':'CommonStateStart SimpleInit precedes SetDamageData. Missing target XXX DAMAGE_DATA does not inherit XX. Manual sphere cannot acquire a valid package from the target table.',
      'candidate':{'authorization':'User repeated XXX has no hit; root authorized a clearly identified finite target-resource owner adapter.',
        'evidenceClass':'target2016-resource-owner-candidate-unverified','nativeOwnerRecovered':False,
        'ownerState':'RSI_COMBO_XXX','setName':'EffectSet_A_RF_XXX','proposedSetEpoch':'state entry animation/state time zero',
        'damageStart':'unchanged EFFECT1.START_TIME .25 relative to proposed set epoch; never .16+.25',
        'payment':'Existing compiled fixed-reference .16 FlushMp(7) accepts/denies the candidate; target2016 cost/phase equivalence unavailable.',
        'oldPresentation':'Suppress old smoke/flare command requests and ignore its manual sphere; no duplicate old explosion.',
        'lifecycle':'On owner exit retire pending definitions and hand particle identity. A born damage mesh remains world-bound and keeps original .4s lifetime/18 accepted-hit ceiling.',
        'damageUnchanged':{'DAMAGE_TIME':18,'DAMAGE':{'MAGIC':1.2},'HIT_GAP':.15,'stageGlobalTime':.15,
          'mesh':'RAVEN_RF_XXX_ATTACK_BOX','size':[2.5,2.5,2.5],'lifeTime':.4},
        'unsupported':['Target native owner/state epoch equivalence','Target2016 MP cost phase','General LOCK_ON_DATA type4 consumer','Original client/GPU trajectories']},
      'platformInputAdapter':{'evidenceClass':'web-device-clock-adapter-target2016-callback-unavailable',
        'cause':'Distinct Down then attack timestamps can coexist in one 60Hz packet; set-only input runs grounded attack first.',
        'scope':'Supported free grounded platform states, distinct finite Down-before-Z/X timestamps, no Up in packet.',
        'consumer':'Existing native CanDown and drop; retain the attack for exactly the following packet of the resulting drop state.',
        'unchanged':['Same timestamp/unknown order keeps ordinary attack priority','Z-before-Down keeps ordinary attack priority','Rejected CanDown keeps ordinary attack','No attack radius/window/damage/physics constant changes','Dead/input-blocked/interrupted candidates are discarded'],
        'limit':'Original full device/Main callback equivalence remains unavailable; other reported 2Z misses are not declared fixed.'}}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target-raw',type=Path,default=TARGET)
    parser.add_argument('--output',type=Path,default=ROOT/'contracts/rf-xxx-candidate-v15.json')
    args=parser.parse_args();record=audit(target=args.target_raw)
    args.output.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'output':str(args.output),'sourceFiles':len(record['sourceFiles']),
      'klFiles':record['targetKlReferenceScan']['fileCount'],'matchingKlFiles':len(record['targetKlReferenceScan']['matchingFiles']),
      'nativeOwnerRecovered':False,'targetClientMeasured':False}))


if __name__=='__main__':main()

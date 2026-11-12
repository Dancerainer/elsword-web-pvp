"""Hash-check the independent Phantom Sword buff consumer; no source bundle in Git."""
from pathlib import Path
import argparse, hashlib, json

ROOT=Path(__file__).resolve().parents[2]
EXPECTED='3f6a42069971f31ae683bcdb6a5879e1c54e55c65aedf18aedc845f2b73e704a'
HEADER_SHA256='a37e667e1d4c119a498aeac4f1d6d2222c05f8442060bfd5ea979cae95628cae'

def audit(source):
    data=source.read_bytes()
    if hashlib.sha256(data).hexdigest()!=EXPECTED:
        raise ValueError('Pinned X2BuffTemplet.cpp SHA256 mismatch')
    lines=data.splitlines(keepends=True)
    header=(ROOT/'.cache/native-reference/X2Lib/X2DamageManager.h').read_bytes()
    if hashlib.sha256(header).hexdigest()!=HEADER_SHA256:
        raise ValueError('Pinned X2DamageManager.h SHA256 mismatch')
    methods=[('constructor',817,838),('destructor',845,861),('FunctionInCommonStateStart',867,901),
        ('FunctionInCommonFrameMove',907,977),('FunctionInCommonStateEnd',983,1011),
        ('InitializeDamageEffectThridBlade',1017,1054),('InitializeMeshThirdBaldeCenter',1060,1088),
        ('CreateAndInsertThirdBladeData',1094,1148),('MoveDataDataToDamageEffect',1154,1176)]
    result={'schemaVersion':1,'clientMeasured':False,'source':{
        'path':'JP_TW_EU_CN_US/Trunk/X2Lib/X2BuffTemplet.cpp','sha256':EXPECTED,
        'commit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
        'gitBlob':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest(),
        'evidenceClass':'fixedV5 version reference, independently matched raw Git blob; target2016 executable unmeasured'},
        'methods':[{'method':name,'line':start,'lastLine':end,
            'sha256':hashlib.sha256(b''.join(lines[start-1:end])).hexdigest()} for name,start,end in methods],
        'damageLoaderDefault':{'path':'X2Lib/X2DamageManager.h','sha256':HEADER_SHA256,
            'line':1448,'lastLine':1450,'fPowerRate':1,
            'caller':'CreateAndInsertThirdBladeData omits fPowerRate; copied command replaces summon cast power'},
        'consumer':{'buffTemplate':29,'damageEffect':'THIRD_BLADE','centerMesh':'ThirdBladeCenter',
            'bone':'Dummy1_Rhand','delaySeconds':.2,'damageMultiplier':1.2,'defenderStopAdditionSeconds':.033,
            'maxQueueCatchUpPerFrame':2,'damageWindow':'selected ATTACK_TIME / play speed + current mesh time + delay',
            'stateEnd':'clamp final queued attack end to current mesh time + delay',
            'damageOverrides':{'FORCE_DOWN':0,'HIT_ADD_MP':0,'ARRANGED_FLY':True,'ATTACK_TYPE':'AT_SPECIAL'},
            'hitHistory':'fresh DamageData assignment resets hitUnitList for every queued attack',
            'destruction':'remove both handles and clear both queues'},
        'targetDeclarations':'.cache/is-target/damage-declarations.json and packages/combat-core/is-profile.json#sources',
        'limits':['Old memo26 is not a target2016 trait and is deliberately excluded.',
            'No original-client combat, scheduling or GPU trace; source port only.']}
    target=ROOT/'contracts/is-phantom-sword-source-v1.json'
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'contract':str(target),'sha256':EXPECTED,'gitBlob':result['source']['gitBlob']}))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,default=ROOT/'.cache/is-source/X2BuffTemplet.cpp')
    audit(parser.parse_args().source)

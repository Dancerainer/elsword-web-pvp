"""Record hashes of target-derived small data and reference source, not source packages."""
from pathlib import Path
import argparse
import hashlib
import json

ROOT=Path(__file__).resolve().parents[2]


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--native',type=Path,default=ROOT/'.cache/v5-source')
    p.add_argument('--assets-native',type=Path,required=True)
    args=p.parse_args()
    profile=json.loads((ROOT/'packages/combat-core/rf-profile.json').read_text('utf-8'))
    paths={
        'X2GURaven.cpp':'JP_TW_EU_CN_US/Trunk/X2Lib/X2GURaven.cpp',
        'X2GUUser.cpp':'JP_TW_EU_CN_US/Trunk/X2Lib/X2GUUser.cpp',
        'X2GameUnit.cpp':'JP_TW_EU_CN_US/Trunk/X2Lib/X2GameUnit.cpp',
        'X2GameUnit.h':'JP_TW_EU_CN_US/Trunk/X2Lib/X2GameUnit.h',
        'X2DamageEffect.cpp':'JP_TW_EU_CN_US/Trunk/X2Lib/X2DamageEffect.cpp',
        'X2DamageManager.h':'JP_TW_EU_CN_US/Trunk/X2Lib/X2DamageManager.h',
        'X2EffectSet.cpp':'JP_TW_EU_CN_US/Trunk/X2Lib/X2EffectSet.cpp',
        'KTDGXMeshPlayer.cpp':'JP_TW_EU_CN_US/Trunk/KTDXLIB/KTDGXMeshPlayer.cpp',
    }
    sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
    # Git/checkouts can change text newlines on Windows. These are generated
    # UTF-8 deliverables, so hash LF-normalized bytes; raw source hashes above
    # remain exact file-byte hashes.
    deliverable_sha=lambda path:hashlib.sha256(path.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
    out={
        'schemaVersion':1,'scope':'RF M2/M3 research behavior executor',
        'target':profile['target'],'targetSources':profile['sources'],
        'referenceSource':{'repository':'reference-v5',
          'commit':profile['referenceSemantics']['commit'], 'kind':'reference-v5; contains 2026 patches, not target behavior confirmation',
          'files':[{'path':v,'sha256':sha(args.native/v)} for v in paths.values()]},
        'rootMotionReference':{'path':'JP_TW_EU_CN_US/Trunk/KTDXLIB/KTDGXSkinAnim.h','sha256':sha(args.assets_native/'KTDGXSkinAnim.h'),'range':'441..461'},
        'deliverables':[{'path':str(path.relative_to(ROOT)).replace('\\','/'),'sha256':deliverable_sha(path),'hashNormalization':'UTF-8 LF'} for path in [ROOT/'packages/combat-core/index.mjs',ROOT/'packages/combat-core/rf-profile.json',ROOT/'tools/combat/kl82_static.py']],
        'staticChecks':{'targetRfClass':107,'targetNodes':36,'selectedStates':38,'sourceEnumFalse':0,'originalCasesMeasured':0},
        'simulationChecks':{'kind':'simulation-implementation','nodeCommand':'node --test tests/combat/core.test.mjs','pythonCommand':'python -m unittest discover -s tests/combat -p test_kl82.py -v'},
        'acceptance':{'M2':'working strict declaration subset + renderer-independent executor', 'M3':'pending-target-client-baseline', 'clientMeasured':False, 'simulationTestsAreOriginalEvidence':False},
        'unsupported':profile['unsupported'],
    }
    target=ROOT/'reports/rf-combat-evidence.json'
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n','utf-8')
    print(json.dumps({'output':str(target),'referenceFiles':len(paths)}))


if __name__=='__main__':main()

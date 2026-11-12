"""Own complete candidate asset closure; original snapshots/junctions stay read-only."""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OVERLAY = ROOT/'runtime/capacity-assets-overlay'
SEALED_ROOT = Path('.')
SEALED = SEALED_ROOT/'runtime/public-assets/1791648242164-54e4d50dd6a2'
CURRENT = (ROOT/('runtime/original-artifacts-junction' if (ROOT/'runtime/original-artifacts-junction').exists() else 'artifacts')).resolve()
OUTPUT = ROOT/'runtime/capacity-asset-source'
BINARY = {'.glb', '.png', '.ogg', '.wav', '.ttf', '.wasm'}

def sha(data): return hashlib.sha256(data).hexdigest()
def load(path): return json.loads(path.read_text('utf8'))
def write_json(path,value):
    path.write_bytes((json.dumps(value,ensure_ascii=False,allow_nan=False,indent=2)+'\n').encode('utf8'))

def copy_input(source,target):
    target.parent.mkdir(parents=True,exist_ok=True)
    if source.suffix.lower() in BINARY:
        os.link(source,target)
        return 'immutable-binary-hardlink'
    shutil.copy2(source,target)
    return 'private-metadata-copy'

def main():
    global SEALED_ROOT, SEALED, CURRENT, OUTPUT, OVERLAY
    parser=argparse.ArgumentParser()
    parser.add_argument('--resume',action='store_true',help='Finish this task-owned interrupted preparation')
    parser.add_argument('--public-project',type=Path,default=SEALED_ROOT)
    parser.add_argument('--input-artifacts',type=Path,default=CURRENT,help='Read-only local source-proof/evidence additions')
    parser.add_argument('--overlay',type=Path,default=OVERLAY)
    parser.add_argument('--output',type=Path,default=OUTPUT)
    args=parser.parse_args()
    SEALED_ROOT=args.public_project.resolve()
    SEALED=Path(load(SEALED_ROOT/'dist/deployment.json')['assetRoot']).resolve()
    CURRENT=args.input_artifacts.resolve()
    OVERLAY=args.overlay.resolve()
    OUTPUT=args.output.absolute()
    if not OUTPUT.resolve().is_relative_to((ROOT/'runtime').resolve()):raise ValueError('Asset closure must remain inside this task runtime')
    if OUTPUT.resolve()==CURRENT.resolve():raise ValueError('Do not write input artifacts')
    if OUTPUT.exists() and not args.resume:raise ValueError('Candidate asset source must be fresh; use explicit resume for this interrupted task')
    if not OUTPUT.resolve().is_relative_to(ROOT.resolve()):raise ValueError('Candidate source escaped task root')
    if OUTPUT.resolve()!=OUTPUT.absolute():raise ValueError('Candidate source became a link')
    evidence=load(OVERLAY/'vc-metadata-merge-evidence.json')
    if not evidence['readyForClosure']:raise ValueError('VC overlay is not sealed')
    actual_profile=(ROOT/'packages/combat-core/vc-profile.json').read_text('utf8').replace('\r\n','\n').encode('utf8')
    if sha(actual_profile)!=evidence['profileSha256']:raise ValueError('Current merged VC profile differs from overlay')
    inventory=load(SEALED_ROOT/'dist/deployment.json')['files']
    OUTPUT.mkdir(exist_ok=args.resume)
    copied=[]
    for relative,expected in inventory.items():
        source=SEALED/relative
        if sha(source.read_bytes())!=expected:raise ValueError('Old sealed file drift: '+relative)
        target=OUTPUT/relative
        if not target.exists():copy_input(source,target)
        elif not args.resume:raise ValueError('Unexpected pre-existing output: '+relative)
        copied.append(relative)
    # Tests and local source-key audits need preserved conversion evidence that
    # is intentionally absent from the public inventory. Copy/link only absent
    # files; existing frozen public bytes always take precedence over mutable
    # source-worktree asset directories. No source path is ever modified.
    extras=[]
    for folder,_,names in os.walk(CURRENT,followlinks=True):
        for name in names:
            source=Path(folder)/name; relative=source.relative_to(CURRENT)
            target=OUTPUT/relative
            if target.exists():continue
            kind=copy_input(source,target)
            extras.append({'file':relative.as_posix(),'bytes':source.stat().st_size,'kind':kind})
    # A resumed preparation must also inventory extras copied before its interruption.
    extras=[{'file':p.relative_to(OUTPUT).as_posix(),'bytes':p.stat().st_size,
        'kind':'immutable-binary-hardlink' if p.stat().st_nlink>1 else 'private-metadata-copy'}
        for p in OUTPUT.rglob('*') if p.is_file() and p.relative_to(OUTPUT).as_posix() not in inventory]
    changed={}
    for relative in ['manifest.json','runtime-pose.json','runtime-pose.json.gz','fx/index.json']:
        source=OVERLAY/'vc'/relative; target=OUTPUT/'vc'/relative
        if target.stat().st_nlink!=1:raise ValueError('Mutable VC metadata was hardlinked')
        shutil.copy2(source,target)
        changed['vc/'+relative]={'sha256':sha(target.read_bytes()),'bytes':target.stat().st_size}
    rf_path=OUTPUT/'rf/manifest.json'
    if rf_path.stat().st_nlink!=1:raise ValueError('Mutable RF metadata was hardlinked')
    rf=load(rf_path)
    rf_profile_bytes=(ROOT/'packages/combat-core/rf-profile.json').read_text('utf8').replace('\r\n','\n').encode('utf8')
    rf_profile=json.loads(rf_profile_bytes)
    rf_pose=load(OUTPUT/'rf/runtime-pose.json')
    pose_names={clip['name'] for clip in rf_pose['clips']}
    model_names=set(rf['runtimeCharacter']['animations'])
    for state in ['RSI_STANDUP_ATTACK_FRONT_NO_DOWN','RSI_STANDUP_ATTACK_BACK_NO_DOWN']:
        name=rf_profile['states'][state]['animationName']
        if name not in pose_names or name not in model_names:raise ValueError('RF original NO_DOWN pose/model missing: '+name)
    # Unlike VC, the existing RF manifest has no profile seal. Its registered
    # original animation inputs already contain GetChance; preserve these bytes
    # rather than introducing an invented metadata field or changing old FX seals.
    if 'profile' in rf:
        if rf['profile']['profileId']!=rf_profile['profileId']:raise ValueError('RF profile identity changed')
        rf['profile']['sha256']=sha(rf_profile_bytes)
        write_json(rf_path,rf)
        changed['rf/manifest.json']={'sha256':sha(rf_path.read_bytes()),'bytes':rf_path.stat().st_size}
    vc_actual=load(OUTPUT/'vc/manifest.json')
    if vc_actual['profile']['sha256']!=sha(actual_profile):raise ValueError('VC final seal drift')
    # All files from the frozen public inventory except the bounded metadata
    # changes must still match their original verified bytes exactly.
    unchanged=0
    for relative,expected in inventory.items():
        if relative in changed:continue
        if sha((OUTPUT/relative).read_bytes())!=expected:raise ValueError('Unexpected runtime asset change: '+relative)
        unchanged+=1
    result={'schemaVersion':1,'sourceRoot':str(OUTPUT.resolve()),'publicBaseAssetRoot':str(SEALED),
        'publicBaseFiles':len(inventory),'unchangedPublicFilesVerified':unchanged,
        'privateMetadataCopies':True,'immutableBinaryHardlinks':True,'originalSourcesWritten':False,
        'vcProfileSha256':sha(actual_profile),'rfProfileSha256':sha(rf_profile_bytes),
        'rfOriginalNoDownAnimationsAvailable':True,'rfStateCount':len(rf_profile['states']),
        'changedRuntimeMetadata':changed,'additionalLocalEvidenceFiles':extras,
        'limitations':['Local extra source-proof inputs are for tests only and must remain excluded by prepare-public-deployment policy.']}
    write_json(OVERLAY/'capacity-asset-source-evidence.json',result)
    print(json.dumps({key:result[key] for key in ['sourceRoot','publicBaseFiles','unchangedPublicFilesVerified',
        'vcProfileSha256','rfProfileSha256','changedRuntimeMetadata']}))

if __name__=='__main__':main()

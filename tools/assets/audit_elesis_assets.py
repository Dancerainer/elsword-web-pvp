"""Hash the Elesis runtime handoff against the read-only prior resource snapshot."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = Path('./runtime/public-assets/1791851396879-b56d0d7a7c80')
def read(path): return json.loads(path.read_text('utf8'))
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def audit(base):
    assets = ROOT/'artifacts'; selected = set()
    summaries = {}
    for job in ('gm','bh','ca'):
        report = read(ROOT/f'reports/{job}-assets-runtime.json'); summaries[job] = report['summary']
        selected.update(job+'/'+row['file'] for row in report['outputs'])
        selected.update(p.relative_to(assets).as_posix() for p in (assets/'ui/skills'/job).rglob('*') if p.is_file())
    for name in ('ui/lobby/manifest.json','ui/loading/manifest.json','ui/loading/elesis-avatar.png',
                 'costumes/manifest.json','costumes/particles.json','common-buffs/catalog.json','common-buffs/fx/index.json',
                 'common-buffs/manifest.json'):
        selected.add(name)
    for job in ('gm','bh','ca'): selected.add('ui/lobby/portraits/'+job+'.png')
    for folder in ('ui/elesis-way-of-sword','ui/buffs','costumes/elesis','common-buffs/fx'):
        selected.update(p.relative_to(assets).as_posix() for p in (assets/folder).rglob('*')
            if p.is_file() and not p.name.endswith('.animation.json'))
    changed = []
    for name in sorted(selected):
        path = assets/name; digest = sha(path); prior = base/name
        if prior.is_file() and sha(prior) == digest: continue
        changed.append({'file':name,'bytes':path.stat().st_size,'sha256':digest,
                        'priorSha256':sha(prior) if prior.is_file() else None})
    result = {'schemaVersion':1,'assetRoot':str(assets),'baseSnapshot':str(base),
        'scope':'Only runtime artifacts and manifests; original-file evidence/cache/source-proof excluded',
        'summary':{'changedFiles':len(changed),'bytes':sum(r['bytes'] for r in changed),'professions':summaries},
        'profiles':{job:sha(ROOT/f'packages/combat-core/{job}-profile.json') for job in summaries},
        'files':changed,'clientMeasured':False,
        'nativeDllProbe':{'sources':155,'traces':190,'requestSha256':sha(ROOT/'reports/elesis-fx-d3dx-sources-v1.json')},
        'originalMissingDeclarations':{job:read(assets/job/'fx/index.json')['missingTemplates'] for job in summaries},
        'originalMissingOwnerBones':{'bh':['Bop01']},
        'reproduceCommands':[
            'python tools/combat/prepare_elesis_declarations.py',
            'python tools/combat/build_elesis_profiles.py',
            'python tools/assets/character/build_elesis.py',
            'python tools/assets/build_elesis_resources.py',
            'python tools/assets/prepare_elesis_d3dx.py',
            'tools/native/d3dx-animation-probe.ps1 -SourceManifestPath reports/elesis-fx-d3dx-sources-v1.json -OutputPath reports/elesis-fx-d3dx-execution-v1.json -KeyframesPath artifacts/native-d3dx/elesis-fx-keyframes-v1.json -ManifestPath reports/elesis-fx-d3dx-keyframes-v1.json',
            'python tools/assets/prepare_elesis_d3dx.py --complete',
            'python tools/assets/build_elesis_resources.py',
            'python tools/combat/build_elesis_profiles.py',
            'python tools/assets/build_elesis_costumes.py',
            'python tools/assets/build_common_buff_assets.py',
            'python tools/assets/finalize_elesis_assets.py',
            'python -m unittest discover -s tests/assets -p test_elesis_assets.py',
            'python tools/assets/audit_elesis_assets.py'],
        'reproductionPrerequisites':[
            'Restore existing runtime snapshot before new resource work so shared assets and previous costume/UI manifests are retained.',
            'Restore hash-frozen native-DLL keyframe artifacts for existing conversion registries; all registry source hashes must match.',
            'contracts/elesis-skill-reference-v1.json belongs to the separately committed skill-source extraction.',
            'All outputs are task-local; original client and independent upstream catalogs are read-only.'],
        'limits':['Original 2016 client and GPU playback have not been executed.',
            'Text-X collision radii use original helper vertices, the existing geometry bounding-sphere candidate adapter; native constructor equality unmeasured.',
            'No guessed replacement for original missing template names or Bop01.',
            'Presentation density policy and gameplay trigger/cancel acceptance are separate consumers.']}
    target=ROOT/'reports/elesis-resource-handoff-v1.json'
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8',newline='\n')
    print(json.dumps({'files':len(changed),'bytes':result['summary']['bytes'],'reportSha256':sha(target)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--base',type=Path,default=BASE)
    audit(parser.parse_args().base)

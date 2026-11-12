"""Reproducible source-only ADD presentation evidence; never client fidelity gold."""
import json,struct,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/assets/character'))
from build_rf import Catalog,write_json,digest
from build_add import spec

def read(path):return json.loads(path.read_text('utf8'))
def build():
    c=Catalog(Path('asset_work'));motion=c.path('Motion_ADD.x');raw=motion.read_bytes()
    common={'schemaVersion':1,'clientMeasured':False,'unitCenter':{'center':list(struct.unpack_from('<3f',raw,12)),
        'radius':struct.unpack_from('<f',raw,24)[0],'source':c.evidence(motion)},'weaponBindings':{}}
    for job in ('lp','mm','de'):
        s=spec(job);source=c.evidence(c.path(s['weapon']))
        common['weaponBindings'][job]=[{'node':m['name'],'parent':m['target'],'sourceFrame':m['source'],'source':source} for m in s['weaponMounts']]
    write_json(ROOT/'contracts/add-common-presentation-v1.json',common)
    baseline=set()
    for job in ('rf','lk','vc','rs','bm','is'):
        for p in (ROOT/'artifacts'/job).glob('*/index.json'):baseline.update(read(p).get('templates',{}))
    report={'schemaVersion':1,'originalDeclarationsModified':False,'clientMeasured':False,
        'policyRecommendation':'Preserve source clocks for these low-capacity or short-window cues; use a separate moderate divisor4 for dense decorative particles. No combat consumer uses presentation budgets.',
        'professions':{},'names':[]}
    names=set()
    for job in ('lp','mm','de'):
        rows=[]
        for name,t in read(ROOT/f'artifacts/{job}/fx/index.json')['templates'].items():
            f=t['fields'];n=f.get('NumParticles');rate=f.get('Emitrate');life=f.get('Lifetime');window=f.get('TriggerTime');count=f.get('TriggerCount')
            if name in baseline or not isinstance(rate,(int,float)) or rate<=0 or not isinstance(n,(int,float)):continue
            windows=[v for v in (life,window) if isinstance(v,(int,float)) and v>0]
            reasons=[]
            if n<=4:reasons.append('sparse source capacity <=4')
            if windows and 8/rate>min(windows):reasons.append('rate/8 first birth later than source lifetime/emission window')
            if not reasons:continue
            generic=n<=1 or count==1
            preserve=not generic and (n<=4 or isinstance(window,(int,float)) and window>0 and 8/rate>window)
            row={'name':name,'NumParticles':n,'Emitrate':rate,'Lifetime':life,'TriggerTime':window,'TriggerCount':count,
                'firstSourceSeconds':1/rate,'firstDivisor8Seconds':8/rate,'reasons':reasons,'source':t['source'],
                'declarationSha256':t['declarationSha256'],'alreadyProtectedByGenericSingleton':generic,
                'preserveSourceClock':preserve,'lifetimeOnlyNeedsParentAudit':not generic and not preserve}
            rows.append(row)
            if preserve:names.add(name)
        report['professions'][job]=rows
    report['names']=sorted(names);write_json(ROOT/'reports/add-particle-source-clocks-v1.json',report)
    files=set();summaries={}
    for job in ('lp','mm','de'):
        receipt=read(ROOT/f'reports/{job}-assets-runtime.json');summaries[job]=receipt['summary']
        files.update(f'{job}/'+row['file'] for row in receipt['outputs'])
        files.update(p.relative_to(ROOT/'artifacts').as_posix() for p in (ROOT/f'artifacts/ui/skills/{job}').rglob('*') if p.is_file())
    files.update('ui/'+name for name in read(ROOT/'contracts/add-ui-source-v1.json')['pieces'])
    files.add('ui/add/index.json')
    files.update(p.relative_to(ROOT/'artifacts').as_posix() for p in (ROOT/'artifacts/costumes/add').rglob('*') if p.is_file() and not p.name.endswith('.animation.json'))
    rows=[{'file':f,'sha256':digest((ROOT/'artifacts'/f).read_bytes()),'bytes':(ROOT/'artifacts'/f).stat().st_size} for f in sorted(files)]
    write_json(ROOT/'reports/add-assets-handoff-v1.json',{'schemaVersion':1,'clientMeasured':False,
        'artifactRoot':str((ROOT/'artifacts').resolve()),'summary':summaries,'files':rows,
        'bytes':sum(r['bytes'] for r in rows),'costumeManifest':{'file':'costumes/manifest.json',
            'sha256':digest((ROOT/'artifacts/costumes/manifest.json').read_bytes()),'operation':'Merge only characters.add into the destination costume manifest; preserve existing professions.'},
        'privateRebuildEvidence':[read(ROOT/'reports/add-fx-d3dx-keyframes-v1.json')['artifact']],
        'sourceProof':'Per-profession source-proof directories stay private; needed only for source audits/rebuilding compact runtime poses.',
        'baselineDependencies':'Existing RF/LK/VC/RS/BM/IS runtime files remain required; exact referenced file SHA256 values are recorded per profession runtime receipt.'})
    print({'sourceClockNames':len(names),'particleRows':{j:len(r) for j,r in report['professions'].items()}})
if __name__=='__main__':build()

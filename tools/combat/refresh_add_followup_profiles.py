"""Refresh Add capability text and exact source buff rows without rebuilding
the shared asset union, clips, collision data or frozen target declarations."""
import argparse,hashlib,json
from pathlib import Path
from add_definitions import SKILL_LIMITATIONS
from rf_skill_catalog import buff_catalog,buff_templates

ROOT=Path(__file__).resolve().parents[2]
def read(path):return json.loads(path.read_text('utf8'))
def verify(source):
    if hashlib.sha256(Path(source['path']).read_bytes()).hexdigest()!=source['sha256']:
        raise ValueError('Original target source changed: '+source['path'])

def refresh(cache,professions):
    source=read(cache/'skill-declarations.json');verify(source['source'])
    originals={row['args'][-1]['m_eID']:row['args'][-1] for row in source['nativeCalls'] if row['target'].endswith('AddSkillTemplet_LUA')}
    outputs=[]
    for profession in professions:
        path=ROOT/'packages/combat-core'/(profession+'-profile.json');p=read(path)
        for skill in p['skillCatalog']:
            if skill['raw']!=originals[skill['skillId']]:raise ValueError('Frozen target skill changed')
            base=skill['skillId']
            while originals[base].get('m_DeleteSkillIDByUpgrade'):base=originals[base]['m_DeleteSkillIDByUpgrade']
            limits=SKILL_LIMITATIONS.get(base,[])
            skill['limitations']=[{'key':key,'message':message,'evidenceClass':'target2016 declarations; absent or unbound native consumer'} for key,message in limits]
        if profession=='mm':
            factors,fp=buff_catalog(cache,[{'BUFF_FACTOR_ID':{'1':368,'2':370}}])
            templates,bp=buff_templates(cache,[factors])
            if set(factors)!={'368','370'} or set(templates)!={'344'}:raise ValueError('Incomplete original Drone Activator buff closure')
            for value in list(fp['sources'].values())+list(bp['sources'].values()):verify(value)
            for rows,additions,key,provenance in [(p['buffFactors'],factors,'buffFactorProvenance',fp),(p['buffTemplates'],templates,'buffTemplateProvenance',bp)]:
                for identity,value in additions.items():
                    if identity in rows and rows[identity]!=value:raise ValueError('Existing original buff row differs: '+identity)
                    rows[identity]=value
                existing=p[key]
                existing['sources'].update(provenance['sources'])
                existing['requestedIds']=sorted(set(existing['requestedIds'])|set(provenance['requestedIds']))
                existing['missingIds']=sorted(set(existing['missingIds'])-set(provenance['requestedIds']))
        raw=(json.dumps(p,ensure_ascii=False,indent=2)+'\n').encode('utf8')
        outputs.append((path,raw))
    # Validate every source and frozen row before modifying any profile.
    for path,raw in outputs:path.write_bytes(raw)
    return [{'file':path.relative_to(ROOT).as_posix(),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()} for path,raw in outputs]

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--cache',type=Path,required=True)
    ap.add_argument('--profession',choices=('lp','mm','de'),action='append');args=ap.parse_args()
    print(json.dumps(refresh(args.cache,args.profession or ['lp','mm','de'])))

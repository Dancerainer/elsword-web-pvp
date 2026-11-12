"""Apply audited skill selection and target effect closure to an existing profile.

Retains unrelated combo data. Inputs are a task-owned declaration copy, hashes
already verified by prepare_rf_skill_declarations.py. No target script executes.
"""
from pathlib import Path
import argparse, hashlib, json

def apply(profile_path, cache):
    p=json.loads(profile_path.read_text('utf8'))
    for skill in p['skillCatalog']:
        if skill['passive']:continue
        skill['supported']=True
        skill['supportStatus']='target-data-and-source-executor-candidate; original-client-validation-pending'
        for branch in skill.get('branches',[]):branch['selectable']=True
        skill['branchStatus']='selectable; target-static-description-adapter; native-V6-consumer-unverified'
        if skill['skillId']==900:
            skill['mpCost']=0
            skill['mpCostEvidence']='No MP-consumption declaration; explicit zero-cost relationship skill candidate'
    effects=json.loads((cache/'effect-declarations.json').read_text('utf8'))
    damage=json.loads((cache/'damage-declarations.json').read_text('utf8'))
    all_sets={}
    for call in effects['nativeCalls']:
        t=call['args'][-1]
        if call['target'].endswith('AddEffectSetTemplet_LUA') and isinstance(t,dict) and t.get('NAME'):
            all_sets[t['NAME']]={'raw':t,'sourcePc':{'prototype':call['prototype'],'instruction':call['instruction']}}
    def strings(v):
        if isinstance(v,dict):
            for x in v.values():yield from strings(x)
        elif isinstance(v,list):
            for x in v:yield from strings(x)
        elif isinstance(v,str):yield v
    pending=['EffectSet_SA_ROT_VALKYRIESJAVELIN_NEW','EffectSet_Heal','EffectSet_Raven_Shadow_Buster'];visited=set()
    while pending:
        n=pending.pop()
        if n in visited:continue
        visited.add(n)
        if n in all_sets:p['effectSets'][n]=all_sets[n];pending.extend(strings(all_sets[n]['raw']))
        if n in damage['globals']:
            p['damageEffects'][n]={'raw':damage['globals'][n],'sourcePc':damage.get('locations',{}).get(n)}
            pending.extend(strings(damage['globals'][n]))
    p.setdefault('resourceOnlyEffectSets',[])
    for n in ['EffectSet_SA_ROT_VALKYRIESJAVELIN_NEW','EffectSet_Heal']:
        if n not in p['resourceOnlyEffectSets']:p['resourceOnlyEffectSets'].append(n)
    p['skillV11Evidence']={'targetClientMeasured':False,'native2016ConsumerVerified':False,
        'selectableActives':20,'selectableTraits':36,'newValkyrieBinding':'a1bcdab 2026 reconstruction of V5; matching 2016 effect-set spelling confirmed',
        'unknownTraitConsumers':['MI_USEFUL hit schedule','MI_ABSORB MP basis','MI_CRITICAL defensive-effect bypass'],
        'closureInputs':{n:hashlib.sha256((cache/n).read_bytes()).hexdigest() for n in ['effect-declarations.json','damage-declarations.json']}}
    fx=Path(__file__).resolve().parents[2]/'contracts/rf-skill-fx-index-v11.json'
    if fx.is_file():
        main_names={d['raw'].get('MAIN_EFFECT_NAME') for d in p['damageEffects'].values()}
        p['effectTemplates'].update({n:t for n,t in json.loads(fx.read_text('utf8'))['templates'].items() if n in main_names})
        p['skillV11Evidence']['additionalEffectIndexSha256']=hashlib.sha256(fx.read_bytes()).hexdigest()
    profile_path.write_text(json.dumps(p,ensure_ascii=False,indent=2)+'\n','utf8')
    print(json.dumps({'profile':str(profile_path),'sha256':hashlib.sha256(profile_path.read_bytes()).hexdigest(),'addedEffectClosure':len(visited)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--profile',type=Path,default=Path('packages/combat-core/rf-profile.json'));parser.add_argument('--cache',type=Path,required=True)
    args=parser.parse_args();apply(args.profile,args.cache)

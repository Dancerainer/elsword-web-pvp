"""Layer source CA Punish factors onto the frozen v3 resource handoff."""
import hashlib
import json
import shutil
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/combat')]
from build_rf import write_json
from build_elesis_profiles import compile_job

def read(path):return json.loads(path.read_text('utf8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def build():
    base=ROOT/'artifacts';patch=ROOT/'.cache/elesis-buff-v4/runtime'
    previous=[ROOT/'.cache/elesis-judgment-v3/runtime',ROOT/'.cache/elesis-wildshock-v2/runtime',base]
    def prior(name):return next(root/name for root in previous if (root/name).is_file())
    files=[]
    for name in ('ca/source-proof/clips.json','ca/fx/index.json'):
        target=patch/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(prior(name),target)
    old=read(prior('ca/manifest.json'))['profile']['sha256']
    compile_job('ca',ROOT/'.cache/elesis-target',patch)
    profile=read(ROOT/'packages/combat-core/ca-profile.json');new=sha(ROOT/'packages/combat-core/ca-profile.json')
    for name in ('ca/fx/index.json','ca/audio/manifest.json','ca/manifest.json'):
        value=json.loads(json.dumps(read(prior(name)),ensure_ascii=False).replace(old,new))
        write_json(patch/name,value);files.append(name)
        if name=='ca/fx/index.json':write_json(ROOT/'contracts/ca-fx-index.json',value)
    common=json.loads(json.dumps(read(prior('common-buffs/catalog.json')),ensure_ascii=False).replace(old,new))
    template=profile['buffTemplates']['441']['raw']
    if template.get('DISPLAYER') or template.get('BUFF_ICON_TEXTURE_NAME'):raise ValueError('Unexpected new Punish display resource requires explicit conversion')
    receipts=[]
    for file,ids,output_key,id_key,value_key in [
        ('battle-buff-declarations.json',[441],'buffTemplates','BUFF_TEMPLET_ID',None),
        ('buff-factor-declarations.json',[479,480],'buffFactors','BUFF_FACTOR_ID','BUFF_FACTOR')]:
        declared=read(ROOT/'.cache/elesis-target'/file)
        for c in declared['nativeCalls']:
            row=c['args'][-1] if c['args'] else None
            if not isinstance(row,dict) or row.get(id_key) not in ids:continue
            key=str(row[id_key]);raw=row[value_key] if value_key else row
            if raw!=profile[output_key][key]['raw']:raise ValueError('Profile differs from original buff declaration')
            record={'raw':raw,'sourcePc':{'prototype':c['prototype'],'instruction':c['instruction']},'source':declared['source']}
            common[output_key][key]=record;receipts.append({'kind':output_key,'id':key,**record})
    write_json(patch/'common-buffs/catalog.json',common);files.append('common-buffs/catalog.json')
    write_json(ROOT/'contracts/common-buff-catalog.json',common)
    roots={key:value for key,value in common.items() if key!='effectTemplates'}
    write_json(ROOT/'contracts/common-buff-display-roots.json',roots)
    manifest=read(prior('common-buffs/manifest.json'))
    for row in manifest['outputs']:
        if row['file']=='catalog.json':row.update(sha256=sha(patch/'common-buffs/catalog.json'),bytes=(patch/'common-buffs/catalog.json').stat().st_size)
    write_json(patch/'common-buffs/manifest.json',manifest);files.append('common-buffs/manifest.json')
    bh=read(ROOT/'packages/combat-core/bh-profile.json')
    for factor,template_id in [('296',295),('297',296)]:
        if bh['buffFactors'][factor]['raw']['BUFF_TEMPLET_ID']!=template_id or str(template_id) not in bh['buffTemplates']:raise ValueError('Original BH pickup buff closure absent')
    dummy=profile['damageEffects']['DamageEffect_SA_SDK_BRANDISH_BREAKER_LOOP_DUMMY']
    if dummy['raw']['ATTACK_TIME_START']!=9999 or dummy['raw']['ATTACK_TIME_END']!=9999:raise ValueError('Original Brandish placeholder changed')
    report={'schemaVersion':1,'id':'elesis-buff-closure-correction-v4','clientMeasured':False,'patchRoot':str(patch),
        'precedingPatch':'reports/elesis-judgment-resource-v3.json','profile':{'before':old,'after':new},
        'addedOriginalDeclarations':receipts,'existingRequestedClosure':{'BH':{
            '296':bh['buffFactors']['296'],'297':bh['buffFactors']['297'],
            'template295':bh['buffTemplates']['295'],'template296':bh['buffTemplates']['296']},'BrandishLoopDummy':dummy},
        'files':[{'file':name,'bytes':(patch/name).stat().st_size,'sha256':sha(patch/name),'priorSha256':sha(prior(name))} for name in sorted(files)],
        'limits':['Template441 declares no icon or display effect; no invented art is added.',
            'Brandish LOOP_DUMMY remains the original 9999/9999 nonattacking placeholder. No timed repeated damage is inferred.',
            'Skill28032 is separately retained as auxiliary source evidence, not made selectable.']}
    write_json(ROOT/'reports/elesis-buff-resource-v4.json',report);print({'files':len(files),'profile':new})

if __name__=='__main__':build()

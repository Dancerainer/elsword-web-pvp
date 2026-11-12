"""Narrow, hash-checked target2016 additions; never rebuild unrelated profiles."""
import argparse,copy,hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def read(path):return json.loads(Path(path).read_text('utf8'))
def write(path,data):Path(path).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n','utf8',newline='\n')
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def build(cache,assets):
    damage=read(cache/'damage-declarations.json');effects=read(cache/'effect-declarations.json')
    for doc,key in [(damage,'damage'),(effects,'effect')]:
        source=doc['source'];source_path=Path(source['path'].replace('\\\\','/'))
        if sha(source_path)!=source['sha256']:raise ValueError('Source changed: '+key)
    path=ROOT/'packages/combat-core/ca-profile.json';p=read(path);old=sha(path)
    if p['sources']['damage']['sha256']!=damage['source']['sha256'] or p['sources']['effect']['sha256']!=effects['source']['sha256']:raise ValueError('Profile target differs')
    name='DamageEffect_SI_SA_SCA_BLOOD_CUTTER'
    p['damageEffects'][name]={'raw':damage['globals'][name],'sourcePc':damage['locations'][name]}
    calls=[c for c in effects['nativeCalls'] if c['target'].endswith('AddEffectSetTemplet_LUA') and c['args'][-1].get('NAME')=='EffectSet_SI_SA_SCA_BLOOD_CUTTER_Projectile']
    if len(calls)!=1:raise ValueError('Ambiguous original Blood Cutter set')
    c=calls[0];p['effectSets'][c['args'][-1]['NAME']]={'raw':c['args'][-1],'sourcePc':{'prototype':c['prototype'],'instruction':c['instruction']}}
    write(path,p);new=sha(path)
    small=ROOT/'runtime/player-feedback-v30/blood-fx-profile.json'
    write(small,{'professionId':'ca','damageEffects':{name:p['damageEffects'][name]},'effectSets':{c['args'][-1]['NAME']:p['effectSets'][c['args'][-1]['NAME']]},'states':{},'skillCatalog':[]})
    for rel in ['manifest.json','audio/manifest.json','fx/index.json','effect-assets.json']:
        asset=assets/'ca'/rel;data=read(asset)
        write(asset,json.loads(json.dumps(data,ensure_ascii=False).replace(old,new)))
    bindings={};proof={}
    for job in ['gm','bh','ca']:
        profile=read(ROOT/f'packages/combat-core/{job}-profile.json')
        for set_name,set_data in profile['effectSets'].items():
            roots=[(key,v) for key,v in set_data['raw'].items() if key.startswith('EFFECT') and key[6:].isdigit() and v.get('BONE_TRACE_TARGET_MESH')==1]
            if len(roots)!=1:continue
            key,v=roots[0]
            if set_name in bindings and bindings[set_name]!=v['NAME']:raise ValueError('Conflicting target-mesh source')
            bindings[set_name]=v['NAME'];proof[set_name]={'member':key,'name':v['NAME'],'bone':v.get('BONE_NAME'),'forcedOwner':v.get('TRACE_USER_TARGET_FORCE')==1,'declarationSha256':hashlib.sha256(json.dumps(set_data['raw'],sort_keys=True,separators=(',',':')).encode()).hexdigest()}
    write(ROOT/'contracts/elesis-effect-targets-v30.json',{'schemaVersion':1,'targetClientMeasured':False,'source':effects['source'],'evidenceClass':'target2016-declarations + fixedV5 per-instance target mesh consumer; web execution','bindings':bindings,'proof':proof})
    print(json.dumps({'caProfileBefore':old,'caProfileAfter':new,'addedDamage':name,'addedSet':c['args'][-1]['NAME'],'targetMeshSets':len(bindings)}))
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--declarations',type=Path,required=True);parser.add_argument('--assets',type=Path,required=True);args=parser.parse_args()
    if not args.assets.resolve().is_relative_to(ROOT/'runtime'):raise ValueError('Only task-local runtime output is supported')
    build(args.declarations,args.assets)

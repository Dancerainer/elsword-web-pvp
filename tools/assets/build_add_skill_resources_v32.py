"""Extend exact Add resource closure from hash-checked 2016 declarations."""
from pathlib import Path
import copy, hashlib, json, sys, shutil, posixpath
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/assets')]
from build_lk_fx import build
import build_rf
from native_d3dx_keys import decode_measured_native_keys

def sha(blob): return hashlib.sha256(blob).hexdigest()
def write(file,value): file.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf8')
def strings(value):
    if isinstance(value,str): yield value
    elif isinstance(value,dict):
        for v in value.values(): yield from strings(v)
    elif isinstance(value,list):
        for v in value: yield from strings(v)

def main():
    cache=ROOT/'.cache/client-skills-ui-v32';data=json.loads((cache/'add-target/damage-declarations.json').read_text('utf8'))
    # Author key bytes are build inputs, isolated from shipped assets.
    measured=cache/'native-input';(measured/'reports').mkdir(parents=True,exist_ok=True)
    for file in (ROOT/'reports').glob('*d3dx*.json'):shutil.copy2(file,measured/'reports'/file.name)
    artifact=measured/'artifacts/native-d3dx/add-fx-keyframes-v1.json';artifact.parent.mkdir(parents=True,exist_ok=True)
    original=Path('./artifacts/native-d3dx/add-fx-keyframes-v1.json')
    expected=json.loads((ROOT/'reports/add-fx-d3dx-keyframes-v1.json').read_text('utf8'))['artifact']
    assert sha(original.read_bytes())==expected['sha256']
    if not artifact.exists():shutil.copy2(original,artifact)
    assert sha(artifact.read_bytes())==expected['sha256']
    build_rf.decode_measured_native_keys=lambda path,clips:decode_measured_native_keys(path,clips,repo_root=measured)
    source=data['source'];assert sha(Path(source['path']).read_bytes())==source['sha256']
    roots=['DamageEffect_ATT_Maximum_Strike_Bullet_Projectile','DamageEffect_ATT_Maximum_Strike_Bullet_Attack',
           'DamageEffect_AMM_Shooting_Chaser_Attacker','DamageEffect_AMM_Shooting_Chaser_Attack',
           'DamageEffect_AMM_Shooting_Chaser_Buff_Attack','DamageEffect_Shooting_Chaser_Drone_FX','DamageEffect_Shooting_Chaser_Beam_FX',
           'DAMAGE_EFFECT_Star_Fall_Explode']
    damage={};pending=list(roots)
    while pending:
        name=pending.pop()
        if name in damage:continue
        raw=data['globals'].get(name)
        if raw is None:continue
        damage[name]={'raw':raw,'sourcePc':data['locations'][name]}
        pending.extend(n for n in strings(raw) if n in data['globals'])
    small={'schemaVersion':1,'professionId':'mm','target':{'unitType':9,'unitClass':123},'states':{},'effectSets':{},'damageEffects':damage}
    source_profile=cache/'skill-resource-profile.json';write(source_profile,small)
    output=ROOT/'artifacts/mm/v32/fx';output.mkdir(parents=True,exist_ok=True)
    if not output.resolve().is_relative_to(ROOT):raise ValueError('Output outside task')
    index=build(output,source_profile,index_output=None,shared_indexes=[
        (ROOT/'artifacts/mm/fx/index.json','../'),(ROOT/'artifacts/lp/fx/index.json','../../lp/'),(ROOT/'artifacts/de/fx/index.json','../../de/')])
    missing=index['missingTemplates']
    critical=[]
    for name,row in damage.items():
        raw=row['raw'];template=index['templates'].get(raw.get('MAIN_EFFECT_NAME'),{})
        needs_pose=bool(raw.get('DAMAGE_DATA')) or name=='DamageEffect_ATT_Maximum_Strike_Bullet_Projectile'
        if needs_pose and template.get('fields',{}).get('MeshType')=='X_SKIN_MESH' and not template.get('poseData'):critical.append(name)
    if missing or critical:raise ValueError('Required original attack/orbit geometry missing: '+str((missing,critical)))
    extra=copy.deepcopy(index['templates'])
    def prefix(record,role):
        record=copy.deepcopy(record)
        for key in ['glb','poseData']:
            if record.get(key):record[key]=posixpath.normpath(('' if role=='mm' else '../mm/')+'v32/'+record[key])
        for texture in record.get('textures',{}).values():
            if texture.get('file'):texture['file']=posixpath.normpath(('' if role=='mm' else '../mm/')+'v32/'+texture['file'])
        return record
    profiles={};receipts=[]
    for role in ['mm','de']:
        file=ROOT/f'packages/combat-core/{role}-profile.json';p=json.loads(file.read_text('utf8'))
        for name,row in damage.items():
            if name in p['damageEffects'] and p['damageEffects'][name]['raw']!=row['raw']:raise ValueError('Original damage declaration differs: '+name)
            p['damageEffects'][name]=row
        fx_file=ROOT/f'artifacts/{role}/fx/index.json';fx=json.loads(fx_file.read_text('utf8'))
        for name,record in extra.items():
            t=prefix(record,role);initial={e['property']:e['value'] for e in t['events'] if e['start']==0 and not e['fade']}
            p['effectTemplates'][name]={**t,'initialSize':initial.get('Size'),'initialVelocity':initial.get('Velocity'),'initialDirSpeed':initial.get('DirSpeed'),
                'initialAnimation':{'name':initial['AniName']['animation'],'playback':initial['AniName']['playback']} if 'AniName' in initial else None,
                'missingExplicitTickRate':t.get('animationMissingTickRate',False)}
            fx['templates'][name]=t
        p['sourceLiteralResources']=sorted(set(p['sourceLiteralResources'])|set(roots))
        write(file,p);fx['profileSha256']=sha(file.read_bytes());write(fx_file,fx)
        profiles[role]={'profileSha256':fx['profileSha256'],'fxIndexSha256':sha(fx_file.read_bytes())}
    for name,row in damage.items():receipts.append({'name':name,'rawSha256':sha(json.dumps(row['raw'],ensure_ascii=False,sort_keys=True).encode()),'sourcePc':row['sourcePc']})
    write(ROOT/'contracts/add-skill-resources-v32.json',{'schemaVersion':1,'clientMeasured':False,'source':source,'roots':roots,'damage':receipts,
          'templates':{name:{'declarationSha256':r['declarationSha256'],'source':r['source']} for name,r in extra.items()},
          'optionalMeshFailures':index['meshFailures'],'requiredAttackGeometryMissing':critical,'profiles':profiles})
    print(json.dumps({'damage':len(damage),'templates':len(extra),'profiles':profiles}))

if __name__=='__main__':main()

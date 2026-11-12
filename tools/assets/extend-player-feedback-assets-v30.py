"""Append missing source FX closure in a task-owned runtime snapshot only."""
import argparse,hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
from build_lk_fx import build
def read(path):return json.loads(Path(path).read_text('utf8'))
def write(path,data):Path(path).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n','utf8',newline='\n')
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def main(assets):
    assets=assets.resolve()
    if not assets.is_relative_to(ROOT/'runtime'):raise ValueError('Task-local runtime assets required')
    profile=ROOT/'packages/combat-core/ca-profile.json';old_hash=sha(profile)
    index=assets/'ca/fx/index.json';old=read(index)
    repaired=['BLOOD_CUTTER_W_P02_1','BLOOD_CUTTER_W_P01_L2','BLOOD_CUTTER_W_P01_L']
    shared=ROOT/'runtime/player-feedback-v30/ca-fx-reuse.json';write(shared,{**old,'templates':{n:t for n,t in old['templates'].items() if n not in repaired}})
    generated=build(index.parent,ROOT/'runtime/player-feedback-v30/blood-fx-profile.json',index_output=ROOT/'runtime/player-feedback-v30/blood-fx-generated.json',shared_indexes=[(shared,'')])
    added={name:t for name,t in generated['templates'].items() if name not in old['templates'] or name in repaired}
    if generated['meshFailures'] or generated['missingTemplates'] or any(t.get('animationRequiresUnconfirmedRate') for t in added.values()):raise ValueError('New Blood Cutter resource closure is incomplete')
    old['templates'].update(added)
    p=read(profile)
    for name,t in added.items():
        initial={e['property']:e['value'] for e in t['events'] if e['start']==0 and not e['fade']}
        p['effectTemplates'][name]={**t,'initialSize':initial.get('Size'),'initialVelocity':initial.get('Velocity'),'initialDirSpeed':initial.get('DirSpeed'),
          'initialAnimation':{'name':initial['AniName']['animation'],'playback':initial['AniName']['playback']} if 'AniName' in initial else None,'missingExplicitTickRate':t.get('animationMissingTickRate',False)}
    write(profile,p);new_hash=sha(profile)
    old['profileSha256']=new_hash;write(index,old)
    meta=read(assets/'ca/effect-assets.json');meta['templates'].update({n:p['effectTemplates'][n] for n in added});write(assets/'ca/effect-assets.json',meta)
    for rel in ['manifest.json','audio/manifest.json','fx/index.json','effect-assets.json']:
        path=assets/'ca'/rel;value=read(path);write(path,json.loads(json.dumps(value,ensure_ascii=False).replace(old_hash,new_hash)))
    write(ROOT/'contracts/ca-fx-index.json',old)
    write(ROOT/'reports/player-feedback-ca-asset-closure-v30.json',{'targetClientMeasured':False,'evidenceClass':'target2016 static resources, task-local conversion','profileBefore':old_hash,'profileAfter':new_hash,'addedTemplates':list(added),'missingTemplates':generated['missingTemplates'],'meshFailures':generated['meshFailures'],'sourceFiles':generated['sourceFiles']})
    print(json.dumps({'added':list(added),'missing':generated['missingTemplates'],'profileSha256':new_hash}))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--assets',type=Path,required=True);main(p.parse_args().assets)

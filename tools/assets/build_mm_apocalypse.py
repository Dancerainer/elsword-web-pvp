"""Convert target-2016 NPC 1604 with its own motion hierarchy and FX closure.

All original inputs are read-only. This append-only resource family does not
rewrite the frozen MM caster assets, profiles, or their native-DLL receipts.
"""
import argparse,json,sys,re,copy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/assets')]
from build_rf import Catalog,build_effect,write_json,digest
from build_rf_fx import read_definitions,select_templates
from build_lk_fx import build as build_fx
import audio
SOURCE=Path('asset_work')
OUT=ROOT/'artifacts/mm/summons/apocalypse'
def read(p):return json.loads(p.read_text('utf8'))
def strings(value):
    if isinstance(value,str):yield value
    elif isinstance(value,dict):
        for item in value.values():yield from strings(item)
    elif isinstance(value,list):
        for item in value:yield from strings(item)
def build(declarations,resource_profile,mode):
    doc=read(declarations);profile=read(resource_profile);g=doc['globals'];c=Catalog(SOURCE)
    if digest(Path(doc['source']['path']).read_bytes())!=doc['source']['sha256']:raise ValueError('NPC declaration source changed')
    states={k:{'animationName':v['ANIM_NAME'],'raw':v}for k,v in g.items()if isinstance(v,dict)and'ANIM_NAME'in v}
    OUT.mkdir(parents=True,exist_ok=True)
    if mode in ('all','body'):
        body=build_effect(c,OUT,g['INIT_MOTION']['MOTION_FILE_NAME'],render_profile={
            'cull':'back','realColor':True,'blend':False,'depthWrite':True,'alphaTest':True,
            'evidence':'current character material adapter; original GPU blend/lighting unmeasured'})
        for k in ('glb','poseData','nativeAnimation'):
            if body.get(k):body[k]=Path(body[k]).name
        pose=read(OUT/body['poseData']);clips={v['name']:v for v in body['animations']}
        if body['unsupportedPoseTracks']or any(v['warnings']or v['trackWarnings'] for v in clips.values()):raise ValueError('Unresolved source animation')
        if any(v['animationName']not in clips for v in states.values()):raise ValueError('NPC state animation missing')
        frames={v['name'] for v in pose['frames']}
        if 'Dummy_B15'not in frames or 'Core'not in frames or 'Bip01'in frames:raise ValueError('Wrong NPC hierarchy')
        roots=set(strings(states))|set(strings(profile['summonDeclarations']['apocalypse']['callbackLiteralResources']))
        effect_sets={};pending=[name for name in roots if name in profile['effectSets']]
        while pending:
            name=pending.pop()
            if name in effect_sets:continue
            raw=profile['effectSets'][name]['raw'];effect_sets[name]=raw
            pending.extend(s for s in strings(raw)if s in profile['effectSets']and s not in effect_sets)
        anchor_rows=[]
        for name,raw in effect_sets.items():
            for key,row in raw.items():
                if isinstance(row,dict)and row.get('BONE_NAME'):
                    anchor_rows.append({'effectSet':name,'effect':key,'bone':row['BONE_NAME'],'present':row['BONE_NAME']in frames})
        if any(not r['present']for r in anchor_rows):raise ValueError('NPC effect-set requests an absent original bone: '+str([r for r in anchor_rows if not r['present']]))
        bindings={k:{'animationName':v['animationName'],'durationSeconds':clips[v['animationName']]['durationSeconds'],
            'rawAnimationSpeed':v['raw'].get('ANIM_SPEED'),'rawPlayType':v['raw'].get('PLAY_TYPE'),
            'rawApplyAnimationMove':v['raw'].get('APPLY_ANIM_MOVE'),
            'rawEffectBindings':{key:value for key,value in v['raw'].items()if key.startswith('EFFECT_SET')}} for k,v in states.items()}
        manifest={'schemaVersion':1,'id':'apocalypse','npcId':1604,'professionId':'mm','clientMeasured':False,
            'evidenceClass':'original-2016-declarations-and-shipped-D3DX-execution',
            'runtimeGlb':body['glb'],'poseData':body['poseData'],'clips':body['animations'],
            'unitScale':g['INIT_SYSTEM']['UNIT_SCALE'],'rawSystem':g['INIT_SYSTEM'],'rawComponents':g['INIT_COMPONENT'],
            'scaleContract':'Pose matrices and geometry remain unscaled source units. Apply UNIT_SCALE once at NPC world sampling/render root, never by borrowing the caster skeleton.',
            'stateBindings':bindings,'body':body,'frameCount':len(frames),'nativeFrameNames':[v['name'] for v in pose['frames']],
            'effectOwnerBoneAudit':{'sourceEffectSets':sorted(effect_sets),'bindings':anchor_rows,'missing':[]},
            'source':doc['source'],'sourceFiles':list(c.used.values()),'fx':'fx/index.json','audio':'audio/manifest.json',
            'samplerContract':{'library':'createPoseLibrary(poseData)','sampling':'samplePose(library, original animationName, source time)','owner':'independent NPC 1604; never caster'},
            'limits':['Whole-client playback, lighting and pixel fidelity are unmeasured.','Original state PLAY_TYPE and ANIM_SPEED belong to the NPC controller; DLL clip playback field does not replace state declarations.']}
        write_json(OUT/'manifest.json',manifest);write_json(ROOT/'contracts/mm-apocalypse-assets-v1.json',manifest)
        print(json.dumps({'body':body['glb'],'frames':len(frames),'clips':len(clips),'states':len(states)},ensure_ascii=False),flush=True)
    if mode in ('all','fx'):
        definitions=read_definitions(c);selected,missing=select_templates(definitions,profile,[])
        baseline=ROOT/'contracts/mm-fx-index.json'
        if digest(baseline.read_bytes())!='90836f7bd87a5c360a8e42250d4ce61ab0faae86202c6d498f3652cfa420418e':raise ValueError('Expected frozen 485-template MM caster baseline')
        old=read(baseline)['templates']
        roots=[name for name,t in selected.items()if name not in old or old[name]['declarationSha256']!=t['declarationSha256']]
        delta={'professionId':'mm-apocalypse','effectSets':{},'damageEffects':{},'resourceOnlyTemplates':roots}
        private=ROOT/'.cache/add-npc/apocalypse-fx-delta.json';write_json(private,delta)
        shared=[(ROOT/'artifacts/mm/fx/index.json','../../')]
        for job in ('lp','rf','lk','vc','rs','bm','is'):
            shared.extend((p,'../../../'+job+'/')for p in (ROOT/'artifacts'/job).glob('*/index.json')if'templates'in read(p))
        fx=build_fx(OUT/'fx',private,SOURCE,ROOT/'contracts/mm-apocalypse-fx-index-v1.json',shared_indexes=shared)
        fx['closureEvidence']={'source':doc['source'],'resourceProfileSha256':digest(resource_profile.read_bytes()),'originalResourceRoots':roots,
            'excludedExistingCasterTemplates':len(selected)-len(roots),'upstreamMissingTemplates':missing}
        if fx['meshFailures']or fx['missingTemplates']or any(t['unsupported']or t.get('animationRequiresUnconfirmedRate')for t in fx['templates'].values()):raise ValueError('NPC FX incomplete')
        write_json(OUT/'fx/index.json',fx);write_json(ROOT/'contracts/mm-apocalypse-fx-index-v1.json',fx)
        particle=[]
        for name,t in fx['templates'].items():
            f=t['fields'];n=f.get('NumParticles');rate=f.get('Emitrate');life=f.get('Lifetime');window=f.get('TriggerTime');count=f.get('TriggerCount')
            if not isinstance(n,(int,float))or not isinstance(rate,(int,float))or rate<=0:continue
            windows=[v for v in (life,window)if isinstance(v,(int,float))and v>0]
            if n<=4 or windows and 8/rate>min(windows):
                generic=n<=1 or count==1
                particle.append({'name':name,'NumParticles':n,'Emitrate':rate,'Lifetime':life,'TriggerTime':window,'TriggerCount':count,
                    'source':t['source'],'declarationSha256':t['declarationSha256'],'alreadyProtectedByGenericSingleton':generic,
                    'preserveSourceClock':not generic and(n<=4 or isinstance(window,(int,float))and window>0 and 8/rate>window)})
        write_json(ROOT/'reports/mm-apocalypse-particle-clocks-v1.json',{'schemaVersion':1,'originalDeclarationsModified':False,'particles':particle,
            'names':[v['name']for v in particle if v['preserveSourceClock']]})
    if mode in ('all','audio'):
        # Keep only this NPC's state and callback sound dependencies. Existing
        # caster audio remains frozen; extra copies are confined to this family.
        sound_profile={'states':states,'damageEffects':{k:v for k,v in profile['damageEffects'].items()if 'Apocalypse'in k or 'APOCALYPSE'in k}}
        private=ROOT/'.cache/add-npc/apocalypse-audio-profile.json';write_json(private,sound_profile)
        audio.VERSION='mm-apocalypse-audio-target2016-v1'
        m=audio.build(private,SOURCE,OUT/'audio',ROOT/'reports/mm-apocalypse-audio-v1.json')
        for r in m['files'].values():r['file']='../mm/summons/apocalypse/audio/'+r['file']
        write_json(OUT/'audio/manifest.json',m)
    if mode=='all':
        rows=[]
        for p in sorted(OUT.rglob('*')):
            if p.is_file()and not p.name.endswith('.animation.json'):rows.append({'file':p.relative_to(ROOT/'artifacts').as_posix(),'sha256':digest(p.read_bytes()),'bytes':p.stat().st_size})
        deps={}
        for t in read(OUT/'fx/index.json')['templates'].values():
            for ref in [t[k]for k in ('glb','poseData')if t.get(k)]+[v['file']for v in t['textures'].values()]:
                p=(OUT/ref).resolve()
                if OUT not in p.parents:deps[p.relative_to(ROOT/'artifacts').as_posix()]={'sha256':digest(p.read_bytes()),'bytes':p.stat().st_size}
        write_json(ROOT/'reports/mm-apocalypse-assets-handoff-v1.json',{'schemaVersion':1,'artifactRoot':str(ROOT/'artifacts'),
            'files':rows,'bytes':sum(r['bytes']for r in rows),'existingDependencies':deps,
            'privateRebuildEvidence':[read(ROOT/'reports/mm-apocalypse-d3dx-keyframes-v1.json')['artifact']],
            'fxMergeContract':'Rebase every glb/poseData/textures.file from the summon directory to MM using path normalization of summons/apocalypse/ + ref. Merge exact declaration identities without replacing old caster resource files.',
            'audioMergeContract':'Manifest file paths are relative to the existing /assets/audio/ root, matching the global audio loader.'})
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--declarations',required=True,type=Path);p.add_argument('--resource-profile',required=True,type=Path);p.add_argument('--mode',choices=['all','body','fx','audio'],default='all');a=p.parse_args();build(a.declarations,a.resource_profile,a.mode)

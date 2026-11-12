import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createActorView,sampleAnimation,getActorNativePoints} from '../../apps/web/actor-presentation.mjs';
import {createRFWeaponTrails} from '../../apps/web/weapon-trails.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {createAwakeningEffects,awakeningAttachmentsFor} from '../../apps/web/awakening-effects.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createEffectPresentationPolicy,DEFAULT_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {writeNativeEffectBoneMatrix} from '../../apps/web/native-effect-bone-matrix.mjs';
const nativeSamplers=process.env.LK_FX_SAMPLERS_MODULE?(await import(pathToFileURL(process.env.LK_FX_SAMPLERS_MODULE))).createNativeSamplers:createNativeSamplers;

const root=fileURLToPath(new URL('../../',import.meta.url));
const json=file=>JSON.parse(readFileSync(resolve(root,file)));
const assetRoot=process.env.LK_PRESENTATION_ASSET_ROOT??resolve(root,'artifacts/lk');
const profile=JSON.parse(readFileSync(process.env.LK_FX_PROFILE??resolve(root,'packages/combat-core/lk-profile.json')));
const index=json('contracts/lk-fx-index.json');
const pose=JSON.parse(readFileSync(resolve(assetRoot,'runtime-pose.json')));
const actor=(state='ESSI_COMBO_Z1')=>({id:'LK',professionId:'LK',hp:800000,x:0,y:0,z:0,facing:1,state,stateSerial:1,
  animationName:profile.states[state].animationName,animationTime:0,animationLoop:false,applyMotionOffset:false,awakening:{remaining:0}});

test('every original LK effect mesh has a confirmed complete source pose; all 46 newly measured source clocks are preserved',()=>{
  const manifest=json('reports/lk-fx-d3dx-keyframes-v2.json');
  assert.equal(manifest.sources.length,46);assert.equal(index.meshFailures.length,0);
  assert.deepEqual(Object.values(index.templates).filter(t=>t.animationRequiresUnconfirmedRate),[]);
  const checked=new Set();
  for(const t of Object.values(index.templates))if(t.poseData&&!checked.has(t.poseData)){
    checked.add(t.poseData);const doc=JSON.parse(readFileSync(resolve(assetRoot,t.poseData)));
    assert.deepEqual(doc.unsupportedTracks,[],t.poseData);
    for(const c of doc.clips){
      assert.ok(c.staticPoseWithoutTickRate||Number.isFinite(c.ticks_per_second)&&c.ticks_per_second>0,t.poseData+'/'+c.name);
      for(const track of c.tracks)for(const key of ['translation','scale','rotation'])assert.ok(track[key]?.times.length);
    }
  }
  for(const source of manifest.sources){
    const stem=source.source.replaceAll('\\','/').split('/').at(-1).replace(/\.[^.]+$/,'');
    const doc=JSON.parse(readFileSync(resolve(assetRoot,'fx/meshes/'+stem+'.pose.json')));
    for(const measured of source.animations){
      const clip=doc.clips.find(c=>c.name===measured.name);assert.ok(clip,stem);
      assert.equal(clip.ticks_per_second,measured.ticksPerSecond);assert.equal(clip.durationSeconds,measured.period);
      assert.equal(clip.nativePlaybackField,measured.playbackType);assert.equal(clip.nativeD3dxKeys,true);
    }
  }
});

test('frozen LK command roles use high quality while hit reactions and every skill actor retain medium',()=>{
  const policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY);
  const skills=new Set(profile.skillCatalog.flatMap(s=>s.states??[])),binding=json('contracts/command-presentation-bindings-v29.json').professions.LK;
  // IS_ATTACK_STATE also marks DamageAirDown and other hit reactions. It is
  // not a command role; use the frozen consumer/standup declarations as the
  // independent expectation instead of deriving it from policy.comboStates.
  const declared=new Set([...binding.states,...binding.standupRoles]),commands=new Set();
  for(const name of declared){
    if(profile.states[name])commands.add(name);
    const source=profile.stateAliases?.[name];if(profile.states[source])commands.add(source);
  }
  for(const [name,state]of Object.entries(profile.states))if(declared.has(state.sourceState))commands.add(name);
  assert.ok(commands.size>=30);
  for(const name of commands){assert.ok(!skills.has(name),'command role cannot be a catalog skill: '+name);assert.equal(policy.actor({state:name,skillId:null}).level,'high',name);}
  assert.equal(profile.states.ESSI_DAMAGE_AIR_DOWN.raw.IS_ATTACK_STATE,1,'legacy attack flag includes this hit reaction');
  for(const [name,state]of Object.entries(profile.states))if(/(?:^|_)(?:DAMAGE|HYPER_MODE|PARRYING)(?:_|$)/.test(state.sourceState??name))
    assert.deepEqual(policy.actor({state:name,skillId:null}),DEFAULT_EFFECT_QUALITY,'system state '+name);
  for(const skill of profile.skillCatalog){
    // This frozen catalog stores the actual identifier in skillId, not id.
    // A no-state skill can leave the actor in a command state, including the
    // active armor startup whose high-quality exception applies only to FX.
    const skillId=skill.skillId;assert.ok(Number.isSafeInteger(skillId),'catalog skillId '+skill.name);
    assert.deepEqual(policy.actor({state:'ESSI_COMBO_Z1',skillId}),DEFAULT_EFFECT_QUALITY,'skill owner '+skillId);
    for(const name of skill.states??[]){
      assert.deepEqual(policy.actor({state:name,skillId}),DEFAULT_EFFECT_QUALITY,skillId+'/'+name);
      assert.deepEqual(policy.actor({state:name,skillId:null}),DEFAULT_EFFECT_QUALITY,'skill branch without ID '+name);
    }
  }
});

test('LK sword trail uses the real mounted weapon pose for every declared command trace, both facings and awakening',async t=>{
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  const view=createActorView(await loadPoseContainer(scene,resolve(assetRoot,'lk-runtime.glb')),scene,'LK',.01,pose);
  const manager=createRFWeaponTrails({scene,profile,sampleEndpoints:(_actor,names)=>Object.fromEntries(getActorNativePoints(view,names,.01))});
  t.after(()=>{manager.dispose();view.dispose();scene.dispose();engine.dispose();});
  const skillStates=new Set(profile.skillCatalog.flatMap(s=>s.states??[]));let checked=0;
  for(const [name,state]of Object.entries(profile.states))if(!skillStates.has(name)&&state.raw.SLASH_TRACE){
    for(const facing of [-1,1])for(const remaining of [0,30]){
      manager.clear();const a=actor(name);a.facing=facing;a.awakening.remaining=remaining;
      view.root.rotation.y=facing<0?Math.PI:0;
      for(let i=0;i<12;i++){
        a.animationTime=state.raw.SLASH_TRACE[1]+i/60;sampleAnimation(view,a.animationName,a.animationTime,false);
        manager.step({actors:[a],dt:1/60,clawEnabled:false});
      }
      const proof=manager.proof();assert.deepEqual(proof.unsupported,[],name);
      assert.equal(proof.channels.length,2,name);assert.ok(proof.channels.every(c=>c.key.includes(':sword:')&&c.visible&&c.vertices>2),name);
      const rendered=scene.meshes.filter(m=>m.name.startsWith('rf-trail-')&&m.isEnabled());assert.equal(rendered.length,4);
      assert.ok(rendered.every(m=>m.getVerticesData('position').every(Number.isFinite)));checked++;
    }
  }
  assert.ok(checked>=100);
});

test('LK normal awakening attaches original blue energy sequences to all four original bones and retires them',()=>{
  const samplers=createNativeSamplers({characterPose:pose,effectIndex:mergeEffectIndexes({templates:{}},index),effectPoses:{},profile});
  const runtime=createEffectRuntime({index}),attachments=awakeningAttachmentsFor(profile);
  const aura=createAwakeningEffects({runtime,samplers,maxHyperModeTime:profile.components.MAX_HYPER_MODE_TIME,attachments});
  const a=actor('RSI_WAIT'),state={actors:[a]};a.awakening.remaining=30;
  for(const facing of [-1,1]){a.facing=facing;for(let i=0;i<30;i++){aura.step(state);runtime.step(1/60,state);}}
  const proof=aura.proof();assert.equal(proof.emitters,4);assert.ok(proof.activeParticles>0);
  assert.deepEqual(proof.templates,['HyperBoostRight','HyperBoostLeft']);assert.deepEqual([...runtime.notes,...proof.unsupported],[]);
  for(const row of proof.attachments)assert.deepEqual(row.position,samplers.effectAnchorSampler({definition:{BONE_NAME:row.bone}},a).position);
  a.awakening.remaining=0;aura.step(state);assert.equal(runtime.count,0);assert.equal(aura.proof().emitters,0);
});

test('every actual LK effect mesh prewarms and animates; traced Armageddon follows the complete native hand matrix',async t=>{
  const names=Object.values(index.templates).filter(t=>t.glb&&(t.fields.DrawCount??1)>0).map(t=>t.name);
  const templates=Object.fromEntries(names.map(name=>[name,index.templates[name]]));
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);new FreeCamera('LK-FX-v2',new Vector3(0,0,10),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_base,file,s)=>loadPoseContainer(s,resolve(assetRoot,file)));
  const effectPoses=Object.fromEntries(Object.values(templates).map(t=>[t.poseData,JSON.parse(readFileSync(resolve(assetRoot,t.poseData)))]));
  const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},damageEffects:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:names};
  const samplers=nativeSamplers({characterPose:pose,effectIndex:mergeEffectIndexes({templates:{}},index),effectPoses,profile});
  const view=await createEffectsView({scene,engine,index:{...index,templates},profile:bounded,effectPoses,samplers,effectQuality:DEFAULT_EFFECT_QUALITY});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  assert.ok(view.proof().meshInstances>=3);assert.ok(!view.proof().unsupported.some(n=>n.includes(':animation-rate')));
  const a=actor('RSI_WAIT'),state={actors:[a],effects:[]};a.landPosition=[0,0,0];
  for(const name of names){
    view.clear();view.event({type:'effectStarted',effectId:name,name,actorId:'LK',skillId:21007,definition:{},birthAnchor:{position:[0,0,0],facing:1}},state);
    let peak=0;
    for(let frame=0;frame<90;frame++){view.step(1/60,state);view.render();peak=Math.max(peak,view.performance().fxMeshesLive);}
    assert.ok(peak>0,name+' has an actual rendered native mesh at its original emission time');
  }
  view.clear();const definition=profile.effectSets.EffectSet_SA_ELK_ArmagedonBlade.raw.EFFECT0;
  view.event({type:'effectStarted',effectId:'tracedSword',name:'ELK_ArmagedonBladeM',actorId:'LK',skillId:21007,definition,birthAnchor:{position:[0,0,0],facing:1}},state);
  for(const facing of [-1,1]){a.facing=facing;a.animationTime=.2;view.step(1/60,state);view.render();
    const matrix=samplers.effectAnchorSampler({definition},a).matrix;assert.equal(matrix?.length,16);
    const expected=writeNativeEffectBoneMatrix(matrix,new Array(16));
    const rendered=scene.transformNodes.find(n=>n.name.startsWith('fx-ELK_ArmagedonBladeM-')&&n.name.endsWith('-world')&&n.isEnabled());
    assert.ok(rendered);for(const [i,value]of rendered.computeWorldMatrix(true).asArray().entries())assert.ok(Math.abs(value-expected[i])<1e-5,'matrix element '+i);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {NullEngine,Scene} from '@babylonjs/core';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {createEffectRuntime,resolveValue} from '../../packages/effect-runtime/index.mjs';
import {instantiateNativeEffectRandom} from '../../packages/native-source/effect-random.mjs';
import {createActorView,sampleAnimation,placeActor,getActorNativePoints} from '../../apps/web/actor-presentation.mjs';
import {createPoseLibrary,samplePose,compose,transform,resolveControllerPose} from '../../tools/assets/character/sample_pose.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const root=new URL('../../',import.meta.url);
const file=name=>process.env.RF_EFFECT_ACTOR_ASSET_ROOT?pathToFileURL(process.env.RF_EFFECT_ACTOR_ASSET_ROOT+'/'+name):new URL('artifacts/rf/'+name,root);
const runtimePose=JSON.parse(readFileSync(file('runtime-pose.json')));
const fullPose=JSON.parse(gunzipSync(readFileSync(file('pose-tracks.json.gz'))));
const source=createPoseLibrary(fullPose);
const roots=JSON.parse(readFileSync(new URL('contracts/rf-buff-display-roots.json',root)));
const index=JSON.parse(readFileSync(new URL('contracts/rf-buff-display-fx-index.json',root)));
const native=await instantiateNativeEffectRandom(readFileSync(process.env.RF_EFFECT_RANDOM_WASM??new URL('artifacts/native/effect-random/effect-random-source.wasm',root)));
function samplers(pose=runtimePose,onUnsupported){return createNativeSamplers({characterPose:pose,effectPoses:{},effectIndex:{templates:{}},profile:{},onUnsupported});}
function actor(overrides={}){return {id:'rf-head',x:120,y:240,z:13,facing:1,animationName:'Walk',animationTime:.25,animationLoop:true,consumeRootTranslation:true,...overrides};}
function close(actual,expected,tolerance,label){actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<tolerance,`${label} axis ${i}: ${n} / ${expected[i]}`));}

test('HEAD_BONE uses original RF head world point plus User Y70 and target offsets, including blended/rendered pose',async()=>{
  const sampler=samplers(),engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  try{
    const view=createActorView(await loadPoseContainer(scene,file('rf-runtime.glb')),scene,'buff-head',.01,fullPose);
    for(const facing of [1,-1])for(const consumeRootTranslation of [true,false])for(const transition of [null,{enabled:true,fromName:'Dash',fromTime:.2,fromSpeed:1,fromWeight:.4,fromLoop:true,durationSeconds:.1,elapsedSeconds:.03}]){
      const a=actor({facing,consumeRootTranslation,animationName:transition?'ComboZ1':'Walk',animationLoop:!transition,presentationTransition:transition});
      const timing=resolveControllerPose(a,name=>source.clips.get(name)?.durationSeconds,name=>source.clips.get(name)?.nativePlaybackField);
      const matrices=samplePose(source,timing.clipName,timing.timeSeconds,{transition:timing.transition,
        rootTranslationOverride:consumeRootTranslation?[0,null,0]:null,worldMatrix:compose([a.x,a.y,a.z],[1,1,1],facing<0?[0,1,0,0]:[0,0,0,1])});
      const sourceHead=transform(matrices.get('Bip01_Head'),[0,0,0]);
      sampleAnimation(view,a.animationName,a.animationTime,a.animationLoop,transition);placeActor(view,a);
      const renderedHead=getActorNativePoints(view,['Bip01_Head']).get('Bip01_Head');
      assert.equal(getActorNativePoints(view,['_HEAD_BONE']).size,0,'consumer token is not a fabricated skeleton node');
      for(const set of ['EffectSet_DEBUFF_WOUND','EffectSet_DEBUFF_STUN']){
        const definition=roots.effectSets[set].raw.EFFECT0;
        const anchor=sampler.effectAnchorSampler({definition},a);
        assert.ok(anchor.evidence.includes('GetHeadBonePos'));
        const expected=[sourceHead[0],sourceHead[1]+70+definition.POSITION_OFFSET_Y,sourceHead[2]];
        close(anchor.position,expected,1e-8,'full source vs runtime-pruned head');
        close(anchor.position,[renderedHead[0],renderedHead[1]+70+definition.POSITION_OFFSET_Y,renderedHead[2]],.003,'actual GLB display head');
      }
    }
  }finally{scene.dispose();engine.dispose();}
});

test('missing real head bone is omitted explicitly, without guessed actor-height fallback',()=>{
  const notes=[],empty={schemaVersion:1,frames:[],helpers:[],clips:[{name:'Walk',durationSeconds:1,tracks:[]}]};
  const sampler=samplers(empty,n=>notes.push(n));
  assert.equal(sampler.effectAnchorSampler({definition:{BONE_NAME:'_HEAD_BONE',POSITION_OFFSET_Y:100}},actor()),null);
  assert.equal(notes.length,1);assert.equal(notes[0].id,'bone:_HEAD_BONE');assert.ok(notes[0].detail.includes('Bip01_Head'));
});

test('original minor SwordFireTip has two actor-position offsets and no invented weapon/head attachment',()=>{
  const sampler=samplers({schemaVersion:1,frames:[],helpers:[],clips:[]});
  const fire=roots.effectSets.EffectSet_DEBUFF_FIRE.raw;
  for(const facing of [1,-1]){
    const a=actor({facing,animationName:'missing-animation'});
    assert.equal(fire.EFFECT0.EFFECT_TYPE,9);assert.equal(fire.EFFECT1.EFFECT_TYPE,9);
    assert.equal(fire.EFFECT0.BONE_NAME,undefined);assert.equal(fire.EFFECT1.BONE_NAME,undefined);
    assert.deepEqual(sampler.effectAnchorSampler({definition:fire.EFFECT0},a).position,[120,330,13]);
    assert.deepEqual(sampler.effectAnchorSampler({definition:fire.EFFECT1},a).position,[120+facing*30,360,13]);
  }
  assert.equal(index.templates.SwordFireTip.sourceFamily,'game-minor');
});

test('original SwordFireTip TRACE moves living particles by actor anchor displacement once',()=>{
  const template=index.templates.SwordFireTip;assert.equal(template.fields.Trace,true);
  const definition=roots.effectSets.EffectSet_DEBUFF_FIRE.raw.EFFECT0;assert.equal(definition.TRACE,1);
  const sampler=samplers(),start=actor(),stationary={actors:[{...start}]},moving={actors:[{...start}]};
  function make(state){const runtime=createEffectRuntime({index,nativeRandom:native,seed:42});
    const anchor=s=>sampler.effectAnchorSampler({definition},s.actors[0]).position;
    const emitter=runtime.add('SwordFireTip',{position:anchor(state),anchor,facing:1});
    runtime.step(.1,state);assert.ok(runtime.particles.size>0);return {runtime,emitter};}
  const a=make(stationary),b=make(moving),ids=[...a.runtime.particles.keys()];
  const displacement=[20,30,6];['x','y','z'].forEach((name,i)=>{moving.actors[0][name]+=displacement[i];});
  a.runtime.step(.01,stationary);b.runtime.step(.01,moving);
  for(const id of ids){const original=a.runtime.particles.get(id),shifted=b.runtime.particles.get(id);assert.ok(original&&shifted);
    close(shifted.position,original.position.map((n,i)=>n+displacement[i]),1e-8,'single original Trace displacement');}
});

test('native float equal ranges compare after binary32 conversion and consume no host or WASM draw',()=>{
  assert.equal(Math.fround(.1),Math.fround(.1+1e-10));
  let calls=0;const rng=()=>{calls++;return .5;};
  rng.nativeRandom={randomFloat(){throw Error('equal binary32 range must not enter native draw');}};
  assert.equal(resolveValue({random:[.1,.1+1e-10]},rng),Math.fround(.1));assert.equal(calls,0);
  assert.ok(Object.is(resolveValue({random:[-0,0]},rng),-0));assert.equal(calls,0);
  rng.nativeRandom=native;
  assert.equal(resolveValue({random:[.7,.5]},rng),native.randomFloat(.7,.5,16384));assert.equal(calls,1);
  assert.throws(()=>resolveValue({random:[1e100,1e100]},rng),/interval/);
});

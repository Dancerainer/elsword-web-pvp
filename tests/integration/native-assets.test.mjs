import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {createPoseLibrary,samplePose,compose,transform} from '../../tools/assets/character/sample_pose.mjs';
const root=new URL('../../',import.meta.url);
const read=file=>JSON.parse(readFileSync(new URL(file,root)));
const available=existsSync(new URL('artifacts/rf/runtime-pose.json',root));
function setup({unmeasuredIron=false}={}){
  const profile=read('packages/combat-core/rf-profile.json'),map=read('artifacts/scene/sander-garpai-rock-pvp/collision.json');
  const effectIndex=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),read('artifacts/rf/fx/index.json'));
  // Explicitly remove clock evidence in this fixture. The actual Iron X clock
  // is now measured by the shipped DLL and must no longer be called unknown.
  if(unmeasuredIron)effectIndex.templates.Raven_OverTaker_Iron_Attack01.missingExplicitTickRate=true;
  const paths=[...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))];
  const effectPoses=Object.fromEntries(paths.map(f=>[f,read('artifacts/rf/'+f)]));
  const notes=[];
  const samplers=createNativeSamplers({characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex,effectPoses,profile,onUnsupported:e=>notes.push(e)});
  return {profile,map,samplers,notes};
}
test('real map + original RF helper poses enable Z1 hits and deterministic snapshot replay',{skip:!available},()=>{
  const {profile,map,samplers}=setup();
  const make=()=>createSimulation({profile,map,seed:2016,...samplers});
  const a=make(),b=make();
  for(const s of [a,b]){s.drainEvents();s.step(1/60,{pressed:['Z']});}
  for(let i=0;i<30;i++){a.step(1/60,{});b.step(1/60,{});}
  assert.deepEqual(a.snapshot(),b.snapshot());
  assert.ok(a.snapshot().actors[1].hp<a.snapshot().actors[1].hpMax,'Z1 must hit with the source dummy and defender spheres');
  assert.equal(a.snapshot().events.filter(e=>e.type==='hit').length,1,'single-target hit latch must not repeat every sample');
  const c=make();c.restore(a.snapshot());
  for(let i=0;i<60;i++){a.step(1/60,{});c.step(1/60,{});}
  assert.deepEqual(a.snapshot(),c.snapshot());
});
test('unconfirmed effect tracks are retained as unsupported and never given a guessed tick rate',{skip:!available},()=>{
  const {notes,samplers}=setup({unmeasuredIron:true});
  const effect={name:'BIG_SPINE',damage:{MAIN_EFFECT_NAME:'Raven_OverTaker_Iron_Attack01'},definition:{},elapsed:.05,animationTime:.05,
    currentAnchor:{position:[100,200,300],facing:1}};
  assert.deepEqual(samplers.effectSampler(effect,{x:0,y:0,z:0,facing:1}),[]);
  assert.ok(notes.some(n=>n.id==='effect-tick:BIG_SPINE'));
  assert.ok(notes.every(n=>n.type==='unsupported-asset-adapter'));
});
test('declared left-hand effect bone survives pruning and agrees with the complete source-key pose',{skip:!available},()=>{
  const {samplers}=setup(),runtime=read('artifacts/rf/runtime-pose.json');assert.ok(runtime.frames.some(f=>f.name==='Dummy2_Lhand'));
  const source=createPoseLibrary(JSON.parse(gunzipSync(readFileSync(new URL('artifacts/rf/pose-tracks.json.gz',root)))));
  const actor={id:'source-bone-check',animationName:'SI_A_RRF_HELL_DIVE',animationTime:.8,animationLoop:false,applyMotionOffset:true,x:100,y:200,z:0,facing:-1};
  const matrices=samplePose(source,actor.animationName,actor.animationTime,{rootTranslationOverride:[0,null,0],worldMatrix:compose([100,200,0],[1,1,1],[0,1,0,0])});
  const point=transform(matrices.get('Dummy2_Lhand'),[0,0,0]);point[0]-=20;
  const anchor=samplers.effectAnchorSampler({definition:{BONE_NAME:'Dummy2_Lhand',POSITION_OFFSET_X:20}},actor);
  point.forEach((n,i)=>assert.ok(Math.abs(n-anchor.position[i])<1e-9,'pruning changed a declared source attachment'));
});

test('during dash/combo blending, attack helpers and effect attachments share the blended local source pose',{skip:!available},()=>{
  const {samplers}=setup();
  const library=createPoseLibrary(JSON.parse(gunzipSync(readFileSync(new URL('artifacts/rf/pose-tracks.json.gz',root)))));
  for(const facing of [1,-1])for(const elapsed of [0,.025,.075]){
    const tr={enabled:true,fromName:'Dash',fromTime:.2,fromSpeed:1,fromLoop:true,durationSeconds:.1,elapsedSeconds:elapsed};
    const actor={id:'blend-helper-check',animationName:'ComboZ1',animationTime:.12,animationLoop:false,applyMotionOffset:true,x:100,y:200,z:0,facing,presentationTransition:tr};
    // Complete original skeleton and runtime-pruned source helper data are separate inputs.
    const expected=samplePose(library,actor.animationName,actor.animationTime,{rootTranslationOverride:[0,null,0],worldMatrix:compose([100,200,0],[1,1,1],facing<0?[0,1,0,0]:[0,0,0,1]),transition:{clipName:'Dash',timeSeconds:.2+elapsed-elapsed**2/.2,weight:elapsed/.1}});
    const anchor=samplers.effectAnchorSampler({definition:{BONE_NAME:'Dummy2_Lhand'}},actor);
    const point=transform(expected.get('Dummy2_Lhand'),[0,0,0]);
    point.forEach((n,i)=>assert.ok(Math.abs(n-anchor.position[i])<1e-8,'source/runtime attachment clocks diverged'));
    const shapes=samplers.collisionSampler(actor,{raw:{}});
    assert.ok(shapes.length>0);
    for(const shape of shapes){
      const p=transform(expected.get(shape.source.helper),[0,0,0]);
      (shape.center??shape.start).forEach((n,i)=>assert.ok(Math.abs(n-p[i])<1e-8,'attack helper used an unblended pose'));
    }
  }
  assert.throws(()=>samplePose(library,'Dash',.1,{transition:{clipName:'absent',timeSeconds:0,weight:.5}}),/previous animation/);
});

test('original effect lines use current anchors; DLL-measured Iron moving lines are enabled',{skip:!available},()=>{
  const {samplers}=setup(),templateName='Mesh_ROT_DASH_JUMP_COMBO_ZX_Ground_Dummy';
  for(const facing of [1,-1]){
    const effect={name:templateName,damage:{MAIN_EFFECT_NAME:templateName},definition:{},elapsed:.025,animationTime:10,
      birthAnchor:{position:[9000,9000,9000],facing},currentAnchor:{position:[100,200,300],facing}};
    const shapes=samplers.effectSampler(effect,{x:0,y:0,z:0,facing});
    assert.equal(shapes.length,1);assert.equal(shapes[0].kind,'line');
    // Original helper frames: X=-70/80, Y=48.656829833984375. The template
    // explicitly scales [2,2,0], so no unknown .X tick rate is needed.
    const expectedStart=[100+facing*-140,297.31365966796875,300],expectedEnd=[100+facing*160,297.31365966796875,300];
    shapes[0].start.forEach((n,i)=>assert.ok(Math.abs(n-expectedStart[i])<1e-8));
    shapes[0].end.forEach((n,i)=>assert.ok(Math.abs(n-expectedEnd[i])<1e-8));
    const anchor=samplers.effectBoneSampler(effect,{},'ATTACK_LINE_END1');
    anchor.forEach((n,i)=>assert.ok(Math.abs(n-expectedEnd[i])<1e-8));
  }
  const moving={name:'BIG_SPINE',damage:{MAIN_EFFECT_NAME:'Raven_OverTaker_Iron_Attack01'},definition:{},elapsed:.05,animationTime:.05,
    currentAnchor:{position:[100,200,300],facing:1}};
  const iron=samplers.effectSampler(moving,{x:0,y:0,z:0,facing:1});
  assert.equal(iron.length,3,'all three original Iron attack lines have measured key data');
  assert.ok(iron.every(s=>s.kind==='line'&&s.start.every(Number.isFinite)&&s.end.every(Number.isFinite)));
  const parentName='Mesh_Raven_OverTaker_XX_Down_X_Dummy',parent={name:parentName,damage:{MAIN_EFFECT_NAME:parentName},definition:{},elapsed:.1,animationTime:.1,
    currentAnchor:{position:[100,200,300],facing:1},birthAnchor:{position:[0,0,0],facing:1}};
  const shapes=samplers.effectSampler(parent,{x:0,y:0,z:0,facing:1});
  assert.equal(shapes.length,1);assert.deepEqual(shapes[0].center,[100,200,300]);
  assert.equal(shapes[0].source.sizeEvidence,'reference-V5 constructor default; target2016 unmeasured');
});

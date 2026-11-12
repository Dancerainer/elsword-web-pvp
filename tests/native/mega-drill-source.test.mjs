import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {instantiateNativeSkills,originalDrillGroups} from '../../packages/native-source/skills.mjs';
import {originalSkillFuture,originalSkillFrame,originalSkillEnd} from '../../packages/combat-core/active-skills.mjs';
const compiled=await WebAssembly.compile(await readFile(new URL('../../.cache/native-skills-generated/skills.wasm',import.meta.url)));
const bridge=await instantiateNativeSkills(compiled);
const invalid=0xffffffff;
const snapshot=()=>({nowSpeedX:123,dashSpeed:500,damageChangeTime:1.17,hitListSize:2,
  reAttack:false,hitGap:0,backSpeedX:800,lhandEnabled:false,swordEnabled:true,luaTableOpen:true,
  particleHandle:invalid,meshHandle:invalid,particleExists:false,meshExists:false,
  handPosition:[120,230,5],createdParticleHandle:invalid,createdMeshHandle:invalid,damageStage:0});
const base={hp:800000,hpMax:800000,dt:1/60,position:[100,200,5],rotation:[0,0,0],direction:[1,0,0],landY:200,isRight:true};
const run=(kind,time,before,extra={})=>bridge.evaluate({...base,kind,time,before,oneshot:0,megaDrill:snapshot(),...extra});

test('MegaDrill compiles unchanged original callbacks without host imports and retains target limits',()=>{
  assert.deepEqual(WebAssembly.Module.imports(compiled),[]);
  assert.deepEqual(originalDrillGroups,{future:56,now:57,end:58});
  assert.equal(bridge.contract.drillTargetBinaryVerified,false);
});
test('original Future .27/.7/1.2 events use the supplied dash getter and strict previous-time boundary',()=>{
  for(const t of [.27,.7,1.2]){
    assert.equal(run(56,t,t-.01).megaDrill.nowSpeedX,600);
    assert.equal(run(56,t,t).megaDrill.nowSpeedX,123);
    assert.equal(run(56,t-.001,t-.01).megaDrill.nowSpeedX,123);
    assert.equal(run(56,t,t-.01,{oneshot:t}).megaDrill.nowSpeedX,123);
  }
});
test('original .5 Now clears shared hit history without switching damage or attack boxes',()=>{
  const r=run(57,.5,.49);
  assert.equal(r.megaDrill.hitListSize,0);assert.equal(r.drillMutation.clearHitHistory,true);
  assert.equal(r.drillMutation.damageOverridden,null);assert.equal(r.drillMutation.attackBoxMask,0);
  assert.equal(run(57,.5,.5).drillMutation.clearHitHistory,false);
});
test('original 1.0 Now enables repeat at .1 gap, zeroes knockback and changes sword/claw attack boxes',()=>{
  const r=run(57,1,.99);
  assert.deepEqual(r.drillMutation.attackDataMutation,{reAttack:true,hitGap:Math.fround(.1),backSpeedX:0});
  assert.deepEqual(r.drillMutation.enabledBoxes,{Lhand1:true,Sword:false});
  assert.equal(r.drillMutation.clearHitHistory,true);assert.equal(r.drillMutation.attackBoxMask,3);
  assert.equal(r.megaDrill.damageStage,0);assert.equal(r.drillMutation.damageOverridden,null);
});
test('original configurable damage-change event requests the whole next table after SimpleInit',()=>{
  const r=run(57,1.17,1.16);
  assert.equal(r.drillMutation.damageOverridden,'DAMAGE_DATA_NEXT');assert.equal(r.megaDrill.damageStage,1);
  assert.equal(r.drillMutation.clearHitHistory,true);assert.equal(r.drillMutation.attackDataMutation,null);
  assert.equal(r.drillMutation.commonSimpleInitWholeConsumerExecuted,false);
  // These are only SimpleInit defaults. They cannot replace next table's data.
  assert.equal(r.megaDrill.reAttack,false);assert.equal(r.megaDrill.hitGap,0);assert.equal(r.megaDrill.backSpeedX,0);
  const closed=run(57,1.17,1.16,{megaDrill:{...snapshot(),luaTableOpen:false}});
  assert.equal(closed.drillMutation.damageOverridden,null);assert.equal(closed.drillMutation.clearHitHistory,false);
});
test('original Now else-if preserves first-event priority across a large interval',()=>{
  const r=run(57,1.4,0);
  assert.equal(r.drillMutation.clearHitHistory,true);assert.equal(r.drillMutation.attackBoxMask,0);
  assert.equal(r.drillMutation.damageOverridden,null);assert.deepEqual(r.drillMutation.helperRequests,[]);
  assert.equal(r.megaDrill.damageStage,0,'time>=1.17 does not prove original next-table event ran');
});
test('original 1.33 hand helpers preserve exact names, host factory returns and subsequent follow requests',()=>{
  const input={...snapshot(),createdParticleHandle:71,createdMeshHandle:91};
  const r=run(57,1.33,1.32,{megaDrill:input});
  assert.equal(r.megaDrill.particleHandle,71);assert.equal(r.megaDrill.meshHandle,91);
  assert.deepEqual(r.drillMutation.helperRequests.map(x=>[x.type,x.name??x.handle]),[
    ['createParticleHandle','Flare_Raven_MagnumBlaster06'],['createMeshHandle','Raven_MagnumBlaster01_Mesh'],
    ['followParticleHandle',71],['followMeshHandle',91]]);
  assert.ok(r.drillMutation.helperRequests.every(x=>JSON.stringify(x.position)==='[120,230,5]'));
  const follow=run(57,1.4,1.39,{megaDrill:{...r.megaDrill,createdParticleHandle:invalid,createdMeshHandle:invalid,particleExists:true,meshExists:true,handPosition:[125,240,5]}});
  assert.deepEqual(follow.drillMutation.helperRequests.map(x=>x.type),['followParticleHandle','followMeshHandle']);
  assert.ok(follow.drillMutation.helperRequests.every(x=>JSON.stringify(x.position)==='[125,240,5]'));
});
test('invalid helpers remain absent and original lookup failure clears stale handles',()=>{
  const r=run(57,1.33,1.32);
  assert.equal(r.megaDrill.particleHandle,invalid);assert.equal(r.megaDrill.meshHandle,invalid);
  assert.deepEqual(r.drillMutation.helperRequests.map(x=>x.type),['createParticleHandle','createMeshHandle']);
  assert.equal(r.drillMutation.helperFactoryAndLifetimeVerified,false);
  const gone=run(57,1.4,1.39,{megaDrill:{...snapshot(),particleHandle:71,meshHandle:91}});
  assert.equal(gone.megaDrill.particleHandle,invalid);assert.equal(gone.megaDrill.meshHandle,invalid);
  assert.deepEqual(gone.drillMutation.helperRequests,[]);
});
test('original End restores attack boxes and delegates common cleanup instead of inventing helper destruction',()=>{
  const r=run(58,2.5,2.4,{megaDrill:{...snapshot(),lhandEnabled:true,swordEnabled:false,damageStage:1,particleHandle:71,meshHandle:91}});
  assert.deepEqual(r.drillMutation.enabledBoxes,{Lhand1:false,Sword:true});
  assert.equal(r.drillMutation.attackBoxMask,3);assert.equal(r.commonBoundaryCalls,1);
  assert.equal(r.megaDrill.particleHandle,71);assert.deepEqual(r.drillMutation.helperRequests,[]);
});
test('independent simulations and restored snapshots do not share drill fields or sink state',async()=>{
  const other=await instantiateNativeSkills(compiled),input={...base,kind:57,time:1,before:.99,megaDrill:snapshot()};
  const expected=bridge.evaluate(input);other.evaluate({...input,time:1.17,before:1.16});
  assert.deepEqual(bridge.evaluate(input),expected);
  const revived=await instantiateNativeSkills(compiled);
  assert.deepEqual(revived.evaluate({...base,kind:58,time:2,before:1.9,megaDrill:structuredClone(expected.megaDrill)}),
    bridge.evaluate({...base,kind:58,time:2,before:1.9,megaDrill:expected.megaDrill}));
});
test('snapshot host rejects missing, nonfinite, over-capacity and non-boolean inputs',()=>{
  for(const patch of [{dashSpeed:NaN},{hitListSize:5},{particleHandle:-1},{handPosition:[1,2]},{reAttack:1},{damageStage:2}])
    assert.throws(()=>run(57,1,.99,{megaDrill:{...snapshot(),...patch}}));
  assert.throws(()=>run(57,1,.99,{megaDrill:undefined}),TypeError);
});
test('combat callback adapters retain actor snapshot, local direction and explicit source geometry',()=>{
  const profile={states:{RSI_A_RF_MEGADRILL_BREAK:{raw:{DAMAGEDATA_CHANGE_TIME:1.17,DAMAGE_DATA:{BACK_SPEED_X:800}}}}};
  const actor={state:'RSI_A_RF_MEGADRILL_BREAK',animationTime:.27,animationBeforeTime:.26,animationOneshotTimer:0,
    hp:800000,hpMax:800000,skillScale:1,awakening:{remaining:0},grounded:true,x:100,y:200,z:5,facing:-1,vx:-123,hits:{a:1,b:1}};
  const future=originalSkillFuture(bridge,actor,profile,1/60,{dashSpeed:500});
  assert.equal(future.megaDrill.nowSpeedX,600);actor.sourceMegaDrill=future.megaDrill;
  actor.animationTime=1;actor.animationBeforeTime=.99;
  const now=originalSkillFrame(bridge,actor,profile,1/60,{dashSpeed:500,handPosition:[120,230,5]});
  assert.equal(now.drillMutation.clearHitHistory,true);actor.sourceMegaDrill=now.megaDrill;
  assert.deepEqual(originalSkillEnd(bridge,actor,profile,{dashSpeed:500}).drillMutation.enabledBoxes,{Lhand1:false,Sword:true});
  assert.throws(()=>originalSkillFrame(bridge,actor,profile,1/60,{dashSpeed:500}),TypeError,'hand bone cannot be guessed from actor origin');
});
test('PowerAssault Future changes passive velocity first, then restores separate current velocity at .9',()=>{
  const motion={...base,kind:59,skillMotion:{nowSpeedX:123,passiveSpeedX:42},oneshot:0};
  assert.deepEqual(bridge.evaluate({...motion,time:.35,before:.34}).skillMotion,{nowSpeedX:123,passiveSpeedX:1500});
  assert.deepEqual(bridge.evaluate({...motion,time:.9,before:.89}).skillMotion,{nowSpeedX:1000,passiveSpeedX:0});
  assert.deepEqual(bridge.evaluate({...motion,time:.9,before:.9}).skillMotion,{nowSpeedX:123,passiveSpeedX:42});
  assert.deepEqual(bridge.evaluate({...motion,time:1,before:0}).skillMotion,{nowSpeedX:123,passiveSpeedX:1500},'source else-if does not execute later stage in same frame');
});
test('SevenBurst Future recoil preserves −700 current speed and supplied passive speed',()=>{
  const motion={...base,kind:60,skillMotion:{nowSpeedX:123,passiveSpeedX:42},oneshot:0};
  assert.deepEqual(bridge.evaluate({...motion,time:2.633,before:2.63}).skillMotion,{nowSpeedX:-700,passiveSpeedX:42});
  assert.deepEqual(bridge.evaluate({...motion,time:2.633,before:2.633}).skillMotion,{nowSpeedX:123,passiveSpeedX:42});
  assert.throws(()=>bridge.evaluate({...motion,time:2.633,before:2.63,skillMotion:{nowSpeedX:NaN,passiveSpeedX:0}}),TypeError);
});

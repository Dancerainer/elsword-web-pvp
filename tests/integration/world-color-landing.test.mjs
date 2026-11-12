import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Color3} from '@babylonjs/core';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createLandingEffects,airDownLandingState} from '../../apps/web/landing-effects.mjs';
import {actorWorldColor,createWorldColorController,createWorldColorView} from '../../apps/web/world-color.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const index=JSON.parse(readFileSync(new URL('../../contracts/rf-landing-fx-index-v1.json',import.meta.url)));
const sources=JSON.parse(readFileSync(new URL('../../contracts/rf-screen-landing-source-v1.json',import.meta.url)));
const actor=(extra={})=>({id:'rf',x:10,y:100,z:0,facing:1,hp:100,state:'RSI_WAIT',stateSerial:1,animationTime:0,landPosition:[10,100,0],awakening:{remaining:0},...extra});
function fixture(actors=[actor()]){
  const runtime=createEffectRuntime({index}),landing=createLandingEffects({runtime});
  const state={actors};
  const step=dt=>{landing.step(state);runtime.step(dt,state);};
  return {runtime,landing,state,step};
}

test('awake, target CHANGE_WORLD_COLOR and original special callback share original PvP colors',()=>{
  assert.deepEqual(actorWorldColor(actor({state:'RSI_HYPER_MODE',awakening:{remaining:99}}),profile),[34/255,34/255,34/255]);
  for(const state of ['SI_SA_RRF_X_CRASH','RSI_SI3_OVER_TAKER_GUARDIAN_STRIKE','RSI_SI1_OVER_TAKER_CHARGED_BOLT']){
    assert.deepEqual(actorWorldColor(actor({state}),profile),[34/255,34/255,34/255]);
    assert.deepEqual(actorWorldColor(actor({state,awakening:{remaining:1}}),profile),[1,0,0]);
  }
  assert.equal(actorWorldColor(actor(),profile),null);
  assert.equal(actorWorldColor(actor({state:'RSI_A_ROT_WEAPON_BREAK'}),profile),null);
});
test('the supported world-color footprint covers every audited reference callback and actual target flag',()=>{
  for(const state of [...Object.keys(sources.colorCallbacks),...sources.targetChangeWorldColorStates]){
    assert.deepEqual(actorWorldColor(actor({state}),profile),[34/255,34/255,34/255]);
  }
  assert.equal(index.templates.DropDown.animationClips[0].durationSeconds,.3333333432674408);
  for(const t of Object.values(index.templates))assert.deepEqual(t.unsupported,[]);
});
test('world color uses global PvP source rather than guessed StopOther radius and restores in one second',()=>{
  const c=createWorldColorController({profile}),state={actors:[actor({x:90000,state:'RSI_HYPER_MODE'})]};
  assert.deepEqual(c.step(state,1/60),[34/255,34/255,34/255]);
  state.actors[0].state='RSI_WAIT';const half=c.step(state,.5);
  assert.deepEqual(half,[.5+17/255,.5+17/255,.5+17/255]);
  assert.deepEqual(c.step(state,.5),[1,1,1]);
  assert.equal(c.proof().active,false);
});
test('retained competing skills do not reset one another and clear immediately restores original world colors',()=>{
  const c=createWorldColorController({profile}),a=actor({state:'RSI_HYPER_MODE'}),b=actor({id:'other',state:'SI_SA_RRF_X_CRASH',awakening:{remaining:10}});
  assert.deepEqual(c.step({actors:[a,b]},.1),[1,0,0]);
  b.state='RSI_WAIT';assert.deepEqual(c.step({actors:[a,b]},.1),[34/255,34/255,34/255]);
  c.clear();assert.deepEqual(c.step({actors:[]},0),[1,1,1]);
});
test('world material baseline and native opt-out are preserved; character and UI material stays bright',()=>{
  const colored={albedoColor:new Color3(.4,.6,.8)},optOut={albedoColor:new Color3(.9,.8,.7)},character={albedoColor:new Color3(1,1,1)};
  const view=createWorldColorView({profile});
  view.setEnvironment({meshes:[{material:colored},{material:optOut,parent:{metadata:{gltf:{extras:{nativeUseWorldColor:false}}}}}]});
  view.step({actors:[actor({state:'RSI_HYPER_MODE'})]},.1);
  for(const [i,v] of colored.albedoColor.asArray().entries())assert.ok(Math.abs(v-[.4,.6,.8][i]*34/255)<1e-12);
  assert.deepEqual(optOut.albedoColor.asArray(),[.9,.8,.7]);assert.deepEqual(character.albedoColor.asArray(),[1,1,1]);
  view.setEnvironment({meshes:[]});assert.deepEqual(colored.albedoColor.asArray(),[.4,.6,.8]);
});
test('air-down landing emits original ground ring, stones and two timed smoke triggers exactly once',()=>{
  const f=fixture(),a=f.state.actors[0];f.step(1/60);
  a.state=airDownLandingState;a.stateSerial++;a.animationTime=0;f.step(1/60);
  assert.deepEqual(f.landing.proof().triggers,{DropDown:1,GroundShockWave:1,AirDownTick:1});
  a.animationTime=.03;f.step(1/60);a.animationTime=.47;f.step(1/60);
  assert.equal(f.landing.proof().triggers.DownSmoke,2);
  const ring=[...f.runtime.emitters.values()].find(e=>e.name==='GroundShockWave');assert.deepEqual(ring.position,[10,105,0]);assert.equal(ring.limit,1);
  const stones=[...f.runtime.emitters.values()].find(e=>e.name==='AirDownTick');assert.equal(stones.options.landPosition,100);assert.equal(stones.limit,10);
  for(let n=0;n<200;n++)f.step(1/60);
  assert.equal(f.runtime.count,0);assert.equal(f.runtime.emitters.size,0);
  assert.equal(f.landing.proof().triggers.DownSmoke,2);
});
test('repeated or old state packets never replay bursts; common smoke reuses its original per-actor cap',()=>{
  const f=fixture(),a=f.state.actors[0];f.step(1/60);a.state=airDownLandingState;a.stateSerial++;a.animationTime=.03;f.step(1/60);
  for(let n=0;n<12;n++)f.step(1/60);
  const old=[...f.runtime.emitters.values()].find(e=>e.name==='DownSmoke');assert.equal(old.count,7);
  a.animationTime=.47;f.step(1/60);assert.equal([...f.runtime.emitters.values()].find(e=>e.name==='DownSmoke').id,old.id);
  for(let n=0;n<20;n++)f.step(1/60);assert.ok(old.particles.size<=10);
  const before=f.landing.proof().triggers;a.stateSerial--;a.animationTime=.01;
  for(let n=0;n<20;n++)f.step(1/60);assert.deepEqual(f.landing.proof().triggers,before);
});
test('refresh observing an old landing skips historical rings and smoke; future second timer still executes',()=>{
  const f=fixture([actor({state:airDownLandingState,stateSerial:5,animationTime:.3})]);f.step(1/60);
  assert.deepEqual(f.landing.proof().triggers,{});f.state.actors[0].animationTime=.47;f.step(1/60);
  assert.deepEqual(f.landing.proof().triggers,{DownSmoke:1});
});
test('ordinary jumps/standing downs do not emit air-down landing dust; actor removal clears actor-owned sequences',()=>{
  const f=fixture(),a=f.state.actors[0];f.step(1/60);
  for(const state of ['RSI_JUMP_LANDING','RSI_DAMAGE_DOWN_FRONT']){a.state=state;a.stateSerial++;a.animationTime=.5;f.step(1/60);}
  assert.deepEqual(f.landing.proof().triggers,{});
  a.state=airDownLandingState;a.stateSerial++;a.animationTime=.03;f.step(1/60);
  f.state.actors=[];f.step(1/60);assert.equal(f.landing.proof().actors,0);
  assert.equal([...f.runtime.emitters.values()].some(e=>e.name!=='DropDown'),false);
});
test('actual target 82X air-down reaction lands through source state and only that transition emits dust',()=>{
  const map={sceneId:'explicit-air-down-fixture',lines:[{lineId:0,start:[-2000,0,0],end:[2000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
  const sim=createSimulation({profile,map,actors:[{id:'rf',team:0,x:0,y:0},{id:'target',team:1,x:300,y:300}]});
  const a=sim.actor('target');a.grounded=false;a.lineId=null;a.landPosition=[300,0,0];
  const f=fixture(sim.view().actors);f.step(1/60);
  // The original jump-X table supplies RT_DOWN, not a synthetic landing event.
  const data=structuredClone(profile.states.RSI_JUMP_COMBO_X.raw.DAMAGE_DATA);
  assert.equal(data.REACT_TYPE,3);
  sim.injectHit({attackerId:'rf',targetId:'target',damageData:data});
  for(let n=0;n<180;n++){sim.step(1/60,{}, {snapshot:false});f.state.actors=sim.view().actors;f.step(1/60);}
  assert.equal(f.landing.proof().triggers.DropDown,1);assert.equal(f.landing.proof().triggers.GroundShockWave,1);
  assert.equal(f.landing.proof().triggers.AirDownTick,1);assert.equal(f.landing.proof().triggers.DownSmoke,2);
});

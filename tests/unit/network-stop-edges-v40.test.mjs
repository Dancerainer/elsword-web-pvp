import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createCombatPlaybackProducer} from '../../packages/online/combat-playback.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import {encodeOwnedMotion} from '../../packages/online/owned-motion.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';
import {advanceActorStops} from '../../packages/combat-core/source-stop-queues-v53.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url))),dt=1/60;
const map={sceneId:'stop-edges',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const near=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1e-6,`${label}: ${actual} vs ${expected}`);
function fixture(options={}){
  // Actual source STOP_OTHER_UNIT -> accepted hit cancellation -> new STOP.
  // Fixture durations deliberately alias the source deadline (frame 19).
  const sourceProfile=structuredClone(profile);
  for(const [name,duration]of [['NETWORK_STOP_LONG',.3],['NETWORK_STOP_AGAIN',.3-2*dt]])
    sourceProfile.states[name]={...structuredClone(profile.states.RSI_WAIT),raw:{STOP_OTHER_UNIT1:{1:.01,2:duration}}};
  const source=createSimulation({profile:sourceProfile,map,networkOwnerId:'remote',seed:2016,preset:{passives:[],guildPassives:[]},actors:[
    {id:'remote',team:0,position:[0,300,0],lineId:null},
    {id:'longCaster',team:1,position:[-1200,0,0],lineId:0},
    {id:'newCaster',team:1,position:[1200,300,0],lineId:null}]});
  for(const actor of source.state.actors)actor.inputLock=0;
  const actor=source.actor('remote');source.enter(actor,'RSI_DAMAGE_AIR_UP','fixture-reaction');
  Object.assign(actor,{grounded:false,lineId:null,y:300,vy:600,landPosition:[0,0,0]});
  const serial=actor.stateSerial,producer=createCombatPlaybackProducer({version:1});
  const snapshot=frame=>{const report=encodeOwnedState(source,'remote',{epoch:1,frameSeq:frame});
    return {report,motion:encodeOwnedMotion(report,{includeReaction:true}),action:producer.capture(source,'remote',{epoch:1,frameSeq:frame,report})};};
  const stop=(id,state)=>{const caster=source.actor(id);source.enter(caster,state,'fixture-stop');source.processStateEvents(caster,0,.02);advanceActorStops(actor,0);};
  stop('longCaster','NETWORK_STOP_LONG');const first=snapshot(1);source.step(dt,{});
  assert.equal(source.applyHit(actor,source.actor('longCaster'),profile.states.RSI_COMBO_Z.raw.DAMAGE_DATA,
    {kind:'effect',id:12345,powerMultiplier:1}).accepted,true);
  const zero=snapshot(2);assert.equal(zero.action.actor.worldStop,0);assert.equal(zero.action.playback.start,false);
  source.step(dt,{});stop('newCaster','NETWORK_STOP_AGAIN');const latest=snapshot(3);
  assert.equal(actor.stateSerial,serial);assert.equal(latest.action.playback.start,false);
  near(1+first.report.actor.worldStop*60,3+latest.report.actor.worldStop*60,'equal source deadlines');
  const sim=createSimulation({profile,map,networkOwnerId:'local',seed:2016,preset:{passives:[],guildPassives:[]},actors:[
    {id:'remote',team:0,position:[0,300,0],lineId:null},{id:'local',team:1,position:[3000,0,0],lineId:0}]});
  for(const value of sim.state.actors)value.inputLock=0;
  sim.networkCombatPlaybackVersion=1;let epoch=1;
  // Complete geometric correction on the checkpoint itself, so the following
  // beforeStep can assert that cancellation metadata changes only STOP.
  const playback=createRemoteCombatPlayback({clock:()=>sim.state.time*1000,motionBlend:1,...options});playback.bind(sim,'local',()=>epoch);
  const before=()=>playback.beforeStep(sim,'local',()=>epoch),remote=sim.actor('remote');
  const step=(elapsed=dt)=>{before();sim.step(elapsed,{...playback.remoteInputs(sim,'local'),local:{held:[],pressed:[],released:[]}});playback.afterStep(sim);};
  const receive=(action,life=epoch,frame=action.frameSeq)=>playback.receiveActions('remote',[action],life,frame);
  const exhaust=()=>{playback.observeMotion(sim,'remote',first.motion,'local');for(let i=0;i<21;i++)step();assert.equal(remote.worldStop,0);};
  const newer=()=>{playback.observeMotion(sim,'remote',latest.motion,'local');before();};
  const resetLife=next=>{epoch=next;playback.reset('remote',epoch);};
  return {sim,source,remote,playback,first,zero,latest,snapshot,exhaust,newer,receive,before,step,resetLife};
}

test('real same-deadline STOP restart survives a reliable zero overtaken by motion',()=>{
  const f=fixture();f.exhaust();f.newer();assert.equal(f.remote.worldStop,0,'no generation is guessed from a positive sample alone');
  const remote=structuredClone(f.remote),local=structuredClone(f.sim.actor('local')),effects=structuredClone(f.sim.state.effects);
  f.receive(f.zero.action);assert.deepEqual(f.remote,remote,'receipt only records evidence');f.before();
  near(f.remote.worldStop,.3-8*dt,'new generation remainder after initial bounded projection');
  const after=structuredClone(f.remote);after.worldStop=remote.worldStop;assert.deepEqual(after,remote,'no old actor fields replayed');
  assert.deepEqual(f.sim.actor('local'),local);assert.deepEqual(f.sim.state.effects,effects);
});

test('late zero deducts actual simulation time after the motion anchor, beyond six projected frames',()=>{
  const f=fixture();f.exhaust();f.newer();
  // Three positive ticks of .04s exceed six source frames. Frame count alone
  // and the capped projection would both restore too much of the new STOP.
  for(let i=0;i<3;i++)f.step(.04);
  f.receive(f.zero.action);f.before();near(f.remote.worldStop,.3-8*dt-.12,'elapsed simulation seconds');
});

test('a zero arriving after the new STOP has elapsed cannot freeze it again',()=>{
  const f=fixture();f.exhaust();f.newer();for(let i=0;i<11;i++)f.step();
  f.receive(f.zero.action);f.before();assert.equal(f.remote.worldStop,0);
  f.receive(f.latest.action);f.before();assert.equal(f.remote.worldStop,0);
});

test('repeated zero evidence cannot restore the same generation twice',()=>{
  const f=fixture();f.exhaust();f.newer();f.receive(f.zero.action);f.before();
  near(f.remote.worldStop,.3-8*dt,'first restoration');f.step();
  const remaining=f.remote.worldStop;
  f.receive(f.zero.action);f.receive({...structuredClone(f.zero.action),id:900});f.before();
  near(f.remote.worldStop,remaining,'duplicate edge after origin advanced');
  f.receive(f.latest.action);f.before();near(f.remote.worldStop,remaining,'same-generation reliable positive');
});

test('a newer reliable same-countdown control retains the original motion time anchor',()=>{
  const f=fixture();f.exhaust();f.newer();f.source.step(dt,{});f.source.actor('remote').facing=-1;
  const next=f.snapshot(4);assert.ok(next.action);assert.equal(next.action.playback.start,false);
  near(4+next.action.actor.worldStop*60,3+f.latest.report.actor.worldStop*60,'unchanged deadline');
  f.receive(next.action);f.before();assert.equal(f.remote.worldStop,0);assert.equal(f.remote.facing,-1);
  f.step(.04);f.receive(f.zero.action,1,4);f.before();
  near(f.remote.worldStop,.3-8*dt-.04,'original motion anchor after newer control');assert.equal(f.remote.facing,-1);
  f.step();const remaining=f.remote.worldStop;f.receive({...f.zero.action,id:901},1,4);f.before();
  near(f.remote.worldStop,remaining,'origin advances past newer reliable sample');
});

test('a newer reliable changed deadline cannot borrow the old motion generation anchor',()=>{
  const f=fixture();f.exhaust();f.newer();
  const next=structuredClone(f.latest.action);next.id=next.frameSeq=4;next.actor.worldStop=.05;
  f.receive(next);f.before();near(f.remote.worldStop,.05,'new distinct source stop');
  for(let i=0;i<4;i++)f.step();assert.equal(f.remote.worldStop,0);
  f.receive(f.zero.action,1,4);f.before();assert.equal(f.remote.worldStop,0);
});

for(const path of ['expired','lateOrder'])test(`zero metadata survives ${path} without replaying old controls`,()=>{
  const f=fixture();f.exhaust();f.newer();
  if(path==='lateOrder'){f.receive(f.latest.action);f.before();assert.equal(f.playback.diagnostics.owners.remote.playedSourceFrame,3);}
  const action=structuredClone(f.zero.action);action.actor.x=-9000;action.actor.facing=-1;
  const before=structuredClone(f.remote);f.receive(action,1,path==='expired'?1000:3);f.before();
  near(f.remote.worldStop,.3-8*dt,'recovered remainder');
  const after=structuredClone(f.remote);after.worldStop=before.worldStop;assert.deepEqual(after,before);
  assert.ok(f.playback.diagnostics[path]>0);
});

for(const restored of ['hitStop','worldStop'])test(`zero evidence for ${restored} does not restore the other STOP`,()=>{
  const f=fixture(),other=restored==='hitStop'?'worldStop':'hitStop';
  // Packet-only independence case supplements the real world STOP producer above.
  for(const key of ['hitStop','worldStop']){
    f.first.motion.reaction[key]=.3;f.latest.motion.reaction[key]=.3-2*dt;
    f.zero.action.actor[key]=key===restored?0:.3-dt;
  }
  f.exhaust();f.newer();f.receive(f.zero.action);f.before();
  near(f.remote[restored],.3-8*dt,'only cancelled domain restores');assert.equal(f.remote[other],0);
});

for(const mismatch of ['life','controller','animation','origin','future'])test(`zero from a mismatched ${mismatch} cannot change latest STOP`,()=>{
  const f=fixture();f.exhaust();f.newer();const action=structuredClone(f.zero.action);
  if(mismatch==='controller')action.actor.stateSerial--;
  if(mismatch==='animation')action.actor.animationName='unrelated-animation';
  if(mismatch==='origin')action.frameSeq=1;
  if(mismatch==='future')action.frameSeq=3;
  // A future/equal edge is not proof of a cancel between the two samples.
  const actor=structuredClone(f.remote);f.receive(action,mismatch==='life'?0:1,3);f.before();
  assert.equal(f.remote.worldStop,0);assert.deepEqual(f.remote,actor);
});

test('zero for a departed controller cannot alter a new controller or new life',()=>{
  const f=fixture();f.exhaust();f.newer();
  const motion=structuredClone(f.latest.motion);motion.frameSeq=4;motion.reaction.stateSerial++;motion.reaction.worldStop=.2;
  f.playback.observeMotion(f.sim,'remote',motion,'local');f.before();const remaining=f.remote.worldStop;
  f.receive(f.zero.action);f.before();near(f.remote.worldStop,remaining,'new controller');
  f.resetLife(2);const newLife=structuredClone(f.first.motion);newLife.epoch=2;newLife.frameSeq=1;
  f.playback.observeMotion(f.sim,'remote',newLife,'local');f.before();near(f.remote.worldStop,.3,'new life initial STOP');
  const before=f.remote.worldStop;f.receive(f.zero.action,1,3);f.before();near(f.remote.worldStop,before,'old life zero');
});

test('latest zero motion is not changed by an earlier reliable cancellation',()=>{
  const f=fixture();f.exhaust();f.latest.motion.reaction.worldStop=0;f.newer();
  f.receive(f.zero.action);f.before();assert.equal(f.remote.worldStop,0);
});

test('zero received before the newer motion separates that sample without a second replay',()=>{
  const f=fixture();f.exhaust();f.receive(f.zero.action);f.newer();
  near(f.remote.worldStop,.3-8*dt,'known edge on checkpoint application');
  f.step();const remaining=f.remote.worldStop;f.receive(f.zero.action);f.before();near(f.remote.worldStop,remaining,'one application');
});

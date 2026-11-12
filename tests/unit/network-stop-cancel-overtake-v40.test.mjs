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
const map={sceneId:'stop-cancel-overtake',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};

test('a later motion cannot erase the new short STOP after a reliable cancellation it overtook',()=>{
  // These two timers are fixture values, not new LK move values. Execute the
  // real STOP_OTHER_UNIT and accepted effect-hit consumers, then the actual
  // reliable producer/encoders: the owner stays in one passive controller.
  const sourceProfile=structuredClone(profile);
  for(const [name,duration]of [['NETWORK_STOP_LONG',.3],['NETWORK_STOP_SHORT',.15]])
    sourceProfile.states[name]={...structuredClone(profile.states.RSI_WAIT),raw:{STOP_OTHER_UNIT1:{1:.01,2:duration}}};
  const source=createSimulation({profile:sourceProfile,map,networkOwnerId:'remote',seed:2016,preset:{passives:[],guildPassives:[]},actors:[
    {id:'remote',team:0,position:[0,300,0],lineId:null},
    {id:'longCaster',team:1,position:[-1200,0,0],lineId:0},
    {id:'shortCaster',team:1,position:[1200,300,0],lineId:null}]});
  for(const actor of source.state.actors)actor.inputLock=0;
  const actor=source.actor('remote');source.enter(actor,'RSI_DAMAGE_AIR_UP','fixture-existing-reaction');
  Object.assign(actor,{grounded:false,lineId:null,y:300,vy:600,landPosition:[0,0,0]});
  const serial=actor.stateSerial,producer=createCombatPlaybackProducer({version:1});
  const snapshot=frame=>{const report=encodeOwnedState(source,'remote',{epoch:1,frameSeq:frame});
    return {report,motion:encodeOwnedMotion(report,{includeReaction:true}),action:producer.capture(source,'remote',{epoch:1,frameSeq:frame,report})};};
  const stop=(id,state)=>{const caster=source.actor(id);source.enter(caster,state,'fixture-stop-callback');
    source.processStateEvents(caster,0,.02);advanceActorStops(actor,0);};
  stop('longCaster','NETWORK_STOP_LONG');
  assert.equal(actor.worldStop,Math.fround(.3));assert.equal(source.actor('shortCaster').worldStop,0,'second caster lies outside first STOP radius');
  const first=snapshot(1);
  source.step(dt,{});
  const accepted=source.applyHit(actor,source.actor('longCaster'),profile.states.RSI_COMBO_Z.raw.DAMAGE_DATA,
    {kind:'effect',id:12345,powerMultiplier:1});
  assert.equal(accepted.accepted,true);assert.equal(actor.worldStop,0,'accepted independent effect clears caster world STOP');
  assert.equal(actor.stateSerial,serial);assert.equal(actor.state,'RSI_DAMAGE_AIR_UP');
  const cancelled=snapshot(2);assert.ok(cancelled.action);assert.equal(cancelled.action.playback.start,false);
  source.step(dt,{});stop('shortCaster','NETWORK_STOP_SHORT');
  assert.equal(actor.worldStop,Math.fround(.15));assert.equal(actor.stateSerial,serial);assert.equal(actor.state,'RSI_DAMAGE_AIR_UP');
  const restarted=snapshot(3);assert.ok(restarted.action);assert.equal(restarted.action.playback.start,false);
  assert.ok(3+restarted.report.actor.worldStop*60<1+first.report.actor.worldStop*60,'new STOP ends before the cancelled old STOP');

  const sim=createSimulation({profile,map,networkOwnerId:'local',seed:2016,preset:{passives:[],guildPassives:[]},actors:[
    {id:'remote',team:0,position:[0,300,0],lineId:null},
    {id:'local',team:1,position:[3000,0,0],lineId:0}]});
  for(const value of sim.state.actors)value.inputLock=0;
  sim.networkCombatPlaybackVersion=1;
  const playback=createRemoteCombatPlayback({clock:()=>sim.state.time*1000});playback.bind(sim,'local',()=>1);
  const before=()=>playback.beforeStep(sim,'local',()=>1);
  playback.observeMotion(sim,'remote',first.motion,'local');
  for(let i=0;i<21;i++){before();sim.step(dt,{...playback.remoteInputs(sim,'local'),local:{held:[],pressed:[],released:[]}});playback.afterStep(sim);}
  const remote=sim.actor('remote');assert.equal(remote.stateSerial,serial);assert.equal(remote.worldStop,0);
  const phase=remote.stateTime,animation=remote.animationTime,local=structuredClone(sim.actor('local'));
  assert.ok(phase>restarted.report.actor.stateTime,'test covers the old-checkpoint branch rather than a forward phase');
  // Wire order is M1 -> M3 -> reliable cancel2/start3. The 6-frame existing
  // projection bound leaves .15-.1=.05 seconds of this distinct STOP.
  playback.observeMotion(sim,'remote',restarted.motion,'local');before();
  playback.receiveActions('remote',[cancelled.action,restarted.action],1,3);
  playback.observeState(sim,'remote',restarted.report,'local');before();
  assert.ok(Math.abs(remote.worldStop-(.15-6*dt))<1e-6,
    `new STOP after overtaken cancellation must remain visible: ${remote.worldStop}`);
  assert.ok(remote.stateTime>=phase);assert.ok(remote.animationTime>=animation);
  assert.deepEqual(sim.actor('local'),local);
});

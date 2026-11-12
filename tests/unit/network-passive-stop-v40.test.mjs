import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {encodeOwnedMotion} from '../../packages/online/owned-motion.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';

// Source packets below describe one already-confirmed passive controller.
// Expected deadlines come from frame numbers and durations, not the receiver.
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const dt=1/60;
function fixture(){
  const sim=createSimulation({profile,map:{sceneId:'stop-v40',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},
    networkOwnerId:'local',seed:2016,preset:{passives:[],guildPassives:[]},actors:[
      {id:'remote',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
      {id:'local',team:1,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','fixture');}
  sim.networkCombatPlaybackVersion=1;
  let epoch=1;
  const playback=createRemoteCombatPlayback({clock:()=>sim.state.time*1000});playback.bind(sim,'local',()=>epoch);
  const report=(frame,fields={})=>{const report=encodeOwnedState(sim,'remote',{epoch,frameSeq:frame});
    const state=fields.state??'RSI_DAMAGE_SMALL_FRONT';
    Object.assign(report.actor,{state,stateSerial:30,animationName:profile.states[state].animationName,stateTime:0,animationTime:0,
      animationPlaybackSpeed:1,animationStopped:false,grounded:true,y:0,vy:0,vx:0,lineId:0,
      hitStop:0,worldStop:0,downForce:false,flyCount:1,lastAttackerFront:true,...fields});
    return report;};
  const motion=(frame,fields={})=>encodeOwnedMotion(report(frame,fields),{includeReaction:true});
  const reliable=(frame,fields={},start=true)=>{const value=report(frame,fields),action=encodeCriticalAction(value,{id:frame});
    action.playback={version:1,start,held:[]};
    playback.receiveActions('remote',[action],epoch,frame);playback.observeState(sim,'remote',value,'local');};
  const receive=value=>playback.observeMotion(sim,'remote',value,'local');
  const before=()=>playback.beforeStep(sim,'local',()=>epoch);
  const step=()=>{before();sim.step(dt,{...playback.remoteInputs(sim,'local'),local:{held:[],pressed:[],released:[]}});playback.afterStep(sim);};
  const resetLife=value=>{epoch=value;playback.reset('remote',epoch);};
  return {sim,playback,motion,reliable,receive,before,step,resetLife,actor:sim.actor('remote')};
}

test('a jittered checkpoint for the same ground stop cannot extend its consumed deadline',()=>{
  const f=fixture();
  f.receive(f.motion(1,{hitStop:.1,worldStop:.075}));
  for(let frame=0;frame<4;frame++)f.step();
  const remaining={hitStop:f.actor.hitStop,worldStop:f.actor.worldStop},local=structuredClone(f.sim.actor('local'));
  f.receive(f.motion(2,{hitStop:.1-dt,worldStop:.075-dt}));f.before();
  assert.ok(f.actor.hitStop<=remaining.hitStop+1e-9,'same source stop must not refreeze the actor');
  assert.ok(f.actor.worldStop<=remaining.worldStop+1e-9);
  assert.deepEqual(f.sim.actor('local'),local);
});

test('the initial stop and a newly extended source stop remain observable',()=>{
  const f=fixture();f.receive(f.motion(1,{hitStop:.1}));f.before();assert.equal(f.actor.hitStop,.1);
  for(let frame=0;frame<3;frame++)f.step();
  f.receive(f.motion(5,{hitStop:.2}));f.before();assert.equal(f.actor.hitStop,.2);
});

test('an already consumed air stop does not return when a later packet is older than the live phase',()=>{
  const f=fixture(),fields={state:'RSI_DAMAGE_AIR_UP',grounded:false,lineId:null,y:300,vy:600};
  f.receive(f.motion(1,{...fields,hitStop:.3}));f.before();
  // Same source expiry (frame 19), after local time has consumed the stop.
  // This bounded jitter policy must not restart its older remaining duration.
  for(let frame=0;frame<24;frame++)f.step();
  const stateTime=f.actor.stateTime,animationTime=f.actor.animationTime;
  f.receive(f.motion(2,{...fields,hitStop:.3-dt}));f.before();
  assert.equal(f.actor.hitStop,0);assert.ok(f.actor.stateTime>=stateTime);assert.ok(f.actor.animationTime>=animationTime);
});

test('fractional passive stop consumes only its actual remainder before gravity resumes',()=>{
  const f=fixture(),fields={state:'RSI_DAMAGE_AIR_UP',grounded:false,lineId:null,y:300,vy:600};
  f.receive(f.motion(1,fields));f.before();
  for(let i=0;i<3;i++)f.before();
  f.receive(f.motion(3,{...fields,hitStop:.025,stateSerial:31}));f.before();
  // Two projected 60Hz packets: one entirely stopped, one half stopped.
  const elapsed=2*dt-.025,expectedVy=600-profile.physics.G_ACCEL*elapsed;
  assert.ok(Math.abs(f.actor.vy-expectedVy)<1e-9,`${f.actor.vy} vs ${expectedVy}`);
  assert.ok(Math.abs(f.actor.y-(300+expectedVy*elapsed))<1e-9);
  assert.equal(f.actor.hitStop,0);
});

test('ground checkpoint projection cannot slide a passive body through its confirmed STOP',()=>{
  const f=fixture();f.receive(f.motion(1));f.before();
  for(let i=0;i<12;i++)f.before();
  f.receive(f.motion(5,{x:0,vx:600,hitStop:.2,stateSerial:31}));f.before();
  assert.equal(f.actor.x,0);assert.ok(Math.abs(f.actor.hitStop-.1)<1e-9);
});

test('a same-controller newly extended STOP is retained even when its animation phase is behind',()=>{
  const f=fixture();f.receive(f.motion(1,{hitStop:.025}));
  for(let i=0;i<5;i++)f.step();
  const stateTime=f.actor.stateTime,animationTime=f.actor.animationTime;
  f.receive(f.motion(6,{hitStop:.2,stateTime:0,animationTime:0}));f.before();
  assert.equal(f.actor.hitStop,.2);assert.equal(f.actor.stateTime,stateTime);assert.equal(f.actor.animationTime,animationTime);
});

test('stop projection does not mutate either owner resources or independent protection',()=>{
  const f=fixture(),actor=f.actor;
  Object.assign(actor,{hp:20000,mp:200,superArmor:true,forceInvincible:.8,buffs:[]});
  const local=structuredClone(f.sim.actor('local'));
  f.receive(f.motion(1,{hitStop:.2}));f.before();
  assert.equal(actor.hp,20000);assert.equal(actor.mp,200);assert.equal(actor.superArmor,true);assert.equal(actor.forceInvincible,.8);
  assert.deepEqual(actor.buffs,[]);assert.deepEqual(f.sim.actor('local'),local);assert.equal(f.sim.state.effects.length,0);
});

test('source cancellation permits a later shorter stop on the same controller',()=>{
  const f=fixture();f.receive(f.motion(1,{hitStop:1}));f.before();assert.equal(f.actor.hitStop,1);
  f.receive(f.motion(2,{hitStop:0}));f.before();assert.equal(f.actor.hitStop,0);
  f.receive(f.motion(3,{hitStop:.1}));f.before();assert.equal(f.actor.hitStop,.1);
});

test('hit and world STOP deadlines are independent within one passive controller',()=>{
  const f=fixture();f.receive(f.motion(1,{hitStop:.1,worldStop:.05}));
  for(let i=0;i<4;i++)f.step();
  const hit=f.actor.hitStop;
  f.receive(f.motion(5,{hitStop:.1-4*dt,worldStop:.2}));f.before();
  assert.ok(f.actor.hitStop<=hit+1e-9);assert.equal(f.actor.worldStop,.2);
  f.receive(f.motion(6,{hitStop:.3,worldStop:.2-dt}));f.before();
  assert.equal(f.actor.hitStop,.3);assert.ok(Math.abs(f.actor.worldStop-(.2-dt))<1e-9);
});

test('a new life with restarted source frames receives its own initial STOP',()=>{
  const f=fixture();f.receive(f.motion(300,{hitStop:.05}));
  for(let i=0;i<4;i++)f.step();assert.equal(f.actor.hitStop,0);
  const stale=f.motion(301,{hitStop:.2});f.resetLife(2);
  assert.equal(f.receive(stale),false);
  assert.equal(f.receive(f.motion(1,{hitStop:.1})),true);f.before();
  assert.equal(f.actor.hitStop,.1);assert.equal(f.playback.diagnostics.owners.remote.epoch,2);
});

test('first motion after an already played reliable start cannot refreeze its consumed STOP',()=>{
  const f=fixture();f.reliable(1,{hitStop:.3,worldStop:.25});
  for(let i=0;i<21;i++)f.step();assert.equal(f.actor.hitStop,0);assert.ok(f.actor.stateTime>0);
  const phase=f.actor.stateTime,animation=f.actor.animationTime;
  f.receive(f.motion(15,{hitStop:.3-14*dt,worldStop:.25-14*dt}));f.before();
  assert.equal(f.actor.hitStop,0);assert.equal(f.actor.worldStop,0);
  assert.equal(f.actor.stateTime,phase);assert.equal(f.actor.animationTime,animation);
});

test('a reliable passive control preserves a real STOP extension, and later motion cannot replay it',()=>{
  const f=fixture();f.receive(f.motion(1,{hitStop:.1}));
  for(let i=0;i<2;i++)f.step();
  f.reliable(2,{hitStop:.2},false);f.before();
  assert.equal(f.actor.hitStop,.2,'new source end frame extends an already active STOP');
  for(let i=0;i<15;i++)f.step();assert.equal(f.actor.hitStop,0);
  f.receive(f.motion(3,{hitStop:.2-dt}));f.before();assert.equal(f.actor.hitStop,0);
});

test('reliable cancellation followed by a shorter new STOP is visible without a motion packet',()=>{
  const f=fixture();f.receive(f.motion(1,{hitStop:1}));f.before();
  f.reliable(2,{hitStop:0},false);f.before();assert.equal(f.actor.hitStop,0);
  f.reliable(3,{hitStop:.1},false);f.before();assert.equal(f.actor.hitStop,.1);
  for(let i=0;i<8;i++)f.step();assert.equal(f.actor.hitStop,0);
  f.receive(f.motion(4,{hitStop:.1-dt}));f.before();assert.equal(f.actor.hitStop,0);
});

test('a reliable new controller and a new life have independent STOP deadlines',()=>{
  const f=fixture();f.receive(f.motion(1,{hitStop:.05}));
  for(let i=0;i<5;i++)f.step();
  f.reliable(6,{stateSerial:31,hitStop:.2});f.before();assert.equal(f.actor.hitStop,.2);
  for(let i=0;i<15;i++)f.step();assert.equal(f.actor.hitStop,0);
  f.receive(f.motion(7,{stateSerial:31,hitStop:.2-dt}));f.before();assert.equal(f.actor.hitStop,0);
  f.resetLife(2);f.reliable(1,{stateSerial:30,hitStop:.1});f.before();assert.equal(f.actor.hitStop,.1);
});

test('adopting an already advanced passive controller records but does not replay its first source STOP',()=>{
  const f=fixture();f.receive(f.motion(1,{hitStop:.1,worldStop:.05}));f.before();
  // Enter the observer's next phase through the real local state-entry path,
  // then consume its timers with positive simulation steps before the source
  // StateStart arrives. This is a Web lifecycle fixture, not a Native trace.
  f.sim.enter(f.actor,'RSI_DAMAGE_AIR_FALL','local-passive-phase');
  Object.assign(f.actor,{grounded:false,lineId:null,y:300,vy:0,hitStop:.05,worldStop:.03});
  for(let i=0;i<6;i++)f.step();
  assert.equal(f.actor.state,'RSI_DAMAGE_AIR_FALL');assert.equal(f.actor.stateSerial,31);assert.ok(f.actor.stateTime>0);
  assert.equal(f.actor.hitStop,0);assert.equal(f.actor.worldStop,0);
  const phase=f.actor.stateTime,animation=f.actor.animationTime;
  const fields={state:'RSI_DAMAGE_AIR_FALL',stateSerial:31,grounded:false,lineId:null,y:300,vy:0};
  f.reliable(2,{...fields,hitStop:.05,worldStop:.03});f.before();
  assert.equal(f.playback.diagnostics.adoptedStarts,1);
  assert.equal(f.actor.hitStop,0);assert.equal(f.actor.worldStop,0);
  assert.equal(f.actor.stateTime,phase);assert.equal(f.actor.animationTime,animation);
  // Registration must not turn into a permanent min(current, source) rule.
  f.reliable(3,{...fields,hitStop:.2,worldStop:.15},false);f.before();
  assert.equal(f.actor.hitStop,.2);assert.equal(f.actor.worldStop,.15);
});

test('first reliable STOP remains active when an adopted passive controller has not advanced past its source phase',()=>{
  const f=fixture();f.sim.enter(f.actor,'RSI_DAMAGE_AIR_FALL','local-passive-phase');
  const fields={state:'RSI_DAMAGE_AIR_FALL',stateSerial:f.actor.stateSerial,grounded:false,lineId:null,y:300,vy:0};
  f.reliable(1,{...fields,hitStop:.2,worldStop:.15});f.before();
  assert.equal(f.playback.diagnostics.adoptedStarts,1);assert.equal(f.actor.hitStop,.2);assert.equal(f.actor.worldStop,.15);
});

/** Receiver-time consistency with declared synthetic delivery, not an original
 * client or WAN measurement. The source packet is captured once; no historical
 * collision, damage, event or input is replayed to obtain the expectation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {encodeOwnedMotion} from '../../packages/online/owned-motion.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const map={sceneId:'passive-clock-v43-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const empty={held:[],pressed:[],released:[]},dt=1/60;
function fixture(){
  const sim=createSimulation({profile,map,networkOwnerId:'local',seed:2016,preset:{passives:[],guildPassives:[]},actors:[
    {id:'remote',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
    {id:'local',team:1,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','fixture');}
  sim.networkCombatPlaybackVersion=1;
  const playback=createRemoteCombatPlayback({clock:()=>sim.state.time*1000});playback.bind(sim,'local',()=>1);
  const step=()=>{playback.beforeStep(sim,'local',()=>1);sim.step(dt,{...playback.remoteInputs(sim,'local'),local:empty});playback.afterStep(sim);};
  const motion=(frame,fields={})=>{const report=encodeOwnedState(sim,'remote',{epoch:1,frameSeq:frame});
    Object.assign(report.actor,fields);return encodeOwnedMotion(report,{includeReaction:true});};
  const reaction=(frame,fields={})=>motion(frame,{state:'RSI_DAMAGE_AIR_UP',stateSerial:30,
    animationName:profile.states.RSI_DAMAGE_AIR_UP.animationName,stateTime:.1,animationTime:.1,
    animationPlaybackSpeed:1,animationStopped:false,grounded:false,lineId:null,y:200,vy:600,
    hitStop:0,worldStop:0,downForce:false,flyCount:1,lastAttackerFront:true,...fields});
  const action=(frame,held,fields={})=>{const report=encodeOwnedState(sim,'remote',{epoch:1,frameSeq:frame});
    Object.assign(report.actor,fields);const value=encodeCriticalAction(report,{id:frame});
    value.playback={version:1,start:false,held};return value;};
  // Establish a fast motion sample, then a later source sample arriving eight
  // frames behind that mapping. The production six-frame bound remains intact.
  const age=()=>{playback.observeMotion(sim,'remote',motion(1),'local');for(let i=0;i<12;i++)step();};
  return {sim,playback,step,motion,reaction,action,age};
}
const near=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1e-9,`${label}: ${actual} versus ${expected}`);

test('a jitter-aged passive checkpoint keeps its animation and state clocks at the projected motion time',()=>{
  const f=fixture();f.age();const local=structuredClone(f.sim.actor('local')),motion=f.reaction(5);
  f.playback.observeMotion(f.sim,'remote',motion,'local');f.playback.beforeStep(f.sim,'local',()=>1);
  const actor=f.sim.actor('remote');
  assert.equal(f.playback.diagnostics.airMotionProjected,1,'the actual existing motion path projects this checkpoint');
  assert.ok(actor.y>motion.actor.y);assert.ok(actor.vy<motion.actor.vy);
  near(actor.stateTime,.2,'state clock');near(actor.animationTime,.2,'animation clock');
  assert.deepEqual(f.sim.actor('local'),local);assert.equal(f.sim.state.effects.length,0);
});

test('passive clock projection spends partial hit/world STOP only once and preserves the source playback speed',()=>{
  const f=fixture();f.age();const motion=f.reaction(5,{hitStop:.025,worldStop:.05,animationPlaybackSpeed:1.5});
  f.playback.observeMotion(f.sim,'remote',motion,'local');f.playback.beforeStep(f.sim,'local',()=>1);
  const actor=f.sim.actor('remote');near(actor.stateTime,.15,'state clock after .05 seconds frozen');
  near(actor.animationTime,.175,'animation speed after .05 seconds frozen');
  assert.equal(actor.hitStop,0);assert.equal(actor.worldStop,0);
});

test('a fully stopped checkpoint has no projected clock or physics advance',()=>{
  const f=fixture();f.age();const motion=f.reaction(5,{hitStop:.2});
  f.playback.observeMotion(f.sim,'remote',motion,'local');f.playback.beforeStep(f.sim,'local',()=>1);
  const actor=f.sim.actor('remote');near(actor.stateTime,.1,'state clock');near(actor.animationTime,.1,'animation clock');
  near(actor.hitStop,.1,'STOP remainder');near(actor.y,200,'stopped height');near(actor.vy,600,'stopped speed');
});

test('a source-stopped animation remains stopped while its passive state clock advances',()=>{
  const f=fixture();f.age();const motion=f.reaction(5,{animationStopped:true});
  f.playback.observeMotion(f.sim,'remote',motion,'local');f.playback.beforeStep(f.sim,'local',()=>1);
  const actor=f.sim.actor('remote');near(actor.stateTime,.2,'state clock');near(actor.animationTime,.1,'stopped animation clock');
  assert.equal(actor.animationStopped,true);
});

test('a fresh checkpoint does not gain fictitious time from the source frame number',()=>{
  const f=fixture(),motion=f.reaction(400);f.playback.observeMotion(f.sim,'remote',motion,'local');
  f.playback.beforeStep(f.sim,'local',()=>1);const actor=f.sim.actor('remote');
  near(actor.stateTime,.1,'fresh state clock');near(actor.animationTime,.1,'fresh animation clock');
  near(actor.y,200,'fresh height');assert.equal(f.playback.diagnostics.airMotionProjected,0);
});

test('projected source clocks cannot rewind an already advanced equal passive controller',()=>{
  const f=fixture();f.age();f.playback.observeMotion(f.sim,'remote',f.reaction(5),'local');f.playback.beforeStep(f.sim,'local',()=>1);
  const actor=f.sim.actor('remote');actor.stateTime=.4;actor.animationTime=.5;
  const motion=f.reaction(6,{stateTime:.11,animationTime:.12});
  f.playback.observeMotion(f.sim,'remote',motion,'local');f.playback.beforeStep(f.sim,'local',()=>1);
  near(actor.stateTime,.4,'advanced state clock');near(actor.animationTime,.5,'advanced animation clock');
});

test('locomotion retains its existing clock admission gate without passive projection',()=>{
  const f=fixture(),motion=f.motion(1,{stateSerial:30,stateTime:.1,animationTime:.1});
  f.playback.observeMotion(f.sim,'remote',motion,'local');f.playback.beforeStep(f.sim,'local',()=>1);
  const actor=f.sim.actor('remote');actor.stateTime=.4;actor.animationTime=.2;
  f.playback.observeMotion(f.sim,'remote',f.motion(2,{stateTime:.11,animationTime:.3}),'local');
  f.playback.beforeStep(f.sim,'local',()=>1);
  near(actor.stateTime,.4,'older locomotion state clock');near(actor.animationTime,.2,'older locomotion animation clock');
});

test('an older passive header cannot advance an animation already naturally stopped at its last frame',()=>{
  const f=fixture();f.age();const phase={state:'RSI_DAMAGE_AIR_DOWN',animationName:profile.states.RSI_DAMAGE_AIR_DOWN.animationName,vy:-120};
  f.playback.observeMotion(f.sim,'remote',f.reaction(5,phase),'local');f.playback.beforeStep(f.sim,'local',()=>1);
  f.step();const actor=f.sim.actor('remote');assert.equal(actor.animationStopped,true,'ordinary positive dt stops the original AIR_DOWN clip');
  const stopped=actor.animationTime,stateTime=actor.stateTime,sourceTime=.1+2/60;
  f.playback.observeMotion(f.sim,'remote',f.reaction(7,{...phase,stateTime:sourceTime,animationTime:sourceTime}),'local');
  f.playback.beforeStep(f.sim,'local',()=>1);
  assert.ok(actor.stateTime>stateTime,'the projected passive state clock can still advance');
  near(actor.animationTime,stopped,'the already stopped animation');assert.equal(actor.animationStopped,true);
});

test('a superseded reliable key release cannot leave a prior attack held forever',()=>{
  const f=fixture();f.playback.receiveActions('remote',[f.action(1,['Z'])],1,1);f.playback.beforeStep(f.sim,'local',()=>1);
  assert.deepEqual(f.playback.remoteInputs().remote.held,['Z']);
  const released=f.action(5,[]),motion=f.reaction(10);motion.movementHeld=['RIGHT'];
  f.playback.receiveActions('remote',[released],1,10);f.playback.observeMotion(f.sim,'remote',motion,'local');
  // Enough positive steps to reach the reliable source's scheduled frame.
  for(let i=0;i<5;i++)f.step();
  assert.equal(f.playback.diagnostics.reactionSuperseded,1);
  assert.deepEqual(f.playback.remoteInputs().remote.held,['RIGHT'],'a newer motion direction remains current; released Z is gone');
});

test('superseded action keys cannot become attacks, but a later live controller may still hold a key',()=>{
  const f=fixture(),superseded=f.action(1,['X']);f.playback.receiveActions('remote',[superseded],1,10);
  f.playback.observeMotion(f.sim,'remote',f.reaction(10),'local');f.playback.beforeStep(f.sim,'local',()=>1);
  assert.deepEqual(f.playback.remoteInputs().remote.held,[]);assert.equal(f.sim.state.effects.length,0);
  const current=f.action(11,['Z'],{state:'RSI_COMBO_Z',stateSerial:31,animationName:profile.states.RSI_COMBO_Z.animationName});
  current.playback.start=true;f.playback.receiveActions('remote',[current],1,11);
  for(let i=0;i<11;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(f.sim.actor('remote').state,'RSI_COMBO_Z');assert.deepEqual(f.playback.remoteInputs().remote.held,['Z']);
});

test('V49 a later owner FORCE_FLY contact updates passive metadata despite an older raw clock',()=>{
  const sender=fixture(),receiver=fixture();sender.sim.networkOwnerId='remote';
  const victim=sender.sim.actor('remote');
  sender.sim.enter(victim,'RSI_DAMAGE_AIR_UP','owner-source-fixture');
  Object.assign(victim,{stateTime:.1,animationTime:.1,grounded:false,lineId:null,y:500,vy:600,
    flyCount:3,hitStop:0,worldStop:0,invincible:false,forceInvincible:false,superArmor:false});
  victim.inputLock=0;
  const capture=frame=>encodeOwnedMotion(encodeOwnedState(sender.sim,'remote',{epoch:1,frameSeq:frame}),{includeReaction:true});
  const first=capture(5),serial=victim.stateSerial;
  receiver.age();receiver.playback.observeMotion(receiver.sim,'remote',first,'local');
  receiver.playback.beforeStep(receiver.sim,'local',()=>1);
  const observer=receiver.sim.actor('remote'),local=structuredClone(receiver.sim.actor('local'));
  assert.equal(observer.flyCount,3);assert.ok(observer.stateTime>victim.stateTime);
  // An independently stored target2016 declaration supplies the contact. The
  // expected zero is FORCE_FLY's source rule, not a receiver-generated answer.
  const data=profile.damageEffects.DamageEffect_ELK_Wind_Slicer_Projectile.raw.DAMAGE_DATA;
  assert.equal(data.REACT_TYPE,7);assert.equal(data.FORCE_FLY,1);
  sender.sim.injectHit({attackerId:'local',targetId:'remote',damageData:data});
  assert.equal(victim.stateSerial,serial,'type 7 does not restart the passive controller');
  assert.equal(victim.flyCount,0,'owner executes the actual contact rule');
  const next=capture(6);assert.ok(next.reaction.stateTime<observer.stateTime);
  receiver.playback.observeMotion(receiver.sim,'remote',next,'local');
  receiver.playback.beforeStep(receiver.sim,'local',()=>1);
  assert.equal(observer.flyCount,0,'newer source metadata must not wait for its raw clock to catch up');
  assert.equal(observer.lastAttackerFront,victim.lastAttackerFront);
  assert.deepEqual(receiver.sim.actor('local'),local,'observer cannot settle local resources');
  assert.equal(receiver.sim.state.effects.length,0,'checkpoint never creates an attack');
  assert.equal(receiver.playback.observeMotion(receiver.sim,'remote',first,'local'),false,'late source frame stays rejected');
});

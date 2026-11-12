/** Controlled positive-step Web counterexamples. Source LK configuration is
 * independent of the playback under test; this is not original-client/WAN
 * latency or proof of interactive combo success. An optional read-only checkout
 * supplies the unchanged receiver for red/green comparison. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {encodeOwnedMotion} from '../../packages/online/owned-motion.mjs';

const implementation=process.env.RF_PASSIVE_STOP_IMPLEMENTATION_ROOT;
const {createRemoteCombatPlayback}=await import(implementation?
  pathToFileURL(resolve(implementation,'apps/web/remote-combat-playback.mjs')):
  new URL('../../apps/web/remote-combat-playback.mjs',import.meta.url));
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const dt=1/60,empty={held:[],pressed:[],released:[]};
const map={sceneId:'retired-stop-v51-disclosed-line',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture({initialStop=0}={}){
  const make=networkOwnerId=>createSimulation({profile,map,networkOwnerId,seed:2016,preset:{passives:[],guildPassives:[]},actors:[
    {id:'caster',team:1,position:[600,0,0],lineId:0,loadout:Array(8).fill(null)},
    {id:'local',team:1,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)},
    {id:'remote',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  const source=make('remote'),receiver=make('local');
  for(const sim of [source,receiver])for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','fixture');}
  receiver.networkCombatPlaybackVersion=1;
  const victim=source.actor('remote'),observer=receiver.actor('remote');
  source.enter(victim,'RSI_DAMAGE_AIR_UP','disclosed-near-apex-fixture');
  Object.assign(victim,{stateTime:.1,animationTime:.1,y:400,vy:80,vx:0,vz:0,grounded:false,lineId:null,
    landPosition:[0,0,0],hitStop:0,worldStop:initialStop,flyCount:1,downForce:false});
  const playback=createRemoteCombatPlayback({clock:()=>receiver.state.time*1000});playback.bind(receiver,'local',()=>1);
  const capture=frame=>encodeOwnedMotion(encodeOwnedState(source,'remote',{epoch:1,frameSeq:frame}),{includeReaction:true});
  const apply=motion=>{const accepted=playback.observeMotion(receiver,'remote',motion,'local');playback.beforeStep(receiver,'local',()=>1);return accepted;};
  const sourceStep=()=>source.step(dt,{caster:empty,local:empty,remote:empty},{snapshot:false});
  const receiverStep=()=>{playback.beforeStep(receiver,'local',()=>1);receiver.step(dt,{local:empty,...playback.remoteInputs()},{snapshot:false});playback.afterStep(receiver);};
  const first=capture(1);assert.equal(apply(first),true);
  const stopFromActualState=()=>{
    const state='ESSI_HA_ELK_GIGANTIC_SLASH';
    assert.deepEqual(profile.states[state].raw.STOP_OTHER_UNIT0,{'1':0,'2':.7});
    // A third player's spell is known at the victim owner before it reaches
    // this independent receiver, as can happen in a multiplayer room.
    source.enter(source.actor('caster'),state,'source-authored-stop-event');
  };
  return {source,receiver,victim,observer,playback,capture,apply,sourceStep,receiverStep,first,stopFromActualState};
}
function depart(f,steps=6){
  for(let i=0;i<steps;i++)f.receiverStep();
  assert.equal(f.observer.state,'RSI_DAMAGE_AIR_FALL','positive gravity/Native transition must actually depart UP');
}

test('a fresh source STOP edge restores the victim phase that the receiver predicted past',t=>{
  const f=fixture(),serial=f.victim.stateSerial;f.stopFromActualState();
  for(let i=0;i<6;i++){f.sourceStep();f.receiverStep();}
  assert.equal(f.victim.state,'RSI_DAMAGE_AIR_UP');assert.equal(f.victim.stateSerial,serial);
  assert.equal(f.observer.state,'RSI_DAMAGE_AIR_FALL');assert.ok(f.victim.worldStop>.5);
  const source=f.capture(7),local=structuredClone(f.receiver.actor('local'));
  const errorBefore=Math.abs(f.observer.y-f.victim.y),accepted=f.apply(source);
  const errorAtApply=Math.abs(f.observer.y-f.victim.y),stateAtApply=f.observer.state;
  assert.deepEqual(f.receiver.actor('local'),local,'checkpoint cannot move or settle the local owner');
  const trajectory=[];
  for(let step=1;step<=12;step++){
    f.sourceStep();f.receiverStep();
    trajectory.push({step,sourceState:f.victim.state,receiverState:f.observer.state,
      sourceY:f.victim.y,receiverY:f.observer.y,error:Math.abs(f.observer.y-f.victim.y)});
  }
  t.diagnostic(JSON.stringify({implementation:implementation??'current',accepted,errorBefore,errorAtApply,stateAtApply,
    maximumFollowingYError:Math.max(...trajectory.map(row=>row.error)),trajectory}));
  assert.equal(accepted,true,'new STOP causality must not be mistaken for an old UP replay');
  assert.equal(stateAtApply,'RSI_DAMAGE_AIR_UP');assert.equal(errorAtApply,0);
  assert.equal(Math.max(...trajectory.map(row=>row.error)),0);
  assert.equal(f.receiver.state.effects.length,0,'passive restoration cannot create attacks');
});

test('strictly newer raw clocks and geometry without a new STOP cannot pull old UP back',()=>{
  const f=fixture();depart(f);const old=f.capture(7);
  old.reaction.stateTime+=.1;old.reaction.animationTime+=.1;old.actor.y+=50;
  const before=structuredClone(f.observer);
  assert.equal(f.playback.observeMotion(f.receiver,'remote',old,'local'),false);
  assert.deepEqual(f.observer,before);
});

test('a positive sample of the same already-consumed STOP countdown cannot reopen retired UP',()=>{
  const f=fixture({initialStop:.1});
  for(let i=0;i<3;i++)f.sourceStep();depart(f,12);
  const packet=f.capture(4);assert.ok(packet.reaction.worldStop>0);
  assert.ok(Math.abs(packet.frameSeq+packet.reaction.worldStop*60-(f.first.frameSeq+f.first.reaction.worldStop*60))<1e-6);
  assert.equal(f.playback.observeMotion(f.receiver,'remote',packet,'local'),false);
  assert.equal(f.observer.state,'RSI_DAMAGE_AIR_FALL');
});

test('equal or older source frames cannot reopen even when carrying a positive STOP',()=>{
  const f=fixture();depart(f);const packet=f.capture(1);packet.reaction.worldStop=.5;
  assert.equal(f.playback.observeMotion(f.receiver,'remote',packet,'local'),false);
  packet.frameSeq=0;assert.equal(f.playback.observeMotion(f.receiver,'remote',packet,'local'),false);
});

test('a newer owner-confirmed controller permanently supersedes the old STOP identity',()=>{
  const f=fixture();depart(f);const old=f.capture(8);old.reaction.worldStop=.5;
  f.source.enter(f.victim,'RSI_DAMAGE_AIR_FALL','owner-confirmed-apex');
  f.victim.vy=-120;assert.equal(f.apply(f.capture(7)),true);
  assert.equal(f.observer.state,'RSI_DAMAGE_AIR_FALL');
  assert.equal(f.playback.observeMotion(f.receiver,'remote',old,'local'),false);
  assert.equal(f.observer.state,'RSI_DAMAGE_AIR_FALL');
});

test('an admitted newer passive phase blocks reopening even before its next simulation step',()=>{
  const f=fixture();depart(f);const old=f.capture(8);old.reaction.worldStop=.5;
  f.source.enter(f.victim,'RSI_DAMAGE_AIR_FALL','owner-confirmed-apex');f.victim.vy=-120;
  assert.equal(f.playback.observeMotion(f.receiver,'remote',f.capture(7),'local'),true);
  assert.equal(f.playback.observeMotion(f.receiver,'remote',old,'local'),false);
});

test('a newer full owner pose blocks reopening an older source identity',()=>{
  const f=fixture();depart(f);const old=f.capture(8);old.reaction.worldStop=.5;
  f.source.enter(f.victim,'RSI_DAMAGE_AIR_FALL','owner-confirmed-apex');
  const report=encodeOwnedState(f.source,'remote',{epoch:1,frameSeq:7});
  f.playback.observeState(f.receiver,'remote',report,'local');
  assert.equal(f.playback.observeMotion(f.receiver,'remote',old,'local'),false);
});

test('a new STOP already exhausted by the existing bounded motion age cannot reopen UP',()=>{
  const f=fixture();depart(f,12);const packet=f.capture(4);packet.reaction.worldStop=.05;
  assert.equal(f.playback.observeMotion(f.receiver,'remote',packet,'local'),false);
});

test('a STOP exhausted by measured extra delivery age cannot revive through the six-frame physics cap',()=>{
  const f=fixture();depart(f,20);const packet=f.capture(4);packet.reaction.worldStop=.2;
  assert.equal(f.playback.observeMotion(f.receiver,'remote',packet,'local'),false);
});

test('an extended positive deadline alone is insufficient evidence to reopen retired UP',()=>{
  const f=fixture({initialStop:.1});depart(f,12);const packet=f.capture(4);packet.reaction.worldStop=.5;
  assert.equal(f.playback.observeMotion(f.receiver,'remote',packet,'local'),false);
});

test('a reliably observed cancellation permits a genuinely new STOP after prediction departed',()=>{
  const f=fixture({initialStop:.1});depart(f,12);
  const report=encodeOwnedState(f.source,'remote',{epoch:1,frameSeq:3});report.actor.worldStop=0;
  const cancelled=encodeCriticalAction(report,{id:3});cancelled.playback={version:1,start:false,held:[]};
  f.playback.receiveActions('remote',[cancelled],1,3);
  // A disclosed cancellation/restart input is distinct from an unchanged
  // countdown or an unproven extension. The bounded age still leaves STOP.
  const packet=f.capture(4);packet.reaction.worldStop=.5;
  assert.equal(f.apply(packet),true);
  assert.equal(f.observer.state,'RSI_DAMAGE_AIR_UP');
});

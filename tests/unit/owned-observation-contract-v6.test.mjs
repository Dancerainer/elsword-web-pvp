import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createOwnedPresentation} from '../../apps/web/owned-presentation.mjs';
import {createRemoteActorClock} from '../../apps/web/remote-actor-clock.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedTargetViews} from '../../packages/online/owned-state.mjs';
import {createOwnedActionDelta} from '../../packages/online/owned-action-delta.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(){
 const sim=createSimulation({profile,map,networkOwnerId:'local',actors:[{id:'local',team:0,position:[0,0,0],lineId:0},{id:'remote',team:1,position:[200,0,0],lineId:0}]});
 const sync=createLocalOwnershipSync({presentation:createOwnedPresentation()}),room={snapshot:sim.snapshot(),ownership:{mode:'local-owner-v1',actors:{local:{epoch:1},remote:{epoch:1}}},pvp:{phase:'fight',fightTime:1,players:[]}};
 sync.reconcile(sim,room,'local');sim.drainEvents();return {sim,sync};
}
test('a stale body report still admits its new action without changing local resources or the newest remote pose',()=>{
 const {sim,sync}=fixture();const report=encodeOwnedState(sim,'remote',{epoch:1,frameSeq:12});report.actor.x=500;
 assert.equal(sync.receivePeer(sim,'remote',report,'local'),true);const own=structuredClone(sim.actor('local'));
 const old=encodeOwnedState(sim,'remote',{epoch:1,frameSeq:6});old.actor.x=200;old.actions=[encodeCriticalAction(old,{id:6})];
 assert.equal(sync.receivePeer(sim,'remote',old,'local'),false);assert.equal(sim.actor('remote').x,500);assert.equal(sync.actionDiagnostics.pending,1);
 assert.deepEqual(sim.actor('local'),own);sync.beforeStep(sim,'local');assert.equal(sync.actionDiagnostics.totalConsumed,1);assert.equal(sim.actor('remote').x,500);sync.clear();
});
test('a once-only world stop is sampled on the step after a sound rather than lost inside the three-frame presentation throttle',()=>{
 const {sim,sync}=fixture();const a=sim.actor('local');a.fired=['SOUND_PLAY0'];
 const first=sync.afterStep(sim,'local',[{type:'sound',actorId:'local',field:'SOUND_PLAY0'}]);assert.equal(first.actions.length,1);
 a.fired.push('STOP_OTHER_UNIT0');const next=sync.afterStep(sim,'local',[{type:'worldStop',actorId:'local',duration:1.5}]);
 assert.ok(next);assert.equal(next.actions.length,1);assert.equal(next.actions[0].frameSeq,2);assert.ok(next.actions[0].actor.fired.includes('STOP_OTHER_UNIT0'));sync.clear();
});
test('target contact anchors round-trip in full validation and reliable action deltas, detached from caller mutation',()=>{
 const {sim,sync}=fixture(),report=encodeOwnedState(sim,'remote',{epoch:1,frameSeq:6});
 const reference={playerId:'local',epoch:1,frameSeq:3,position:[0,0,0]},action=encodeCriticalAction(report,{id:6,targetViews:[reference]});report.actions=[action];
 const validated=validateOwnedState(report);reference.position[0]=900;assert.equal(validated.actions[0].targetViews[0].position[0],0);
 const producer=createOwnedActionDelta(),receiver=createOwnedActionDelta(),event={playerId:'remote',epoch:1,frameSeq:6,actions:validated.actions};
 assert.deepEqual(receiver.decode(producer.encode('remote',event)).actions,event.actions);
 const malformed=producer.encode('remote',{...event,frameSeq:7,actions:[{...event.actions[0],id:7,frameSeq:7,targetViews:[{...event.actions[0].targetViews[0],frameSeq:-1}]}]});
 assert.throws(()=>receiver.decode(malformed),/invalid-owner-target-views/);sync.clear();
});
test('contact references reject duplicate players, invalid clocks, undeclared metadata and malformed positions',()=>{
 const reference={playerId:'local',epoch:1,frameSeq:3,position:[0,0,0]};
 for(const value of [[reference,reference],[{...reference,epoch:-1}],[{...reference,frameSeq:.5}],[{...reference,position:[0,0]}],
  [{...reference,position:[NaN,0,0]}],[{...reference,extra:1}],Array.from({length:6},(_,i)=>({...reference,playerId:String(i)}))])
  assert.throws(()=>validateOwnedTargetViews(value),/invalid-owner-target-views/);
});
test('interpolated contact names the actual confirmed source samples rather than guessing a nearest frame',()=>{
 let now=0;const remote={id:'remote',x:100,y:0,z:0,state:'WAIT',stateSerial:1,animationTime:0,animationName:'Wait'};
 const clock=createRemoteActorClock({clock:()=>now,captureContacts:true,minDelayMs:50,maxDelayMs:50});
 clock.observe(remote,{epoch:1,frameSeq:3});clock.contacts([remote],'local');
 assert.deepEqual(clock.observationReference('remote'),{epoch:1,frameSeq:3,position:[100,0,0]});
 now=50;const moved={...remote,x:130,animationTime:.05};clock.observe(moved,{epoch:1,frameSeq:6});
 now=75;clock.contacts([moved],'local');const reference=clock.observationReference('remote');
 assert.equal(reference.frameSeq,3);assert.deepEqual(reference.position,[115,0,0]);
 assert.deepEqual(reference.positionSamples,[{frameSeq:3,weight:.5},{frameSeq:6,weight:.5}]);
 clock.clear();assert.equal(clock.observationReference('remote'),null);
});

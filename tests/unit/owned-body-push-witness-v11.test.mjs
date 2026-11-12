/** Production body-arrival + display witnesses + actual combat hit receiver.
 * The controlled positions/helper sphere are explicit geometry fixtures, not
 * original-client or Native WASM movement/latency measurements. Frozen RF
 * body declarations, pass/push states and damage data remain unchanged. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createOwnedBodyArrivalGuard,ownedBodyPushProjection,nativeBodyPushWitnessPosition} from '../../packages/online/owned-body-arrival.mjs';
import {createRemoteActorClock} from '../../apps/web/remote-actor-clock.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {encodeOwnedState,encodeCriticalAction,applyOwnedState,validateOwnedTargetViews} from '../../packages/online/owned-state.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'body-push-witness-v11',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL',beforeLine:-2,nextLine:-2}]};
const damage=profile.damageEffects.RAVEN_NASOD_BALL.raw.DAMAGE_DATA;
function simulation(owner='source',targetX=50,scene=map){
  return createSimulation({profile,map:scene,networkOwnerId:owner,seed:2016,
    defenderSampler(actor){return [{kind:'sphere',center:[actor.x,actor.y+50,actor.z],radius:20}];},
    actors:[{id:'source',team:0,position:[0,0,0],lineId:0,facing:1,loadout:Array(8).fill(null)},
      {id:'victim',team:1,position:[targetX,0,0],lineId:0,facing:1,loadout:Array(8).fill(null)},
      {id:'ally',team:0,position:[-3000,0,0],lineId:0,loadout:Array(8).fill(null)},
      {id:'enemy-buddy',team:1,position:[3000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
}
function displayed({version=1,scene=map}={}){
  const sim=simulation('source',50,scene),guard=createOwnedBodyArrivalGuard(),clock=createRemoteActorClock({captureContacts:true,minDelayMs:0,maxDelayMs:0});
  clock.setBodyPushWitnessVersion(version);guard.reset('victim',1);
  const first=encodeOwnedState(sim,'victim',{epoch:1,frameSeq:1});guard.accept(sim,'victim',first,'source',guard.capture(sim,'victim','source'));
  const incoming=(x,frame=3)=>{
    const report=encodeOwnedState(sim,'victim',{epoch:1,frameSeq:frame});report.actor.x=x;
    const before=guard.capture(sim,'victim','source');applyOwnedState(sim,'victim',report);guard.accept(sim,'victim',report,'source',before);
    clock.observe(sim.actor('victim'),{...report,at:frame*1000/60});clock.contacts(sim.state.actors,'source',{now:frame*1000/60});return report;
  };
  const before=structuredClone(sim.actor('source')),report=incoming(30);
  return {sim,guard,clock,report,incoming,before,reference:()=>clock.observationReference('victim')};
}
function receiving(reference,{version=1,oldLife=false,expired=false,currentGuard=false}={}){
  const sim=simulation('victim',30),consumer=createRemoteActionConsumer({clock:()=>expired?751:0,bodyPushWitnessVersion:version});
  // Remember actual raw sent poses, not the attacker's projected display.
  const victim=sim.actor('victim');victim.x=30;consumer.rememberVictim(sim,'victim',1,3);
  if(reference.positionSamples){victim.x=100;consumer.rememberVictim(sim,'victim',1,6);}
  Object.assign(victim,{x:500,hp:victim.hpMax*.75,mp:40,stateSerial:50,invincible:currentGuard,forceInvincible:0});
  const before=structuredClone(victim),samples=[];
  const checkHits=sim.checkHits.bind(sim);
  sim.checkCharacterAttack=attacker=>{
    samples.push(sim.contactGeometry(victim,attacker).x);
    return checkHits(attacker,[{kind:'sphere',center:[70,50,0],radius:5}],structuredClone(damage),attacker.hits,
      {kind:'character',state:'RSI_WAIT',powerMultiplier:1,damageStateRaw:{}});
  };
  const report=encodeOwnedState(sim,'source',{epoch:1,frameSeq:12}),target={playerId:'victim',...structuredClone(reference)};
  if(oldLife)target.epoch=0;
  const action=encodeCriticalAction(report,{id:12,targetViews:[target]});
  return {sim,consumer,victim,before,samples,action,consume(){assert.equal(consumer.receive('source',[action],1,12),true);return consumer.consume(sim,'victim',()=>1);}};
}

test('four-player arrival push retains the exact local actor and raw packet, while negotiated mode emits only named source-frame markers',()=>{
  const f=displayed();assert.equal(profile.body.UNIT_WIDTH,70);assert.equal(f.sim.actor('victim').x,70);
  assert.deepEqual(f.sim.actor('source'),f.before);assert.equal(f.report.actor.x,30,'the original source pose is untouched');
  assert.equal(f.guard.diagnostics.bodyPushWitnesses,1);
  assert.ok(ownedBodyPushProjection(f.sim.actor('victim'),{epoch:1,frameSeq:3}));
  assert.deepEqual(f.reference(),{epoch:1,frameSeq:3,position:[70,0,0],bodyPushFrames:[3]});
  assert.doesNotThrow(()=>validateOwnedTargetViews([{playerId:'victim',...f.reference()}]));
  const legacy=displayed({version:0});assert.equal(legacy.reference(),null);assert.equal(legacy.clock.diagnostics().witnesses.projectedDisabled,1);
});

test('the actual receiver admits one otherwise-missed contact at the verified display body without relocating its current owner',()=>{
  const from=displayed(),f=receiving(from.reference());f.consume();
  assert.deepEqual(f.samples,[70]);assert.ok(f.victim.hp<f.before.hp);assert.equal(f.victim.x,500);assert.equal(f.victim.y,f.before.y);
  assert.equal(f.consumer.diagnostics.compensatedVictimBodyPushContacts,1);
  const hp=f.victim.hp;f.consume();assert.equal(f.victim.hp,hp,'reliable duplicates still have one receiving-owner settlement');
  const old=receiving(from.reference(),{version:0});assert.equal(old.consumer.receive('source',[old.action],1,12),false);
  assert.equal(old.consumer.pending,0);assert.deepEqual(old.samples,[]);assert.equal(old.victim.hp,old.before.hp);
  assert.equal(old.consumer.diagnostics.bodyPushWitnessRejected,1);
});

test('the receiver current invulnerability remains final even though an old native push witness was valid',()=>{
  const f=receiving(displayed().reference(),{currentGuard:true});f.consume();assert.deepEqual(f.victim,f.before);
  assert.deepEqual(f.samples,[500]);assert.equal(f.consumer.diagnostics.victimRejections.currentProtection,1);
});

test('a later attacker position cannot borrow an earlier local-obstacle projection',()=>{
  const f=displayed();f.sim.actor('source').x=1;assert.equal(f.reference(),null);
  assert.equal(f.clock.diagnostics().witnesses.obstacleChanged,1);assert.equal(f.sim.actor('victim').x,70);
  const receiver=receiving(displayed().reference());receiver.action.actor.x=1;receiver.consume();
  assert.equal(receiver.victim.hp,receiver.before.hp);assert.equal(receiver.victim.x,500);
  assert.equal(receiver.consumer.diagnostics.victimRejections.positionMismatch,1);
});

test('mixed interpolated raw/pushed source samples remain independently named and weighted, without introducing an offset field',()=>{
  const f=displayed();f.incoming(100,6);f.clock.contacts(f.sim.state.actors,'source',{now:75});
  // Source clock never runs backward; create the delayed rendering timeline
  // independently to sample a cursor between both accepted packets.
  const delayed=createRemoteActorClock({captureContacts:true,minDelayMs:50,maxDelayMs:50});delayed.setBodyPushWitnessVersion(1);
  const earlier=displayed(),pushedActor=earlier.sim.actor('victim');
  delayed.observe(pushedActor,{...earlier.report,at:50});delayed.contacts(earlier.sim.state.actors,'source',{now:50});
  const raw={...structuredClone(pushedActor),x:100};delayed.observe(raw,{epoch:1,frameSeq:6,at:100,actor:raw});
  delayed.contacts(earlier.sim.state.actors,'source',{now:100});delayed.contacts(earlier.sim.state.actors,'source',{now:125});
  const reference=delayed.observationReference('victim');assert.ok(reference);assert.ok(reference.positionSamples.length>=2);
  assert.deepEqual(reference.bodyPushFrames,[3]);
  const p=reference.positionSamples.reduce((sum,sample)=>sum+(sample.frameSeq===3?70:100)*sample.weight,0);
  assert.ok(Math.abs(reference.position[0]-p)<1e-6);assert.doesNotThrow(()=>validateOwnedTargetViews([{playerId:'victim',...reference}]));
  const receiver=receiving(reference);receiver.consume();assert.ok(Math.abs(receiver.samples[0]-p)<1e-6);assert.equal(receiver.victim.x,500);
  assert.equal(receiver.consumer.diagnostics.compensatedVictimBodyPushContacts,1);
});

for(const invalid of ['old-life','offset','missing-frame','unknown-frame','bad-mode'])test(`a ${invalid} push witness never searches for a replacement or expands contact geometry`,()=>{
  const reference=displayed().reference();if(invalid==='offset')reference.position[0]+=1;
  if(invalid==='missing-frame'){reference.frameSeq=4;reference.bodyPushFrames=[4];}
  if(invalid==='unknown-frame')reference.bodyPushFrames=[4];
  let f;
  if(invalid==='unknown-frame'){
    f=receiving(displayed().reference());f.action.targetViews[0].bodyPushFrames=[4];
    assert.throws(()=>validateOwnedTargetViews(f.action.targetViews),/invalid-owner-body-push/);
  }else f=receiving(reference,{oldLife:invalid==='old-life',version:invalid==='bad-mode'?0:1});
  if(invalid==='bad-mode')assert.equal(f.consumer.receive('source',[f.action],1,12),false);else f.consume();
  assert.equal(f.victim.hp,f.before.hp);assert.equal(f.victim.x,500);assert.equal(f.consumer.diagnostics.compensatedVictimBodyPushContacts,0);
  if(invalid==='bad-mode')assert.equal(f.consumer.diagnostics.bodyPushWitnessRejected,1);
  else assert.equal(f.consumer.diagnostics.victimRejections[{'old-life':'life',offset:'positionMismatch','missing-frame':'missingHistory','unknown-frame':'invalidWitness'}[invalid]],1);
});

test('a room capability change after admission retires a queued push witness before combat execution',()=>{
  const f=receiving(displayed().reference());assert.equal(f.consumer.receive('source',[f.action],1,12),true);
  assert.equal(f.consumer.pending,1);f.consumer.setBodyPushWitnessVersion(0);assert.equal(f.consumer.consume(f.sim,'victim',()=>1),0);
  assert.deepEqual(f.victim,f.before);assert.deepEqual(f.samples,[]);assert.equal(f.consumer.diagnostics.bodyPushWitnessRejected,1);
});

test('expired source history retains the 750ms limit for push witnesses',()=>{
  let now=0;const sim=simulation('victim',30),consumer=createRemoteActionConsumer({clock:()=>now,bodyPushWitnessVersion:1});
  consumer.rememberVictim(sim,'victim',1,3);sim.actor('victim').x=500;now=751;
  const action=encodeCriticalAction(encodeOwnedState(sim,'source',{epoch:1,frameSeq:12}),{id:12,targetViews:[{playerId:'victim',...displayed().reference()}]});
  consumer.receive('source',[action],1,12);consumer.consume(sim,'victim',()=>1);
  assert.equal(consumer.diagnostics.victimRejections.expiredSamples,1);assert.equal(consumer.diagnostics.compensatedVictimBodyPushContacts,0);
});

test('pass states, cannot-push bodies, black-hole overrides and no-overlap input cannot manufacture a push candidate',()=>{
  const f=displayed(),target={...f.report.actor},obstacle={...f.sim.actor('source')};
  assert.deepEqual(nativeBodyPushWitnessPosition(target,profile,obstacle,profile),[70,0,0]);
  assert.equal(nativeBodyPushWitnessPosition({...target,state:'RRF_COMBO_ZZXFRONTX'},profile,obstacle,profile),null);
  assert.equal(nativeBodyPushWitnessPosition({...target,state:'RSI_DAMAGE_DOWN_FRONT'},profile,obstacle,profile),null);
  assert.equal(nativeBodyPushWitnessPosition({...target,sourceBlackHoleCanPass:true},profile,obstacle,profile),null);
  assert.equal(nativeBodyPushWitnessPosition({...target,x:500},profile,obstacle,profile),null);
  assert.equal(nativeBodyPushWitnessPosition(target,profile,{...obstacle,state:'missing-native-state'},profile),null);
});

test('crossing blockage and map-wall clipping retain their current body correction but never gain a pure-push marker',()=>{
  const crossing=displayed();crossing.incoming(-30,6);assert.equal(crossing.guard.diagnostics.crossingBlocked,1);
  assert.equal(crossing.reference(),null);assert.equal(ownedBodyPushProjection(crossing.sim.actor('victim'),{epoch:1,frameSeq:6}),null);
  const scene={...map,lines:[{...map.lines[0],end:[50,0,0]}]},wall=displayed({scene});
  assert.equal(wall.sim.actor('victim').x,50);assert.ok(wall.guard.diagnostics.mapLimited>0);
  assert.equal(wall.reference(),null);assert.equal(wall.guard.diagnostics.bodyPushWitnesses,0);
  assert.equal(nativeBodyPushWitnessPosition(wall.report.actor,profile,wall.sim.actor('source'),profile,{map:scene}),null);
});

test('reset/clear and wrong epoch/frame cannot reuse internal projection identity; no arbitrary externally modified body is recognized',()=>{
  const f=displayed();assert.equal(ownedBodyPushProjection(f.sim.actor('victim'),{epoch:0,frameSeq:3}),null);
  assert.equal(ownedBodyPushProjection(f.sim.actor('victim'),{epoch:1,frameSeq:4}),null);
  f.guard.reset('victim',2);assert.equal(ownedBodyPushProjection(f.sim.actor('victim'),{epoch:1,frameSeq:3}),null);
  f.clock.clear();assert.equal(f.clock.diagnostics().bodyPushWitnessVersion,0);
  assert.throws(()=>f.clock.setBodyPushWitnessVersion(2),/invalid-body-push/);
  assert.throws(()=>createRemoteActionConsumer({bodyPushWitnessVersion:2}),/invalid-body-push/);
  const unsupported=createRemoteActorClock({captureContacts:true,minDelayMs:0,maxDelayMs:0});unsupported.setBodyPushWitnessVersion(1);
  unsupported.observe({...f.sim.actor('victim'),x:60},{epoch:1,frameSeq:9,at:150,actor:{...f.sim.actor('victim'),x:30}});
  unsupported.contacts(f.sim.state.actors,'source',{now:150});assert.equal(unsupported.observationReference('victim'),null);
  assert.equal(unsupported.diagnostics().witnesses.unverifiedProjection,1);
});

for(const currentGuard of [false,true])test(`real four-player owner sync negotiates the push witness through room metadata and keeps current owner ${currentGuard?'protection':'position'} final`,()=>{
  let now=0;
  const attackerSim=simulation('source',50),victimSim=simulation('victim',50);
  const display=createRemoteActorClock({clock:()=>now,captureContacts:true,minDelayMs:0,maxDelayMs:0});
  // Constructors intentionally use default capability zero. Only the room
  // metadata may enable both the display and internal consumer witness mode.
  const attackerSync=createLocalOwnershipSync({reportEvery:1,clock:()=>now,remotePresentation:display});
  const victimSync=createLocalOwnershipSync({reportEvery:1,clock:()=>now});
  const room=sim=>({snapshot:sim.snapshot(),ownership:{mode:'local-owner-v1',ownerStatusVersion:1,
    actors:Object.fromEntries(sim.state.actors.map(actor=>[actor.id,{epoch:1,frameSeq:0}]))},owners:{}});
  attackerSync.reconcile(attackerSim,room(attackerSim),'source');victimSync.reconcile(victimSim,room(victimSim),'victim');
  assert.equal(display.diagnostics().bodyPushWitnessVersion,1);assert.equal(victimSync.actionDiagnostics.bodyPushWitnessVersion,1);
  const clean=report=>({...report,actions:report.actions.map(({ageFrames,...action})=>action)});
  const first=victimSync.afterStep(victimSim,'victim',[]);assert.equal(first.frameSeq,1);
  assert.equal(victimSync.recordSentFrame(victimSim,'victim',first.frameSeq),true);
  assert.equal(attackerSync.receivePeer(attackerSim,'victim',clean(first),'source'),true);
  now=1000/60;victimSim.actor('victim').x=30;
  const second=victimSync.afterStep(victimSim,'victim',[]);assert.equal(second.frameSeq,2);
  assert.equal(victimSync.recordSentFrame(victimSim,'victim',second.frameSeq),true);
  const attackerBefore=structuredClone(attackerSim.actor('source'));
  assert.equal(attackerSync.receivePeer(attackerSim,'victim',clean(second),'source'),true);
  assert.equal(attackerSim.actor('victim').x,70);assert.equal(second.actor.x,30);assert.deepEqual(attackerSim.actor('source'),attackerBefore);
  attackerSync.beforeStep(attackerSim,'source',{now});
  const attack=attackerSync.afterStep(attackerSim,'source',[{type:'attackWindow',actorId:'source'}]);
  // This event is an explicit Web fixture trigger; the production owner
  // encoder/receiver and frozen damage check below remain real. It does not
  // claim execution of a Native original command or WAN input latency.
  const reference=attack.actions[0].targetViews.find(view=>view.playerId==='victim');
  assert.deepEqual(reference.bodyPushFrames,[2]);assert.deepEqual(reference.position,[70,0,0]);
  assert.equal(attackerSync.recordSentFrame(attackerSim,'source',attack.frameSeq),true);
  const victim=victimSim.actor('victim');Object.assign(victim,{x:500,hp:victim.hpMax*.75,mp:40,stateSerial:50,
    invincible:currentGuard,forceInvincible:currentGuard ? .5 : 0});
  const before=structuredClone(victim),samples=[];const hit=victimSim.checkHits.bind(victimSim);
  victimSim.checkCharacterAttack=attacker=>{
    samples.push(victimSim.contactGeometry(victim,attacker).x);
    return hit(attacker,[{kind:'sphere',center:[70,50,0],radius:5}],structuredClone(damage),attacker.hits,
      {kind:'character',state:'RSI_WAIT',powerMultiplier:1,damageStateRaw:{}});
  };
  assert.equal(victimSync.receivePeer(victimSim,'source',clean(attack),'victim'),true);
  victimSync.beforeStep(victimSim,'victim',{now});
  assert.equal(victim.x,500);
  if(currentGuard){assert.deepEqual(victim,before);assert.deepEqual(samples,[500]);assert.equal(victimSync.actionDiagnostics.victimRejections.currentProtection,1);}
  else {assert.deepEqual(samples,[70]);assert.ok(victim.hp<before.hp);assert.equal(victimSync.actionDiagnostics.compensatedVictimBodyPushContacts,1);}
  attackerSync.clear();victimSync.clear();
});

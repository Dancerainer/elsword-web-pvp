/** Real Web simulation/controller/effect encoders and negotiated codecs.
 * No Native, GPU, server or WAN performance claim is made by this suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createCombatPlaybackProducer,combatPlaybackEffectSignature} from '../../packages/online/combat-playback.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,validateCombatPlayback} from '../../packages/online/owned-state.mjs';
import {createOwnedActionDelta} from '../../packages/online/owned-action-delta.mjs';
import {createPeerControlDelta} from '../../packages/online/peer-control-delta.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {CONTINUOUS_AURA_SET} from '../../packages/combat-core/continuous-aura.mjs';

const profiles=Object.fromEntries(['RF','LP'].map(id=>[id,JSON.parse(readFileSync(new URL(`../../packages/combat-core/${id.toLowerCase()}-profile.json`,import.meta.url)))]));
const map={sceneId:'combat-playback-v12',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(profession='RF',version=1){
  const sim=createSimulation({profile:profiles[profession],map,networkOwnerId:'source',actors:[
    {id:'source',professionId:profession,team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
    {id:'target',professionId:profession,team:1,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  const producer=createCombatPlaybackProducer({version});let frame=0;
  const capture=(events=[],held=[])=>producer.capture(sim,'source',{epoch:1,frameSeq:++frame,events,held});
  const report=action=>{
    const result=encodeOwnedState(sim,'source',{epoch:1,frameSeq:action.frameSeq});result.actions=[action];
    const lawful=validateOwnedState(result);validateOwnedReferences(lawful,sim.actor('source'),profiles[profession],map,{actors:sim.state.actors,profiles:sim.profiles});return lawful;
  };
  return {sim,producer,capture,report,actor:sim.actor('source')};
}
function aura(f){
  Object.assign(f.actor.awakening,{full:true,remaining:30});
  return f.sim.createEffect(f.actor,structuredClone(profiles.RF.effectSets[CONTINUOUS_AURA_SET].raw.EFFECT0),{setName:CONTINUOUS_AURA_SET});
}

test('negotiated producer captures actual controller starts and held changes, never ordinary source animation clocks',()=>{
  const f=fixture(),first=f.capture();assert.deepEqual(first.playback,{version:1,start:true,held:[]});f.report(first);
  f.actor.animationTime+=.25;f.actor.stateTime+=.25;f.actor.core.phaseTime+=.25;assert.equal(f.capture(),null);
  f.sim.enter(f.actor,'RSI_COMBO_Z','actual-controller-change');const command=f.capture(f.sim.drainEvents());
  assert.equal(command.playback.start,true);assert.equal(command.actor.state,'RSI_COMBO_Z');f.report(command);
  const held=f.capture([],['Z','RIGHT']);assert.deepEqual(held.playback,{version:1,start:false,held:['RIGHT','Z']});
  assert.equal(f.capture([],['RIGHT','Z']),null,'a held set has no ordering-dependent network change');
  const released=f.capture();assert.deepEqual(released.playback,{version:1,start:false,held:[]});f.report(released);
  assert.equal(f.producer.diagnostics.starts,2);f.producer.clear();assert.equal(f.producer.diagnostics.liveEffectSignatures,0);
});

test('an actual effect birth/activation/end uses three lifecycle messages and no periodic history sampling',()=>{
  const f=fixture();f.capture();f.producer.beforeStep(f.sim,'source');const e=aura(f),born=f.capture();
  assert.equal(born.effects.length,1);assert.equal(born.effects[0].id,e.id);assert.equal(born.effects[0].active,false);f.report(born);
  e.active=true;const active=f.capture();assert.equal(active.effects[0].active,true);f.report(active);
  const stable=combatPlaybackEffectSignature(e);
  for(let frame=0;frame<60;frame++){
    e.elapsed+=1/60;e.animationTime+=1/60;e.setElapsed+=1/60;e.x+=1;
    // This aura has no TRACE_MATRIX declaration. Exercise its legal continuous
    // anchor fields; matrix-signature independence is tested separately below.
    e.currentAnchor={position:[e.x,0,0],facing:1,rotation:[0,0,0]};
    e.sourcePosedAnchor=structuredClone(e.currentAnchor);e.hitCount=frame;e.soundFired=[frame];
    assert.equal(combatPlaybackEffectSignature(e),stable);assert.equal(f.capture(),null);
  }
  f.producer.beforeStep(f.sim,'source');e.dead=true;f.sim.state.effects=[];
  const end=f.capture([{type:'effectEnded',actorId:'source',effectId:e.id}]);
  assert.equal(end.effects[0].id,e.id);assert.equal(end.effects[0].dead,true);assert.equal(end.effects[0].active,false);f.report(end);
  assert.equal(f.capture(),null);assert.equal(f.producer.diagnostics.liveEffectSignatures,0);
});

test('effect signatures ignore continuous steering/link matrices while retaining actual logical phase and attack control changes',()=>{
  const f=fixture(),e=aura(f);
  e.sourceAddLockOn={targetId:'target',manualDirDegree:[1,0,0],useManualDir:false};
  e.sourceAddFury={role:'beam',index:0,group:1,targetId:'target',remaining:5,activeElapsed:1};
  e.sourceAddQuicksilverLink={phase:'forward',group:1,mainAnchor:{position:[0,0,0]},mainScale:[1,1,1]};
  const initial=combatPlaybackEffectSignature(e);
  e.sourceAddLockOn.manualDirDegree=[.9,.1,0];e.sourceAddLockOn.useManualDir=true;
  e.sourceAddFury.remaining=4;e.sourceAddFury.activeElapsed=2;e.sourceAddLinkScale=2;
  e.sourceAddQuicksilverLink.mainScale=[3,1,1];e.sourceAddQuicksilverLink.mainAnchor.position=[100,0,0];
  assert.equal(combatPlaybackEffectSignature(e),initial);
  e.damage.ATTACK_TIME_END=9999;assert.notEqual(combatPlaybackEffectSignature(e),initial);
  const attack=combatPlaybackEffectSignature(e);e.sourcePhantomAttackSerial=2;assert.notEqual(combatPlaybackEffectSignature(e),attack);
});

test('LP authored bone carrier is included only as a dependency of a changed sibling, not as a timed stream',()=>{
  const f=fixture('LP');f.capture();f.sim.spawnSet(f.actor,'EffectSet_SA_APT_Conqueror_1st');
  const birth=f.capture();f.report(birth);
  const child=f.sim.state.effects.find(effect=>Object.hasOwn(effect,'sourceBoneTargetMeshId'));
  const carrier=f.sim.state.effects.find(effect=>effect.id===child.sourceBoneTargetMeshId);assert.ok(carrier);
  for(const e of f.sim.state.effects){e.elapsed+=.1;e.animationTime+=.1;e.x+=20;}
  assert.equal(f.capture(),null);
  child.powerMultiplier=2;const control=f.capture();
  assert.deepEqual(control.effects.map(e=>e.id).sort((a,b)=>a-b),[child.id,carrier.id].sort((a,b)=>a-b));f.report(control);
});

test('a same-tick original birth and retirement retains a closed source identity without inventing a historical active collider',()=>{
  const f=fixture();f.capture();f.producer.beforeStep(f.sim,'source');const e=aura(f);
  const visualBirth=structuredClone(e);e.dead=true;f.sim.state.effects=[];
  const action=f.capture([{type:'effectStarted',actorId:'source',effectId:e.id,visualBirth},
    {type:'effectEnded',actorId:'source',effectId:e.id}]);
  assert.equal(action.effects.length,1);assert.equal(action.effects[0].dead,true);assert.equal(action.effects[0].active,false);
  f.report(action);assert.equal(f.capture(),null);assert.equal(f.producer.diagnostics.transientEnds,1);
});

test('combat-executor retirement leaves original visual tails to the local template and does not invent an effect stop',()=>{
  const f=fixture();f.capture();const e=f.sim.createEffect(f.actor,
    structuredClone(profiles.RF.effectSets[CONTINUOUS_AURA_SET].raw.EFFECT1),{setName:CONTINUOUS_AURA_SET});
  assert.ok(f.capture().effects.some(effect=>effect.id===e.id));f.producer.beforeStep(f.sim,'source');
  e.combatRetired=true;f.sim.state.effects=[];
  assert.equal(f.capture(),null);assert.equal(f.producer.diagnostics.naturallyRetired,1);
  assert.equal(f.producer.diagnostics.ends,0);assert.equal(f.producer.diagnostics.liveEffectSignatures,0);
});

test('room capability zero produces no new lane and a new life emits a fresh start',()=>{
  const f=fixture('RF',0);assert.equal(f.capture(),null);f.producer.setVersion(1);
  assert.equal(f.capture().playback.start,true);assert.equal(f.capture(),null);
  const next=f.producer.capture(f.sim,'source',{epoch:2,frameSeq:1,held:[]});assert.equal(next.playback.start,true);
  assert.throws(()=>f.producer.capture(f.sim,'source',{epoch:2,frameSeq:1}),/must-advance/);
  assert.throws(()=>f.producer.setVersion(2),/invalid-combat-playback-version/);
});

test('strict playback schema rejects malformed mode, history witnesses and input keys but still accepts old unmarked actions',()=>{
  const f=fixture(),action=f.capture(),report=f.report(action);
  for(const playback of [null,{}, {version:2,start:true},{version:1,start:1},{version:1,start:false,extra:true},
    {version:1,start:false,held:['Z','Z']},{version:1,start:false,held:['DASH']},{version:1,start:false,held:'Z'}]){
    const bad=structuredClone(report);bad.actions[0].playback=playback;assert.throws(()=>validateOwnedState(bad),/combat-playback/);
  }
  const mixed=structuredClone(report);mixed.actions[0].targetViews=[];assert.throws(()=>validateOwnedState(mixed),/history-witness/);
  const old=structuredClone(report);delete old.actions[0].playback;assert.doesNotThrow(()=>validateOwnedState(old));
  assert.deepEqual(validateCombatPlayback({version:1,start:false}),{version:1,start:false});
});

test('reliable action, peer-control and relay codecs retain start/held markers and reject corrupted markers',()=>{
  const f=fixture(),a=f.capture([],['Z']),report=f.report(a),event={playerId:'source',epoch:1,frameSeq:a.frameSeq,actions:report.actions};
  const encoder=createOwnedActionDelta(),decoder=createOwnedActionDelta(),wire=encoder.encode('source',event);
  assert.deepEqual(decoder.decode(wire).actions,event.actions);
  const peerEncoder=createPeerControlDelta(),peerDecoder=createPeerControlDelta();
  const peerWire=peerEncoder.encode(report);assert.deepEqual(peerDecoder.decode(peerWire).actions,report.actions);
  const relayEncoder=createOwnedRelayDelta(),relayDecoder=createOwnedRelayDelta();
  assert.deepEqual(relayDecoder.decodeActions(relayEncoder.encodeActions('source',event)).actions,event.actions);
  const corrupted=structuredClone(wire);corrupted.actions[0].playback.held=['INVALID'];
  assert.throws(()=>createOwnedActionDelta().decode(corrupted),/combat-playback/);
  const next=f.capture([],[]),nextEvent={...event,frameSeq:next.frameSeq,actions:[next]};
  assert.deepEqual(decoder.decode(encoder.encode('source',nextEvent)).actions[0].playback,{version:1,start:false,held:[]});
});

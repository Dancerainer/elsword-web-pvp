/** Current Web adapter regressions. Original-client behavior is documented
 * separately in contracts/network2016-action-sources.json. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createCombatPlaybackProducer} from '../../packages/online/combat-playback.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'network2016-capture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const fixture=()=>createSimulation({profile,map,networkOwnerId:'source',actors:[
  {id:'source',professionId:'RF',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
  {id:'target',professionId:'RF',team:1,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)}]});

test('a full action and pose share one detached source encoding in the production coordinator',()=>{
  const sim=fixture(),sync=createLocalOwnershipSync({combatPlaybackVersion:1}),actor=sim.actor('source');
  let x=actor.x,reads=0;Object.defineProperty(actor,'x',{enumerable:true,configurable:true,get(){reads++;return x;},set(value){x=value;}});
  const first=sync.afterStep(sim,'source',[],{held:['RIGHT']});
  assert.equal(reads,2,'encodeOwnedState visits each live actor field once for presence and once for value');
  assert.equal(first.actions.length,1);assert.equal(first.actions[0].frameSeq,first.frameSeq);
  const wire=structuredClone(first);for(const action of wire.actions)delete action.ageFrames;
  assert.doesNotThrow(()=>validateOwnedState(wire));
  reads=0;actor.x=100;actor.animationTime+=1/60;actor.stateTime+=1/60;
  assert.equal(sync.afterStep(sim,'source',[],{held:['RIGHT']}),null);assert.equal(reads,0,'unchanged control has no source encoder work before heartbeat');
  const next=sync.afterStep(sim,'source',[],{held:[]});assert.equal(reads,2);
  assert.equal(next.actor.x,100);assert.equal(next.actions[0].actor.x,100);assert.equal(first.actor.x,0);
  next.actions[0].actor.x=900;assert.equal(next.actor.x,100,'action and replaceable body never alias');assert.equal(actor.x,100);
});

test('source factory is lazy, frame-local, rejects wrong clocks, and retries without consuming a transition',()=>{
  const sim=fixture(),producer=createCombatPlaybackProducer({version:1});let calls=0;
  const capture=frameSeq=>producer.capture(sim,'source',{epoch:1,frameSeq,getReport(){calls++;return encodeOwnedState(sim,'source',{epoch:1,frameSeq});}});
  capture(1);assert.equal(calls,1);assert.equal(capture(2),null);assert.equal(calls,1);
  sim.enter(sim.actor('source'),'RSI_WAIT','same-state-reentry');
  assert.throws(()=>producer.capture(sim,'source',{epoch:1,frameSeq:3,getReport:()=>encodeOwnedState(sim,'source',{epoch:1,frameSeq:2})}),/clock-mismatch/);
  const restarted=capture(3);assert.equal(restarted.playback.start,true);assert.equal(calls,2);
  sim.actor('source').animationTransitionSerial++;assert.equal(capture(4),null,'a display loop alone cannot re-enter gameplay');
  sim.actor('source').stateSerial++;assert.equal(capture(5).playback.start,true,'independent transition identity preserves same-name reentry');
});

test('live effect closure reuses a detached snapshot, terminal records are freshly encoded and cannot revive',()=>{
  const sim=fixture(),actor=sim.actor('source'),producer=createCombatPlaybackProducer({version:1});
  producer.capture(sim,'source',{epoch:1,frameSeq:1});
  const effect=sim.createEffect(actor,structuredClone(profile.effectSets.EffectSet_RAVEN_HYPER_AURA.raw.EFFECT0),{setName:'EffectSet_RAVEN_HYPER_AURA'});
  let report;const birth=producer.capture(sim,'source',{epoch:1,frameSeq:2,getReport:()=>report=encodeOwnedState(sim,'source',{epoch:1,frameSeq:2})});
  assert.deepEqual(birth.effects,report.effects);assert.equal(producer.diagnostics.reusedEffectStates,1);
  birth.effects[0].elapsed=999;assert.notEqual(report.effects[0].elapsed,999);assert.notEqual(effect.elapsed,999);
  producer.beforeStep(sim,'source');effect.dead=true;sim.state.effects=[];
  const ended=producer.capture(sim,'source',{epoch:1,frameSeq:3,events:[{type:'effectEnded',actorId:'source',effectId:effect.id}]});
  assert.equal(ended.effects[0].dead,true);assert.equal(ended.effects[0].active,false);assert.equal(producer.diagnostics.terminalEffectStatesEncoded,1);
  assert.equal(producer.capture(sim,'source',{epoch:1,frameSeq:4}),null);
});

test('explicit actor-header reports retain fresh effect semantics',()=>{
  const sim=fixture(),actor=sim.actor('source'),producer=createCombatPlaybackProducer({version:1});
  producer.capture(sim,'source',{epoch:1,frameSeq:1});
  const effect=sim.createEffect(actor,structuredClone(profile.effectSets.EffectSet_RAVEN_HYPER_AURA.raw.EFFECT0),{setName:'EffectSet_RAVEN_HYPER_AURA'});
  const report=encodeOwnedState(sim,'source',{epoch:1,frameSeq:2});effect.powerMultiplier=2;
  const action=producer.capture(sim,'source',{epoch:1,frameSeq:2,report});
  assert.equal(action.effects[0].powerMultiplier,2);assert.notEqual(report.effects[0].powerMultiplier,2);
});

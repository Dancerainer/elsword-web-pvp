/** Versioned consumer lifecycle and dead-owner guards use the real Web/core
 * adapters with frozen declarations. No Native/WAN measurements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {CONTINUOUS_AURA_SET,CONTINUOUS_AURA_NAME,setContinuousAuraVersion} from '../../packages/combat-core/continuous-aura.mjs';

const profiles=Object.fromEntries(['RF','BM','VC'].map(id=>[id,JSON.parse(readFileSync(
  new URL(`../../packages/combat-core/${id.toLowerCase()}-profile.json`,import.meta.url)))]));
const map={sceneId:'raven-aura-v11-consumer',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function simulation(id='RF',owner='source'){
  return createSimulation({profile:profiles[id],map,networkOwnerId:owner,actors:[
    {id:'source',team:0,position:[0,0,0]},{id:'victim',team:1,position:[1000,0,0]}]});
}
function birth(id='RF',version=2){
  const sim=simulation(id),actor=sim.actor('source');Object.assign(actor.awakening,{full:true,remaining:30});
  const effect=sim.createEffect(actor,structuredClone(profiles[id].effectSets[CONTINUOUS_AURA_SET].raw.EFFECT0),{setName:CONTINUOUS_AURA_SET,clock:'custom'});
  Object.assign(effect,{active:true,dead:false,elapsed:.1,animationTime:.1,setElapsed:.1,
    sourceContinuousAura:{version,revision:1,phase:'active'}});
  actor.sourceAwakeningAuraEffectGroup=[{id:effect.id,name:effect.name,setName:effect.setName}];
  const action=encodeCriticalAction(encodeOwnedState(sim,'source',{epoch:0,frameSeq:1}),{id:1,effectIds:new Set([effect.id])});
  assert.equal(action.effects.length,1,'fixture must contain a real canonical aura lifecycle');return {sim,effect,action};
}

for(const id of ['RF','BM','VC'])test(id+' mode 2 reconstructs one running birth without historical aura execution, then hard terminal prevents revival',()=>{
  const from=birth(id),sim=simulation(id,'victim'),consumer=createRemoteActionConsumer({continuousAuraVersion:2,clock:()=>0});
  const calls=[],tick=sim.tickEffects.bind(sim);sim.tickEffects=(dt,selected)=>{calls.push({dt,names:(selected??sim.state.effects).map(e=>e.name)});return tick(dt,selected);};
  assert.equal(consumer.receive('source',[from.action],0,1),true);consumer.consume(sim,'victim',()=>0);
  const live=sim.state.effects.find(e=>e.networkId===from.effect.id);assert.ok(live);
  assert.equal(live.sourceContinuousAura.version,2);assert.equal(live.name,CONTINUOUS_AURA_NAME);
  assert.equal(calls.length,1);assert.equal(calls[0].dt,0);assert.deepEqual(calls[0].names,[]);
  assert.equal(consumer.diagnostics.continuousAuraBirths,1);assert.equal(consumer.diagnostics.continuousAuraHistoricalSkipped,1);
  assert.equal(consumer.receive('source',[from.action],0,1),true);consumer.consume(sim,'victim',()=>0);
  assert.equal(sim.state.effects.filter(e=>e.name===CONTINUOUS_AURA_NAME).length,1);
  const end=structuredClone(from.action);end.id=2;end.frameSeq=2;end.actor.awakening.full=false;end.actor.awakening.remaining=0;
  Object.assign(end.effects[0],{active:false,dead:true,sourceContinuousAura:{version:2,revision:2,phase:'ended'}});
  assert.equal(consumer.receive('source',[end],0,2),true);consumer.consume(sim,'victim',()=>0);
  assert.equal(sim.state.effects.some(e=>e.name===CONTINUOUS_AURA_NAME),false);assert.equal(consumer.diagnostics.continuousAuraEnds,1);
  const stale=structuredClone(from.action);stale.id=3;stale.frameSeq=3;stale.effects[0].sourceContinuousAura.revision=3;
  assert.equal(consumer.receive('source',[stale],0,3),true);consumer.consume(sim,'victim',()=>0);
  assert.equal(sim.state.effects.some(e=>e.name===CONTINUOUS_AURA_NAME),false);assert.equal(consumer.diagnostics.pending,0);consumer.clear();
});

test('mode 2 admits an old lifecycle birth for duration projection without replaying expired ordinary attacks',()=>{
  const from=birth('BM'),sim=simulation('BM','victim'),consumer=createRemoteActionConsumer({continuousAuraVersion:2,clock:()=>0});
  assert.equal(consumer.receive('source',[from.action],0,100),true);assert.equal(consumer.diagnostics.pending,1);
  consumer.consume(sim,'victim',()=>0);const live=sim.state.effects.find(e=>e.networkId===from.effect.id);assert.ok(live);
  assert.ok(Math.abs(sim.actor('source').awakening.remaining-(30-99/60))<1e-10);
  assert.equal(consumer.diagnostics.continuousAuraBirths,1);assert.equal(consumer.diagnostics.totalConsumed,0);consumer.clear();
});

test('consumer constructor/setter accept exactly modes 0/1/2 and reject cross-room marker versions before admission',()=>{
  const from=birth('RF');
  for(const mode of [0,1,2]){
    const consumer=createRemoteActionConsumer({continuousAuraVersion:mode,clock:()=>0});
    assert.equal(consumer.receive('source',[from.action],0,1),mode===2);assert.equal(consumer.diagnostics.pending,mode===2?1:0);
    const v1=structuredClone(from.action);v1.effects[0].sourceContinuousAura.version=1;
    assert.equal(consumer.receive('source',[v1],0,1),mode===1);
    for(const version of [0,1,2])assert.doesNotThrow(()=>consumer.setContinuousAuraVersion(version));
    for(const version of [-1,3,'2',null])assert.throws(()=>consumer.setContinuousAuraVersion(version),/invalid-continuous-aura-version/);
    consumer.clear();
  }
  for(const version of [-1,3,'2',null])assert.throws(()=>createRemoteActionConsumer({continuousAuraVersion:version}),/invalid-continuous-aura-version/);
  const consumer=createRemoteActionConsumer({continuousAuraVersion:2,clock:()=>0});
  for(const alter of [e=>{e.sourceContinuousAura=null;},e=>{e.sourceContinuousAura.revision=0;},e=>{e.sourceContinuousAura.extra=true;},
    e=>{e.sourceContinuousAura.phase='ended';},e=>{e.name='Other';}]){
    const bad=structuredClone(from.action);alter(bad.effects[0]);assert.equal(consumer.receive('source',[bad],0,1),false);
  }
  const ordinary=structuredClone(from.action);delete ordinary.effects[0].sourceContinuousAura;
  consumer.setContinuousAuraVersion(0);assert.equal(consumer.receive('source',[ordinary],0,1),true);consumer.clear();
});

test('queued lifecycle cannot become a historical collision when room mode changes before consumption',()=>{
  const from=birth('RF'),sim=simulation('RF','victim'),consumer=createRemoteActionConsumer({continuousAuraVersion:2,clock:()=>0});
  assert.equal(consumer.receive('source',[from.action],0,1),true);consumer.setContinuousAuraVersion(1);
  assert.equal(consumer.consume(sim,'victim',()=>0),0);assert.equal(sim.state.effects.length,0);
  assert.equal(consumer.diagnostics.continuousAuraRejected,1);assert.equal(consumer.diagnostics.pending,0);consumer.clear();
});

for(const [id,mode]of [['RF',1],['RF',2],['BM',2],['VC',2]])test(id+' mode '+mode+' stops an unmarked same-tick original aura before a dead owner can collide',()=>{
  const sim=simulation(id),actor=sim.actor('source');setContinuousAuraVersion(sim,mode);actor.hp=0;
  const effect=sim.createEffect(actor,structuredClone(profiles[id].effectSets[CONTINUOUS_AURA_SET].raw.EFFECT0),{setName:CONTINUOUS_AURA_SET,clock:'custom'});
  assert.equal(effect.sourceContinuousAura,undefined);const hp=sim.actor('victim').hp;sim.tickEffects(1/60);
  assert.ok(effect.dead||!sim.state.effects.includes(effect));assert.equal(sim.actor('victim').hp,hp);
});

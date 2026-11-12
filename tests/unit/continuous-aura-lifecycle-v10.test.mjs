/** Web lifecycle regressions. Geometry/target2016 timing is checked separately
 * with Native fixtures; these tests use the frozen RF declaration and actual
 * production capture, reconstruction and relay codecs. No WAN claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {isContinuousRavenAura,validateContinuousAuraMarker,setContinuousAuraVersion,acceptContinuousAuraState,
  endContinuousAura,prepareContinuousAuraLives,clearContinuousAuraOwner} from '../../packages/combat-core/continuous-aura.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const setName='EffectSet_RAVEN_HYPER_AURA',name='RAVEN_HYPER_AURA';
const map={sceneId:'continuous-aura-adapter',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function simulation(owner='source'){
  return createSimulation({profile,map,networkOwnerId:owner,actors:[
    {id:'source',team:0,position:[0,0,0]},{id:'victim',team:1,position:[30,0,0]},{id:'other',team:1,position:[500,0,0]}]});
}
function aura(sim,id){
  const actor=sim.actor('source');Object.assign(actor.awakening,{full:true,remaining:30});
  const effect=sim.createEffect(actor,structuredClone(profile.effectSets[setName].raw.EFFECT0),{setName,clock:'custom'});
  Object.assign(effect,{active:true,dead:false,elapsed:.1,animationTime:.1,setElapsed:.1});if(id!==undefined)effect.id=id;
  actor.sourceAwakeningAuraEffectGroup=[{id:effect.id,name,setName}];return effect;
}
function source(version=1){
  const sim=simulation(),effect=aura(sim),sync=createLocalOwnershipSync({continuousAuraVersion:version,clock:()=>0});
  const report=sync.afterStep(sim,'source',[]);return {sim,effect,sync,report};
}
function references(report,sim){
  const value={...report,...(report.actions?{actions:report.actions.map(action=>{const {ageFrames,...sample}=action;return sample;})}:{})};
  const clean=validateOwnedState(value);validateOwnedReferences(clean,sim.actor('source'),profile,map,{profiles:sim.profiles,actors:sim.state.actors});return clean;
}
function receiver(){
  const sim=simulation('victim'),consumer=createRemoteActionConsumer({continuousAuraVersion:1,clock:()=>0});
  consumer.bind(sim,'victim',()=>0);return {sim,consumer};
}
function consume(f,action,latest=action.frameSeq){
  assert.equal(f.consumer.receive('source',[action],0,latest),true);return f.consumer.consume(f.sim,'victim',()=>0);
}
const marker=(revision,phase='active')=>({version:1,revision,phase});

test('RF-only policy checks the frozen original trace and damage declaration, and rejects substituted markers',()=>{
  const f=source();assert.equal(isContinuousRavenAura(f.effect,profile),true);references(f.report,f.sim);
  for(const alter of [
    e=>{e.name='RAVEN_OTHER';},e=>{e.setName=null;},e=>{e.definitionMember='EFFECT1';},
    e=>{e.sourceProfessionId='RF';},e=>{e.sourceContinuousAura.extra=true;},e=>{e.sourceContinuousAura.revision=0;},
    e=>{e.sourceContinuousAura.phase='ended';},
  ]){const bad=structuredClone(f.report);alter(bad.effects[0]);assert.throws(()=>references(bad,f.sim),/continuous-aura|owner-effect|owner-reflection/);}
  const changed=structuredClone(profile);changed.damageEffects[name].raw.DAMAGE_DATA.REACT_TYPE=1;
  assert.equal(isContinuousRavenAura(f.effect,changed),false);
  assert.throws(()=>validateContinuousAuraMarker(f.report.effects[0],changed),/continuous-aura/);
  const injected=structuredClone(references(f.report,f.sim));injected.effects[0].damage={DAMAGE_DATA:{DAMAGE:{PHYSIC:99999}}};
  assert.throws(()=>validateOwnedState(injected),/invalid-owner-effect/,'damage remains frozen, never supplied by the owner');
});

test('mode 1 emits one reliable birth, one renewal phase and one end while ordinary poses retain calibration',()=>{
  const f=source(),reports=[f.report];
  for(let i=1;i<30;i++){const report=f.sync.afterStep(f.sim,'source',[]);if(report)reports.push(report);}
  assert.deepEqual(reports.flatMap(r=>r.actions).map(a=>a.effects.filter(e=>e.name===name).map(e=>e.sourceContinuousAura)),[[marker(1)]]);
  assert.ok(reports.length>=9&&reports.length<=11);assert.equal(f.sync.sampledEffectCount,0);
  for(const report of reports){references(report,f.sim);assert.deepEqual(report.effects[0].sourceContinuousAura,marker(1));}
  f.sim.actor('source').awakening.remaining=60;
  const phase=f.sync.afterStep(f.sim,'source',[{actorId:'source',type:'reawakenCoreRefill'}]);
  assert.equal(phase.actions.length,1);assert.deepEqual(phase.actions[0].effects[0].sourceContinuousAura,marker(2));
  assert.equal(phase.actions[0].effects[0].id,f.effect.id);
  f.sim.state.effects=[];Object.assign(f.sim.actor('source').awakening,{full:false,remaining:0});
  const ended=f.sync.afterStep(f.sim,'source',[]);references(ended,f.sim);
  assert.deepEqual(ended.actions[0].effects[0].sourceContinuousAura,marker(3,'ended'));
  assert.equal(ended.actions[0].effects[0].active,false);assert.equal(ended.effects.length,0);
  for(let i=0;i<6;i++)assert.equal(f.sync.afterStep(f.sim,'source',[])?.actions.length??0,0);
});

test('mode 0 keeps historical aura sampling and never emits lifecycle metadata',()=>{
  const f=source(0),reports=[f.report];for(let i=1;i<12;i++){const r=f.sync.afterStep(f.sim,'source',[]);if(r)reports.push(r);}
  assert.deepEqual(reports.flatMap(r=>r.actions).map(a=>a.frameSeq),[1,4,7,10]);
  assert.ok(reports.every(r=>r.effects.every(e=>e.sourceContinuousAura===undefined)));
  assert.equal(f.sim.continuousAuraVersion,0);
});

test('reliable birth with every body dropped installs one live collider; historical zero-dt replay never runs that collider',()=>{
  const from=source(),f=receiver(),calls=[],original=f.sim.tickEffects.bind(f.sim);
  f.sim.tickEffects=(dt,selected)=>{calls.push({dt,ids:(selected??f.sim.state.effects).filter(e=>e.name===name).map(e=>e.networkId)});return original(dt,selected);};
  consume(f,references(from.report,from.sim).actions[0]);
  const live=f.sim.state.effects.find(e=>e.name===name);assert.ok(live);assert.equal(live.networkId,from.effect.id);
  assert.deepEqual(live.definition,profile.effectSets[setName].raw.EFFECT0);assert.deepEqual(live.sourceContinuousAura,marker(1));
  assert.ok(calls.every(call=>call.dt!==0||call.ids.length===0));
  const ordinary=encodeCriticalAction(encodeOwnedState(from.sim,'source',{epoch:0,frameSeq:2}),{id:2,effectIds:new Set()});
  consume(f,ordinary);assert.ok(calls.every(call=>call.dt!==0||call.ids.length===0),'even an unrelated history cannot tick the live aura');
  assert.equal(f.sim.state.effects.find(e=>e.name===name),live);
  f.sim.step(1/60,{}, {snapshot:false});assert.ok(calls.some(call=>call.dt===1/60&&call.ids.includes(from.effect.id)));
  consume(f,from.report.actions[0]);assert.equal(f.sim.state.effects.filter(e=>e.name===name).length,1);
});

test('new reliable birth survives older empty pose and keeps its authored group; latest empty pose retires it',()=>{
  const from=source(),f=receiver();const birth=structuredClone(from.report.actions[0]);birth.frameSeq=10;birth.id=10;
  consume(f,birth);const live=f.sim.state.effects.find(e=>e.name===name);
  const empty=encodeOwnedState(f.sim,'source',{epoch:0,frameSeq:5});empty.effects=[];
  empty.actor.awakening={...empty.actor.awakening,full:false,remaining:0};delete empty.actor.sourceAwakeningAuraEffectGroup;
  applyOwnedState(f.sim,'source',empty);
  assert.equal(f.sim.state.effects.find(e=>e.name===name),live);assert.equal(f.sim.actor('source').awakening.full,true);
  assert.ok(f.sim.actor('source').sourceAwakeningAuraEffectGroup.some(e=>e.id===live.id));
  empty.frameSeq=11;applyOwnedState(f.sim,'source',empty);assert.equal(f.sim.state.effects.some(e=>e.name===name),false);
  const active=structuredClone(from.report);active.frameSeq=12;applyOwnedState(f.sim,'source',active);
  assert.equal(f.sim.state.effects.some(e=>e.name===name),false,'terminal ID cannot be revived by a stale active state');
});

test('delayed unseen birth cannot resurrect a field after a newer authoritative empty state',()=>{
  const from=source(),f=receiver(),empty=encodeOwnedState(f.sim,'source',{epoch:0,frameSeq:30});
  empty.effects=[];applyOwnedState(f.sim,'source',empty);consume(f,from.report.actions[0],30);
  assert.equal(f.sim.state.effects.some(e=>e.name===name),false);
});

for(const [remaining,latest]of [[.05,4],[.01,2]])test(`projected active deadline ${remaining}s expires without damage and permits only a later renewal revision`,()=>{
  const from=source(),f=receiver(),birth=structuredClone(from.report.actions[0]);birth.actor.awakening.remaining=remaining;
  consume(f,birth,latest);assert.equal(f.sim.state.effects.some(e=>e.name===name),false);
  const soft=f.sim.state.continuousAuraReceipts.find(row=>row.effectId===from.effect.id);
  assert.equal(soft.locallyExpired,true);assert.equal(soft.phase,'ended');
  const renewal=structuredClone(birth);renewal.id=10;renewal.frameSeq=10;renewal.actor.awakening.remaining=5;
  renewal.effects[0].sourceContinuousAura=marker(2);consume(f,renewal,10);
  assert.equal(f.sim.state.effects.filter(e=>e.name===name).length,1);
  assert.equal(f.sim.state.continuousAuraReceipts.find(row=>row.effectId===from.effect.id).locallyExpired,undefined);
  const old=structuredClone(birth);old.id=11;consume(f,old,10);assert.equal(f.sim.actor('source').awakening.remaining,5);
  const end=structuredClone(renewal);end.id=12;end.frameSeq=12;end.actor.awakening.remaining=0;end.actor.awakening.full=false;
  Object.assign(end.effects[0],{active:false,dead:true,sourceContinuousAura:marker(3,'ended')});consume(f,end,12);
  const forgedRenewal=structuredClone(renewal);forgedRenewal.id=13;forgedRenewal.frameSeq=13;forgedRenewal.effects[0].sourceContinuousAura=marker(4);
  consume(f,forgedRenewal,13);assert.equal(f.sim.state.effects.some(e=>e.name===name),false,'wire end remains hard even across higher revisions');
});

test('current body calibration and newer renewal both protect their duration from an older expired reliable phase',()=>{
  const from=source(),f=receiver(),body=structuredClone(from.report);body.frameSeq=20;delete body.actions;
  body.actor.awakening.remaining=60;body.effects[0].sourceContinuousAura=marker(2);applyOwnedState(f.sim,'source',body);
  const old=structuredClone(from.report.actions[0]);old.actor.awakening.remaining=.01;consume(f,old,20);
  const oldPhase=structuredClone(old);oldPhase.id=19;oldPhase.frameSeq=19;oldPhase.effects[0].sourceContinuousAura=marker(2);consume(f,oldPhase,20);
  assert.equal(f.sim.actor('source').awakening.remaining,60);assert.equal(f.sim.state.effects.find(e=>e.name===name).sourceContinuousAura.revision,2);
});

test('all end/body messages may be lost while a live local phase still stops collision and a wire end hardens its soft receipt',()=>{
  const from=source(),f=receiver();consume(f,from.report.actions[0]);const live=f.sim.state.effects.find(e=>e.name===name);
  const phase=structuredClone(from.report.actions[0]);phase.id=20;phase.frameSeq=20;phase.effects[0].sourceContinuousAura=marker(2);
  consume(f,phase);assert.equal(live.networkFrameSeq,20);
  // The phase source frontier also protects expiry if a calibration clock is
  // old; this cannot let an accepted reliable renewal keep a zero-time field.
  live.networkFrameSeq=1;
  f.sim.actor('source').awakening.remaining=0;prepareContinuousAuraLives(f.sim,()=>0);
  assert.equal(f.sim.state.effects.includes(live),false);assert.equal(live.dead,true);
  assert.equal(f.sim.state.continuousAuraReceipts.find(row=>row.effectId===from.effect.id).locallyExpired,true);
  f.sim.step(1/60,{}, {snapshot:false});assert.equal(f.sim.state.events.some(event=>event.type==='hit'&&event.actorId==='source'),false);
  assert.equal(endContinuousAura(f.sim,'source',0,from.effect.id,21,3),true,'actual end upgrades the already locally expired row');
  assert.equal(f.sim.state.continuousAuraReceipts.find(row=>row.effectId===from.effect.id).locallyExpired,undefined);
  assert.equal(acceptContinuousAuraState(f.sim,'source',0,22,{id:from.effect.id,sourceContinuousAura:marker(4)}),false);
});

test('same-revision older packets cannot rewind newer phases, and end tombstones survive JSON snapshot restore',()=>{
  const from=source(),f=receiver();consume(f,from.report.actions[0]);
  const phase=structuredClone(from.report.actions[0]);phase.id=20;phase.frameSeq=20;phase.effects[0].sourceContinuousAura=marker(2);phase.actor.awakening.remaining=60;
  consume(f,phase);const live=f.sim.state.effects.find(e=>e.name===name);assert.equal(f.sim.actor('source').awakening.remaining,60);
  const old=structuredClone(phase);old.id=21;old.frameSeq=10;old.actor.awakening.remaining=1;
  consume(f,old,20);assert.equal(f.sim.actor('source').awakening.remaining,60);assert.equal(live.sourceContinuousAura.revision,2);
  assert.equal(endContinuousAura(f.sim,'source',0,from.effect.id,30,3),true);
  const restored=simulation('victim');restored.restore(JSON.parse(JSON.stringify(f.sim.snapshot())));setContinuousAuraVersion(restored,1);
  const late=structuredClone(from.report);late.frameSeq=40;applyOwnedState(restored,'source',late);
  assert.equal(restored.state.effects.some(e=>e.name===name),false);
  clearContinuousAuraOwner(restored,'source');late.epoch=1;applyOwnedState(restored,'source',late);
  assert.equal(restored.state.effects.filter(e=>e.name===name).length,1,'new owner life may reuse an effect ID');
});

test('target life change clears only that target 2.5-second live/shared receipt',()=>{
  const from=source(),f=receiver();consume(f,from.report.actions[0]);const effect=f.sim.state.effects.find(e=>e.name===name);
  const epochs={source:0,victim:0,other:0};prepareContinuousAuraLives(f.sim,id=>epochs[id]);
  effect.hits.victim=1;effect.hitGaps.victim=2.5;effect.hits.other=1.1;effect.hitGaps.other=2.5;
  f.consumer.adopt(f.sim,'source',0);const shared=effect.hits;epochs.victim=1;
  prepareContinuousAuraLives(f.sim,id=>epochs[id]);assert.equal(effect.hits,shared);assert.equal(shared.victim,undefined);
  assert.equal(effect.hitGaps.victim,undefined);assert.equal(shared.other,1.1);assert.equal(effect.hitGaps.other,2.5);
  f.consumer.adopt(f.sim,'source',0);assert.equal(effect.hits.victim,undefined,'adopting the existing receipt cannot restore the old-life cooldown');
});

test('target respawn during a soft-expired phase cannot revive its old cooldown when a newer phase reinstalls the same field',()=>{
  const from=source(),f=receiver(),epochs={source:0,victim:0,other:0},epochFor=id=>epochs[id];
  f.consumer.receive('source',from.report.actions,0,1);f.consumer.consume(f.sim,'victim',epochFor);
  const old=f.sim.state.effects.find(e=>e.name===name);old.hits.victim=1;old.hitGaps.victim=2.5;old.hits.other=1.1;old.hitGaps.other=2.5;
  f.consumer.adopt(f.sim,'source',0);f.sim.actor('source').awakening.remaining=0;prepareContinuousAuraLives(f.sim,epochFor);epochs.victim=1;
  const renewal=structuredClone(from.report.actions[0]);renewal.id=5;renewal.frameSeq=5;
  renewal.effects[0].sourceContinuousAura=marker(2);renewal.actor.awakening.remaining=30;
  f.consumer.receive('source',[renewal],0,5);f.consumer.consume(f.sim,'victim',epochFor);
  const live=f.sim.state.effects.find(e=>e.name===name);assert.ok(live);assert.equal(live.hits.victim,undefined);
  assert.equal(live.hitGaps.victim,undefined);assert.equal(live.hits.other,1.1);assert.equal(live.hitGaps.other,2.5);
});

test('caster retirement marks the live field immediately; clear removes collision and simulation mode before offline reuse',()=>{
  const f=source();f.sync.beforeStep(f.sim,'source');f.sim.actor('source').hp=0;
  prepareContinuousAuraLives(f.sim,()=>0);assert.equal(f.effect.dead,true);
  const ended=f.sync.afterStep(f.sim,'source',[]);assert.equal(ended.actions[0].effects[0].sourceContinuousAura.phase,'ended');
  f.sync.clear();assert.equal(f.sim.continuousAuraVersion,0);assert.equal(f.sim.state.effects.some(e=>e.sourceContinuousAura),false);
  assert.equal(f.sim.state.continuousAuraReceipts,undefined);assert.equal(f.sync.continuousAuraDiagnostics.version,0);
});

test('bounded terminal history retains an owner/life retirement watermark instead of resurrecting evicted births',()=>{
  const sim=simulation('victim');setContinuousAuraVersion(sim,1);
  for(let id=1;id<=140;id++){
    assert.equal(acceptContinuousAuraState(sim,'source',0,id*2,{id,sourceContinuousAura:marker(1)}),true);
    assert.equal(endContinuousAura(sim,'source',0,id,id*2+1,2),true);
  }
  assert.ok(sim.state.continuousAuraReceipts.length<=128);
  assert.equal(acceptContinuousAuraState(sim,'source',0,2,{id:1,sourceContinuousAura:marker(1)}),false);
  clearContinuousAuraOwner(sim,'source');assert.equal(acceptContinuousAuraState(sim,'source',1,2,{id:1,sourceContinuousAura:marker(1)}),true);
});

test('both existing relay codecs keep lifecycle revisions dynamic and reconstruct full markers without birth conflicts',()=>{
  const from=source(),p=createOwnedRelayDelta(),c=createOwnedRelayDelta();
  const report=structuredClone(from.report);delete report.actions;
  const first=p.encodeSplit('source',report,{deltaVersion:3});assert.equal(first.baseline.effectBaselines[0].sourceContinuousAura,undefined);
  c.decode(first.baseline);assert.deepEqual(c.decode(first.value),report);
  const event=r=>({playerId:'source',matchId:'fixture-match',epoch:0,frameSeq:r.frameSeq,
    actions:r.actions.map(action=>{const {ageFrames,...sample}=action;return sample;})});
  const birth=p.encodeActions('source',event(from.report));assert.equal(birth.actionEffectBaselines[0].sourceContinuousAura,undefined);
  assert.deepEqual(c.decodeActions(birth),event(from.report));
  for(const [revision,phase]of [[2,'active'],[3,'ended']]){
    const r=structuredClone(from.report);r.frameSeq=revision;r.actions[0].id=revision;r.actions[0].frameSeq=revision;
    for(const e of [r.effects[0],r.actions[0].effects[0]]){e.sourceContinuousAura=marker(revision,phase);if(phase==='ended'){e.active=false;e.dead=true;}}
    const a=p.encodeActions('source',event(r));assert.equal(a.actionEffectBaselines.length,0);assert.deepEqual(c.decodeActions(a),event(r));
    delete r.actions;const packet=p.encodeSplit('source',r,{deltaVersion:3});assert.equal(packet.baseline,null);assert.deepEqual(c.decode(packet.value),r);
  }
});

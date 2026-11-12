/** Production lifecycle over original Native samplers. These are Web adapter
 * regressions, not target-client network goldens or WAN latency evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {make,profile} from '../helpers/rf-passive-fixture-v12.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
import {isContinuousRavenAura} from '../../packages/combat-core/continuous-aura.mjs';
const dt=1/60;
function nativeAuraGeometry(sim,effect){
  const anchor=effect.sourcePosedAnchor;assert.ok(anchor?.position?.length===3&&anchor.position.every(Number.isFinite));
  assert.ok(anchor.rotation?.length===3&&anchor.rotation.every(Number.isFinite));
  // TRACE=1 binds the Bip01 position. The original declaration does not set
  // TRACE_MATRIX, so the sampler legitimately does not attach a full matrix.
  assert.equal(effect.definition.TRACE_MATRIX,undefined);
  const shapes=sim.effectSampler(effect,sim.actor('rf'));
  assert.ok(shapes.length>0,'original Raven_Aura helper geometry is present');
  assert.ok(shapes.every(shape=>shape.kind==='sphere'&&shape.center.length===3&&shape.center.every(Number.isFinite)&&
    shape.radius>0&&/^ATTACK_SPHERE/i.test(shape.source?.helper)));
}
function activate(sim){
  const actor=sim.actor('rf');Object.assign(actor.awakening,{pendingOrbs:3,pendingAvailableOrbs:3});
  sim.activateAwakening(actor);return actor;
}
function lawful(raw,sim){
  const report=validateOwnedState({...raw,actions:raw.actions.map(action=>{const {ageFrames,...sample}=action;return sample;})});
  validateOwnedReferences(report,sim.actor('rf'),profile,sim.map,{profiles:sim.profiles,actors:sim.state.actors});return report;
}

test('RF original awakening creates one lifecycle birth and reawakening changes phase without resetting its Native collider',async()=>{
  const sim=await make({passives:[24405],positions:[[2022.98,2840,0],[4000,2840,0]]});sim.networkOwnerId='rf';
  const sync=createLocalOwnershipSync({continuousAuraVersion:1,clock:()=>0});sync.beforeStep(sim,'rf');
  const actor=activate(sim);sim.step(dt,{}, {snapshot:false});
  const report=lawful(sync.afterStep(sim,'rf',sim.drainEvents()),sim),effect=sim.state.effects.find(e=>e.name==='RAVEN_HYPER_AURA');
  assert.ok(effect&&isContinuousRavenAura(effect,profile));assert.equal(effect.definition.BONE_NAME,'Bip01');
  assert.equal(report.actions.flatMap(a=>a.effects).filter(e=>e.sourceContinuousAura?.phase==='active').length,1);
  const id=effect.id;nativeAuraGeometry(sim,effect);
  for(let i=0;i<8;i++){sync.beforeStep(sim,'rf');sim.step(dt,{}, {snapshot:false});const raw=sync.afterStep(sim,'rf',sim.drainEvents());
    if(raw)assert.equal(lawful(raw,sim).actions.flatMap(a=>a.effects).filter(e=>e.sourceContinuousAura).length,0);}
  const hits=effect.hits;effect.hits.target=sim.state.time;effect.hitGaps.target=2.5;
  Object.assign(actor.awakening,{pendingOrbs:1,pendingAvailableOrbs:1,reawakening:true});sim.activateAwakening(actor);
  const renewed=lawful(sync.afterStep(sim,'rf',sim.drainEvents()),sim);
  assert.equal(sim.state.effects.find(e=>e.name==='RAVEN_HYPER_AURA'),effect);assert.equal(effect.id,id);assert.equal(effect.hits,hits);
  assert.equal(effect.hitGaps.target,2.5);assert.equal(renewed.actions.flatMap(a=>a.effects).find(e=>e.sourceContinuousAura)?.sourceContinuousAura.revision,2);
  sync.clear();
});

test('reliable-only Native birth becomes a running traced collider and terminal event removes it before another normal frame',async()=>{
  const sim=await make({positions:[[2022.98,2840,0],[4000,2840,0]]});sim.networkOwnerId='rf';
  const source=createLocalOwnershipSync({continuousAuraVersion:1,clock:()=>0});source.beforeStep(sim,'rf');activate(sim);
  sim.step(dt,{}, {snapshot:false});const born=lawful(source.afterStep(sim,'rf',sim.drainEvents()),sim);
  const birth=born.actions.find(a=>a.effects.some(e=>e.sourceContinuousAura)),wire=birth.effects.find(e=>e.sourceContinuousAura);
  source.clear();sim.networkOwnerId='target';sim.state.effects=[];
  Object.assign(sim.actor('rf').awakening,{full:false,remaining:0});
  const consumer=createRemoteActionConsumer({continuousAuraVersion:1,clock:()=>0});
  assert.equal(consumer.receive('rf',[birth],0,birth.frameSeq),true);consumer.consume(sim,'target',()=>0);
  const effect=sim.state.effects.find(e=>e.networkId===wire.id);assert.ok(effect);assert.equal(effect.definition.TRACE,1);
  // Place the actual target-owned Native defender helper inside an original
  // Raven_Aura attack sphere, rather than assuming an actor-origin radius.
  const victim=sim.actor('target'),attack=sim.effectSampler(effect,sim.actor('rf'))[0],defence=sim.defenderSampler(victim)[0];
  assert.ok(attack?.center&&defence?.center);for(const [index,key]of ['x','y','z'].entries())victim[key]+=attack.center[index]-defence.center[index];
  victim.forceInvincible=0;victim.invincible=false;victim.inputLock=0;const hp=victim.hp;
  sim.drainEvents();
  const elapsed=effect.elapsed;consumer.remember(sim,'target',()=>0);sim.step(dt,{}, {snapshot:false});
  assert.ok(effect.elapsed>elapsed,'ordinary Native frame advances the installed collider');nativeAuraGeometry(sim,effect);
  assert.ok(sim.state.events.some(event=>event.type==='hit'&&event.actorId==='rf'&&event.targetId==='target'&&event.amount>0));
  assert.ok(victim.hp<hp,'the receiving owner commits a nonempty live Native contact');
  const end=structuredClone(birth);end.id=2;end.frameSeq=2;end.effects=[{...wire,active:false,dead:true,endEmitted:true,
    sourceContinuousAura:{version:1,revision:2,phase:'ended'}}];
  end.actor.awakening={...end.actor.awakening,full:false,remaining:0};
  consumer.receive('rf',[end],0,2);consumer.consume(sim,'target',()=>0);
  assert.equal(sim.state.effects.some(e=>e.networkId===wire.id),false);sim.step(dt,{}, {snapshot:false});
  assert.equal(sim.state.effects.some(e=>e.networkId===wire.id),false);consumer.clear();
});

test('mode 1 stops a same-tick unmarked Native newborn when its caster is already dead, without producing legacy active history',async()=>{
  const sim=await make();sim.networkOwnerId='rf';const sync=createLocalOwnershipSync({continuousAuraVersion:1,clock:()=>0});
  sync.beforeStep(sim,'rf');const actor=activate(sim),effect=sim.state.effects.find(e=>e.name==='RAVEN_HYPER_AURA');
  assert.equal(effect.sourceContinuousAura,undefined,'core must recognize the original declaration before producer marking');
  actor.hp=0;const hp=sim.actor('target').hp;sim.tickEffects(dt);
  assert.ok(effect.dead||!sim.state.effects.includes(effect));assert.equal(sim.actor('target').hp,hp);
  const report=lawful(sync.afterStep(sim,'rf',sim.drainEvents()),sim);
  assert.equal(report.actions.flatMap(a=>a.effects).some(e=>e.name==='RAVEN_HYPER_AURA'&&e.active),false);
  sync.clear();assert.equal(sim.continuousAuraVersion,0);
});

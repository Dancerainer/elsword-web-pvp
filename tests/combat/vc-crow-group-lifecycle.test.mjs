/** Source declarations and fixed V5 gate are the oracle; actual converted
 * poses/native helpers/Garpai collision establish the regression trigger.
 * Current web simulation, not a measured target2016 client trace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vcProductionFixture,vcProductionPreset} from '../helpers/vc-production-fixture.mjs';
import {vcProfile} from '../helpers/vc-fixture.mjs';
import {claimEffectGroupHit,retireEffectGroupHits} from '../../packages/combat-core/effect-group-damage.mjs';

const ground=/^DAMAGE_EFFECT_IGNITION_CROW_GROUND(?:_OVERHEAT)?$/;
function fixture({facing=1,awake=false,branch='none',skillId=24022}={}){
  const f=vcProductionFixture({preset:{loadout:[{skillId,branchId:branch},...Array(7).fill(null)],passives:[],guildPassives:[],
    attributes:{...vcProductionPreset.attributes,criticalRate:0}},
    actor:{position:[facing*-600,3080,0],facing,passives:[],guildPassives:[]},gap:facing*(-600+160)});
  if(awake){f.a.awakening.remaining=60;f.a.awakening.orbs=1;}
  f.sim.rng=()=>.99;
  const names=new Map(),lifetimes=new Map(),create=f.sim.createEffect.bind(f.sim);
  f.sim.createEffect=(...args)=>{const e=create(...args);if(e){names.set(e.id,e.name);lifetimes.set(e.id,e.lifeTimeSeconds);}return e;};
  f.sim.drainEvents();return {...f,names,lifetimes};
}
function cast(f,{heat=false,frames=900}={}){
  const events=[];for(let i=0;i<frames;i++){
    f.sim.step(1/60,{pressed:i===0||heat&&i<200&&i%2===0?['A']:[]},{snapshot:false});events.push(...f.sim.drainEvents());
  }return events;
}

test('source Crow fire is one named group with1.1s gap and unchanged8.3s lifetime; drops are separate nonattacking carriers',()=>{
  const source=JSON.parse(readFileSync(new URL('../../.cache/vc/damage-declarations.json',import.meta.url)));
  for(const suffix of['','_OVERHEAT']){
    const name='DAMAGE_EFFECT_IGNITION_CROW_GROUND'+suffix,raw=vcProfile.damageEffects[name].raw;
    assert.deepEqual(raw,source.globals[name]);assert.equal(raw.GROUP_DAMAGE,1);assert.equal(raw.DAMAGE_DATA.HIT_GAP,1.1);
    assert.equal(raw.DAMAGE_DATA.RE_ATTACK,1);assert.equal(vcProfile.effectTemplates[raw.MAIN_EFFECT_NAME].fields.LifeTime,8.3);
    assert.equal(vcProfile.damageEffects['DAMAGE_EFFECT_IGNITION_CROW_DROPFIRE'+suffix].raw.DAMAGE_DATA,undefined);
  }
});

test('group receipt is victim/attacker/name scoped, expires, snapshots and never merges distinct fire damage names',()=>{
  const state={time:1},effect={name:'fire',damage:{GROUP_DAMAGE:1}},data={HIT_GAP:1.1};
  assert.equal(claimEffectGroupHit(state,effect,'owner','target',data),true);
  assert.equal(claimEffectGroupHit(state,{...effect,id:2},'owner','target',data),false);
  assert.equal(claimEffectGroupHit(state,effect,'other-owner','target',data),true);
  assert.equal(claimEffectGroupHit(state,effect,'owner','other-target',data),true);
  assert.equal(claimEffectGroupHit(state,{...effect,name:'overheat-fire'},'owner','target',data),true);
  assert.equal(claimEffectGroupHit(state,effect,'owner','target',data,{attackerEpoch:1}),true,'new attacker life is independent');
  assert.equal(claimEffectGroupHit(state,effect,'owner','target',data,{targetEpoch:1}),true,'new victim life is independent');
  assert.equal(claimEffectGroupHit(state,{name:'ungrouped',damage:{}},'owner','target',data),true);
  const restored=structuredClone(state);restored.time=2.099;
  assert.equal(claimEffectGroupHit(restored,effect,'owner','target',data),false);
  restored.time=2.1;assert.equal(claimEffectGroupHit(restored,effect,'owner','target',data),true);
  restored.time=20;retireEffectGroupHits(restored);assert.deepEqual(restored.effectGroupHits,[]);
  assert.equal(claimEffectGroupHit(restored,effect,'owner','target',{HIT_GAP:0}),true);
  assert.equal(claimEffectGroupHit(restored,effect,'owner','target',{HIT_GAP:0}),true);
  assert.deepEqual(restored.effectGroupHits,[]);
});

test('ten thousand successive group gaps retain only live windows, including changing life epochs',()=>{
  const state={time:0},effect={name:'fire',damage:{GROUP_DAMAGE:1}};
  let peak=0;
  for(let i=0;i<10000;i++){
    state.time=i*1.2;
    assert.equal(claimEffectGroupHit(state,effect,'owner','target',{HIT_GAP:1.1},{attackerEpoch:i,targetEpoch:i}),true);
    peak=Math.max(peak,state.effectGroupHits.length);
  }
  assert.equal(peak,1);
  state.time+=1.2;retireEffectGroupHits(state);assert.deepEqual(state.effectGroupHits,[]);
});

test('a real mid-fire simulation snapshot restores the shared gap and repeats the exact remaining trajectory',()=>{
  const original=fixture(),replayed=fixture();
  for(let i=0;i<75;i++){original.sim.step(1/60,{pressed:i===0?['A']:[]},{snapshot:false});original.sim.drainEvents();}
  const snapshot=original.sim.snapshot();assert.ok(snapshot.effectGroupHits?.length>0,'snapshot is inside a live group gap');
  replayed.sim.restore(snapshot);
  for(let i=0;i<825;i++){
    original.sim.step(1/60,{}, {snapshot:false});replayed.sim.step(1/60,{}, {snapshot:false});
    assert.deepEqual(replayed.sim.drainEvents(),original.sim.drainEvents());
  }
  assert.deepEqual(replayed.sim.snapshot(),original.sim.snapshot());
  assert.deepEqual(replayed.sim.state.effectGroupHits,[]);
});

for(const facing of[-1,1])for(const heat of[false,true])for(const awake of[false,true])for(const branch of['none','memo-61'])
  test(`real Crow overlapping fire shares accepted hit gap facing=${facing} heat=${heat} awake=${awake} branch=${branch}`,()=>{
    const f=fixture({facing,awake,branch}),events=cast(f,{heat});
    const drops=events.filter(e=>e.type==='damageChildCreated'&&/^DAMAGE_EFFECT_IGNITION_CROW_DROPFIRE/.test(e.name));
    const flames=events.filter(e=>e.type==='damageSecondaryCreated'&&ground.test(e.name));
    assert.equal(drops.length,heat?17:11,'each authored timed drop is born once');
    assert.equal(flames.length,drops.length,'one ground fire per actual carrier death');
    const hits=events.filter(e=>e.type==='hit'&&ground.test(f.names.get(e.origin?.id)??''));
    const gap=branch==='memo-61'?.55:1.1;
    assert.ok(hits.length>=8,'original repeat damage remains');
    for(let i=1;i<hits.length;i++)assert.ok(hits[i].time-hits[i-1].time>=gap-1e-8,'adjacent fire instances cannot bypass group gap');
    assert.ok(hits.every(h=>h.data.HIT_GAP===gap));
    for(const birth of flames){
      assert.equal(f.lifetimes.get(birth.effectId),8.3);
      assert.equal(events.filter(e=>e.type==='effectEnded'&&e.effectId===birth.effectId).length,1,'natural death emits one retirement');
    }
    assert.deepEqual(f.sim.state.effectGroupHits,[],'group receipts retire after final gap');
    assert.equal(f.sim.state.effects.filter(e=>/IGNITION_CROW/.test(e.name)).length,0,'crow damage/carriers have finite lifetimes');
  });

for(const heat of[false,true])test(`Incineration heat=${heat} does not inherit Crow group damage or retain expired moving targets`,()=>{
  const f=fixture({skillId:24023}),events=cast(f,{heat,frames:1200});
  const births=events.filter(e=>e.type==='effectStarted'&&/IGNITION_CROW_INCINERATION/.test(e.name));
  assert.ok(births.length>0);
  assert.equal(f.sim.state.effects.filter(e=>/IGNITION_CROW/.test(e.name)).length,0);
  assert.equal(f.sim.state.effectGroupHits?.length??0,0);
});

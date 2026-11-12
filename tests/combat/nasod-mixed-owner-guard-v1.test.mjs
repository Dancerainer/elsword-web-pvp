/** Regression for the real participant-hit/owner-report failure. Frozen target
 * declarations supply guard state/effects; no original-client trace claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeNasod} from '../../packages/native-source/nasod.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

const read=file=>readFileSync(new URL('../../'+file,import.meta.url));
const json=file=>JSON.parse(read(file));
const professions=['RF','LK','VC','RS','BM','IS'];
const profiles=Object.fromEntries(professions.map(id=>[id,json('packages/combat-core/'+id.toLowerCase()+'-profile.json')]));
const map={...json('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...json('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const declaration=json('contracts/rf-nasod-target-v11.json');
const nativeManifest=json('artifacts/native/manifest.json');
const declaredBinary=name=>{
  const module=nativeManifest.modules[name];assert.ok(module,'declared native module '+name);
  const bytes=read('artifacts/native/'+module.file);
  assert.equal(bytes.length,module.bytes,'declared native byte count '+name);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),module.sha256,'declared native SHA256 '+name);
  return bytes;
};
const nativeNasod=await instantiateNativeNasod(declaredBinary('nasod'));
const nativeSkillValues=await instantiateNativeSkillValues(declaredBinary('skill-values'));
const damage={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:1,HIT_TYPE:1,ATTACK_TYPE:2};
const attributes={hpMax:50000,mpMax:300,physicalAttack:1000,magicAttack:1000};
function fixture(attacker,defender){
  return createSimulation({profile:profiles[attacker],profiles,map,nativeNasod,nativeSkillValues,networkOwnerId:'defender',seed:2016,
    preset:{guildPassives:[],passives:[],loadout:Array(8).fill(null)},actors:[
      {id:'attacker',professionId:attacker,team:0,position:[2022.98,2840,0],lineId:6,attributes,passives:[],guildPassives:[],loadout:Array(8).fill(null)},
      {id:'defender',professionId:defender,team:1,position:[2142.98,2840,0],lineId:6,facing:-1,attributes,passives:[],guildPassives:[],loadout:Array(8).fill(null)},
    ]});
}
function awakeGuard(sim){const b=sim.actor('defender');b.awakening.remaining=60;b.core.gauge=40;sim.updateCoreLevel(b);return b;}

for(const attacker of professions)for(const defender of ['RF','BM','VC'])
test(`${attacker} hits awakened ${defender}: native guard completes and its owned packet reconstructs both shield effects`,()=>{
  const source=fixture(attacker,defender),receiver=fixture(attacker,defender),a=source.actor('attacker'),b=awakeGuard(source);
  const hp=b.hp;
  assert.equal(source.canGuard(b,a,damage),true,'must exercise actual native guard rather than an unguarded hit');
  const result=source.injectHit({attackerId:a.id,targetId:b.id,damageData:damage});
  assert.equal(result.accepted,true);assert.equal(hp-b.hp,250);
  assert.equal(b.state,'RSI_PARRYING_SMALL');assert.equal(b.core.canParry,true);
  assert.deepEqual([b.core.gauge,b.core.level],[20,1]);
  const events=source.drainEvents();
  assert.equal(events.filter(e=>e.type==='coreGuardStarted').length,1);
  const effects=source.state.effects.filter(e=>e.ownerId===b.id&&e.setName==='EffectSet_RAVEN_PARRING');
  assert.deepEqual(effects.map(e=>e.name),['raven_bead_shield_01','raven_bead_shield_02']);
  const packet=JSON.parse(JSON.stringify(encodeOwnedState(source,b.id,{epoch:1,frameSeq:1,events})));
  validateOwnedState(packet);
  validateOwnedReferences(packet,receiver.actor(b.id),receiver.profileFor(receiver.actor(b.id)),receiver.map,
    {profiles:receiver.profiles,actors:receiver.state.actors});
  applyOwnedState(receiver,b.id,packet);
  assert.equal(receiver.actor(b.id).hp,b.hp);assert.equal(receiver.actor(b.id).core.canParry,true);
  assert.equal(receiver.actor(b.id).state,'RSI_PARRYING_SMALL');
  assert.deepEqual(receiver.state.effects.filter(e=>e.ownerId===b.id).map(e=>e.name),effects.map(e=>e.name));
  source.step(1/60,{}, {snapshot:false});receiver.step(1/60,{}, {snapshot:false});
  assert.ok([source.actor(b.id).hp,receiver.actor(b.id).hp].every(Number.isFinite));
});

test('all Nasod professions install detached target guard declarations while Elsword profiles and raw inputs stay unchanged',()=>{
  const before=JSON.stringify(profiles),source=fixture('LK','BM');
  for(const id of ['RF','BM','VC']){
    const profile=source.profiles[id];
    assert.deepEqual(profile.effectSets.EffectSet_RAVEN_PARRING,declaration.effectSet);
    assert.deepEqual(profile.states.RSI_PARRYING_SMALL.raw,declaration.smallState.raw);
  }
  for(const id of ['LK','RS','IS'])assert.equal(source.profiles[id].effectSets.EffectSet_RAVEN_PARRING,undefined);
  source.profiles.BM.effectSets.EffectSet_RAVEN_PARRING.raw.EFFECT0.TRACE=0;
  assert.equal(source.profiles.RF.effectSets.EffectSet_RAVEN_PARRING.raw.EFFECT0.TRACE,1);
  assert.equal(source.profiles.VC.effectSets.EffectSet_RAVEN_PARRING.raw.EFFECT0.TRACE,1);
  assert.equal(JSON.stringify(profiles),before);
});

test('continuous BM guard repeats the authored shield without consuming the core twice and survives JSON continuation',()=>{
  const source=fixture('LK','BM'),a=source.actor('attacker'),b=awakeGuard(source);
  for(let i=0;i<2;i++)source.injectHit({attackerId:a.id,targetId:b.id,damageData:damage});
  assert.equal(source.state.events.filter(e=>e.type==='coreGuardStarted').length,1);
  assert.equal(source.state.events.filter(e=>e.type==='coreGuard').length,2);
  assert.deepEqual([b.core.gauge,b.core.level],[20,1]);
  assert.equal(source.state.effects.filter(e=>e.setName==='EffectSet_RAVEN_PARRING').length,4);
  const restored=fixture('LK','BM');restored.restore(JSON.parse(JSON.stringify(source.snapshot())));
  for(let i=0;i<40;i++){source.step(1/60,{}, {snapshot:false});restored.step(1/60,{}, {snapshot:false});}
  assert.deepEqual(JSON.parse(JSON.stringify(restored.snapshot())),JSON.parse(JSON.stringify(source.snapshot())));
});

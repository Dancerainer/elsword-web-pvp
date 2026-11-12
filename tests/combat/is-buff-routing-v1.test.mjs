/** Target2016 factor228 level rates and factor238/template20 immediate MP.
 * Tests use source values, not probabilities inferred from simulated samples. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url)));
const profiles={IS:read('packages/combat-core/is-profile.json'),LK:read('packages/combat-core/lk-profile.json')};
const preset=read('config/is-preset.json');
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const nativeSkillValues=await instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values-v1/skill-values-source.wasm',import.meta.url)));
function make(){return createSimulation({profile:profiles.IS,profiles,map,nativeSkillValues,
  preset:{...preset,guildPassives:[],passives:[21412],loadout:Array(8).fill(null)},
  actors:[{id:'is',professionId:'IS',team:0,position:[2022,2840,0],lineId:6,guildPassives:[],passives:[21412]},
    {id:'target',professionId:'LK',team:1,position:[1858,2840,0],lineId:6,guildPassives:[],passives:[]}]});}
function validate(sim,report){
  validateOwnedState(report);
  validateOwnedReferences(report,sim.actor('target'),sim.profileFor(sim.actor('target')),map,
    {actors:sim.state.actors,profiles:sim.profiles});
}

test('Sharp Sword real grant path preserves factor228 and its learned-level source probability',()=>{
  // Original factor228 RATE is 1.5%, 3%, 4.5% at learned levels1–3.
  for(const [level,rate]of [[1,.015],[2,.03],[3,.045]])for(const [roll,accepted]of [[rate-.00001,true],[rate,true],[rate+.00001,false]]){
    const sim=make(),before=structuredClone(sim.profileFor(sim.actor('is')).buffFactors[228]);sim.rng=()=>roll;
    const buff=sim.grantBuff(sim.actor('is'),sim.actor('target'),228,level,null);
    assert.equal(!!buff,accepted,`factor228 level${level} roll${roll}`);
    if(buff)assert.equal(buff.factorId,228);
    assert.deepEqual(sim.profileFor(sim.actor('is')).buffFactors[228],before,'raw target declaration stays frozen');
  }
});

test('preserving source factor identity also preserves a trait-transformed raw duration',()=>{
  const sim=make(),a=sim.actor('is'),b=sim.actor('target');sim.rng=()=>.03;
  const source=structuredClone(sim.profileFor(a).buffFactors[228].raw);
  const buff=sim.grantBuff(a,b,228,3,{buffDurationMultiplier:2,buffStrengthMultiplier:1});
  assert.ok(buff);assert.equal(buff.factorId,228);
  assert.equal(buff.finalizers[0].remaining,Math.fround(source.FINALIZER.BFT_TIME.NORMAL_TIME['3']*2));
  assert.deepEqual(sim.profileFor(a).buffFactors[228].raw,source);
});

test('Brutal MP proc serializes on the LK victim and restores one immediate source tick',()=>{
  const owner=make(),receiver=make(),a=owner.actor('is'),b=owner.actor('target');owner.rng=()=>0;
  owner.applyHit(a,b,{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},ATTACK_TYPE:2,HIT_TYPE:1,REACT_TYPE:1,FORCE_DOWN:0},{powerMultiplier:1});
  const buff=b.buffs.find(row=>row.templateId===20);assert.ok(buff);assert.equal(buff.factorId,238);
  assert.equal(buff.behaviors[0].interval,0);assert.equal(buff.finalizers[0].kind,'immediate');
  const report=encodeOwnedState(owner,'target',{epoch:1,frameSeq:1});validate(receiver,report);
  applyOwnedState(receiver,'target',report);const target=receiver.actor('target'),mp=target.mp;
  receiver.advanceActorBuffs(target,1/60);
  assert.ok(Math.abs(target.mp-(mp-10.6))<.00001,'original level4 factor238 MP FIX -10.6');
  assert.equal(target.buffs.some(row=>row.templateId===20),false);
  const after=target.mp;receiver.advanceActorBuffs(target,1/60);assert.equal(target.mp,after);
  validate(receiver,encodeOwnedState(receiver,'target',{epoch:1,frameSeq:2}));
});

test('zero-interval exception rejects other containers and requires a declared source factor',()=>{
  const owner=make(),a=owner.actor('is'),b=owner.actor('target');owner.rng=()=>0;
  owner.grantBuff(a,b,238,4,null);const report=encodeOwnedState(owner,'target',{epoch:1,frameSeq:1});
  for(const mutate of [
    buff=>{buff.behaviors[0].kind='hpInterval';},
    buff=>{buff.behaviors[0].interval=-1;},
    buff=>{buff.finalizers=[{kind:'time',remaining:1,sourceDuration:1}];},
    buff=>{buff.templateId=99;},
    buff=>{buff.factorId=null;},
    buff=>{buff.factorId=228;},
    buff=>{buff.behaviors[0].type=999;},
  ]){
    const invalid=structuredClone(report);mutate(invalid.actor.buffs.find(row=>row.templateId===20));
    assert.throws(()=>validate(owner,invalid),/owner/);
  }
  const unknownSource=structuredClone(report);unknownSource.actor.buffs[0].sourceActorId='missing';
  assert.throws(()=>validate(owner,unknownSource),/invalid-owner-buff-source/);
});

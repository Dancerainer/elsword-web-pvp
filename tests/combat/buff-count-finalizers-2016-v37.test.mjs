import test from 'node:test';
import assert from 'node:assert/strict';
import {buffCountFinalizerIncrement,countBuffInstances} from '../../packages/combat-core/buff-count-finalizers.mjs';
import {createBuffFromFactor,mergeBuffs,consumeBuffHit,tickBuffs} from '../../packages/combat-core/buffs.mjs';
import {readFileSync} from 'node:fs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
const evidence=JSON.parse(readFileSync(new URL('../../contracts/rf-buff-source.json',import.meta.url)));
const nativeValues=await instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values.wasm',import.meta.url)));
const profile=structuredClone(evidence.profile);
Object.assign(profile.buffTemplates,{9001:{raw:{IS_DEBUF:0}},9002:{raw:{IS_DEBUF:1}},9003:{raw:{IS_DEBUF:0,IS_WORLD_BUFF:1}}});
const unit={id:'b',hp:5000,hpMax:5000,sourceHitCountByte:0,buffResistances:{0:0,1:0},debuffDurationMultiplier:1,
  buffs:[{templateId:9001,accumulationCount:10},{templateId:9002,finalizers:[{remaining:0}]},{templateId:9003},{templateId:9002}]};
const sourceActor={id:'a',stats:{physicalAttack:2000,magicAttack:1000},buffs:[]};
test('2016 count aggregation counts matching instances on the supplied unit including pending/world entries',()=>{
  assert.equal(countBuffInstances(profile,unit,false),2);assert.equal(countBuffInstances(profile,unit,true),2);
  assert.equal(buffCountFinalizerIncrement(profile,{policy:3,parameters:[0,1.9,0],unit}),3);
  assert.equal(buffCountFinalizerIncrement(profile,{policy:4,parameters:[0,2.9,0],unit}),5);
  assert.equal(buffCountFinalizerIncrement(profile,{policy:4,parameters:[0,999,7.9],unit}),7);
  assert.equal(buffCountFinalizerIncrement(profile,{policy:1,parameters:[0,999,0],unit}),0);
  assert.equal(buffCountFinalizerIncrement(profile,{policy:2,parameters:[0,999,2.9],unit}),2);
});
test('typed policy3/4 parameters enter real Buff construction without fabricating a Lua multiplier key',()=>{
  for(const policy of [3,4]){
    const p=structuredClone(profile),factor=structuredClone(p.buffFactors[437].raw),name='BFT_HIT_COUNT';
    factor.FINALIZER[name].BUFF_USE_COUNT_TYPE=policy;
    p.buffTemplates[factor.BUFF_TEMPLET_ID].raw.FINALIZER[name].BUFF_USE_COUNT_TYPE=policy;
    const options={factor,sourceActor,targetActor:unit,roll:0,nativeValues};
    assert.equal(createBuffFromFactor(p,options).supported,false,'unknown Lua binding stays explicit');
    const result=createBuffFromFactor(p,{...options,countFinalizerParameters:{[name]:[0,1.9,0]}});
    assert.equal(result.supported,true,JSON.stringify(result.unsupported));assert.equal(result.buff.finalizers.find(f=>f.kind==='hit').remaining,3);
  }
});
test('BF437 retains its initial byte baseline, corrects one visible wrap, refreshes max and finishes at manager tick',()=>{
  const owner={...unit,sourceHitCountByte:250};
  const make=count=>{const factor=structuredClone(profile.buffFactors[437].raw);factor.FINALIZER.BFT_HIT_COUNT.COUNT={'1':count};
    const result=createBuffFromFactor(profile,{factor,sourceActor,targetActor:owner,roll:0,nativeValues});
    assert.equal(result.supported,true,JSON.stringify(result.unsupported));return result.buff;};
  let buffs=[make(7)];const hit=()=>buffs[0].finalizers.find(row=>row.kind==='hit');
  assert.equal(hit().sourceByteEnd,257);assert.equal(hit().sourceByteBaseline,250);
  owner.sourceHitCountByte=255;buffs=consumeBuffHit(profile,buffs,{count:5,targetActor:owner}).buffs;
  assert.equal(hit().remaining,2);
  owner.sourceHitCountByte=0;buffs=consumeBuffHit(profile,buffs,{count:1,targetActor:owner}).buffs;
  assert.equal(hit().remaining,1);assert.equal(hit().sourceByteEnd,257,'feedback does not commit the manager wrap');
  buffs=tickBuffs(profile,buffs,1/60,{targetActor:owner,nativeValues}).buffs;
  assert.equal(hit().sourceByteEnd,1);assert.equal(hit().sourceByteBaseline,250);assert.equal(hit().remaining,1);
  buffs=mergeBuffs(profile,buffs,make(7));assert.equal(hit().sourceByteEnd,7);assert.equal(hit().remaining,7);
  assert.equal(hit().sourceByteBaseline,250,'refresh keeps the first initialization baseline');
  buffs=mergeBuffs(profile,buffs,make(3));assert.equal(hit().sourceByteEnd,7,'refresh uses max(current+quota), not additive stacking');
  owner.sourceHitCountByte=7;buffs=consumeBuffHit(profile,buffs,{count:7,targetActor:owner}).buffs;
  assert.equal(hit().remaining,0);assert.equal(buffs.length,1);
  assert.equal(tickBuffs(profile,buffs,0,{targetActor:owner,nativeValues}).buffs.length,1);
  assert.equal(tickBuffs(profile,buffs,1/60,{targetActor:owner,nativeValues}).buffs.length,0);
  assert.equal(owner.hp,5000,'count consumption is independent of HP results');
});

test('BF437 construction and its native byte finalizer reject absent or invalid byte inputs instead of guessing zero',()=>{
  const missing={...unit};delete missing.sourceHitCountByte;
  const targets=[missing,...[-1,256,1.5,NaN].map(sourceHitCountByte=>({...unit,sourceHitCountByte}))];
  for(const targetActor of targets){
    const result=createBuffFromFactor(profile,{factor:437,sourceActor,targetActor,roll:0,nativeValues});
    assert.equal(result.supported,false);assert.equal(result.buff,null);
    assert.ok(result.unsupported.some(row=>/byte|counter/i.test(row.reason)),JSON.stringify(result.unsupported));
  }
  const made=createBuffFromFactor(profile,{factor:437,sourceActor,targetActor:unit,roll:0,nativeValues});
  assert.equal(made.supported,true);const buffs=[made.buff];
  const large=structuredClone(profile.buffFactors[437].raw);large.FINALIZER.BFT_HIT_COUNT.COUNT={'1':520};
  assert.equal(createBuffFromFactor(profile,{factor:large,sourceActor,targetActor:unit,roll:0,nativeValues}).supported,false,
    'Current Web byte-finalizer support and wire end bound cover quotas at most255; the original larger-quota algorithm is not replaced by unlimited remaining uses');
  for(const targetActor of [undefined,...targets]){
    assert.throws(()=>consumeBuffHit(profile,buffs,{targetActor}),{name:'TypeError',message:/byte|counter/i});
    assert.throws(()=>tickBuffs(profile,buffs,1/60,{targetActor,nativeValues}),{name:'TypeError',message:/byte|counter/i});
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {initializeActorPassives,applyStatPassives,modifyOutgoingHit,modifyReceivedHit,onHit,onReceivedHit,onAwakening} from '../../packages/combat-core/passives.mjs';
const evidence=JSON.parse(readFileSync(new URL('../../contracts/rf-passive-source.json',import.meta.url)));
const wasm=new URL('../../artifacts/native/skill-values-v1/skill-values-source.wasm',import.meta.url);
const skip=!existsSync(wasm)?'Build original skill-value WASM in isolated task artifacts first':false;
const nativeValues=skip?null:await instantiateNativeSkillValues(readFileSync(wasm));
const profile={skillCatalog:evidence.targetPassives,buffFactors:{437:{}},enums:{DAMAGE_TYPE:{DT_PHYSIC:0,DT_MAGIC:1},REACT_TYPE:{RT_CREATE_DAMAGE_EFFECT:11,RT_CREATE_EFFECT_SET:12}}};
const policy=skip?null:initializeActorPassives(profile,{nativeValues});

test('contract separates target values, original getters, later source modifications and missing consumers',()=>{
  assert.equal(evidence.targetClientMeasured,false);
  assert.equal(evidence.referenceCommit,'a8438f3ed18dd6f0944793de6c0d8bb9334e9633');
  assert.deepEqual(evidence.targetPassives.map(x=>[x.skillId,x.maxLevel]),[[24400,4],[24401,4],[24402,3],[24403,3],[24404,3],[24405,3]]);
  assert.ok(evidence.unsupported.some(x=>x.id==='explosive-critical-buff-activation'));
});
test('all six default highest passives read actual target values through original C++ methods',{skip},()=>{
  assert.deepEqual(policy.skillLevels,{24400:4,24401:4,24402:3,24403:3,24404:3,24405:3});
  assert.deepEqual(applyStatPassives({physicalAttack:2000,magicAttack:3000},policy),{physicalAttack:3000,magicAttack:4000});
  assert.equal(policy.burning.multiplier,Math.fround(1.3));
  assert.equal(policy.received.damageMultiplier,Math.fround(.76));
  assert.equal(policy.explosive.chance,Math.fround(.1));
  assert.equal(policy.explosive.buffFactorId,437); // list index 1, not level index 3
});
test('Nasod conversion requires the original eligible-state flag and AT2 gate and keeps input immutable',{skip},()=>{
  const raw={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:2.86},FORCE_DOWN:13.88,ATTACK_TYPE:2};
  const ordinary=modifyOutgoingHit(policy,{damageData:raw,stateRaw:{},targetHp:400,targetMaxHp:1000});
  assert.equal(ordinary.damageData.DAMAGE_TYPE,0);
  const converted=modifyOutgoingHit(policy,{damageData:raw,stateRaw:{BURNING_NASOD_HAND_POSSIBLE:1},targetHp:400,targetMaxHp:1000});
  assert.equal(converted.damageData.DAMAGE_TYPE,1);
  assert.equal(converted.damageData.DAMAGE.MAGIC,Math.fround(Math.fround(2.86)*Math.fround(1.3)));
  for(const ATTACK_TYPE of [0,1])assert.equal(modifyOutgoingHit(policy,{damageData:{...raw,ATTACK_TYPE},
    stateRaw:{BURNING_NASOD_HAND_POSSIBLE:1},targetHp:400,targetMaxHp:1000}).damageData.DAMAGE_TYPE,0);
  assert.deepEqual(raw,{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:2.86},FORCE_DOWN:13.88,ATTACK_TYPE:2});
});
test('target2016 victory HP gate includes equality and its KD channel is independent of target HP',{skip},()=>{
  const context={damageData:{DAMAGE:{PHYSIC:1}},targetMaxHp:1000};
  assert.equal(modifyOutgoingHit(policy,{...context,targetHp:299}).attackMultiplier,Math.fround(1.45));
  assert.equal(modifyOutgoingHit(policy,{...context,targetHp:300}).attackMultiplier,Math.fround(1.45));
  assert.equal(modifyOutgoingHit(policy,{...context,targetHp:300.0001}).attackMultiplier,1);
  assert.equal(modifyOutgoingHit(policy,{...context,targetHp:0}).attackMultiplier,1);
  assert.equal(modifyOutgoingHit(policy,{...context,targetHp:NaN}).attackMultiplier,1);
  assert.equal(modifyOutgoingHit(policy,{...context,targetHp:299}).forceDownMultiplier,Math.fround(.73));
  assert.match(policy.victory.conditionEvidence,/target2016.*321f4bcc/);
  assert.match(policy.victory.knockdownEvidence,/328bc880/);assert.equal(policy.targetClientMeasured,false);
});
test('received reduction and sourced soul EPS apply without guessing .1 MP multiplier',{skip},()=>{
  const received=modifyReceivedHit(policy,{damage:1000});
  assert.equal(received.damage,1000*Math.fround(.76));
  assert.equal(received.mpMultiplier,1);
  const charge=Math.fround(1+Math.fround(Math.fround(Math.fround(1.12)-1)+Math.fround(.00005)));
  assert.equal(received.soulMultiplier,charge);
  assert.equal(onReceivedHit(policy).soulMultiplier,charge);
  assert.equal(onReceivedHit(policy,{accepted:false}).soulMultiplier,1);
});
test('explosion uses actual CREATE name, <= float roll, impact point; BF437 activation is a separate target adapter',{skip},()=>{
  const context={damageData:{REACT_TYPE:2,CREATE_DAMAGE_EFFECT_NAME:'DamageEffect_RRF_ExplosiveHand_Impact_NEW'},impactPoint:[10,20,30]};
  const hit=onHit(policy,{...context,roll:.1});
  assert.equal(hit.additionalDamageEffect.name,'DamageEffect_RRF_ExplosiveHand_Impact_NEW');
  assert.equal(hit.additionalDamageEffect.powerRate,1);
  assert.deepEqual(hit.additionalDamageEffect.impactPoint,[10,20,30]);
  assert.deepEqual(hit.buffRequests,[]);assert.equal(hit.unsupportedBuffFactor,null);
  assert.equal(policy.explosive.buffActivationSupported,true);
  assert.equal(onHit(policy,{...context,roll:.1001}).additionalDamageEffect,null);
  assert.equal(onHit(policy,{damageData:{},roll:0}).additionalDamageEffect,null);
  assert.equal(onHit(policy,{...context,damageData:{...context.damageData,REACT_TYPE:11},roll:0}).additionalDamageEffect,null);
  assert.equal(onHit(policy,{...context,accepted:false,roll:0}).additionalDamageEffect,null);
});
test('reawakening consumes one orb/adds two levels with user-confirmed one-bead duration adaptation',{skip},()=>{
  assert.deepEqual(onAwakening(policy,{alreadyAwakened:true,orbs:2,coreGaugeMax:100}),{
    kind:'reawaken',allowed:true,orbsConsumed:1,coreGauge:40,durationOverride:null,
    addedSeconds:30*Math.fround(.7),unsupported:['Reawakening one-bead-duration/+2-level user adaptation; matching target2016 consumer unavailable']});
  assert.equal(onAwakening(policy,{alreadyAwakened:true,orbs:0}).allowed,false);
});
test('explicit empty passive list disables hooks; malformed/missing target fields fail closed',{skip},()=>{
  const off=initializeActorPassives(profile,{nativeValues,passiveIds:[]});
  assert.deepEqual(applyStatPassives({physicalAttack:1000,magicAttack:1000},off),{physicalAttack:1000,magicAttack:1000});
  assert.equal(onHit(off,{damageData:{CREATE_DAMAGE_EFFECT_NAME:'x'},roll:0}).additionalDamageEffect,null);
  assert.equal(onAwakening(off,{alreadyAwakened:true,orbs:3}).allowed,false);
  assert.throws(()=>initializeActorPassives(profile),/Original C\+\+/);
  assert.throws(()=>initializeActorPassives(profile,{nativeValues,passiveIds:[24027]}),/highest/);
  const broken=structuredClone(profile);delete broken.skillCatalog[1].raw.SA_DAMAGE_REL['4'];
  assert.throws(()=>initializeActorPassives(broken,{nativeValues}),/max level missing/);
});

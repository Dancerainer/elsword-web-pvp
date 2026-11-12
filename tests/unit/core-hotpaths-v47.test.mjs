import test from 'node:test';
import assert from 'node:assert/strict';
import {synchronizeBuffStats} from '../../packages/combat-core/passive-attributes-v20.mjs';
import {PVP_FORMULA_VERSION,usesPvpEquipmentFormulas} from '../../packages/combat-core/equipment-attributes.mjs';
import {composeEquipmentSpeedAttributes} from '../../packages/combat-core/equipment-speed-formulas.mjs';
import {stateWindows} from '../../packages/combat-core/state-windows.mjs';
import {baselineStateWindows} from '../helpers/core-hotpath-baseline-v47.mjs';

const statKeys=['mpMax','physicalAttack','magicAttack','criticalRate','criticalAttack','finalDefenceMultiplier','finalDamageMultiplierMelee','finalDamageMultiplierRange','physicalDefence','magicDefence',
  'moveSpeedMultiplier','jumpSpeedMultiplier','animationSpeedMultiplier','accuracy','avoidance','enchantAttackRate','everyAttributeDefence','hitMeleeMpMultiplier','hitRangeMpMultiplier','receivedMpMultiplier','additionalAttackPercent','forceDownMultiplierMelee','forceDownMultiplierRange'];
const actor=()=>({stats:{physicalAttack:999,mpMax:600,unrelated:17},buffBaseStats:{physicalAttack:100,mpMax:300},mpMax:600,mp:500,buffs:[]});
const row=(stat,changeType,value)=>({kind:'stat',stat,changeType,value});
const result=(fn,value)=>{try{return {value:fn(value)};}catch(error){return {error:{name:error.name,message:error.message}};}};
// Keep the v46 comparison helper immutable. The slow oracle below retains its
// per-stat traversal, with the separately recovered2016 BBT14/15 stage added.
// MISS_EVASION_2016:321de520 base1,321de7a0 temporary0/1;31fc43f0 uses last
// swap or the ordered multiplicative group. Both socket curves return zero,
// so valid additive point groups do not change these final percentages.
function sourceAccuracyOracle(actor,stat,type){
  const rows=actor.buffs.flatMap(buff=>buff.behaviors).filter(row=>row?.stat===stat||row?.type===type);
  if(rows.some(row=>row.kind!=='stat'||!Number.isInteger(row.changeType)||row.changeType<0||row.changeType>3||
    !Number.isFinite(row.value)||!Number.isFinite(Math.fround(row.value))))return undefined;
  const swaps=rows.filter(row=>row.changeType===0);if(swaps.length)return Math.fround(swaps.at(-1).value);
  let product=1;for(const row of rows.filter(row=>row.changeType===3))product=Math.fround(product*Math.fround(row.value));
  if(!(product>0))return 1;
  return Math.max(0,product>=1?Math.fround(Math.fround(product-1)+1):product);
}
function referenceSynchronizeBuffStats(actor){
  const f=Math.fround,previousMpMax=actor.stats.mpMax;
  for(const stat of statKeys){
    if(actor.buffBaseStats[stat]!==undefined)actor.stats[stat]=actor.buffBaseStats[stat];else delete actor.stats[stat];
    for(const row of actor.buffs.flatMap(buff=>buff.behaviors).filter(row=>row.kind==='stat'&&row.stat===stat)){
      if(row.changeType===0)actor.stats[stat]=row.value;
      else if(row.changeType===1)actor.stats[stat]=f((actor.stats[stat]??0)+row.value);
      else if(actor.stats[stat]!==undefined)actor.stats[stat]=f(actor.stats[stat]*row.value);
      else if(['physicalDefence','magicDefence'].includes(stat))actor.stats[stat]=0;
      else if(['finalDefenceMultiplier','finalDamageMultiplierMelee','finalDamageMultiplierRange','accuracy','avoidance','enchantAttackRate','hitMeleeMpMultiplier','hitRangeMpMultiplier','receivedMpMultiplier','forceDownMultiplierMelee','forceDownMultiplierRange'].includes(stat))actor.stats[stat]=row.value;
      else throw new TypeError('No explicit base attribute for original buff '+stat);
    }
  }
  for(const [stat,type]of [['accuracy',14],['avoidance',15]]){
    const value=sourceAccuracyOracle(actor,stat,type);if(value!==undefined)actor.stats[stat]=value;
  }
  // These numeric composers remain byte-checked against v46 by the imported
  // baseline helper. They do not provide expectations for the new source stage.
  if(usesPvpEquipmentFormulas(actor))Object.assign(actor.stats,composeEquipmentSpeedAttributes(actor.equipmentAttributes,{
    passives:actor.passivePolicy?.bladeMaster?{animationSpeedMultiplier:{multiple:actor.passivePolicy.bladeMaster.animationSpeedMultiplier}}:actor.passivePolicy?.speedPassives??{},
    modifiers:actor.buffs.flatMap(buff=>buff.behaviors).filter(row=>row.kind==='stat')}));
  if(Number.isFinite(actor.stats.mpMax)&&actor.stats.mpMax!==previousMpMax){actor.mpMax=actor.stats.mpMax;if(Number.isFinite(actor.mp))actor.mp=Math.min(actor.mp,actor.mpMax);}
  return actor.stats;
}
function compare(input){
  const before=structuredClone(input),after=structuredClone(input);
  assert.deepEqual(result(synchronizeBuffStats,after),result(referenceSynchronizeBuffStats,before));
  assert.deepEqual(after,before,'including source-stage partial state when a dependency rejects input');
  assert.deepEqual(after.buffs,input.buffs,'recomposition does not mutate Buff objects');
  return after;
}

test('all 23 Buff attributes preserve binary32, nullish, NaN, missing base and factor branches',()=>{
  for(const stat of statKeys)for(const base of [undefined,null,NaN,-0,31.123456789]){
    for(const changeType of [0,1,2,3,undefined])for(const value of [undefined,null,NaN,Infinity,-0,-1.25,.10000001]){
      const input=actor();input.buffBaseStats[stat]=base;
      input.buffs=[{behaviors:[row(stat,changeType,value)]}];compare(input);
    }
  }
});

test('ordered mixed Buff rows preserve replacement/addition/multiplication, MP clamp and unrelated stats',()=>{
  const input=actor();
  input.buffs=[{behaviors:[row('physicalAttack',1,.123456789),{kind:'stun'},row('mpMax',0,150)]},
    {behaviors:[row('physicalAttack',3,1.25),row('magicDefence',3,2),row('unknown',1,17)]},
    {behaviors:[row('physicalAttack',0,-0),row('physicalAttack',1,5),row('physicalAttack',3,.3)]}];
  const output=compare(input);
  assert.equal(output.stats.physicalAttack,Math.fround(5*.3));
  assert.equal(output.mpMax,150);assert.equal(output.mp,150);
  assert.equal(output.stats.magicDefence,0);assert.equal(output.stats.unrelated,17);
});

test('same actor sees immediate row edits, reorder, splice, Buff replacement and removal without stale buckets',()=>{
  const before=actor(),after=actor();
  const mutations=[
    a=>a.buffs=[{behaviors:[row('physicalAttack',1,10),row('physicalAttack',3,2)]}],
    a=>a.buffs[0].behaviors.reverse(),
    a=>a.buffs[0].behaviors[0].value=.5,
    a=>a.buffs[0].behaviors.splice(0,1),
    a=>a.buffs=[{behaviors:[row('physicalAttack',0,73)]}],
    a=>a.buffs=[],
    a=>{delete a.buffBaseStats.physicalAttack;},
    a=>{a.buffBaseStats.physicalAttack=111;},
  ];
  for(const mutate of mutations){mutate(before);mutate(after);
    assert.deepEqual(result(synchronizeBuffStats,after),result(referenceSynchronizeBuffStats,before));assert.deepEqual(after,before);}
  assert.equal(after.stats.physicalAttack,111);
});

test('sparse Buff/behavior arrays and malformed null rows retain previous traversal behavior',()=>{
  const sparse=actor();sparse.buffs=Array(4);sparse.buffs[2]={behaviors:Array(3)};
  sparse.buffs[2].behaviors[1]=row('physicalAttack',3,2);compare(sparse);
  for(const buffs of [[null],[{behaviors:[null]}],[{behaviors:[row('physicalAttack',3,2),undefined]}]]){
    const input=actor();input.buffs=buffs;compare(input);
  }
});

test('equipment speed recomposition preserves BM and ordinary passives, valid swaps and original rejection',()=>{
  for(const passivePolicy of [{},{bladeMaster:{animationSpeedMultiplier:1.09}},
    {speedPassives:{animationSpeedMultiplier:{sum:.07,multiple:1.1},moveSpeedMultiplier:{multiple:1.2}}}]){
    for(const modifiers of [[],[row('animationSpeedMultiplier',3,.65)],
      [row('animationSpeedMultiplier',3,1.1),row('animationSpeedMultiplier',0,1.75),row('animationSpeedMultiplier',0,1.25)],
      [row('moveSpeedMultiplier',3,1.625),row('jumpSpeedMultiplier',3,.75)],
      [row('animationSpeedMultiplier',1,2)],[row('moveSpeedMultiplier',0,2)],
      [row('animationSpeedMultiplier',3,null)],[row('animationSpeedMultiplier',3,NaN)]]){
      const input=actor();Object.assign(input,{formulaRules:{version:PVP_FORMULA_VERSION},passivePolicy,
        equipmentAttributes:{animationSpeedMultiplier:1.35,moveSpeedMultiplier:1.25,jumpSpeedMultiplier:1.25}});
      Object.assign(input.buffBaseStats,{animationSpeedMultiplier:1.35,moveSpeedMultiplier:1.125,jumpSpeedMultiplier:1.125});
      input.buffs=[{behaviors:modifiers}];compare(input);
    }
  }
});

test('source accuracy and avoidance use base1, zero socket curves, ordered multipliers and last swap',()=>{
  const input=actor();Object.assign(input.buffBaseStats,{accuracy:.4,avoidance:.2});
  assert.equal(compare(input).stats.accuracy,1);assert.equal(compare(input).stats.avoidance,1);
  input.buffs=[{behaviors:[row('accuracy',1,900),row('accuracy',2,800),row('avoidance',1,700)]}];
  assert.equal(compare(input).stats.accuracy,1);assert.equal(compare(input).stats.avoidance,1);
  input.buffs[0].behaviors.push(row('accuracy',3,.5),row('accuracy',3,.5),row('avoidance',3,.5));
  assert.equal(compare(input).stats.accuracy,.25);assert.equal(compare(input).stats.avoidance,.5);
  input.buffs[0].behaviors.push(row('accuracy',0,8),row('accuracy',0,-2),row('avoidance',0,3));
  assert.equal(compare(input).stats.accuracy,-2);assert.equal(compare(input).stats.avoidance,3);
});

const prefixes=['CAN_PASS_UNIT_TIME','CAN_PUSH_UNIT_TIME','ATTACK_TIME','CREATE_DAMAGE_EFFECT'];
test('window families keep exact/numbered matches and own enumeration order',()=>{
  for(const prefix of prefixes){
    const raw=Object.create({[prefix+'99']:'inherited'});
    for(const [suffix,value]of [['2','two'],['','exact'],['00','zero-zero'],['0','zero'],['1','one'],['-1','minus'],['1x','tail'],['１','unicode'],['_1','underscore'],['.1','decimal']])raw[prefix+suffix]=value;
    raw['unrelated'+prefix+'1']='unrelated';Object.defineProperty(raw,prefix+'3',{value:'hidden'});
    assert.deepEqual(stateWindows(raw,prefix),['two','exact','zero-zero','zero','one']);
    assert.deepEqual(stateWindows(raw,prefix),baselineStateWindows(raw,prefix));
    for(const input of [null,undefined,{},[],{[prefix]:undefined}])assert.deepEqual(stateWindows(input,prefix),baselineStateWindows(input,prefix));
  }
});

test('window reads see raw mutations immediately and return an independent result list with original value identity',()=>{
  const raw={ATTACK_TIME:{1:.1,2:.2},ATTACK_TIME2:{1:.3,2:.4}};
  const first=stateWindows(raw,'ATTACK_TIME');first.pop();assert.equal(stateWindows(raw,'ATTACK_TIME').length,2);
  raw.ATTACK_TIME={1:.8,2:.9};delete raw.ATTACK_TIME2;raw.ATTACK_TIME01=null;
  const current=stateWindows(raw,'ATTACK_TIME');assert.deepEqual(current,baselineStateWindows(raw,'ATTACK_TIME'));
  assert.equal(current[0],raw.ATTACK_TIME);assert.equal(current[1],null);
});

test('window traversal preserves enumerable getter reads and fallback prefix regex semantics',()=>{
  const reads=[];const raw={};
  Object.defineProperty(raw,'unrelated',{enumerable:true,get(){reads.push('unrelated');return 8;}});
  Object.defineProperty(raw,'ATTACK_TIME1',{enumerable:true,get(){reads.push('window');return 9;}});
  assert.deepEqual(stateWindows(raw,'ATTACK_TIME'),[9]);assert.deepEqual(reads,['unrelated','window']);
  for(const [input,prefix]of [[{CUSTOM1:3,CUSTOM:4},'CUSTOM'],[{'[':1},'['],[{'[':1,other:2},'[']]){
    assert.deepEqual(result(value=>stateWindows(value,prefix),input),result(value=>baselineStateWindows(value,prefix),input));
  }
});

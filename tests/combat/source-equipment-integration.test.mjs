import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {equipmentAttributeContext,composeEquipmentCombatStats} from '../../packages/combat-core/equipment-attributes.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
const read=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
const presets={RF:read('config/rf-preset.json'),LK:read('config/lk-preset.json')};
for(const p of Object.values(presets)){p.sourceEquipment.weaponEnhancement=11;Object.assign(p.attributes,expectedForLegacy(p));}
function expectedForLegacy(p){return p.career.includes('LORD_KNIGHT')?{hpMax:143807,physicalAttack:2376,magicAttack:1894,physicalDefence:357,magicDefence:286}:{hpMax:143807,physicalAttack:2229,magicAttack:2046,physicalDefence:349,magicDefence:293};}
for(const p of Object.values(presets))Object.assign(p.attributes,{mpMax:0,hpBonus:0,damageReduction:0,criticalRate:0,awakeningChargeBonus:0,awakeningDurationBonus:0,mpGainBonus:0,animationSpeedMultiplier:1,moveSpeedMultiplier:1,jumpSpeedMultiplier:1});
const profiles={RF:read('packages/combat-core/rf-profile.json'),LK:read('packages/combat-core/lk-profile.json')};
const nativeSkillValues=await instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values.wasm',import.meta.url)));
const map={lines:[{lineId:0,start:[-5000,0,0],end:[5000,0,0],type:'LT_NORMAL'}]};
const expected={RF:{hpMax:143807,physicalAttack:2229,magicAttack:2046,physicalDefence:349,magicDefence:293},
 LK:{hpMax:143807,physicalAttack:2376,magicAttack:1894,physicalDefence:357,magicDefence:286}};
function make(grants=false){return createSimulation({profile:profiles.RF,profiles,preset:presets.RF,presets,map,nativeSkillValues,
 actors:['RF','LK'].map((professionId,i)=>({id:professionId,professionId,team:i,position:[i*1000,0,0],lineId:0,
 ...(grants?{}:{passives:[],guildPassives:[]})}))});}

test('neutral-option source gear fixture reproduces the accepted five-stat baseline',()=>{
 const sim=make();
 for(const profession of ['RF','LK']){
  const p=presets[profession],a=sim.actor(profession);
  assert.equal(p.combatLevel,85);assert.equal(p.sourceEquipment.weaponLevel,80);
  for(const [key,value]of Object.entries(expected[profession]))assert.equal(a.stats[key],value,key);
  assert.equal(a.hp,a.hpMax);assert.equal(a.mpMax,300);assert.equal(a.equipmentAttributes.mpMax,0);
  for(const key of ['animationSpeedMultiplier','moveSpeedMultiplier','jumpSpeedMultiplier'])assert.equal(a.stats[key],1);
  assert.equal(a.stats.damageReduction,0);assert.equal(a.stats.awakeningChargeBonus,0);assert.equal(a.stats.criticalRate,0);
  const b=a.formulaRules.sourceEquipmentBaseline;
  assert.equal(b.items[0].itemId,profession==='RF'?30397:30388);
  assert.deepEqual(b.items.map(r=>r.enhancement),[11,9,9,9,9]);
  assert.equal(b.targetRuntimeVerified,false);
  assert.deepEqual(b.pvp,expected[profession]);
  assert.notEqual(a.equipmentAttributes.physicalAttack,a.stats.physicalAttack,'unscaled gear and PvP combat stats are distinct');
 }
});
test('existing profession and guild grants run in the separate PvP channels exactly once',()=>{
 const sim=make(true),rf=sim.actor('RF'),lk=sim.actor('LK'),f=Math.fround;
 assert.equal(rf.stats.physicalAttack,2339,'2229 + RF100 + guild10');
 // Independent inputs: gear2046 + RF24400 PvP100 + guild501 PvP10.
 // Target326a9860 consumes24405 Lv3 SA1.075 as a stored float32
 // delta=(SA-1)+double EPS, then adds localMagic*delta to localMagic.
 const magicBase=f(2046+100+10),magicDelta=f(f(1.075)-1+4.999999873689376e-5);
 assert.equal(rf.stats.magicAttack,f(magicBase+magicBase*magicDelta));
 assert.equal(rf.stats.physicalDefence,354);assert.equal(rf.stats.magicDefence,298);
 assert.equal(lk.stats.physicalAttack,2386);assert.equal(lk.stats.magicAttack,1904);
 assert.equal(lk.stats.physicalDefence,362);assert.equal(lk.stats.magicDefence,291);
 // LK source HP passive changes only naked153000 before .6 normalization:
 // 153000+trunc(153000*(float32(1.06)-1))=162179.
 // 33075+trunc((162179+43804-12250)*float32(.6))=149314.
 assert.equal(lk.stats.hpMax,149314);
 assert.equal(rf.stats.hpMax,143807);
 assert.deepEqual(rf.buffBaseStats,rf.stats);
});
test('source gear identity survives replay and cannot be changed via owner packets',()=>{
 const sim=make(),snapshot=sim.snapshot();sim.restore(snapshot);
 const bad=structuredClone(snapshot);bad.actors[0].formulaRules.sourceEquipmentBaseline.weaponLevel=85;
 assert.throws(()=>sim.restore(bad));
 const packet=encodeOwnedState(sim,'RF',1);
 assert.equal(JSON.stringify(packet).includes('sourceEquipmentBaseline'),false);
});
test('source configuration fails closed on stale results or unaccepted source policies',()=>{
 const p=presets.RF;
 assert.throws(()=>equipmentAttributeContext({...p,attributes:{...p.attributes,hpMax:800000}}),/Stale/);
 assert.throws(()=>equipmentAttributeContext({...p,sourceEquipment:{...p.sourceEquipment,characterPolicy:null}}),/policy/);
 assert.throws(()=>equipmentAttributeContext(p,{hpMax:NaN}),/Invalid/);
 const ctx=equipmentAttributeContext(p,{physicalAttack:500});
 assert.equal(composeEquipmentCombatStats(ctx.equipmentAttributes,ctx.formulaRules).physicalAttack,500);
 assert.equal(ctx.equipmentAttributes.physicalAttack,ctx.formulaRules.sourceEquipmentBaseline.equipment.physicalAttack);
});

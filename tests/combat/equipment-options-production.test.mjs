// Historical equipment inputs frozen at389e247; production v3 has separate coverage.
import {beforeBalanceV3} from '../helpers/equipment-balance-before-v3.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {awakeningDurationPlan} from '../../packages/combat-core/passives.mjs';
import {equipmentAttributeContext,composeEquipmentCombatStats} from '../../packages/combat-core/equipment-attributes.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const ids=['RF','LK','VC'];
const profiles=Object.fromEntries(ids.map(id=>[id,read(`packages/combat-core/${id.toLowerCase()}-profile.json`)]));
const presets=Object.fromEntries(ids.map(id=>[id,beforeBalanceV3(read(`config/${id.toLowerCase()}-preset.json`))]));
const nativeSkillValues=await instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values.wasm',import.meta.url)));
const make=(grants=false)=>createSimulation({profile:profiles.RF,profiles,preset:presets.RF,presets,nativeSkillValues,
 map:{lines:[{lineId:0,start:[-5000,0,0],end:[5000,0,0],type:'LT_NORMAL'}]},
 actors:ids.map((id,i)=>({id,professionId:id,team:i,position:[i*500,0,0],lineId:0,...(grants?{}:{passives:[],guildPassives:[]})}))});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-4,`${a} != ${b}`);

test('VC shares RF equipment options while preserving its own 2016 career and armor stats',()=>{
 const sim=make(),rf=sim.actor('RF'),vc=sim.actor('VC');
 for(const key of ['hpBonus','mpMax','criticalRate','damageReduction','mpGainBonus','awakeningChargeBonus','awakeningDurationBonus','animationSpeedMultiplier','moveSpeedMultiplier','jumpSpeedMultiplier'])assert.equal(vc.equipmentAttributes[key],rf.equipmentAttributes[key]);
 // Independent source-bytecode cases cover each item. VC anchorHP12000,
 // naked153000, enhanced gear30695 =>32400+trunc(171695*.6)=135417.
 assert.deepEqual(vc.formulaRules.sourceEquipmentBaseline.pvp,{hpMax:135417,physicalAttack:1659,magicAttack:1557,physicalDefence:356,magicDefence:303});
 assert.notEqual(vc.stats.hpMax,rf.stats.hpMax);assert.notEqual(vc.stats.physicalAttack,rf.stats.physicalAttack);
 assert.ok(vc.stats.physicalDefence>rf.stats.physicalDefence);assert.ok(vc.stats.magicDefence>rf.stats.magicDefence);
});

test('production equipment uses level85 HP points, 360MP and half a starting awakening bead',()=>{
 const sim=make();
 // 150 points * (100+15*84)=204000 rawHP; ranked channel adds122400.
 const hp={RF:264480,LK:264480,VC:257817};
 for(const id of ids){const a=sim.actor(id);assert.equal(a.hpMax,hp[id]);assert.equal(a.hp,a.hpMax);
  assert.equal(a.mpMax,360);assert.equal(a.equipmentAttributes.mpMax,60);
  assert.equal(a.awakening.gauge,50);assert.equal(a.awakening.orbs,0);assert.equal(a.awakening.remaining,0);
  assert.equal(a.stats.criticalRate,id==='LK'?40:50);assert.equal(a.stats.damageReduction,.42);
  near(a.stats.animationSpeedMultiplier,1.35);near(a.stats.moveSpeedMultiplier,id==='LK'?1.09:1.125);
  near(a.stats.jumpSpeedMultiplier,id==='LK'?1.09:1.125);
 }
 for(const a of sim.state.actors)assert.deepEqual(a.formulaRules.sourceEquipmentBaseline.items.map(i=>i.enhancement),[9,9,9,9,9]);
 const withPassives=make(true);assert.equal(withPassives.actor('LK').hpMax,269988);
 assert.equal(withPassives.actor('RF').stats.physicalAttack,1808);assert.equal(withPassives.actor('VC').stats.physicalAttack,1769);
});

test('equipment MP recovery applies to attack and received hits without changing natural recovery',()=>{
 const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},PVP_RATE:1,REACT_TYPE:1,HIT_ADD_MP:5,FORCE_DOWN:0,STOP_TIME_ATT:0,STOP_TIME_DEF:0};
 for(const id of ids){const sim=make(),a=sim.actor(id),b=sim.actor(id==='LK'?'RF':'LK');a.mp=b.mp=0;
  assert.equal(sim.applyHit(a,b,data,{kind:'character',powerMultiplier:1}).accepted,true);
  near(a.mp,5*(id==='LK'?1.30:1.33));near(b.mp,3*(b.id==='LK'?1.30:1.33));
  const mp=a.mp;sim.applyHit(a,b,data,{kind:'effect',powerMultiplier:1});near(a.mp,mp);
 }
 const sim=make();for(const a of sim.state.actors)a.mp=0;sim.step(.25,{});for(const a of sim.state.actors)near(a.mp,.25);
});

test('equipment duration composes once with profession duration; JSON continuation does not regrant gauge',()=>{
 const sim=make(true);
 for(const id of ids){const a=sim.actor(id),base=profiles[id].components.MAX_HYPER_MODE_TIME;
  a.awakening.pendingOrbs=1;a.awakening.pendingAvailableOrbs=1;sim.activateAwakening(a);
  const passive=a.passivePolicy?.awakening.enabled?a.passivePolicy.awakening.durationMultiplier:1;
  near(a.awakening.remaining,base*(id==='LK'?1:1.2)*passive);
  a.awakening.gauge=7;
 }
 const other=make(true);other.restore(JSON.parse(JSON.stringify(sim.snapshot())));
 for(const a of other.state.actors)assert.equal(a.awakening.gauge,7);
 assert.throws(()=>awakeningDurationPlan(null,{orbs:1,baseSeconds:30,equipmentDurationBonus:-.1}),/Nonnegative/);
});

test('HP option rejects unsupported range and preserves explicit actor test HP overrides',()=>{
 const p=presets.RF,ctx=equipmentAttributeContext(p,{hpMax:1234});
 assert.equal(composeEquipmentCombatStats(ctx.equipmentAttributes,ctx.formulaRules).hpMax,1234);
 assert.throws(()=>composeEquipmentCombatStats({...ctx.equipmentAttributes,hpBonus:1.6},ctx.formulaRules),/policy limit/);
 assert.throws(()=>composeEquipmentCombatStats(ctx.equipmentAttributes,{...ctx.formulaRules,equipmentOptionPolicy:undefined}),/policy limit/);
});

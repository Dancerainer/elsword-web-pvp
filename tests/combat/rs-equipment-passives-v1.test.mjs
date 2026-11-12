// Historical equipment inputs frozen at389e247; production v3 has separate coverage.
import {beforeBalanceV3} from '../helpers/equipment-balance-before-v3.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {calculateSourceEquipmentCandidate,sourceItemBase} from '../../packages/combat-core/source-equipment-base.mjs';
import {equipmentAttributeContext} from '../../packages/combat-core/equipment-attributes.mjs';
import {initializeActorPassives} from '../../packages/combat-core/passives.mjs';
import {applyTargetPassiveAttributes,synchronizeBuffStats} from '../../packages/combat-core/passive-attributes-v20.mjs';
const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url)));
const source=read('contracts/rs-attributes-source-v1.json'),evidence=read('reports/rs-equipment-evidence-v1.json');
const profiles=Object.fromEntries(['LK','RS'].map(id=>[id,read(`packages/combat-core/${id.toLowerCase()}-profile.json`)]));
const presets=Object.fromEntries(['LK','RS'].map(id=>[id,beforeBalanceV3(read(`config/${id.toLowerCase()}-preset.json`))]));
const nativeSkillValues=await instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values.wasm',import.meta.url)));
const map={sceneId:'rs-equipment-fixture',lines:[{lineId:0,start:[-5000,0,0],end:[5000,0,0],type:'LT_NORMAL'}]};
const make=(grants=true)=>createSimulation({profile:profiles.RS,profiles,preset:presets.RS,presets,nativeSkillValues,map,
 actors:['RS','LK'].map((id,i)=>({id,professionId:id,team:i,position:[i*2000,0,0],lineId:0,...(grants?{}:{passives:[],guildPassives:[]})}))});
const policy=ids=>initializeActorPassives(profiles.RS,{nativeValues:nativeSkillValues,passiveIds:ids});

test('RS gear uses original Elsword item IDs, independent RS coefficients and source-bytecode expectations',()=>{
 const result=calculateSourceEquipmentCandidate({...presets.RS.sourceEquipment,profession:'RS',level:85});
 assert.deepEqual(result.character,evidence.character);assert.deepEqual(result.equipment,evidence.equipment);
 assert.deepEqual(result.items,evidence.items);assert.deepEqual(result.pvp,evidence.basePvp);
 assert.deepEqual(result.pvp,{hpMax:128752,physicalAttack:1769,magicAttack:1561,physicalDefence:351,magicDefence:293});
 for(const row of evidence.sourceCases)assert.deepEqual(sourceItemBase('RS',row.itemId),row.expected);
 assert.throws(()=>sourceItemBase('RS',30397),/unit mismatch/);
 assert.equal(source.career.unitClass,101);assert.equal(source.career.raw.hpMax,11750);
 assert.equal(result.targetRuntimeVerified,false);assert.equal(source.originalClientRuntimeMeasurements,0);
 assert.ok(source.growthCrossCheck.differences.length>0,'V5 RS truncation differences remain visible');
});

test('RS copies every LK equipment option while preserving its own five base attributes',()=>{
 const fields=new Set(Object.keys(evidence.basePvp));
 const options=p=>Object.fromEntries(Object.entries(p.attributes).filter(([key])=>!fields.has(key)));
 assert.deepEqual(options(presets.RS),options(presets.LK));
 assert.deepEqual(presets.RS.sourceEquipment,presets.LK.sourceEquipment);
 assert.deepEqual(presets.RS.unsupportedEquipmentOptions,presets.LK.unsupportedEquipmentOptions);
 assert.deepEqual(presets.RS.guildPassives,presets.LK.guildPassives);
 for(const key of fields)assert.notEqual(presets.RS.attributes[key],presets.LK.attributes[key]);
 const a=make(false).actor('RS');
 assert.equal(a.hpMax,251152);assert.equal(a.mpMax,360);assert.equal(a.stats.criticalRate,40);
 assert.equal(a.awakening.gauge,50);assert.ok(Math.abs(a.stats.moveSpeedMultiplier-1.09)<1e-6,'18% equipment movement becomes9% after source half-increment, within float32 precision');
 const bad=structuredClone(presets.RS);bad.attributes.physicalAttack=presets.LK.attributes.physicalAttack;
 assert.throws(()=>equipmentAttributeContext(bad),/Stale source equipment PvP baseline/);
});

test('RS passive values match original class101 rows and never inherit LK or Raven benefits',()=>{
 const p=policy(presets.RS.passives);
 assert.deepEqual(p.skillLevels,{21405:4,21406:3,21407:3,21408:3,21409:3});
 for(const sid of presets.RS.passives){const row=profiles.RS.skillCatalog.find(s=>s.skillId===sid);
  assert.equal(row.maxLevel,source.passives[sid].level);assert.deepEqual(row.raw,source.passives[sid].raw);}
 assert.equal(p.stats.magicDefenceMultiplier,Math.fround(1.1),'source value, not descriptive12%');
 assert.equal(p.runeSlayer.runeSizeMultiplier,Math.fround(1.4));
 assert.equal(p.runeSlayer.runeRangeMultiplier,Math.fround(1.2004));
 assert.equal(p.runeSlayer.magicChainChance,Math.fround(.05));assert.equal(p.runeSlayer.magicChainFactorId,72);
 assert.equal(p.runeSlayer.swordEnchantChance,Math.fround(.09));assert.deepEqual(p.runeSlayer.swordEnchantFactorIds,[162,163,164]);
 assert.equal(p.stats.hpMultiplier,undefined);assert.equal(p.burning.enabled,false);assert.equal(p.awakening.canReawaken,false);
 assert.throws(()=>policy([21403]),/RS passive IDs/);assert.throws(()=>policy([24405]),/RS passive IDs/);
 assert.throws(()=>policy([21408,21408]),/unique/);
 const bad=structuredClone(profiles.RS);delete bad.skillCatalog.find(s=>s.skillId===21408).raw.SA_PROJECTILE_RANGE_REL;
 assert.throws(()=>initializeActorPassives(bad,{nativeValues:nativeSkillValues,passiveIds:[21408]}),/at max level missing/);
});

test('RS final stat channels use source integer truncation and independent physical conversion',()=>{
 const input={...evidence.isolatedPassiveCase.input,damageReduction:.42,awakeningChargeBonus:0};
 const result=applyTargetPassiveAttributes(input,policy(presets.RS.passives));
 for(const [key,value]of Object.entries(evidence.isolatedPassiveCase.expected))assert.equal(result[key],value);
 // Direct source arithmetic, independently written:1561+trunc(1561*.06)+trunc(1769*.15)=1919.
 assert.equal(applyTargetPassiveAttributes(input,policy([21405])).magicAttack,1826);
 assert.equal(applyTargetPassiveAttributes(input,policy([21408])).magicAttack,1654);
 assert.equal(applyTargetPassiveAttributes(input,policy([])).magicAttack,1561);
 assert.equal(result.physicalAttack,input.physicalAttack,'conversion adds magic; it does not deduct physical');
 const a=make().actor('RS');
 assert.equal(a.hpMax,251152);assert.equal(a.stats.physicalAttack,1779);
 assert.equal(a.stats.magicAttack,1931,'1571+94 RuneMastery+266 physical conversion');
 assert.equal(a.stats.physicalDefence,356);assert.equal(a.stats.magicDefence,327,'trunc((293+5)*float32(1.1))');
 assert.equal(a.stats.criticalRate,40);assert.equal(a.buffBaseStats.magicAttack,1931);
 synchronizeBuffStats(a);synchronizeBuffStats(a);assert.equal(a.stats.magicAttack,1931);
});

test('RS production stats and independent profession identities survive JSON restoration without reapplying passives',()=>{
 const first=make(),second=make();second.restore(JSON.parse(JSON.stringify(first.snapshot())));
 assert.deepEqual(second.snapshot(),first.snapshot());
 assert.equal(second.actor('RS').stats.magicAttack,1931);
 assert.notEqual(second.actor('RS').actorVersions.preset,second.actor('LK').actorVersions.preset);
 for(let i=0;i<5;i++){first.step(1/60,{});second.step(1/60,{});}
 assert.deepEqual(second.snapshot(),first.snapshot());
});

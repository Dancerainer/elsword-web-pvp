// Historical source arithmetic at389e247; production v3 is tested separately.
import {beforeBalanceV3} from '../helpers/equipment-balance-before-v3.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import source from '../../contracts/equipment-2016-source-v1.json' with {type:'json'};
import evidence from '../fixtures/evidence/is-equipment-bytecode-v1.json' with {type:'json'};
import raw_preset from '../../config/is-preset.json' with {type:'json'};
import raw_lk from '../../config/lk-preset.json' with {type:'json'};
import {BASE_FIELDS,sourceItemBase,calculateSourceEquipmentCandidate} from '../../packages/combat-core/source-equipment-base.mjs';
import {equipmentAttributeContext,composeEquipmentCombatStats} from '../../packages/combat-core/equipment-attributes.mjs';
const preset=beforeBalanceV3(raw_preset);
const lk=beforeBalanceV3(raw_lk);


test('IS specialization is the target2016 class row, independently of LK',()=>{
  assert.deepEqual(source.career.UC_ELSWORD_INFINITY_SWORD,
    {hpMax:12000,physicalAttack:510,magicAttack:410,physicalDefence:102,magicDefence:97});
  assert.notDeepEqual(source.career.UC_ELSWORD_INFINITY_SWORD,source.career.UC_ELSWORD_LORD_KNIGHT);
});
for(const row of evidence.cases)test(`IS item ${row.itemId} agrees with independent original bytecode`,()=>{
  assert.deepEqual(sourceItemBase('IS',row.itemId),row.expected);
});
test('IS uses Elsword sword and career-specific armor, with independently worked PvP channels',()=>{
  const b=calculateSourceEquipmentCandidate({...preset.sourceEquipment,profession:'IS',level:85});
  assert.deepEqual(b.items.map(i=>i.itemId),[30388,153795,153796,153797,153798]);
  assert.deepEqual(b.items.map(i=>i.enhancement),[9,9,9,9,9]);
  // Independent bytecode weapon PA7252, armor PA196+329. Each x1.75
  // truncates to12691+343+575=13609. Level1 anchor408, naked1211:
  // 408+trunc((1211-408)*.1)+trunc(13609*.1)=1848.
  assert.equal(b.equipment.physicalAttack,13609);
  // HP anchor12000, naked153000, per-item enhanced sum30695:
  // trunc(12000*2.7)+trunc((153000+30695-12000)*.6)=135417.
  assert.equal(b.equipment.hpMax,30695);
  assert.deepEqual(b.pvp,{hpMax:135417,physicalAttack:1848,magicAttack:1482,physicalDefence:323,magicDefence:310});
  assert.equal(b.targetRuntimeVerified,false);
  assert.throws(()=>sourceItemBase('IS',30397),/unit mismatch/);
});
test('IS equipment choices and all optional attributes exactly match LK, excluding five career bases',()=>{
  const options=p=>Object.fromEntries(Object.entries(p.attributes).filter(([k])=>!BASE_FIELDS.includes(k)));
  assert.deepEqual(options(preset),options(lk));
  assert.deepEqual(preset.sourceEquipment,lk.sourceEquipment);
  assert.deepEqual(preset.unsupportedEquipmentOptions,lk.unsupportedEquipmentOptions);
  assert.equal(preset.equipmentOptionPolicy,lk.equipmentOptionPolicy);
  assert.equal(preset.combatLevel,85);
  assert.equal(preset.initialAwakeningGauge,50);
  assert.equal(preset.ravenCoreEnabled,false);
  assert.equal(preset.awakeningEnabled,true);
});
test('IS equipment context recomputes own baseline, applies HP points once, and rejects LK bases',()=>{
  const context=equipmentAttributeContext(preset);
  assert.equal(context.formulaRules.sourceEquipmentBaseline.profession,'IS');
  const stats=composeEquipmentCombatStats(context.equipmentAttributes,context.formulaRules);
  assert.equal(stats.hpMax,257817); // +150 points x1360 x.6 =122400
  assert.equal(stats.mpMax,360);
  assert.equal(stats.physicalAttack,1848);
  assert.equal(stats.magicAttack,1482);
  assert.equal(stats.criticalRate,40);
  assert.throws(()=>equipmentAttributeContext({...preset,attributes:lk.attributes}),/Stale source equipment/);
});

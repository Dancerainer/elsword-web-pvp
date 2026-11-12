// Historical source arithmetic at389e247; production v3 is tested separately.
import {beforeBalanceV3} from '../helpers/equipment-balance-before-v3.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import raw_bm from '../../config/bm-preset.json' with {type:'json'};
import raw_lk from '../../config/lk-preset.json' with {type:'json'};
import raw_vc from '../../config/vc-preset.json' with {type:'json'};
import source from '../../contracts/equipment-2016-source-v1.json' with {type:'json'};
import evidence from '../fixtures/evidence/equipment-2016-formula-evidence-v1.json' with {type:'json'};
import {BASE_FIELDS,calculateSourceEquipmentCandidate,inferCharacterBase,sourceItemBase} from '../../packages/combat-core/source-equipment-base.mjs';
import {equipmentAttributeContext,composeEquipmentCombatStats} from '../../packages/combat-core/equipment-attributes.mjs';
const bm=beforeBalanceV3(raw_bm);
const lk=beforeBalanceV3(raw_lk);
const vc=beforeBalanceV3(raw_vc);


const options={...bm.sourceEquipment,profession:'BM',level:85};
const base={hpMax:148744,physicalAttack:1738,magicAttack:1479,physicalDefence:356,magicDefence:286};
const nonBase=attributes=>Object.fromEntries(Object.entries(attributes).filter(([key])=>!BASE_FIELDS.includes(key)));

test('BM uses its own target2016 career specialization and Raven growth',()=>{
  assert.deepEqual(source.career.UC_RAVEN_BLADE_MASTER,
    {hpMax:12500,physicalAttack:480,magicAttack:410,physicalDefence:112,magicDefence:90});
  assert.deepEqual(inferCharacterBase('BM',85,bm.sourceEquipment.characterPolicy),{
    levelOne:{hpMax:12500,physicalAttack:384,magicAttack:328,physicalDefence:90,magicDefence:72},
    naked:{hpMax:153000,physicalAttack:1157,magicAttack:1022,physicalDefence:277,magicDefence:223},
  });
  const oracle=evidence.cases.filter(row=>row.profession==='BM');
  assert.equal(oracle.length,6);
  for(const row of oracle)assert.deepEqual(sourceItemBase('BM',row.itemId),row.expected);
  assert.throws(()=>sourceItemBase('BM',30388),/unit mismatch/);
});

test('BM +9 gear has independently worked PvP channels and separate per-item truncation',()=>{
  const result=calculateSourceEquipmentCandidate(options);
  assert.deepEqual(result.items.map(item=>item.itemId),[30397,153795,153796,153797,153798]);
  assert.deepEqual(result.items.map(item=>item.enhancement),[9,9,9,9,9]);
  // From six independent source-bytecode item cases, with float32 +9=1.75
  // truncation per item: HP7871+16724+14336+5059+7168=51158.
  assert.deepEqual(result.equipment,{hpMax:51158,physicalAttack:12770,magicAttack:10827,physicalDefence:2489,magicDefence:1999});
  // HP33750+trunc((153000+51158-12500)*float32(.6))=148744.
  // Physical384+trunc((1157-384)*.1)+trunc(12770*.1)=1738.
  // Magic328+69+1082=1479; defence90+18+248=356,72+15+199=286.
  assert.deepEqual(result.pvp,base);
  assert.deepEqual(Object.fromEntries(BASE_FIELDS.map(key=>[key,bm.attributes[key]])),base);
  assert.equal(result.targetRuntimeVerified,false);
  assert.notDeepEqual(result.pvp,calculateSourceEquipmentCandidate({...options,profession:'LK'}).pvp);
});

test('BM reuses every user-selected VC equipment option without inheriting another career base or passives',()=>{
  assert.deepEqual(nonBase(bm.attributes),nonBase(vc.attributes));
  assert.deepEqual(bm.sourceEquipment,vc.sourceEquipment);
  assert.deepEqual(bm.unsupportedEquipmentOptions,vc.unsupportedEquipmentOptions);
  assert.equal(bm.equipmentOptionPolicy,vc.equipmentOptionPolicy);
  assert.deepEqual(bm.guildPassives,vc.guildPassives);
  assert.deepEqual(bm.passives,[24406,24400,24407,24408,24409,24410]);
  assert.equal(bm.career,'UC_RAVEN_BLADE_MASTER');
  assert.equal(bm.ravenCoreEnabled,true);
  assert.equal(bm.awakeningEnabled,true);
  assert.equal(bm.initialAwakeningGauge,50);
  const context=equipmentAttributeContext(bm);
  const actual=composeEquipmentCombatStats(context.equipmentAttributes,context.formulaRules);
  // The same +150% HP option adds 122400 HP; final profession/guild
  // passives are intentionally composed later by the shared simulation.
  assert.equal(actual.hpMax,271144);
  assert.equal(actual.mpMax,360);
  assert.equal(actual.criticalRate,50);
  assert.equal(actual.skillDamageBonus,.2);
  assert.equal(actual.mpGainBonus,.33);
  assert.equal(actual.awakeningChargeBonus,.5);
  assert.equal(actual.awakeningDurationBonus,.2);
  assert.deepEqual(context.formulaRules.sourceEquipmentBaseline.pvp,base);
});

test('BM rejects a copied LK or stale five-stat baseline and unapproved source policy',()=>{
  assert.throws(()=>equipmentAttributeContext({...bm,attributes:lk.attributes}),/Stale/);
  assert.throws(()=>equipmentAttributeContext({...bm,attributes:{...bm.attributes,physicalAttack:1739}}),/Stale/);
  assert.throws(()=>equipmentAttributeContext({...bm,sourceEquipment:{...bm.sourceEquipment,characterPolicy:null}}),/policy/);
  assert.throws(()=>equipmentAttributeContext({...bm,sourceEquipment:{...bm.sourceEquipment,referencePolicy:null}}),/policy/);
});

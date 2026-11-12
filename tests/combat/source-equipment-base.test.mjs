import test from 'node:test';
import assert from 'node:assert/strict';
import evidence from '../fixtures/evidence/equipment-2016-formula-evidence-v1.json' with {type:'json'};
import {sourceItemBase,calculateSourceEquipmentCandidate,INFERRED_CHARACTER_POLICY,
  EQUIPMENT_REFERENCE_POLICY} from '../../packages/combat-core/source-equipment-base.mjs';

const options={characterPolicy:INFERRED_CHARACTER_POLICY,referencePolicy:EQUIPMENT_REFERENCE_POLICY,weaponLevel:85};
for(const row of evidence.cases)test(`${row.profession} item ${row.itemId} matches independent target bytecode`,()=>{
  assert.deepEqual(sourceItemBase(row.profession,row.itemId),row.expected);
});
test('source candidates require explicit evidence policies and weapon level',()=>{
  assert.throws(()=>calculateSourceEquipmentCandidate({profession:'RF'}),/reference policy/);
  assert.throws(()=>calculateSourceEquipmentCandidate({profession:'RF',...options,characterPolicy:undefined}),/character policy/);
  assert.throws(()=>calculateSourceEquipmentCandidate({profession:'RF',...options,weaponLevel:undefined}),/weapon level/);
  assert.throws(()=>calculateSourceEquipmentCandidate({profession:'UNKNOWN',...options}),/profession/);
  assert.throws(()=>calculateSourceEquipmentCandidate({profession:'RF',...options,level:90}),/level85/);
  assert.throws(()=>sourceItemBase('RF',30507),/unit mismatch/);
  assert.throws(()=>sourceItemBase('RF',1),/Unsupported/);
});
test('V5 integer enhancement and ranked PvP channels match a manual worked case',()=>{
  // Source-bytecode RF weapon attack6938; float32 2.55 =>17691 after truncation.
  // Armor adds313+526 =>18530. Naked growth candidate1157, level1 anchor376.
  // 376 + trunc((1157-376)*.1) + trunc(18530*.1) =2307.
  const rf=calculateSourceEquipmentCandidate({profession:'RF',...options});
  assert.equal(rf.items[0].enhanced.physicalAttack,17691);
  assert.equal(rf.equipment.physicalAttack,18530);
  assert.deepEqual(rf.pvp,{hpMax:144129,physicalAttack:2307,magicAttack:2117,physicalDefence:349,magicDefence:293});
  // HP: trunc(12250*2.7)+trunc((153000+44340-12250)*.6)=144129.
  assert.equal(rf.equipment.hpMax,44340);
  assert.equal(rf.targetRuntimeVerified,false);
  assert.deepEqual(calculateSourceEquipmentCandidate({profession:'LK',...options}).pvp,
    {hpMax:144129,physicalAttack:2459,magicAttack:1960,physicalDefence:357,magicDefence:286});
});
test('80 and85 weapon records remain distinct; armor stays level80 +9',()=>{
  const low=calculateSourceEquipmentCandidate({profession:'RF',...options,weaponLevel:80});
  const high=calculateSourceEquipmentCandidate({profession:'RF',...options});
  assert.equal(low.items[0].itemId,30397);assert.equal(high.items[0].itemId,30516);
  assert.ok(low.pvp.physicalAttack<high.pvp.physicalAttack);
  assert.deepEqual(low.items.slice(1),high.items.slice(1));
  assert.equal(high.items[1].enhanced.hpMax,13380); // truncate each item, then sum
});

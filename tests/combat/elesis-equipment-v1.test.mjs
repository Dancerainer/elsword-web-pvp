import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import evidence from '../fixtures/evidence/elesis-equipment-evidence-v1.json' with {type:'json'};
import {BASE_FIELDS,sourceItemBase,calculateSourceEquipmentCandidate} from '../../packages/combat-core/source-equipment-base.mjs';
import {equipmentAttributeContext} from '../../packages/combat-core/equipment-attributes.mjs';

const json=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
for(const row of evidence.cases){
  test(row.profession+' base stats match independent original-bytecode and PvP arithmetic',()=>{
    const preset=json('config/'+row.profession.toLowerCase()+'-preset.json');
    const actual=calculateSourceEquipmentCandidate({...preset.sourceEquipment,profession:row.profession,level:85});
    assert.deepEqual(actual.pvp,row.basePvp);
    assert.deepEqual(actual.character,row.character);
    assert.deepEqual(actual.equipment,row.equipment);
    for(const item of row.items)assert.deepEqual(sourceItemBase(row.profession,item.itemId),item.base);
    assert.deepEqual(equipmentAttributeContext(preset).formulaRules.sourceEquipmentBaseline.pvp,row.basePvp);
    assert.throws(()=>sourceItemBase(row.profession,30388),/unit mismatch/);
    assert.equal(actual.items[0].itemId,30409);
    assert.equal(calculateSourceEquipmentCandidate({...preset.sourceEquipment,profession:row.profession,level:85,weaponLevel:85}).items[0].itemId,30528);
  });
}
for(const [id,reference]of [['GM','LK'],['BH','RS'],['CA','IS']])test(id+' inherits the entire '+reference+' equipment option set independently of class bases',()=>{
  const preset=json('config/'+id.toLowerCase()+'-preset.json'),original=json('config/'+reference.toLowerCase()+'-preset.json');
  const options=p=>Object.fromEntries(Object.entries(p.attributes).filter(([key])=>!BASE_FIELDS.includes(key)));
  assert.deepEqual(options(preset),options(original));
  assert.deepEqual(preset.sourceEquipment,original.sourceEquipment);
  assert.notEqual(preset.career,original.career);
  assert.ok(preset.passives.every(id=>id>=28400&&id<=28414));
  assert.equal(preset.ravenCoreEnabled,false);
});

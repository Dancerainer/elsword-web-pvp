import test from 'node:test';import assert from 'node:assert/strict';
import {sourceSkillPowerDelta} from '../../packages/combat-core/skill-socket-power-2016.mjs';
import {addMoonlightPowerFor} from '../../packages/combat-core/add-moonlight-receipts-v45.mjs';
const profile={skillCatalog:[{skillId:29024,raw:{m_eType:15}},{skillId:29026,raw:{m_DeleteSkillIDByUpgrade:29000}}]};
test('2016 per-skill socket lookup has exact key,0 default and only one missing-key predecessor fallback',()=>{
 const a={equipmentAttributes:{skillPowerDeltas:{29000:.2,29026:.4,29025:99}}};assert.equal(sourceSkillPowerDelta(a,profile,29026),.4);delete a.equipmentAttributes.skillPowerDeltas[29026];assert.equal(sourceSkillPowerDelta(a,profile,29026),.2);assert.equal(sourceSkillPowerDelta(a,profile,29024),0);
});
test('Moonlight base×(1+delta) does not borrow current attack power, generic bonus or an extra Hyper10percent',()=>{
 const a={skillScale:18,equipmentAttributes:{skillPowerDeltas:{29024:.25},skillDamageBonus:.7},awakening:{remaining:1}},sim={profileFor:()=>profile};assert.deepEqual(addMoonlightPowerFor(sim,a),{power:1.25,hyperMode:true});a.equipmentAttributes.skillPowerDeltas={};assert.equal(addMoonlightPowerFor(sim,a).power,1);
});

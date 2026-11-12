import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAX_OWNER_EFFECT_STAGE} from '../../packages/online/owned-state.mjs';
// Independent source-profile review: CA Dread Weapon is the sole NEXT3;
// Raven Shockwave and Add declarations also retain their known NEXT2 stages.
const maximum={RF:1,LK:1,VC:1,RS:1,BM:2,IS:1,GM:1,BH:2,CA:3,LP:2,MM:2,DE:2};
for(const [id,expected]of Object.entries(maximum))test(`${id} every declared damage table fits the bounded owner stage contract`,()=>{
  const p=JSON.parse(readFileSync(new URL(`../../packages/combat-core/${id.toLowerCase()}-profile.json`,import.meta.url)));
  let maximumStage=0;
  for(const [name,row]of Object.entries(p.damageEffects))for(const key of Object.keys(row.raw).filter(k=>/^DAMAGE_DATA_NEXT\d*$/.test(k))){
    const stage=Number(key.slice('DAMAGE_DATA_NEXT'.length)||1);maximumStage=Math.max(maximumStage,stage);
    assert.ok(stage<=MAX_OWNER_EFFECT_STAGE,`${name}.${key} requires an explicit protocol/schema review`);
    assert.ok(row.raw[key]&&typeof row.raw[key]==='object'&&!Array.isArray(row.raw[key]),`${name}.${key} must have a real declared table`);
    if(stage>1)assert.ok(row.raw[stage===2?'DAMAGE_DATA_NEXT':`DAMAGE_DATA_NEXT${stage-1}`],`${name}.${key} cannot skip its predecessor`);
  }
  assert.equal(maximumStage,expected);
});

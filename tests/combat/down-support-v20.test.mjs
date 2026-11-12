import test from 'node:test';
import assert from 'node:assert/strict';
import {downSupportReaction} from '../../packages/combat-core/down-support.mjs';

test('Raven down callbacks immediately release an unsupported foot, without a height or end-time threshold',()=>{
  for(const state of ['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK']){
    assert.deepEqual(downSupportReaction(state,{grounded:false,lineRadius:30}),{state:'RSI_DAMAGE_AIR_FALL',offsetY:-45});
    assert.equal(downSupportReaction(state,{grounded:true,lineRadius:30}),null);
  }
});
test('air-down, invincible mana-break down, landing and death never reuse the ground-down support branch',()=>{
  for(const state of ['RSI_DAMAGE_AIR_DOWN','RSI_DAMAGE_AIR_DOWN_INVINCIBLE','RSI_DAMAGE_AIR_DOWN_LANDING','RSI_DIE_FRONT','RSI_DAMAGE_STANDUP_FRONT'])
    assert.equal(downSupportReaction(state,{grounded:false,lineRadius:30}),null);
  assert.throws(()=>downSupportReaction('RSI_DAMAGE_DOWN_FRONT',{grounded:false,lineRadius:NaN}));
});

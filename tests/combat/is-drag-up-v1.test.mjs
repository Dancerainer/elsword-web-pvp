import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {selectHitReaction,nextFlyCount} from '../../packages/combat-core/reaction-policy.mjs';

test('Rage Cutter target DRAG_UP is the pinned full-speed AIR_FLY consumer',()=>{
  const source=readFileSync(new URL('../../.cache/native-reference/X2Lib/X2GUUser.cpp',import.meta.url));
  // Whole-file identity is independent of the JavaScript port and test result.
  assert.equal(createHash('sha256').update(source).digest('hex'),'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38');
  const text=source.toString('latin1'),start=text.indexOf('case CX2DamageManager::RT_DRAG_UP:',text.indexOf('case CX2DamageManager::RT_DRAG_UP:')+1);
  const block=text.slice(start,text.indexOf('case CX2DamageManager::RT_REVENGE:',start));
  assert.match(block,/nowSpeed\.y = pDamageData->backSpeed\.y;/);assert.match(block,/ResetOnSomethingFuture\(\)/);
  assert.match(block,/USI_DAMAGE_AIR_FLY_FRONT/);assert.match(block,/USI_DAMAGE_AIR_FLY_BACK/);assert.doesNotMatch(block,/m_FlyCount/);
  const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/is-profile.json',import.meta.url)));
  const data=profile.damageEffects.ELSWORD_SA_RAGECUTTER_HIT_M02.raw.DAMAGE_DATA;
  assert.equal(data.REACT_TYPE,16);
  for(const fromFront of [true,false])for(const grounded of [true,false])for(const flyCount of [0,1,3,8]){
    const r=selectHitReaction(data,{fromFront,grounded,flyCount,localVx:17,vy:31});
    assert.equal(r.supported,true);assert.equal(r.state,'RSI_DAMAGE_AIR_FLY_'+(fromFront?'FRONT':'BACK'));
    assert.equal(r.grounded,false);assert.equal(r.vy,data.BACK_SPEED_Y);
    assert.equal(data.FORCE_FLY,1);assert.equal(nextFlyCount(flyCount,data),0);
    assert.equal(nextFlyCount(flyCount,{...data,FORCE_FLY:false}),flyCount+1);
  }
  const armored=selectHitReaction(data,{superArmor:true,grounded:true,localVx:17,vy:31});
  assert.equal(armored.state,null);assert.equal(armored.vy,31);assert.equal(armored.grounded,true);
});

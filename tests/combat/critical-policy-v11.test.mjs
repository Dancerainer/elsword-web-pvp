import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {instantiateNativeCritical} from '../../packages/native-source/critical.mjs';
import {evaluateHitCritical} from '../../packages/combat-core/critical-hit.mjs';
const native=await instantiateNativeCritical(readFileSync(new URL('../../artifacts/native/critical.wasm',import.meta.url)));
const actor={stats:{}};
test('2016 Maximized consumer requests source critical rate, Critical defence consumer does not',()=>{
  const values={attacker:actor,defender:actor,data:{DAMAGE_TYPE:0},roll:.75,headPosition:[2,3,4]};
  const maximal=evaluateHitCritical(native,{...values,traitPolicy:{forceCritical:true}});
  assert.equal(maximal.critical,true);assert.equal(maximal.amount,1.5);assert.deepEqual(maximal.effectPosition,[2,133,4]);
  assert.equal(evaluateHitCritical(native,{...values,traitPolicy:{ignoreDefence:true}}).critical,false);
  assert.equal(evaluateHitCritical(native,{...values,data:{DAMAGE_TYPE:0,CRITICAL_RATE:1}}).critical,true);
});
test('host critical adapter keeps magic additions separate and does not invent a missing native calculation',()=>{
  assert.equal(evaluateHitCritical(null,{}),null);
  const values={attacker:{stats:{magicCriticalRate:1,magicCriticalDamage:.5}},defender:actor,roll:.5};
  assert.equal(evaluateHitCritical(native,{...values,data:{DAMAGE_TYPE:1}}).amount,2);
  assert.equal(evaluateHitCritical(native,{...values,data:{DAMAGE_TYPE:0}}).critical,false);
});

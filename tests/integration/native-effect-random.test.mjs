import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {instantiateNativeEffectRandom,createNativeEffectRandomBridge} from '../../packages/native-source/effect-random.mjs';

const path=process.env.RF_EFFECT_RANDOM_WASM??new URL('../../artifacts/native/effect-random/effect-random-source.wasm',import.meta.url);
const native=await instantiateNativeEffectRandom(readFileSync(path));
const f32=Math.fround;

test('original float source accepts descending range, preserves first bound and both rand endpoints',()=>{
  assert.equal(native.randomFloat(.7,.5,0),f32(.7));assert.equal(native.drawsUsed,1);
  assert.equal(native.randomFloat(.7,.5,32767),f32(.9));
  assert.equal(native.randomFloat(0,-90,32767),90);
  assert.equal(native.randomFloat(-2,3,0),-2);
  assert.equal(native.randomFloat(-2,3,32767),3);
  for(const [min,max] of [[.7,.5],[-90,0],[90,0],[1.25,-2.5]])for(const rand of [1,1234,16384,32766]){
    const expected=f32(f32(f32(rand/32767)*Math.abs(f32(f32(max)-f32(min))))+f32(min));
    assert.equal(native.randomFloat(min,max,rand),expected,'binary32 operations from independently read source');
  }
});
test('original int overload keeps modulo and descending first bound',()=>{
  assert.equal(native.randomInt(7,2,0),7);
  assert.equal(native.randomInt(7,2,5),12);
  assert.equal(native.randomInt(7,2,6),7);
  assert.equal(native.randomInt(-2,3,5),3);
  assert.equal(native.randomInt(7,2,32767),8);
  assert.equal(native.drawsUsed,1);
});
test('original equal bound branches return before rand for float and integer',()=>{
  assert.equal(native.randomFloat(.5,.5,32767),.5);assert.equal(native.drawsUsed,0);
  assert.equal(native.randomInt(-7,-7,32767),-7);assert.equal(native.drawsUsed,0);
});
test('bridge rejects unsafe ABI inputs instead of causing source undefined behavior',()=>{
  for(const value of [-1,32768,.5,NaN])assert.throws(()=>native.randomFloat(0,1,value));
  assert.throws(()=>native.randomFloat(NaN,1,0));
  assert.throws(()=>native.randomFloat(3e38,-3e38,0));
  assert.throws(()=>native.randomInt(-2147483648,2147483647,0));
  assert.throws(()=>native.randomInt(2147483647,2147483646,0));
  assert.throws(()=>native.randomInt(1.5,3,0));
  assert.throws(()=>createNativeEffectRandomBridge({}));
});

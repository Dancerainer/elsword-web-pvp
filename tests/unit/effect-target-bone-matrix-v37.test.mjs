import test from 'node:test';
import assert from 'node:assert/strict';
import {writeNativeEffectBoneMatrix,writeNativeEffectBonePlaneMatrix} from '../../apps/web/native-effect-bone-matrix.mjs';
import {compose,multiply} from '../../tools/assets/character/sample_pose.mjs';
import {nativeEffectQuaternion} from '../../packages/combat-assets/effect-transform.mjs';
const near=(actual,expected)=>actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-10,`${actual} != ${expected}`));
test('target BT_NONE plane retains bone shear/translation and applies local Size*Rotate before one unit/reflection conversion',()=>{
 const bone=[1,.2,.3,0, .4,2,.5,0, .6,.7,3,0, 100,200,-300,1],before=[...bone];
 for(const degrees of [[0,0,0],[90,0,0],[-20,30,-70],[40,180,10]]){
  const size=[950,750,1],scale=[1.5,1.25,1],local=compose([0,0,0],size.map((n,i)=>n*scale[i]),nativeEffectQuaternion(degrees));
  const originalWorld=multiply(bone,local),expected=writeNativeEffectBoneMatrix(originalWorld,Array(16));
  const actual=writeNativeEffectBonePlaneMatrix(bone,Array(16),size,scale,degrees);near(actual,expected);
  assert.deepEqual(actual.slice(12),[1,2,3,1]);
 }
 assert.deepEqual(bone,before,'display conversion never mutates the source bone');
});
test('target plane source matrix/rotation validation rejects absent and nonfinite source inputs',()=>{
 const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 for(const bad of [null,[],identity.map((n,i)=>i===4?NaN:n)])assert.throws(()=>writeNativeEffectBonePlaneMatrix(bad,[]));
 assert.throws(()=>writeNativeEffectBonePlaneMatrix(identity,[],[1,1,1],[1,1,1],[0,Infinity,0]));
});

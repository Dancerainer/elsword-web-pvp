import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {instantiateNativeSkills} from '../../packages/native-source/skills.mjs';
const bytes=await readFile(new URL('../../artifacts/native/skills.wasm',import.meta.url));
const bridge=await instantiateNativeSkills(bytes);
const input={kind:69,time:1.166,before:1.15,dt:1/60,hp:800000,hpMax:800000,power:1,awakening:0,
  position:[90,200,30],rotation:[0,0,0],direction:[1,0,0],landY:200,isRight:true,memo:false,
  xCrash:{bonePosition:[101,223,37],savedPosition:[0,0,0],hyperState:false}};

test('original XCrash .1.166 Bip01 capture persists and .1.31 creation uses saved bone, not current character center',()=>{
  const before=bridge.evaluate({...input,time:1.165});assert.deepEqual(before.xCrash.savedPosition,[0,0,0]);
  const capture=bridge.evaluate(input);assert.deepEqual(capture.xCrash.savedPosition,[101,223,37]);assert.deepEqual(capture.commands,[]);
  const later={...input,time:1.31,before:1.3,oneshot:1.3,position:[800,400,90],
    xCrash:{bonePosition:[810,410,95],savedPosition:capture.xCrash.savedPosition,hyperState:false}};
  const explosion=bridge.evaluate(later);assert.equal(explosion.commands.length,1);
  const c=explosion.commands[0];assert.equal(c.name,'RRF_X_CRASH_NODAMAGE');assert.deepEqual(c.position,[101,223,37]);
  assert.deepEqual(c.rotation,[0,0,0]);assert.equal(c.threshold,Math.fround(1.31));
  assert.equal(explosion.disabledPresentationCalls.cutIn,1);assert.equal(explosion.disabledPresentationCalls.worldColor,1);
  assert.deepEqual(bridge.evaluate({...later,before:1.31,oneshot:1.31,time:1.34}).commands,[]);
});

test('original XCrash selects hyper name and preserves reverse rotation and source power',()=>{
  const r=bridge.evaluate({...input,time:1.31,before:1.3,oneshot:1.3,awakening:20,power:1.2,
    rotation:[0,180,0],isRight:false,xCrash:{...input.xCrash,savedPosition:[101,223,37],hyperState:true}});
  assert.equal(r.commands[0].name,'RRF_X_CRASH_NODAMAGE_HYPER');assert.deepEqual(r.commands[0].rotation,[0,180,0]);
  assert.equal(r.commands[0].power,Math.fround(1.2));
  const expired=bridge.evaluate({...input,time:1.31,before:1.3,oneshot:1.3,awakening:0,
    xCrash:{...input.xCrash,hyperState:true}});
  assert.equal(expired.commands[0].name,'RRF_X_CRASH_NODAMAGE_HYPER','registered state survives awakening expiry');
  assert.equal(bridge.evaluate({...input,time:1.31,before:1.3,oneshot:1.3,awakening:20}).commands[0].name,'RRF_X_CRASH_NODAMAGE');
});

test('XCrash requires actual finite bone/persistent fields and safely interleaves native state',async()=>{
  assert.throws(()=>bridge.evaluate({...input,xCrash:undefined}),/Explicit XCrash/);
  assert.throws(()=>bridge.evaluate({...input,xCrash:{...input.xCrash,hyperState:undefined}}),/registered Hyper/);
  assert.throws(()=>bridge.evaluate({...input,xCrash:{...input.xCrash,bonePosition:[1,2]}}),/three-component/);
  assert.throws(()=>bridge.evaluate({...input,xCrash:{...input.xCrash,savedPosition:[NaN,0,0]}}),/finite/);
  const second=await instantiateNativeSkills(bytes),expected=bridge.evaluate(input);
  second.evaluate({...input,xCrash:{bonePosition:[-1,-2,-3],savedPosition:[-10,-20,-30],hyperState:false}});
  assert.deepEqual(bridge.evaluate(input),expected);
});

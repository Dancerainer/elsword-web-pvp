import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import {createNativeCommands} from '../../packages/native-source/commands.mjs';

// Independently selected equations from fixed a8438f3 C++ bodies, not a recorded
// 2016-client trace or implementation-generated golden snapshot. These probe
// only the speed getter/constant boundary before the host's common physics.
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url),'utf8'));
const wasmPath=process.env.RF_NATIVE_COMMANDS_WASM??new URL('../../artifacts/native/commands/commands.wasm',import.meta.url);
const missing=!existsSync(wasmPath),f=Math.fround;
const actor=(state,extra={})=>({state,animationTime:0,animationBeforeTime:0,animationOneshotTimer:0,
  animationStopped:false,sourceCommandFlags:0,vx:1000,vy:0,passiveSpeed:{x:-1,y:-1},
  facing:1,grounded:false,y:1000,canNotJumpTime:0,...extra});

// The second actor represents final movement +30% and final jump +21%, with
// neutral speed Buff/passive/run-jump-rate factors. The fixed V5 additional-stat
// consumer applies 0.5 to those option percentages, yielding 1.15 and 1.105.
const fixtures=[
  {label:'neutral',move:1,jump:1,walk:500},
  {label:'move30/jump21',move:f(1.15),jump:f(1.105),walk:575},
];
for(const fixture of fixtures){
  const {walk}=fixture;
  const cases=[
    {name:'ZZXX .35 reads unit current Walk',state:'RSI_COMBO_ZZXX',source:'X2GURaven.cpp:8372-8384',
      extra:{animationTime:.35,animationBeforeTime:.34},expected:{vx:walk}},
    {name:'ZZZZ .6 reads unit current Walk times1.3f',state:'RSI_COMBO_ZZZZ',source:'X2GURaven.cpp:8003-8015',
      extra:{animationTime:.6,animationBeforeTime:.59},expected:{vx:f(f(walk)*f(1.3))}},
    {name:'8X Down and Up uses current Walk and extraG',state:'RSI_JUMP_COMBO_X',source:'X2GURaven.cpp:9022-9040',
      input:{held:['RIGHT','DOWN','UP']},expected:{vx:walk,vy:-40,flags:1}},
    {name:'8Z Up suppresses Down extraG',state:'RSI_JUMP_COMBO_Z',source:'X2GURaven.cpp:8972-8990',
      input:{held:['RIGHT','DOWN','UP']},expected:{vx:walk,vy:0,flags:0}},
    {name:'668X .27 sets literal1200 independent of attributes',state:'RRF_DASH_JUMP_COMBO_X',source:'X2GURaven.cpp:15752-15768',
      extra:{animationTime:.27},expected:{vy:1200}},
    {name:'668XX .53 clamps descent to literal0',state:'RRF_DASH_JUMP_COMBO_XX',source:'X2GURaven.cpp:15856-15864',
      extra:{animationTime:.53,vy:-400},expected:{vy:0}},
    {name:'668ZZ .23 sets physical MaxG divided by2',state:'RSI_DASH_JUMP_COMBO_ZZ',source:'X2GURaven.cpp:8815-8826',
      extra:{animationTime:.23,animationBeforeTime:.22},expected:{vy:-1000}},
    {name:'668ZX .267 sets literal diagonal passive speed',state:'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX',source:'X2GURaven.cpp:11603-11616',
      extra:{animationTime:.267,animationBeforeTime:.266},expected:{vx:0,vy:0,passiveSpeed:{x:2200,y:-2640}}},
    {name:'ZZ6XX firstX .29 preserves declared1250 slide',state:'RRF_COMBO_ZZXFRONTX',source:'X2GURaven.cpp:15928-15941 plus target2016 PASSIVE_SPEED_X1250',
      extra:{animationTime:.29,vx:1250,passiveSpeed:{x:1250,y:0}},expected:{vx:1250,passiveSpeed:{x:1250,y:0}}},
    {name:'ZZ6XX firstX .34 clears current and passiveX',state:'RRF_COMBO_ZZXFRONTX',source:'X2GURaven.cpp:15928-15941',
      extra:{animationTime:.34,vx:1250,passiveSpeed:{x:1250,y:0}},expected:{vx:0,passiveSpeed:{x:0,y:0}}},
    {name:'AirSmall Start uses current Walk times0.33f and literal700Y',state:'RSI_DAMAGE_AIR_SMALL',phase:'Start',source:'X2GUUser.cpp:25842-25855',
      expected:{vx:f(f(1000)-f(f(walk)*f(.33))),vy:700}},
  ];
  for(const example of cases)test(`${fixture.label}: ${example.name}`,{skip:missing?'Build fixed-source commands WASM or set RF_NATIVE_COMMANDS_WASM':false},async()=>{
    assert.equal(profile.physics.WALK_SPEED,500,'Probe fixture requires the pinned target base Walk');
    assert.equal(profile.physics.G_ACCEL,4000);assert.equal(profile.physics.MAX_G_SPEED,-2000);
    const native=await createNativeCommands({bytes:readFileSync(wasmPath)});
    assert.equal(native.contract.referenceCommit,'a8438f3ed18dd6f0944793de6c0d8bb9334e9633');
    assert.equal(native.contract.targetClientMeasured,false);
    const a=actor(example.state,{...example.extra,stats:{moveSpeedMultiplier:fixture.move,jumpSpeedMultiplier:fixture.jump}});
    const actual=example.phase==='Start'?native.runStart(a,profile):native.runFuture(a,example.input??{},profile,.01);
    assert.equal(actual.handled,true,example.source);
    for(const [field,expected] of Object.entries(example.expected))assert.deepEqual(actual[field],expected,`${example.source}: ${field}`);
  });
}

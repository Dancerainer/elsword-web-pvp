import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import {createNativeCommands} from '../../packages/native-source/commands.mjs';
import {createNativeGeometry} from '../../packages/native-source/geometry.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url),'utf8'));
const profile=read('packages/combat-core/rf-profile.json'),preset=authoredEquipmentPreset(read('config/rf-preset.json'));
const path=p=>new URL('../../artifacts/'+p,import.meta.url);
const commandsPath=path('native/commands/commands.wasm'),geometryPath=path('native/geometry/geometry.wasm');
const mapPath=path('scene/sander-garpai-rock-pvp/collision.json');
const missing=[commandsPath,geometryPath,mapPath].some(p=>!existsSync(p));
const nativeTest=(name,fn)=>test(name,{skip:missing?'Built command/geometry modules and original Garpai map required':false},fn);
const dt=1/60;
async function make(start,suppliedMap){
  const map=suppliedMap??JSON.parse(readFileSync(mapPath,'utf8'));
  if(!suppliedMap)assert.equal(map.source.sha256,'dc51d7927c168a57e6220796b6c73cc90104abdcb39723c9c4d24b7dd7c57d8a');
  const geometry=await createNativeGeometry({bytes:readFileSync(geometryPath),map});
  const commands=await createNativeCommands({bytes:readFileSync(commandsPath)});
  const s=createSimulation({profile,preset,map,nativeGeometry:geometry,nativeCommands:commands,actors:[{id:'rf',team:0,...start}]});
  s.drainEvents();return {s,a:s.actor('rf'),geometry};
}
const tick=(s,input={},elapsed=dt)=>s.step(elapsed,input,{snapshot:false});
const advance=(s,n,input={})=>{for(let i=0;i<n;i++)tick(s,input);};
// Assertions are source-derived branch/liveness checks, not recorded 2016
// golden positions. The authored map and explicit historical equipment fixture are preserved.
nativeTest('historical v20 40% action and23% movement/jump 668ZX exits diving at both Garpai boundaries and accepts later input',async()=>{
  assert.equal(preset.attributes.hpMax,800000);
  assert.equal(preset.attributes.animationSpeedMultiplier,1.4);
  for(const field of ['moveSpeedMultiplier','jumpSpeedMultiplier'])assert.equal(preset.attributes[field],1.23);
  for(const facing of [1,-1]){
    const {s,a}=await make({x:facing*2022.97998046875,y:2840,z:0,lineId:facing===1?6:0,facing});
    const key=facing===1?'RIGHT':'LEFT',back=facing===1?'LEFT':'RIGHT';
    tick(s,{pressed:[key],held:[key]});tick(s,{released:[key]});tick(s,{pressed:[key],held:[key]});
    assert.equal(a.state,'RSI_DASH');
    tick(s,{pressed:['UP'],held:[key]});tick(s,{pressed:['Z'],held:[key]});advance(s,2,{held:[key]});
    // Source oneX latches before the strict .2 animation threshold. The lower
    // configured jump reaches ground sooner, so holding X until13 physical
    // ticks would correctly select Landing instead of this airborne branch.
    tick(s,{pressed:['X'],held:[key]});
    for(let i=0;i<12&&a.state==='RSI_DASH_JUMP_COMBO_Z';i++)tick(s,{held:[key]});
    assert.equal(a.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX');
    advance(s,40,{held:[key]});advance(s,120);
    assert.equal(a.grounded,true);assert.equal(a.state,'RSI_WAIT');
    assert.equal(a.lineId,facing===1?6:0);assert.equal(a.y,2840,'blocked wall endpoint preserves the original upper floor');
    assert.ok(s.drainEvents().some(e=>e.type==='stateChanged'&&e.state==='RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING'));
    const serial=a.stateSerial;advance(s,120);
    assert.equal(a.stateSerial,serial,'stationary endpoint does not enter repeated walk-off/landing states');
    assert.equal(s.drainEvents().filter(e=>e.type==='landed'||e.type==='jumpPlatformLaunched').length,0);
    const x=a.x;advance(s,12,{held:[back]});assert.ok((a.x-x)*facing<0,'can move away from wall');
    tick(s,{pressed:['Z']});assert.equal(a.state,'RSI_COMBO_Z');advance(s,90);
    tick(s,{pressed:['UP']});assert.equal(a.grounded,false);assert.ok(a.vy>0,'can jump after recovery');
  }
});
nativeTest('original endpoint support remains exclusive; post-correction foot query recovers a serialized frozen ZX',async()=>{
  const {s,a,geometry}=await make({x:2200,y:2600,z:0,lineId:7,facing:1});
  assert.equal(geometry.support({position:[2200,2600,0],radius:30,lastLineId:7}).found,false);
  s.enter(a,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX','failure-state-fixture');
  Object.assign(a,{grounded:false,lineId:null,lastTouchLineId:7,landPosition:[2200,2600,0],vx:2200,vy:-2640,
    passiveSpeed:{x:2200,y:-2640},animationTime:.37208333333333343,animationBeforeTime:.3720833361148834,
    animationOneshotTimer:.3720833361148834,animationStopped:true});
  const snap=JSON.parse(JSON.stringify(s.snapshot()));s.restore(snap);s.drainEvents();tick(s);
  const recovered=s.actor('rf');
  assert.equal(recovered.grounded,true);assert.equal(recovered.lineId,7);
  assert.equal(recovered.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING');
  assert.deepEqual([recovered.vx,recovered.vy,recovered.passiveSpeed.x,recovered.passiveSpeed.y],[0,0,0,0]);
  assert.equal(s.drainEvents().filter(e=>e.type==='landed').length,1);
  advance(s,90);s.drainEvents();const serial=recovered.stateSerial;advance(s,120);
  assert.equal(recovered.stateSerial,serial);assert.equal(s.drainEvents().filter(e=>e.type==='landed').length,0);
});
nativeTest('final feet use strict <1 height and nonpositive velocity rather than snapping an airborne pose',async()=>{
  // Disable gravity only in this explicit source-equation fixture so the probe
  // cannot cross the chosen height during Euler displacement. No target answer
  // is inferred from a produced snapshot.
  for(const [gap,vy,grounded] of [[.999,0,true],[1,0,false],[0,1,false]]){
    const {s,a}=await make({x:2200,y:2600+gap,z:0,lineId:7,facing:1});
    s.enter(a,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX','foot-boundary-fixture');
    Object.assign(a,{grounded:false,lineId:null,lastTouchLineId:7,landPosition:[2200,2600,0],vx:0,vy,
      passiveSpeed:{x:-1,y:-1},applyMotionOffset:false});
    const raw=s.profile.states[a.state].raw;raw.DISABLE_GRAVITY_TIME_START=0;raw.DISABLE_GRAVITY_TIME_END=1;
    tick(s,{},.001);assert.equal(a.grounded,grounded,`gap=${gap}, vy=${vy}`);
    if(!grounded)assert.equal(a.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX');
  }
});
nativeTest('native down keeps the lower remembered floor and upward takeoff never immediately relands',async()=>{
  const {s,a}=await make({x:0,y:3800,z:0,lineId:4,facing:1});
  tick(s,{pressed:['DOWN']});assert.equal(a.grounded,false);assert.equal(a.lastTouchLineId,2);
  assert.equal(a.landPosition[1],3080);assert.ok(a.y>3081);
  advance(s,120);assert.equal(a.grounded,true);assert.equal(a.lineId,2);advance(s,90);
  tick(s,{pressed:['UP']});assert.equal(a.grounded,false);assert.ok(a.vy>0);assert.ok(a.y>3080);
});
nativeTest('post-correction feet validate memory in every native loader representation',async()=>{
  for(const [fields,grounded] of [[{ENABLE:false},false],[{nativeFields:{ENABLE:{symbol:'FALSE'}}},false],
    [{nativeFields:{LINE_TYPE:{symbol:'LT_WALL'}}},false],[{type:1},false],[{type:7},false],
    [{},true],[{nativeFields:{LINE_TYPE:{symbol:'LT_NORMAL'}}},true],[{type:0},true]]){
    const map={sceneId:'invalid-remembered-floor',lines:[{lineId:0,start:[-100,0,0],end:[100,0,0],...fields}]};
    const {s,a}=await make({x:100,y:0,z:0,lineId:0,facing:1},map);
    s.enter(a,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX','invalid-floor-fixture');
    a.applyMotionOffset=false;a.grounded=false;a.lineId=null;a.landPosition=[100,0,0];a.lastTouchLineId=0;a.vx=0;a.vy=-1;
    tick(s);assert.equal(a.grounded,grounded,JSON.stringify(fields));
    assert.equal(s.drainEvents().some(e=>e.type==='landed'),grounded);
  }
});

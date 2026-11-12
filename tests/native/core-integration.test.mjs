import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeGeometry,NATIVE_GEOMETRY_RULE} from '../../packages/native-source/geometry.mjs';

const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url),'utf8'));
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
// Native geometry/caller source equations use explicit neutral speed inputs.
// Keep the user's 30% configured-preset coverage in its separate observations.
preset.attributes={...preset.attributes,animationSpeedMultiplier:1,moveSpeedMultiplier:1,jumpSpeedMultiplier:1};
const wasmPath=process.env.RF_NATIVE_GEOMETRY_WASM ?? new URL('../../artifacts/native/geometry/geometry.wasm',import.meta.url);
const actualMapPath=new URL('../../artifacts/scene/sander-garpai-rock-pvp/collision.json',import.meta.url);
const missing=!existsSync(wasmPath);
const bytes=missing?null:readFileSync(wasmPath);
const integration=(name,fn)=>test(name,{skip:missing?'Compile tools/native/geometry-build.py before running native integration':false},fn);
const step=(s,input={},dt=.01)=>s.step(dt,input,{snapshot:false});
const near=(actual,expected,eps=1e-4)=>actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<=eps,`${actual} vs ${expected}`));
const floorMap={sceneId:'native-core-integration',lines:[{lineId:0,start:[-5000,0,0],end:[5000,0,0],type:'LT_NORMAL',nativeFields:{CAN_DOWN:false}}]};
const garpai=t=>{
  if(!existsSync(actualMapPath)){t.skip('Original 2016 Garpai converted map required');return null;}
  const map=JSON.parse(readFileSync(actualMapPath,'utf8'));
  assert.equal(map.source.sha256,'dc51d7927c168a57e6220796b6c73cc90104abdcb39723c9c4d24b7dd7c57d8a');
  return map;
};

// Observe dispatch without replacing the algorithm: every observed method calls
// the actual compiled C++ inside its owned WASM instance and copies its result.
async function make({map=floorMap,actors=[{id:'rf',team:0,x:-400,y:0,z:0,facing:1}],...extra}={}){
  const native=await createNativeGeometry({bytes,map});
  const calls=[];
  const observed={ruleVersion:native.ruleVersion};
  for(const key of ['reset','support','down','land','canPassUp','collisionPoint'])observed[key]=(...args)=>{
    const result=native[key](...args);
    if(key!=='reset')calls.push({method:key,args:structuredClone(args),result:structuredClone(result)});
    return result;
  };
  const s=createSimulation({profile,preset,map,actors,nativeGeometry:observed,
    versions:{geometry:NATIVE_GEOMETRY_RULE},...extra});
  return {s,native,calls};
}
function dash(s){
  step(s,{pressed:['RIGHT'],held:['RIGHT']});
  step(s,{released:['RIGHT']});
  step(s,{pressed:['RIGHT'],held:['RIGHT']});
  assert.equal(s.actor('rf').state,'RSI_DASH');
}

// Source-derived integration expectations, not native 2016 input/output gold.
// CanDown is unchanged cpp1106-1350; the caller and simulation are separately
// implemented. Raven's drop subtracts45, DashJumpZ supplies SPEED_Y500, and
// User20497/20520 can recover the old line inside strict support radius30.
integration('real CanDown remembers Garpai lower line, then three full 662Z gestures recapture authored upper line',async t=>{
  const map=garpai(t);if(!map)return;
  const {s,calls}=await make({map,actors:[{id:'rf',team:0,x:-650,y:3800,z:0,lineId:4,facing:1}]}),a=s.actor('rf');
  for(let attempt=0;attempt<3;attempt++){
    dash(s);
    const callStart=calls.length;
    step(s,{pressed:['DOWN'],held:['RIGHT','DOWN']});
    assert.equal(a.state,'RSI_DASH_JUMP');assert.equal(a.grounded,false);
    assert.equal(a.lastTouchLineId,2,'CanDown outputs are remembered before subsequent support query');
    near(a.landPosition,[a.x,3080,0]);
    const drop=calls.slice(callStart).find(c=>c.method==='down'&&c.args[0].downRadius===true);
    assert.ok(drop,'platform command must execute actual native down query');
    assert.equal(drop.args[0].lastLineId,4);assert.equal(drop.result.lineId,2);
    near(drop.result.point,[drop.args[0].position[0],3080,0]);
    assert.equal(a.y,3755,'caller subtracts1.5*radius rather than teleporting to lower landPosition');
    step(s,{pressed:['Z'],held:['RIGHT']});assert.equal(a.state,'RSI_DASH_JUMP_COMBO_Z');
    for(let i=0;i<100&&!a.grounded;i++)step(s);
    assert.equal(a.state,'RSI_DASH_JUMP_LANDING');assert.equal(a.lineId,4);assert.equal(a.lastTouchLineId,4);assert.equal(a.y,3800);
    assert.ok(calls.slice(callStart).some(c=>c.method==='support'&&c.result.found&&c.result.lineId===4&&c.args[0].lastLineId===2),
      'native nearest query must recover upper line even though remembered index points to lower line');
  }
});
integration('ordinary Down uses native lower-line correction and descends to actual Garpai platform2',async t=>{
  const map=garpai(t);if(!map)return;
  const {s,calls}=await make({map,actors:[{id:'rf',team:0,x:-650,y:3800,z:0,lineId:4,facing:1}]});
  step(s,{pressed:['DOWN']});
  assert.equal(s.actor('rf').lastTouchLineId,2);
  for(let i=0;i<200&&!s.actor('rf').grounded;i++)step(s);
  assert.equal(s.actor('rf').lineId,2);assert.equal(s.actor('rf').y,3080);
  assert.ok(calls.some(c=>c.method==='down'&&c.args[0].downRadius===false&&c.args[0].onLine===false));
});
integration('native CanPassUp rejects a non-passable ceiling and core cancels upward displacement',async()=>{
  const map={sceneId:'native-ceiling-fixture',lines:[...floorMap.lines,{lineId:1,start:[-500,130,0],end:[500,130,0],type:'LT_NORMAL',nativeFields:{CAN_PASS:false}}]};
  const {s,calls}=await make({map,actors:[{id:'rf',team:0,x:0,y:100,z:0}]});
  const a=s.actor('rf');s.enter(a,'RSI_JUMP_UP','source-integration-fixture');a.vy=500;
  step(s);
  const ceiling=calls.find(c=>c.method==='canPassUp');
  assert.ok(ceiling);assert.equal(ceiling.result,false);near(ceiling.args[0].position,[0,100,0]);
  assert.equal(a.y,100);assert.equal(a.vy,0);assert.equal(a.grounded,false);
  const passMap=structuredClone(map);passMap.lines[1].nativeFields.CAN_PASS=true;
  const control=await make({map:passMap,actors:[{id:'rf',team:0,x:0,y:100,z:0}]});
  control.s.enter(control.s.actor('rf'),'RSI_JUMP_UP','source-integration-fixture');control.s.actor('rf').vy=500;
  step(control.s);
  assert.equal(control.calls.find(c=>c.method==='canPassUp').result,true);
  assert.ok(control.s.actor('rf').y>100);assert.ok(control.s.actor('rf').vy>0);
});
integration('core hit dispatch calls original line/sphere methods, including a result that JS fallback rejects',async()=>{
  const {s,calls}=await make({actors:[{id:'rf',team:0,x:-400,y:0,z:0},{id:'target',team:1,x:0,y:0,z:0}],
    collisionSampler:()=>[{kind:'line',start:[0,100,0],end:[0,100,0],radius:1}],
    defenderSampler:()=>[{kind:'sphere',center:[0,105,0],radius:10}]});
  const line={kind:'line',start:[0,0,0],end:[100,0,0],radius:1},sphere={kind:'sphere',center:[110,0,0],radius:10};
  near(s.hitPoint(line,sphere),[110,0,0]);
  near(s.hitPoint({kind:'sphere',center:[0,0,0],radius:5},{kind:'sphere',center:[9,0,0],radius:5}),[4.5,0,0]);
  assert.equal(s.hitPoint({kind:'sphere',center:[0,0,0],radius:5},{kind:'sphere',center:[10,0,0],radius:5}),null);
  // The original zero-length line normalizes to zero in the compatibility
  // helper, then accepts this forward projection. Existing JS fallback returns
  // null unconditionally for length===0. This explicit fixture proves dispatch;
  // it does not assert that a particular original character helper is degenerate.
  near(s.hitPoint({kind:'line',start:[0,100,0],end:[0,100,0],radius:1},{kind:'sphere',center:[0,105,0],radius:10}),[0,100,0]);
  const hp=s.actor('target').hp;step(s,{pressed:['Z']});
  for(let i=0;i<100&&s.actor('rf').animationTime<.28;i++)step(s);
  step(s,{pressed:['Z']});
  for(let i=0;i<100&&s.actor('target').hp===hp;i++)step(s);
  assert.ok(s.actor('target').hp<hp,'a character attack must consume the actual C++ hit result');
  assert.ok(calls.some(c=>c.method==='collisionPoint'&&c.args[0].kind==='line'&&c.args[0].start.every((n,i)=>n===c.args[0].end[i])&&c.result!==null));
  const hits=s.drainEvents().filter(e=>e.type==='hit');assert.equal(hits.length,1);assert.equal(hits[0].origin.kind,'character');near(hits[0].origin.impactPoint,[0,100,0]);
});
integration('constructor and grounded refresh reject native disabled/wall/monster/depth lines',async()=>{
  for(const extra of [{nativeFields:{ENABLE:{$symbol:'FALSE'}}},{type:'LT_WALL'},{type:'LT_MONSTER_ROAD'},
    {start:[-5000,0,500],end:[5000,0,500]}]){
    const map={sceneId:'native-invalid-support',lines:[{...floorMap.lines[0],...extra}]};
    const {s,calls}=await make({map,actors:[{id:'rf',team:0,x:0,y:0,z:0}]});
    assert.equal(s.actor('rf').grounded,false);
    assert.equal(calls.find(c=>c.method==='support').result.found,false);
    step(s);
    assert.equal(s.actor('rf').grounded,false);assert.equal(s.drainEvents().some(e=>e.type==='landed'),false);
  }
  for(const change of ['disabled','depth']){
    const {s,native,calls}=await make({actors:[{id:'rf',team:0,x:0,y:0,z:0}]});
    const a=s.actor('rf');assert.equal(a.grounded,true);
    if(change==='disabled'){
      s.map.lines[0].nativeFields.ENABLE={symbol:'FALSE'};native.reset(s.map);
    }else a.z=500;
    const count=calls.length;step(s);
    assert.ok(calls.slice(count).some(c=>c.method==='support'&&c.result.found===false));
    assert.equal(a.grounded,false,'grounded refresh must call native geometry rather than accept the X/Y-only map line');
  }
});
integration('blocked remembered endpoints dispatch original GetLandPosition before CanDown and retain XYZ floor',async()=>{
  for(const facing of [1,-1]){
    const map={sceneId:'native-blocked-end',lines:[
      {lineId:0,start:[0,100,400],end:[200,100,400],type:'LT_NORMAL',beforeLine:-2,nextLine:-2},
      {lineId:1,start:[-500,30,400],end:[500,30,400],type:'LT_NORMAL'},
      {lineId:2,start:[0,180,0],end:[200,180,0],type:'LT_NORMAL'}]};
    const {s,calls}=await make({map,actors:[{id:'rf',team:0,x:facing===1?198:2,y:100,z:400,lineId:0,facing}]});
    step(s,{held:[facing===1?'RIGHT':'LEFT']},.01);step(s,{held:[facing===1?'RIGHT':'LEFT']},.1);const a=s.actor('rf');
    assert.equal(a.grounded,true);assert.equal(a.lineId,0);near([a.x,a.y,a.z],[facing===1?200:0,100,400]);
    const land=calls.find(c=>c.method==='land');assert.ok(land);assert.equal(land.result.lineId,0);
    assert.equal(calls.some(c=>c.method==='down'),false,'blocked-end branch never asks CanDown for the lower line');
    s.drainEvents();const serial=a.stateSerial;for(let i=0;i<120;i++)step(s);
    assert.equal(a.grounded,true);assert.equal(a.state,'RSI_WAIT');assert.equal(a.stateSerial,serial+1);
    assert.equal(s.drainEvents().some(e=>e.type==='landed'),false);
  }
});
integration('open endpoints and the exact 30-unit remembered threshold continue through the original CanDown branch',async()=>{
  for(const [x,nextLine,elapsed] of [[198,-1,.1],[170,-2,.14]]){
    const map={sceneId:'native-open-end',lines:[
      {lineId:0,start:[0,100,400],end:[200,100,400],type:'LT_NORMAL',beforeLine:-1,nextLine}]};
    const {s,calls}=await make({map,actors:[{id:'rf',team:0,x,y:100,z:400,lineId:0,facing:1}]});
    step(s,{held:['RIGHT']},.01);step(s,{held:['RIGHT']},elapsed);
    assert.equal(calls.some(c=>c.method==='land'),false);
    assert.ok(calls.some(c=>c.method==='down'));
  }
});
integration('blocked-end source correction cannot turn an invalid host depth cache into an authored floor',async()=>{
  const map={sceneId:'invalid-host-depth-near-wall',lines:[
    {lineId:0,start:[0,100,400],end:[200,100,400],type:'LT_NORMAL',beforeLine:-2,nextLine:-2}]};
  const {s,calls}=await make({map,actors:[{id:'rf',team:0,x:198,y:100,z:400,lineId:0,facing:1}]});
  const a=s.actor('rf');a.z=900;step(s,{held:['RIGHT']},.1);
  assert.equal(a.grounded,false);assert.equal(a.z,900);assert.equal(calls.some(c=>c.method==='land'),false);
});
integration('ascending native support refresh caches the upper Garpai land point before grounding',async t=>{
  const map=garpai(t);if(!map)return;
  const {s,calls}=await make({map,actors:[{id:'rf',team:0,x:-650,y:3800,z:0,lineId:4,facing:1}]}),a=s.actor('rf');
  dash(s);step(s,{pressed:['DOWN'],held:['RIGHT','DOWN']});assert.equal(a.landPosition[1],3080);
  const start=calls.length;step(s,{pressed:['Z'],held:['RIGHT']});
  for(let i=0;i<100&&a.landPosition[1]!==3800&&!a.grounded;i++)step(s);
  const upper=calls.slice(start).find(c=>c.method==='support'&&c.result.found&&c.result.lineId===4);
  assert.ok(upper);assert.equal(a.lastTouchLineId,4);assert.equal(a.landPosition[1],3800);
  assert.equal(a.grounded,false);assert.ok(a.vy>0);assert.ok(a.y<3800);
  near(a.landPosition,[a.x,3800,a.z]);
});
integration('full JSON snapshot resumes identically in a separate WASM instance through recovery and another 662Z',async t=>{
  const map=garpai(t);if(!map)return;
  const actors=[{id:'rf',team:0,x:-650,y:3800,z:0,lineId:4,facing:1}];
  const first=await make({map,actors});dash(first.s);step(first.s,{pressed:['DOWN'],held:['RIGHT','DOWN']});
  assert.equal(first.s.actor('rf').lastTouchLineId,2);
  const wire=JSON.parse(JSON.stringify(first.s.snapshot()));
  assert.equal(wire.versions.geometry,NATIVE_GEOMETRY_RULE);
  const resumed=await make({map,actors});assert.notEqual(first.native.instance,resumed.native.instance);
  assert.notEqual(first.native.instance.exports.memory,resumed.native.instance.exports.memory);
  resumed.s.restore(wire);
  const sameStep=input=>{
    step(first.s,input);step(resumed.s,input);
    assert.deepEqual(JSON.parse(JSON.stringify(resumed.s.snapshot())),JSON.parse(JSON.stringify(first.s.snapshot())));
  };
  sameStep({pressed:['Z'],held:['RIGHT']});
  for(let i=0;i<100&&!first.s.actor('rf').grounded;i++)sameStep({});
  assert.equal(first.s.actor('rf').lineId,4);assert.equal(resumed.s.actor('rf').lineId,4);
  for(const input of [{pressed:['RIGHT'],held:['RIGHT']},{released:['RIGHT']},{pressed:['RIGHT'],held:['RIGHT']},
    {pressed:['DOWN'],held:['RIGHT','DOWN']},{pressed:['Z'],held:['RIGHT']}])sameStep(input);
  for(let i=0;i<100&&!first.s.actor('rf').grounded;i++)sameStep({});
  assert.equal(resumed.s.actor('rf').lineId,4);assert.equal(resumed.s.actor('rf').y,3800);
  assert.ok(resumed.calls.some(c=>c.method==='down'&&c.result.lineId===2));
});

import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createNativeGeometry} from '../../packages/native-source/geometry.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const artifact=new URL('../../artifacts/native/geometry/',import.meta.url);
const wasmPath=process.env.RF_NATIVE_GEOMETRY_WASM ?? fileURLToPath(new URL('geometry.wasm',artifact));
const nativePath=process.env.RF_NATIVE_GEOMETRY_EXE ?? fileURLToPath(new URL('geometry-native.exe',artifact));
const missing=!existsSync(wasmPath);
const geometryTest=(name,fn)=>test(name,{skip:missing?'Compile original methods with tools/native/geometry-build.py first':false},fn);
const bytes=missing?null:readFileSync(wasmPath);
const line=(id,y,extra={})=>({lineId:id,start:[0,y,0],end:[200,y,0],beforeLine:-1,nextLine:-1,type:'LT_NORMAL',...extra});
const make=lines=>createNativeGeometry({bytes,map:{lines}});
const near=(actual,expected,eps=1e-4)=>actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<=eps,`${actual} vs ${expected}`));

// Expectations come from inspected original method branches and simple analytic
// geometry, independently of the JS adapter and C++ outputs. No client gold trace.
geometryTest('WASM contains the original query exports with no host algorithm imports',async()=>{
  const m=await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(m),[]);
  const names=WebAssembly.Module.exports(m).map(x=>x.name);
  for(const n of ['query_support','query_down','query_land','line_collision','sphere_collision','line_sphere_collision'])assert.ok(names.includes(n));
});
geometryTest('original GetLandPosition retains closed endpoints and selects the highest authored floor in its ray',async()=>{
  const g=await make([line(4,100),line(9,30)]);
  assert.equal(g.support({position:[200,100,0],lastLineId:4}).found,false);
  const q=g.land({position:[200,100,0],lastLineId:4});
  assert.equal(q.lineId,4);near(q.point,[200,100,0]);
  near(g.land({position:[220,100,0],lastLineId:4}).point,[200,100,0]);
  assert.equal(g.land({position:[100,200,0],lastLineId:9}).lineId,4);
});
geometryTest('original GetLandPosition scans enabled non-wall XYZ lines and retains its remembered-end fallback',async()=>{
  for(const extra of [{nativeFields:{ENABLE:false}},{type:'LT_WALL'},{start:[0,100,500],end:[200,100,500]}]){
    const g=await make([line(4,100,extra),line(9,30)]);
    const q=g.land({position:[100,200,0],lastLineId:9});assert.equal(q.lineId,9);near(q.point,[100,30,0]);
  }
  const g=await make([line(4,100,{start:[0,100,400],end:[200,100,400]})]);
  near(g.land({position:[200,200,400],lastLineId:4}).point,[200,100,400]);
  near(g.land({position:[1000,200,400],lastLineId:4}).point,[200,100,400]);
  assert.throws(()=>g.land({position:[Infinity,0,0]}),/finite/);
  assert.throws(()=>g.land({position:[0,0,0],radius:0}),/positive/);
});
geometryTest('geometry loader fails closed when the compiled original land export is absent',async()=>{
  const instance=await WebAssembly.instantiate(await WebAssembly.compile(bytes));
  const exports={...instance.exports};delete exports.query_land;
  await assert.rejects(createNativeGeometry({instance:{exports},map:{lines:[]}}),/Missing native geometry export query_land/);
});
geometryTest('original support radius is strict, start inclusive and end exclusive',async()=>{
  const g=await make([line(4,100)]);
  assert.equal(g.support({position:[20,71,0]}).found,true);
  assert.equal(g.support({position:[20,70,0]}).found,false);
  assert.equal(g.support({position:[0,100,0]}).lineId,4);
  assert.equal(g.support({position:[200,100,0]}).found,false);
});
geometryTest('original nearest support preserves last-line tie order and 3D depth',async()=>{
  const g=await make([line(4,100),line(9,100)]);
  assert.equal(g.support({position:[100,100,0],lastLineId:9}).lineId,9);
  assert.equal(g.support({position:[100,100,0],lastLineId:4}).lineId,4);
  assert.equal(g.support({position:[100,100,500]}).found,false);
});
geometryTest('original support filters disabled, wall and unit-vs-monster roads',async()=>{
  for(const extra of [{nativeFields:{ENABLE:false}},{type:'LT_WALL'},{type:'LT_MONSTER_ROAD'}]){
    const g=await make([line(3,100,extra)]);
    assert.equal(g.support({position:[100,100,0]}).found,false);
  }
  const g=await make([line(3,100,{type:'LT_UNIT_ROAD'})]);
  assert.equal(g.support({position:[100,100,0],isMonster:true}).found,false);
  assert.equal(g.support({position:[100,100,0]}).found,true);
});
geometryTest('original support projects a sloped XYZ line',async()=>{
  const g=await make([{lineId:7,start:[0,0,0],end:[100,100,100]}]);
  const q=g.support({position:[50,55,45],radius:10});
  assert.equal(q.lineId,7); near(q.point,[50,50,50]);
});
geometryTest('CanDown executes down-radius subtraction and current-line CAN_DOWN guard',async()=>{
  const g=await make([line(4,100),line(8,30)]);
  const q=g.down({position:[100,100,0],lastLineId:4});
  assert.equal(q.lineId,8); near(q.point,[100,30,0]);
  assert.equal(g.down({position:[100,100,0],lastLineId:4,downRadius:false}).lineId,4);
  g.reset({lines:[line(4,100,{nativeFields:{CAN_DOWN:false}}),line(8,30)]});
  const blocked=g.down({position:[100,100,0],lastLineId:4});
  assert.equal(blocked.found,false); assert.equal(blocked.nativeIndex,0); near(blocked.rawPoint,[100,69,0]);
});
geometryTest('CanDown filters forbidden lines and corrects enabled endpoint neighbors',async()=>{
  for(const extra of [{nativeFields:{ENABLE:false}},{type:'LT_WALL'},{type:'LT_MONSTER_ROAD'},{start:[0,30,500],end:[200,30,500]}]){
    const g=await make([line(4,100),line(8,30,extra)]);
    assert.equal(g.down({position:[100,100,0],lastLineId:4}).found,false);
  }
  const g=await make([line(4,100),line(8,30,{nextLine:9}),{lineId:9,start:[200,30,0],end:[400,30,0]}]);
  const q=g.down({position:[200,100,0],lastLineId:4});
  assert.equal(q.lineId,9); near(q.point,[200,30,0]);
  // Reciprocal neighbors are visited again: cpp1196/1202 redirects the last
  // matching line 9 back to its beforeLine 8, even after line 8 selected 9.
  g.reset({lines:[line(4,100),line(8,30,{nextLine:9}),{lineId:9,start:[200,30,0],end:[400,30,0],beforeLine:8}]});
  assert.equal(g.down({position:[200,100,0],lastLineId:4}).lineId,8);
});
geometryTest('original LineToLine executes strict Manhattan separation and endpoint correction',async()=>{
  const g=await make([]);
  const a={aStart:[50,200,0],aEnd:[50,0,0],bStart:[0,100,0],bEnd:[200,100,0],radius:30};
  const q=g.lineCollision(a); assert.equal(q.hit,true); near(q.pointA,[50,100,0]); near(q.pointB,[50,100,0]);
  assert.equal(g.lineCollision({...a,bStart:[0,100,30],bEnd:[200,100,30]}).hit,false);
  assert.equal(g.lineCollision({...a,bStart:[0,100,29],bEnd:[200,100,29]}).hit,true);
  assert.equal(g.lineCollision({...a,aStart:[-20,200,20],aEnd:[-20,0,20]}).hit,false);
  const end=g.lineCollision({...a,aStart:[220,200,0],aEnd:[220,0,0]});
  assert.equal(end.hit,true); near(end.pointB,[200,100,0]);
});
geometryTest('original LineToLine parallel and degenerate branches execute',async()=>{
  const g=await make([]);
  const parallel=g.lineCollision({aStart:[0,100,0],aEnd:[200,100,0],bStart:[100,110,0],bEnd:[300,110,0],radius:30});
  assert.equal(parallel.hit,true); near(parallel.pointA,[150,100,0]); near(parallel.pointB,[150,110,0]);
  const point=g.lineCollision({aStart:[50,100,0],aEnd:[50,100,0],bStart:[0,100,0],bEnd:[200,100,0],radius:30});
  assert.equal(point.hit,true); near(point.pointA,[50,100,0]); near(point.pointB,[50,100,0]);
});
geometryTest('native hit methods retain original strict sphere and forward line projection policies',async()=>{
  const g=await make([]),s={kind:'sphere',center:[0,0,0],radius:5},d={kind:'sphere',center:[9,0,0],radius:5};
  near(g.collisionPoint(s,d),[4.5,0,0]);
  assert.equal(g.collisionPoint(s,{...d,center:[10,0,0]}),null);
  const a={kind:'line',start:[0,0,0],end:[100,0,0],radius:1};
  assert.equal(g.collisionPoint(a,{kind:'sphere',center:[-1,0,0],radius:10}),null);
  near(g.collisionPoint(a,{kind:'sphere',center:[110,0,0],radius:10}),[110,0,0]);
  near(g.collisionPoint(a,{kind:'sphere',center:[50,11,0],radius:10}),[50,0,0]);
});
geometryTest('CanPassUp executes the source CAN_PASS and 50-unit ceiling check',async()=>{
  const g=await make([line(4,130,{nativeFields:{CAN_PASS:false}})]);
  assert.equal(g.canPassUp({position:[100,100,0]}),false);
  g.reset({lines:[line(4,130)]});
  assert.equal(g.canPassUp({position:[100,100,0]}),true);
});
geometryTest('adapter isolates module storage and validates maps before reset',async()=>{
  const module=await WebAssembly.compile(bytes),g=await createNativeGeometry({module,map:{lines:[line(4,100)]}}),h=await createNativeGeometry({module,map:{lines:[line(8,200)]}});
  assert.equal(g.support({position:[100,100,0]}).lineId,4);
  assert.equal(h.support({position:[100,100,0]}).found,false);
  assert.throws(()=>g.reset({lines:[line(4,100,{nextLine:999})]}),/Missing native neighbor/);
  assert.equal(g.support({position:[100,100,0]}).lineId,4);
  assert.throws(()=>g.support({position:[NaN,0,0]}),/finite/);
  assert.throws(()=>g.down({position:[0,0,0],radius:0}),/positive/);
});
geometryTest('adapter treats native FALSE symbols as false and rejects unknown boolean fields',async()=>{
  for(const value of [false,0,{symbol:'FALSE'},{$symbol:'FALSE'}]){
    const g=await make([line(4,100,{nativeFields:{ENABLE:value}})]);
    assert.equal(g.support({position:[100,100,0]}).found,false);
  }
  const g=await make([line(4,100,{nativeFields:{CAN_DOWN:{symbol:'FALSE'}}}),line(8,30)]);
  assert.equal(g.down({position:[100,100,0],lastLineId:4}).found,false);
  assert.throws(()=>g.reset({lines:[line(4,100,{nativeFields:{ENABLE:{symbol:'MAYBE'}}})]}),/explicit boolean/);
  assert.throws(()=>g.reset({lines:[line(4,100,{nativeFields:{CAN_PASS:2}})]}),/explicit boolean/);
  assert.throws(()=>g.reset({lines:[line(4,100,{nativeFields:{ENABLE:null}})]}),/explicit boolean/);
});
geometryTest('actual original Garpai map executes support recapture and lower-line descent',async t=>{
  const path=new URL('../../artifacts/scene/sander-garpai-rock-pvp/collision.json',import.meta.url);
  if(!existsSync(path)){t.skip('Original 2016 converted map is unavailable');return;}
  const map=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(map.source.sha256,'dc51d7927c168a57e6220796b6c73cc90104abdcb39723c9c4d24b7dd7c57d8a');
  const g=await createNativeGeometry({bytes,map});
  const recapture=g.support({position:[-650,3771,0],lastLineId:4});
  assert.equal(recapture.lineId,4); near(recapture.point,[-650,3800,0]);
  assert.equal(g.support({position:[-650,3770,0],lastLineId:4}).found,false);
  const down=g.down({position:[-650,3800,0],lastLineId:4});
  assert.equal(down.lineId,2); near(down.point,[-650,3080,0]);
});
geometryTest('Windows native executable runs independent fixtures and agrees with WASM float results',async t=>{
  if(!existsSync(nativePath)){t.skip('Compile with --native to exercise native executable');return;}
  const commands=['reset','add 0 100 0 200 100 0 0 1 1 -1 -1 1','add 0 30 0 200 30 0 0 1 1 -1 -1 1',
    'support 100 71 0 30 0 0','support 100 70 0 30 0 0','down 100 100 0 30 0 1 0 1',
    'line 50 200 0 50 0 0 0 100 0 200 100 0 30','point 0 0 0 5 9 0 0 5','tube 0 0 0 100 0 0 1 110 0 0 10'];
  const run=spawnSync(nativePath,[],{input:commands.join('\n')+'\n',encoding:'utf8',cwd:root});
  assert.equal(run.status,0,run.stderr);
  const outputs=run.stdout.trim().split(/\r?\n/).map(s=>s.split(' ').map(Number));
  assert.equal(outputs[3][0],1);near(outputs[3].slice(2,5),[100,100,0]);
  assert.equal(outputs[4][0],0);assert.equal(outputs[5][1],1);near(outputs[5].slice(2,5),[100,30,0]);
  assert.equal(outputs[6][0],1);near(outputs[6].slice(5,8),[50,100,0]);
  near(outputs[7].slice(2,5),[4.5,0,0]);near(outputs[8].slice(2,5),[110,0,0]);
  const g=await make([line(0,100),line(1,30)]);
  near(outputs[3].slice(2,5),g.support({position:[100,71,0]}).point,0);
  near(outputs[5].slice(2,5),g.down({position:[100,100,0],lastLineId:0}).point,0);
});
geometryTest('Windows native executable also executes the actual 2016 Garpai map',async t=>{
  const path=new URL('../../artifacts/scene/sander-garpai-rock-pvp/collision.json',import.meta.url);
  if(!existsSync(nativePath)||!existsSync(path)){t.skip('Native executable and original map required');return;}
  const map=JSON.parse(readFileSync(path,'utf8'));
  const commands=['reset',...map.lines.map(l=>`add ${l.start.join(' ')} ${l.end.join(' ')} 0 1 1 ${l.beforeLine} ${l.nextLine} 1`),
    'support -650 3771 0 30 4 0','support -650 3770 0 30 4 0','down -650 3800 0 30 4 1 0 1'];
  const run=spawnSync(nativePath,[],{input:commands.join('\n')+'\n',encoding:'utf8',cwd:root});
  assert.equal(run.status,0,run.stderr);
  const outputs=run.stdout.trim().split(/\r?\n/).slice(-3).map(s=>s.split(' ').map(Number));
  assert.equal(outputs[0][0],1);assert.equal(outputs[0][1],4);near(outputs[0].slice(2,5),[-650,3800,0]);
  assert.equal(outputs[1][0],0);
  assert.equal(outputs[2][0],1);assert.equal(outputs[2][1],2);near(outputs[2].slice(2,5),[-650,3080,0]);
});
geometryTest('Windows native GetLandPosition and WASM agree at both nonzero-Z endpoints',async t=>{
  if(!existsSync(nativePath)){t.skip('Compile with --native to exercise native executable');return;}
  const commands=['reset','add 0 100 400 200 100 400 0 1 1 -2 -2 1',
    'add 0 30 400 200 30 400 0 1 1 -1 -1 1','ground -20 110 400 30 0','ground 220 110 400 30 0'];
  const run=spawnSync(nativePath,[],{input:commands.join('\n')+'\n',encoding:'utf8',cwd:root});assert.equal(run.status,0,run.stderr);
  const outputs=run.stdout.trim().split(/\r?\n/).slice(-2).map(s=>s.split(' ').map(Number));
  const g=await make([line(0,100,{start:[0,100,400],end:[200,100,400]}),line(1,30,{start:[0,30,400],end:[200,30,400]})]);
  for(const [i,x] of [-20,220].entries()){
    assert.equal(outputs[i][0],1);assert.equal(outputs[i][1],0);
    near(outputs[i].slice(2,5),[i===0?0:200,100,400]);near(outputs[i].slice(2,5),g.land({position:[x,110,400],lastLineId:0}).point,0);
  }
});

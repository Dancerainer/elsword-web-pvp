import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createNativeGeometry} from '../../packages/native-source/geometry.mjs';
const artifact=new URL('../../artifacts/native/geometry/',import.meta.url);
const bytes=readFileSync(new URL('geometry.wasm',artifact));
const line=(id,start,end,extra={})=>({lineId:id,start,end,type:'LT_NORMAL',...extra});
const make=lines=>createNativeGeometry({bytes,map:{lines}});

test('original nearest/group/distance exports are mandatory and have no host imports',async()=>{
  const module=await WebAssembly.compile(bytes);assert.deepEqual(WebAssembly.Module.imports(module),[]);
  const names=WebAssembly.Module.exports(module).map(e=>e.name);
  for(const name of ['query_nearest','query_line_group','build_line_groups','distance_between'])assert.ok(names.includes(name));
  const instance=await WebAssembly.instantiate(module),exports={...instance.exports};delete exports.query_nearest;
  await assert.rejects(createNativeGeometry({instance:{exports},map:{lines:[]}}),/Missing native geometry export query_nearest/);
});
test('GetNearestLine clamps its full XYZ projection to closed line endpoints and selects the later equal-distance line',async()=>{
  const g=await make([line(10,[0,0,0],[100,0,0]),line(20,[0,100,200],[100,100,200])]);
  assert.deepEqual(g.nearest({position:[150,20,0]}).point,[100,0,0]);
  assert.equal(g.nearest({position:[40,100,200]}).lineId,20);
  g.reset({lines:[line(10,[0,0,0],[100,0,0]),line(20,[0,0,0],[100,0,0])]});
  assert.equal(g.nearest({position:[50,0,0]}).lineId,20,'native <= tie selects last, unlike support remembered tie');
  g.reset({lines:[]});assert.equal(g.nearest({position:[0,0,0]}).found,false);
});
test('VerifyLine rejects disabled/wall/monster roads for user nearest queries without hiding unit roads',async()=>{
  for(const extra of [{nativeFields:{ENABLE:false}},{type:'LT_WALL'},{type:'LT_MONSTER_ROAD'}]){
    const g=await make([line(10,[0,0,0],[100,0,0],extra),line(20,[0,100,0],[100,100,0])]);
    assert.equal(g.nearest({position:[50,0,0]}).lineId,20);
  }
  const g=await make([line(10,[0,0,0],[100,0,0],{type:'LT_UNIT_ROAD'})]);
  assert.equal(g.nearest({position:[50,0,0]}).lineId,10);
});
test('original GetDistance is three dimensional binary32 and preserves the inclusive source distance boundary',async()=>{
  const g=await make([]);assert.equal(g.distance([0,0,0],[3,4,12]),13);
  assert.equal(g.distance([0,0,0],[0,240,320]),400);
  assert.throws(()=>g.distance([NaN,0,0],[0,0,0]),/finite/);
  assert.throws(()=>g.nearest({position:[0,Infinity,0]}),/finite/);
});
test('ReBuildLineGroup follows authored reciprocal topology across XYZ bends, independent of screen distance',async()=>{
  const g=await make([
    line(10,[0,0,0],[100,0,0],{nextLine:20}),
    line(20,[100,0,0],[200,50,100],{beforeLine:10,nextLine:30}),
    line(30,[200,50,100],[300,50,200],{beforeLine:20}),
    line(40,[0,0,1],[300,0,1]),
  ]);
  for(const id of [10,20,30])assert.deepEqual(g.lineGroup(id),{startLineId:10,endLineId:30,nativeStartIndex:0,nativeEndIndex:2});
  assert.deepEqual(g.lineGroup(40),{startLineId:40,endLineId:40,nativeStartIndex:3,nativeEndIndex:3});
  assert.equal(g.lineGroup(999),null);
});
test('disabled bridges and asymmetric neighbor references do not merge native groups',async()=>{
  const g=await make([
    line(10,[0,0,0],[100,0,0],{nextLine:20}),
    line(20,[100,0,0],[200,0,0],{beforeLine:10,nextLine:30,nativeFields:{ENABLE:false}}),
    line(30,[200,0,0],[300,0,0],{beforeLine:20}),
  ]);
  assert.equal(g.lineGroup(20),null);assert.equal(g.lineGroup(10).endLineId,10);assert.equal(g.lineGroup(30).startLineId,30);
  g.reset({lines:[line(10,[0,0,0],[100,0,0],{nextLine:20}),line(20,[100,0,0],[200,0,0])]});
  assert.equal(g.lineGroup(10).endLineId,10);assert.equal(g.lineGroup(20).startLineId,20);
});
test('unsupported reciprocal cycles are rejected before mutating existing isolated geometry',async()=>{
  const g=await make([line(99,[0,0,0],[100,0,0])]);
  assert.throws(()=>g.reset({lines:[line(10,[0,0,0],[100,0,0],{beforeLine:20,nextLine:20}),line(20,[100,0,0],[0,0,0],{beforeLine:10,nextLine:10})]}),/Cyclic reciprocal/);
  assert.equal(g.nearest({position:[50,0,0]}).lineId,99);assert.equal(g.lineGroup(99).startLineId,99);
});
test('compiled Windows and WASM execute the same unchanged nearest/group functions',()=>{
  const path=process.env.RF_NATIVE_GEOMETRY_EXE??fileURLToPath(new URL('geometry-native.exe',artifact));assert.ok(existsSync(path),'native source fixture must be built');
  const input=['reset','add 0 0 0 100 0 0 0 1 1 -1 1 1','add 100 0 0 200 0 0 0 1 1 0 -1 1','build','nearest 250 20 0','query 0','query 1'];
  const run=spawnSync(path,[],{input:input.join('\n')+'\n',encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const rows=run.stdout.trim().split(/\r?\n/).map(r=>r.split(' ').map(Number));
  assert.deepEqual(rows[3],[0]);assert.deepEqual(rows[4].slice(0,5),[1,1,200,0,0]);
  for(const row of rows.slice(5))assert.deepEqual(row.slice(0,5),[1,rows.indexOf(row)-5,0,1,0]);
});

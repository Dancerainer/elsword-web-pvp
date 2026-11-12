import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeQuadFramePlan} from '../../apps/web/native-quad-frame-plan.mjs';
import {nativeQuadTextureDrawGroups,setNativeSequenceRenderOrder,nativeSequenceRenderOrder,
  compareNativeTransparentSubMeshes} from '../../apps/web/native-sequence-render-order.mjs';

const particle=(id,emitterId)=>({id,emitterId});
const flatten=sequences=>sequences.flatMap(({emitterId,groups})=>groups.flatMap(group=>
  Array.from({length:Math.ceil(group.drawCount)},(_,draw)=>[emitterId,group.textureId,draw,
    group.rows.filter(row=>draw<row.drawCount).map(row=>[row.p.id,row.path,Array.from(row.matrix),row.sequencePosition])])));
function original(rows){
  const sequences=new Map();
  for(const row of rows){if(!sequences.has(row.p.emitterId))sequences.set(row.p.emitterId,[]);sequences.get(row.p.emitterId).push(row);}
  return [...sequences].flatMap(([id,rows])=>nativeQuadTextureDrawGroups(rows).map(group=>[id,group.textureId,group.draw,
    group.rows.map(row=>[row.p.id,row.path,Array.from(row.matrix),row.sequencePosition])]));
}
function frame(plan,rows){
  plan.beginFrame();
  for(const row of rows)plan.append(row.p,row.path,row.textureId,row.drawCount,row.sequencePosition).matrix.set(row.matrix);
  return plan.finishFrame();
}
const sourceRow=(p,textureId,drawCount,path='same.dds')=>({p,textureId,drawCount,path,
  matrix:Float32Array.from({length:16},(_,i)=>i+p.id/100),sequencePosition:[p.emitterId,20,30]});

test('reused quad lists preserve emitter birth order, ascending texture IDs and complete repeated passes',()=>{
  const plan=createNativeQuadFramePlan();
  const rows=[sourceRow(particle(1,40),4,2),sourceRow(particle(2,30),0,1),
    sourceRow(particle(3,40),1,3),sourceRow(particle(4,40),4,1),
    sourceRow(particle(5,30),0,2),sourceRow(particle(6,40),1,2)];
  assert.deepEqual(flatten(frame(plan,rows)),original(rows));
  assert.deepEqual(frame(plan,rows).map(sequence=>sequence.emitterId),[40,30],
    'the collector does not replace particle-list insertion order with numeric emitter order');
  const before=structuredClone(rows);
  for(let i=0;i<24;i++)assert.deepEqual(flatten(frame(plan,rows)),original(rows));
  assert.deepEqual(rows,before,'declarations, source particles and matrices stay unchanged');
  assert.deepEqual(plan.proof().created,{rows:6,sequences:2,textureGroups:3},
    'steady frames create no new rows, sequence arrays or texture groups');
});

test('texture changes, particle expiry and fresh emitter identities do not reuse stale rows or matrices',()=>{
  const plan=createNativeQuadFramePlan(),a=particle(1,10),b=particle(2,10),c=particle(3,20);
  const first=frame(plan,[sourceRow(a,4,3),sourceRow(b,2,1),sourceRow(c,0,2)]);
  const retained=first[0],row=retained.groups.find(g=>g.textureId===4).rows[0],matrix=row.matrix;
  const next=[sourceRow(a,2,1,'changed.dds'),sourceRow(c,0,1)];next[0].matrix[0]=99;
  const second=frame(plan,next);
  assert.strictEqual(second[0],retained);assert.strictEqual(second[0].groups[0].rows[0],row);
  assert.strictEqual(row.matrix,matrix);assert.equal(row.matrix[0],99);
  assert.deepEqual(flatten(second),original(next));
  assert.equal(second[0].byTexture.get(4).rows.length,0,'the unused texture group releases old particle references');
  assert.deepEqual(frame(plan,[]),[]);assert.equal(plan.proof().retainedSequences,0);
  assert.equal(retained.groups.length,0,'a retired sequence releases its visible rows');
  const d=particle(4,30),fresh=[sourceRow(d,null,2)];
  const visible=frame(plan,fresh),visibleGroup=visible[0].groups[0];
  assert.deepEqual(flatten(visible),original(fresh),'the original null texture ID conversion remains zero');
  assert.equal(plan.proof().retainedSequences,1);
  plan.clear();
  assert.equal(visibleGroup.rows.length,0,'leaving the match clears particle references even without another render');
  assert.deepEqual(plan.proof(),{created:{rows:4,sequences:3,textureGroups:4},retainedSequences:0,activeSequences:0,activeTextureGroups:0});
});

test('long repeated bursts keep only the current emitter lists and never copy retired particles into a new pass',()=>{
  const plan=createNativeQuadFramePlan();
  for(let burst=0;burst<180;burst++){
    const rows=Array.from({length:24},(_,i)=>sourceRow(particle(burst*24+i,burst*4+i%4),i%3,1+i%3));
    assert.deepEqual(flatten(frame(plan,rows)),original(rows));
    assert.equal(plan.proof().retainedSequences,4);
  }
  frame(plan,[]);assert.equal(plan.proof().retainedSequences,0);
});

test('reused sorting metadata updates all ordering fields while preserving equal-depth native sequence and child barriers',()=>{
  const meshes=Array.from({length:5},(_,i)=>({uniqueId:i}));
  const submesh=(mesh,layer,index=0)=>({_alphaIndex:layer,_distanceToCamera:100,getMesh:()=>mesh,index});
  const options={emitterId:7,position:[0,0,100],cameraPosition:[0,0,0],particleOrder:3,drawOrder:2};
  setNativeSequenceRenderOrder([meshes[0],meshes[1]],options);
  const metadata=nativeSequenceRenderOrder(meshes[0]);
  setNativeSequenceRenderOrder([meshes[2]],{...options,emitterId:8,particleOrder:0,drawOrder:0});
  setNativeSequenceRenderOrder([meshes[3]],{...options,particleOrder:3,drawOrder:1});
  const rows=[submesh(meshes[2],13),submesh(meshes[1],13),submesh(meshes[0],13),submesh(meshes[3],13),submesh(meshes[4],12)];
  assert.deepEqual(rows.sort(compareNativeTransparentSubMeshes).map(row=>row.getMesh().uniqueId),[4,3,0,1,2]);
  setNativeSequenceRenderOrder([meshes[1],meshes[0]],{...options,emitterId:9,particleOrder:0,drawOrder:0,position:[0,0,200]});
  assert.strictEqual(nativeSequenceRenderOrder(meshes[0]),metadata,'no new ordering object is allocated for a live mesh');
  assert.deepEqual(metadata,{emitterId:9,distance:2,particleOrder:0,drawOrder:0,childOrder:1});
  assert.deepEqual(rows.sort(compareNativeTransparentSubMeshes).map(row=>row.getMesh().uniqueId),[4,1,0,3,2]);
});

test('invalid native texture IDs remain rejected before reaching the draw queue',()=>{
  const plan=createNativeQuadFramePlan();plan.beginFrame();
  assert.throws(()=>plan.append(particle(1,1),'a',NaN,1,[0,0,0]),/Invalid native particle texture id/);
});

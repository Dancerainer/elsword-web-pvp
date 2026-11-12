import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeTrailBuffer} from '../../packages/presentation/weapon-trails.mjs';
import {createNativeTrailGeometry} from '../../apps/web/native-trail-geometry.mjs';

const convert=p=>[p[0]*.01,p[1]*.01,-p[2]*.01];
for(const curveType of [0,1,2])test('Reused strip upload equals legacy geometry through curve '+curveType+', fade, clear and restart',()=>{
  const buffer=new NativeTrailBuffer({vertexCount:150,curveType}),geometry=createNativeTrailGeometry();
  for(let frame=0;frame<240;frame++){
    if(frame===130)buffer.clear();
    const emit=frame<90||frame>=130&&frame<170;
    buffer.step({dt:1/60,up:[frame*33,Math.sin(frame)*50,-frame*7],down:[frame*33-80,200+frame*2,frame*5],color:emit?[.3,.8,1,.85]:[0,0,0,0],emit});
    const original=buffer.geometry(convert),actual=geometry.sample(buffer);
    if(!buffer.visible||original.indices.length===0){assert.equal(actual,null);continue;}
    assert.deepEqual(actual.positions,new Float32Array(original.positions));
    assert.deepEqual(actual.colors,new Float32Array(original.colors));
    assert.deepEqual(Array.from(actual.indices),original.indices);
  }
  assert.equal(geometry.proof().allocations,1,'One fixed upload store per source buffer');
});

test('Trail GPU prefixes reuse storage and invisible history requests no allocation',()=>{
  const buffer=new NativeTrailBuffer({vertexCount:6,curveType:2}),geometry=createNativeTrailGeometry();
  assert.equal(geometry.sample(buffer),null);assert.equal(geometry.proof().allocations,0);
  const step=x=>buffer.step({dt:1/60,up:[x,1,2],down:[x,3,4],color:[1,1,1,1]});
  for(let x=0;x<3;x++)step(x);
  const first=geometry.sample(buffer),bytes=first.positions.buffer,oldPosition=first.positions[0];
  step(30);const next=geometry.sample(buffer);
  assert.equal(next,first);assert.equal(next.positions.buffer,bytes);assert.notEqual(next.positions[0],oldPosition);
  buffer.fade(1);for(let n=0;n<100;n++)assert.equal(geometry.sample(buffer),null);
  assert.equal(geometry.proof().allocations,1);assert.equal(buffer.pairs.length,3,'Invisible source history is preserved');
  buffer.clear();step(50);step(70);
  const restart=geometry.sample(buffer);assert.equal(restart.positions.buffer,bytes);assert.equal(restart.positions.length,12);
});

test('Independent trail renderers do not share mutable upload storage',()=>{
  const buffers=[new NativeTrailBuffer({curveType:2}),new NativeTrailBuffer({curveType:2})];
  for(let j=0;j<2;j++)for(let i=0;i<2;i++)buffers[j].add([j*10+i,0,0],[0,20,0],[1,1,1,1]);
  const a=createNativeTrailGeometry(),b=createNativeTrailGeometry(),before=a.sample(buffers[0]).positions.slice();
  b.sample(buffers[1]);assert.deepEqual(a.sample(buffers[0]).positions,before);
  assert.notEqual(a.sample(buffers[0]).positions.buffer,b.sample(buffers[1]).positions.buffer);
  assert.throws(()=>createNativeTrailGeometry({scale:0}),/scale/);
});

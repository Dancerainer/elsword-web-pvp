import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderQuality,renderPixelRatio} from '../../apps/web/render-quality.mjs';

test('automatic pixel budget bounds high DPI and large windows without changing CSS size',()=>{
  const size={width:1920,height:1080,devicePixelRatio:2};
  const ratio=renderPixelRatio(size);assert.ok(ratio<=1);assert.ok(size.width*size.height*ratio*ratio<=1600001);
  assert.ok(renderPixelRatio({...size,mode:'performance'})<ratio);
  assert.ok(renderPixelRatio({...size,mode:'sharp'})>ratio);
  assert.equal(renderPixelRatio({width:800,height:600,devicePixelRatio:1}),1);
  assert.equal(renderPixelRatio({width:0,height:0}),1);
});

test('adaptive resolution ignores isolated spikes and paused/background gaps, degrades gradually and recovers slowly',()=>{
  let changes=0;const q=createRenderQuality({onChange:()=>changes++});
  const run=(n,ms,active=true)=>{for(let i=0;i<n;i++)q.sample(ms,{active});};
  run(119,16);run(1,100);assert.equal(changes,0);
  run(120,30);assert.equal(q.proof().scale,.9);assert.equal(changes,1);
  run(600,1000);run(600,30,false);assert.equal(q.proof().scale,.9);
  run(599,16);assert.equal(q.proof().scale,.9);run(1,16);assert.equal(q.proof().scale,.95);
  run(1200,30);assert.equal(q.proof().scale,.65);run(12000,16);assert.equal(q.proof().scale,1);
});

test('explicit quality persists, stays fixed under load, and denied storage remains usable',()=>{
  let saved;const storage={getItem:()=>saved,setItem:(_key,value)=>{saved=value;}};
  const q=createRenderQuality({storage});q.setMode('performance');assert.equal(saved,'performance');
  for(let i=0;i<1000;i++)q.sample(60);assert.equal(q.proof().scale,1);
  assert.equal(createRenderQuality({storage}).mode,'performance');
  assert.throws(()=>q.setMode('invalid'),/quality/);
  const denied=createRenderQuality({storage:{getItem(){throw Error();},setItem(){throw Error();}}});
  denied.setMode('sharp');assert.equal(denied.mode,'sharp');
});

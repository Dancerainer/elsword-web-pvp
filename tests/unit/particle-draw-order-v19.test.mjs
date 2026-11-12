import test from 'node:test';
import assert from 'node:assert/strict';
import {particlesInNativeDrawOrder,nativeEffectLayer} from '../../apps/web/particle-draw-order.mjs';

test('native alpha draw order uses layer first, then sequence center distance, preserving particle birth order',()=>{
 const particle=(id,emitterId,layer,position)=>({id,emitterId,template:{fields:{Layer:layer}},position,options:{}});
 const rows=[particle(1,10,16,[0,0,9999]),particle(2,20,13,[0,0,0]),particle(3,30,16,[0,0,0]),particle(4,10,16,[0,0,0])];
 const runtime={particles:new Map(rows.map(p=>[p.id,p])),emitters:new Map([
  [10,{position:[0,0,0]}],[20,{position:[0,0,0]}],[30,{position:[0,0,-1000]}],
 ])};
 assert.deepEqual(particlesInNativeDrawOrder(runtime,[0,0,1]).map(p=>p.id),[2,3,1,4]);
 assert.deepEqual([...runtime.particles.keys()],[1,2,3,4],'render sorting does not mutate runtime order or event state');
 assert.equal(nativeEffectLayer({}),0,'source Object constructor default');
});

test('hidden and native nonpositive DrawCount meshes do not enter the render queue',()=>{
 const p=(id,fields,options={})=>({id,emitterId:id,position:[0,0,0],template:{fields},options});
 const rows=[p(1,{DrawCount:-1}),p(2,{DrawCount:0}),p(3,{DrawCount:1},{hidden:true}),p(4,{DrawCount:2,Layer:14})];
 assert.deepEqual(particlesInNativeDrawOrder({particles:new Map(rows.map(v=>[v.id,v])),emitters:new Map()},[0,0,0]).map(v=>v.id),[4]);
});

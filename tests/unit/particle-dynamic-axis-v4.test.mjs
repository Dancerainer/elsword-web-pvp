import test from 'node:test';
import assert from 'node:assert/strict';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
const near=(actual,expected)=>actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-4,JSON.stringify({actual,expected})));
const event=(property,value)=>({property,value,start:0,end:0,fade:false});
const template=trace=>({name:'source-order-probe',kind:'particle',fields:{Lifetime:2,NumParticles:8,TriggerCount:3,Emitrate:10,Trace:trace},
  events:[event('Velocity',[100,0,0]),event('DirSpeed',100)],textures:{},unsupported:[]});

for(const trace of [false,true])test(`changing sequence axes preserves birth visual rotation and native movement phase, Trace=${trace}`,()=>{
  const source=template(trace),runtime=createEffectRuntime({index:{templates:{[source.name]:source}}});
  const rotation={axis:[0,0,0],addRotate:[0,0,0]};
  const emitter=runtime.add(source.name,{position:[0,0,0],rotationSource:()=>rotation});
  runtime.step(.1,{});const first=[...runtime.particles.values()][0];
  assert.deepEqual(first.axis,[0,0,0]);assert.deepEqual(first.visualRotation,[0,0,0]);
  rotation.axis[1]=rotation.addRotate[1]=90;
  runtime.step(.1,{});const second=[...runtime.particles.values()][1];
  near(first.position,[10,0,0]); // Previous packet had no prepared Velocity yet.
  assert.deepEqual(first.axis,[0,trace?90:0,0]);assert.deepEqual(first.visualRotation,[0,0,0]);
  assert.deepEqual(second.axis,[0,90,0]);assert.deepEqual(second.visualRotation,[0,90,0]);
  const firstBasis=first.axisBasis;
  runtime.step(.1,{});
  // DirSpeed uses original global+local visual rotation, Velocity uses its
  // separately updated Trace axis (.h349–390, .cpp3091–3095/5189/5242).
  near(first.position,trace?[20,0,-10]:[30,0,0]);near(second.position,[0,0,-10]);
  assert.equal(first.axisBasis,firstBasis,'axis updates reuse the cached basis object');
  emitter.options.rotationSource=null;runtime.stop(emitter.id);
  rotation.axis[1]=rotation.addRotate[1]=180;runtime.step(.1,{});
  assert.deepEqual(first.axis,[0,trace?90:0,0],'owner retirement freezes the last sequence axes');
});

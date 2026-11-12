import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileEvents,sampleEvents,createEventSample,sampleEventsToRef,seededRandom,createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
const index=JSON.parse(readFileSync(new URL('../../contracts/rf-fx-index.json',import.meta.url)));

test('reused samples equal retained stateless evaluation at every original event boundary for all target templates',()=>{
  for(const template of Object.values(index.templates))for(const seed of [1,2016]){
    const channels=compileEvents(template,seededRandom(seed)),values=createEventSample(channels),refs=new Map(['Color','Size','Rotate','Velocity'].map(key=>[key,values[key]]));
    const ages=[0,.001,.016,.16,.6,1.5,...template.events.flatMap(event=>[event.start,(event.start+event.end)/2,event.end])];
    // Reverse ages exercise reset-to-defaults: this is stateless sampling,
    // not a stateful fade which accidentally retains a previous late value.
    for(const age of [...ages,...ages.toReversed()]){
      assert.deepEqual(sampleEventsToRef(channels,age,values),sampleEvents(channels,age),template.name+'@'+age);
      for(const [key,ref]of refs)assert.equal(values[key],ref,template.name+' owns a stable '+key+' vector');
    }
  }
});

test('particles own their sample vectors; updating one cannot mutate another or source declarations',()=>{
  const template=index.templates.RavenHandFireP03,before=JSON.stringify(template),channels=compileEvents(template,()=>.5),a=createEventSample(channels),b=createEventSample(channels);
  sampleEventsToRef(channels,.7,a);assert.deepEqual(b,sampleEvents(channels,0));
  assert.notEqual(a.Color,b.Color);assert.notEqual(a.Size,b.Size);assert.equal(JSON.stringify(template),before);
});

test('independent FinalParticleList resets parent transform, cap overrides and attachment by the original NULL-owner contract',()=>{
  const child={name:'source-final',kind:'particle',unsupported:[],fields:{Emitrate:60,Lifetime:.5,NumParticles:4,TriggerCount:4},events:[]};
  const parent={name:'source-parent',kind:'particle',unsupported:[],fields:{Emitrate:60,Lifetime:.01,NumParticles:1,FinalParticleList:child.name},events:[]};
  const r=createEffectRuntime({index:{templates:{[child.name]:child,[parent.name]:parent}}});
  r.emitParticle(parent.name,{position:[30,40,50],rotate:[10,20,30],scale:[8,8,8],facing:-1,traceMore:true,triggerCount:1,triggerTime:0,anchor:()=>[999,0,0]});
  r.step(1/60,{});const final=[...r.emitters.values()].find(e=>e.name===child.name);assert.ok(final);
  assert.deepEqual(final.position,[999,0,0]);assert.equal(final.limit,4);assert.equal(final.duration,-1);
  for(const key of ['anchor','rotate','scale','facing'])assert.equal(final.options[key],undefined,key);
  for(let i=0;i<4;i++)r.step(1/60,{});assert.equal(final.particles.size,4);r.step(1,{});assert.equal(r.count,0);
});

test('supplied original land plane clamps and bounces debris without altering horizontal channels',()=>{
  for(const speed of [-40,-200]){
    const t={name:'land',kind:'particle',unsupported:[],fields:{Emitrate:0,Lifetime:2,NumParticles:1,UseLand:true},events:[{property:'Velocity',start:0,end:0,fade:false,value:[100,speed,0]}]};
    const r=createEffectRuntime({index:{templates:{land:t}}}),p=r.emitParticle('land',{position:[0,10,0],landPosition:10});
    r.step(.125,{});r.step(.125,{});assert.equal(p.position[1],10);assert.equal(p.position[0],12.5);
    assert.equal(p.velocity[1],speed===-40?0:100);assert.equal(p.velocityAccum[1],speed===-40?0:12.5);
  }
});

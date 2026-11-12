import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEffectRuntime,compileEvents,createEventSample,sampleEventsToRef,seededRandom} from '../../packages/effect-runtime/index.mjs';
import {isParticleControlEvent} from '../../packages/effect-runtime/particle-control-events.mjs';

const ids=['rf','lk','vc','rs','is','bm','lp','mm','de','gm','bh','ca'];
const source=id=>JSON.parse(readFileSync(new URL(`../../contracts/${id}-fx-index.json`,import.meta.url)));
const randomValue=value=>Array.isArray(value)?value.some(randomValue):
  !!(value&&typeof value==='object'&&Array.isArray(value.random));
const display=t=>t.kind==='particle'?{...t,events:t.events.filter(event=>event.property.toUpperCase()!=='VELOCITY'&&!isParticleControlEvent(event))}:t;
const particle=(name,events,fields={})=>({name,kind:'particle',unsupported:[],events,
  fields:{NumParticles:100,Emitrate:100,Lifetime:2,Emitradius:[0,0,0],...fields}});

test('all twelve professions share only fixed display plans while samples stay private and source declarations unchanged',()=>{
  let checked=0;
  for(const id of ids){
    const index=source(id);
    for(const template of Object.values(index.templates)){
      if(template.kind!=='particle'||template.unsupported.length||display(template).events.some(e=>randomValue(e.value)))continue;
      const before=JSON.stringify(template),runtime=createEffectRuntime({index});
      const a=runtime.emitParticle(template.name),b=runtime.emitParticle(template.name);
      if(!a||!b){runtime.clear();continue;}
      assert.strictEqual(a.channels,b.channels,`${id}/${template.name}: one fixed plan`);
      const reference=compileEvents(display(template),seededRandom(2016));
      // The runtime's Velocity channel is separately advanced by native
      // activation clocks, so compare the independent display destinations.
      const first=createEventSample(a.channels),second=createEventSample(b.channels);
      const ages=[0,.001,.25,1,...template.events.flatMap(event=>[event.start-1e-6,event.start,event.end,event.end+1e-6])];
      for(const age of ages){
        const expected=createEventSample(reference);sampleEventsToRef(reference,age,expected);
        assert.deepEqual(sampleEventsToRef(a.channels,age,first),expected,`${id}/${template.name}@${age}`);
        assert.deepEqual(sampleEventsToRef(b.channels,age,second),expected);
      }
      for(const key of ['Color','Size','Rotate','Tex0UV','Tex1UV','Tex2UV'])
        if(Array.isArray(a.values[key]))assert.notStrictEqual(a.values[key],b.values[key]);
      assert.equal(JSON.stringify(template),before);
      runtime.clear();assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);checked++;
    }
  }
  assert.ok(checked>1000,`current original templates checked: ${checked}`);
});

test('random display declarations retain private plans and exactly one native RNG resolution per particle',()=>{
  const template=particle('random',[{property:'Size',start:0,end:0,value:[{random:[1,2]},3,4]},
    {property:'Color',start:0,end:1,fade:true,value:[1,{random:[.1,.9]},1,0]}]);
  const nativeCalls=[],expectedCalls=[];
  const nativeRandom=calls=>({randomFloat(min,max,value){
    calls.push([min,max,value]);return Math.fround(min+Math.fround((max-min)*Math.fround(value/32768)));
  }});
  const before=JSON.stringify(template),rng=seededRandom(9),expected=[];rng.nativeRandom=nativeRandom(expectedCalls);
  for(let i=0;i<3;i++)expected.push(createEventSample(compileEvents(template,rng)));
  const runtime=createEffectRuntime({index:{templates:{random:template}},seed:9,nativeRandom:nativeRandom(nativeCalls)});
  const particles=Array.from({length:3},()=>runtime.emitParticle('random'));
  assert.equal(new Set(particles.map(p=>p.channels)).size,3);
  assert.deepEqual(particles.map(p=>p.values),expected);
  assert.deepEqual(nativeCalls,expectedCalls);
  assert.equal(JSON.stringify(template),before);
});

test('random native Velocity remains per birth when the independent display channels are fixed',()=>{
  const template=particle('velocity',[{property:'Velocity',start:0,end:0,value:[{random:[1,10]},0,0]},
    {property:'Size',start:0,end:0,value:[4,5,6]}]);
  const runtime=createEffectRuntime({index:{templates:{velocity:template}},seed:11});
  const a=runtime.emitParticle('velocity'),b=runtime.emitParticle('velocity');
  assert.strictEqual(a.channels,b.channels);assert.notEqual(a.velocity[0],b.velocity[0]);
  runtime.step(.1,{});assert.notEqual(a.values.Velocity[0],b.values.Velocity[0]);
  assert.deepEqual(a.values.Size,[4,5,6]);assert.deepEqual(b.values.Size,[4,5,6]);
  a.values.Size[0]=99;assert.equal(b.values.Size[0],4);
  runtime.step(.1,{});assert.equal(a.values.Size[0],4);assert.equal(b.values.Size[0],4);
});

test('clearing a populated packet releases its old owner callbacks and restarts without replaying particles',()=>{
  const template=particle('packet',[{property:'Color',start:0,end:0,value:[1,1,1,1]}]);
  const runtime=createEffectRuntime({index:{templates:{packet:template}}});let anchors=0;
  const old=runtime.add('packet',{anchor(){anchors++;return [1,2,3];}});
  runtime.step(.1,{});assert.equal(anchors,1);assert.ok(runtime.count>0);
  runtime.clear();assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
  runtime.step(.1,{});assert.equal(anchors,1);assert.equal(runtime.count,0);
  const fresh=runtime.add('packet');assert.equal(fresh.id,old.id);
  runtime.step(.1,{});assert.equal(anchors,1);assert.ok(runtime.count>0);
  assert.deepEqual(fresh.position,[0,0,0]);runtime.clear();
});

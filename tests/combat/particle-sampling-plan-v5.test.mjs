import test from 'node:test';
import assert from 'node:assert/strict';
import {compileEvents,createEventSample,sampleEventsToRef,seededRandom,resolveValue} from '../../packages/effect-runtime/index.mjs';
import {visualIndex} from '../helpers/rf-passive-fixture-v12.mjs';

// Retained pre-optimization stateless evaluator. Its literal constructor
// values and fade/Scale arithmetic are independent of the optimized plan.
const initial={Color:[1,1,1,1],Size:[1,1,1],Rotate:[0,0,0],Velocity:[0,0,0],Scale:1,Stretch:1,DirSpeed:0,AniSpeed:1,Tex0UV:[0,0],Tex1UV:[0,0],Tex2UV:[0,0]};
const compatible=(a,b)=>Array.isArray(b)?Array.isArray(a)&&a.length===b.length&&b.every((v,i)=>compatible(a[i],v)):typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b);
const interpolate=(a,b,t)=>Array.isArray(b)?b.map((v,i)=>interpolate(a[i],v,t)):typeof b==='number'?a+(b-a)*t:b;
function previousSample(channels,age){
 const values={...initial};
 for(const [property,events]of channels){let value=initial[property]??null;
  for(const event of events){if(age<event.start)break;
   const target=event.scaleOperation?value.map(n=>Math.fround(Math.fround(n)*Math.fround(event.value))):event.value;
   if(event.fade&&event.end>event.start){if(!compatible(value,target))continue;
    value=interpolate(value,target,Math.max(0,Math.min(1,(age-event.start)/(event.end-event.start))));
   }else value=target;
  }
  values[property]=value;
 }
 return values;
}
const vectorProperties=Object.keys(initial).filter(key=>Array.isArray(initial[key]));
test('all current actual templates retain pre-optimization samples, key order and random streams at every boundary',()=>{
 for(const template of Object.values(visualIndex.templates))for(const seed of [1,2016,0xffffffff]){
  const rng=seededRandom(seed),referenceRng=seededRandom(seed),before=JSON.stringify(template),channels=compileEvents(template,rng);
  // compileEvents resolves each supported declaration in original order;
  // Crash/reset clocks are deliberately unsupported before RNG evaluation.
  for(const event of template.events)if(!['CRASH','RESETCRASH','EVENTTIMER'].includes(event.property.toUpperCase()))resolveValue(event.value,referenceRng);
  const values=createEventSample(channels),other=createEventSample(channels),refs=new Map(vectorProperties.map(key=>[key,values[key]]));
  const ages=[-.001,0,.001,.016,.16,.6,1.5,...template.events.flatMap(event=>[event.start-.000001,event.start,(event.start+event.end)/2,event.end,event.end+.000001])];
  for(const age of [...ages,...ages.toReversed()]){
   const expected=previousSample(channels,age);
   assert.deepEqual(sampleEventsToRef(channels,age,values),expected,`${template.name}/${seed}@${age}`);
   assert.deepEqual(Object.keys(values),Object.keys(expected));
   for(const [key,ref]of refs)assert.equal(values[key],ref,`${template.name} stable ${key}`);
  }
  assert.deepEqual(other,previousSample(channels,0),`${template.name} independent destination`);
  for(const key of vectorProperties)assert.notEqual(values[key],other[key],`${template.name} private ${key}`);
  assert.equal(rng(),referenceRng(),`${template.name} random cursor`);
  assert.equal(JSON.stringify(template),before,`${template.name} source unchanged`);
 }
});

test('pre-start defaults, late absolute overwrite, fade overflow and unsupported shape preserve legacy behavior',()=>{
 const cases=[
  {events:[{property:'SIZE',start:.5,end:.5,value:[4,5,6]},{property:'Size',start:.7,end:1,fade:true,value:[7,8,9]}]},
  {events:[{property:'STRETCH',start:0,end:0,value:Number.MAX_VALUE},{property:'Stretch',start:0,end:1,fade:true,value:-Number.MAX_VALUE},{property:'Stretch',start:.25,end:2,fade:true,value:1}]},
  {events:[{property:'Scale',start:0,end:1,fade:true,value:2},{property:'Size',start:.5,end:.6,value:[8,9,10]}]},
  {events:[{property:'Size',start:0,end:1,fade:true,value:[1,2]},{property:'UnknownVector',start:0,end:1,fade:true,value:[4,5,6]},{property:'Color',start:0,end:0,value:[1,1,1,NaN]}]},
 ];
 for(const template of cases){const channels=compileEvents(template),values=createEventSample(channels);
  for(const age of [1.5,.75,.5,.25,0,-1,1])assert.deepEqual(sampleEventsToRef(channels,age,values),previousSample(channels,age));
 }
 assert.throws(()=>compileEvents({events:[{property:'Size',start:0,end:0,value:[{random:[NaN,1]},2,3]}]}),/Invalid effect random interval/);
});

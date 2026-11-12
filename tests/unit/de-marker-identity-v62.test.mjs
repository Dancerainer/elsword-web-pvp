import test from 'node:test';
import assert from 'node:assert/strict';
import {deMarkerIdentity} from '../../tools/validation/diagnose-de-marker-alias-v62.mjs';

const marker=()=>({name:'void-early-fade-mid',at:123,time:2.5,frame:150,alpha:.58,currentId:1,
 batches:[{name:'native-particle:ATT_Void_Field_P01',instances:2,center:[1,2,0],
  sequence:{emitterId:4,distance:15.1327,particleOrder:0,drawOrder:1,childOrder:0}}]});

test('only mutable sorting distance is excluded, without changing either original',()=>{
 const a=marker(),b=marker();b.batches[0].sequence.distance=15.145;
 assert.deepEqual(deMarkerIdentity(a),deMarkerIdentity(b));
 assert.equal(a.batches[0].sequence.distance,15.1327);assert.equal(b.batches[0].sequence.distance,15.145);
});
test('missing, negative and nonfinite sorting diagnostics remain invalid',()=>{
 for(const v of [undefined,-1,NaN,Infinity]){const a=marker();a.batches[0].sequence.distance=v;assert.throws(()=>deMarkerIdentity(a));}
 const a=marker();delete a.batches[0].sequence.distance;assert.throws(()=>deMarkerIdentity(a));
});
test('all visual, timing and sequence identity fields remain exact',()=>{
 for(const mutate of [a=>a.alpha=0,a=>a.time++,a=>a.frame++,a=>a.currentId=2,
  a=>a.batches[0].instances++,a=>a.batches[0].center[0]++,a=>a.batches[0].name+='changed',
  a=>a.batches[0].sequence.emitterId++,a=>a.batches[0].sequence.drawOrder++,
  a=>a.batches[0].sequence.particleOrder++,a=>a.batches[0].sequence.childOrder++,
  a=>a.batches.push(structuredClone(a.batches[0]))]){
  const a=marker();mutate(a);assert.notDeepEqual(deMarkerIdentity(a),deMarkerIdentity(marker()));
 }
});

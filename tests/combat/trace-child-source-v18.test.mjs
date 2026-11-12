import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';

const native=readFileSync(new URL('../../.cache/native-reference/KTDXLIB/KTDGParticleSystem.cpp',import.meta.url));
const source=native.toString('latin1');
const proof=JSON.parse(readFileSync(new URL('../../reports/rf-trace-child-source-v18.json',import.meta.url)));
const template=(name,fields={},events=[])=>({name,kind:'particle',unsupported:[],repeated:{},
  fields:{Emitrate:200,NumParticles:1,Lifetime:2,TriggerCount:1,...fields},events});
const velocity=value=>({property:'Velocity',start:0,end:0,fade:false,value});
const parent=template('parent',{Emitrate:0,TraceParticleList:'child'},[velocity([0,0,0])]);
const child=template('child',{Emitradius:[1,2,3],BillBoardType:'BT_ALL'},[velocity([100,0,0])]);

test('fixed V5 original callsite and independent compiled recordings use NULL, template overrides and zero constructor axis',()=>{
  assert.equal(createHash('sha256').update(native).digest('hex'),proof.sourceSha256);
  assert.equal(proof.sourceSha256,'43b5025740ed9c89a5f6f3617789abd68bcb18aaf8aaddef1b5ca9d3b9334050');
  assert.equal(proof.targetClientMeasured,false);assert.equal(proof.fullNativeConsumerExecuted,false);
  assert.match(source,/INIT_VECTOR3\( m_AxisAngleDegree, 0\.0f, 0\.0f, 0\.0f \)/);
  assert.match(source,/CreateSequence\( NULL, m_TraceSeqNameList\[i\]\.c_str\(\), pPart->m_vPos, -1, -1, -1, -1, -1\.0f, true, 0\.0f, true \)/);
  const clone=source.slice(source.indexOf('CParticleEventSequence::GetCloneSequence()'),source.indexOf('CParticleEventSequence::GetCloneSequence()')+8000);
  assert.match(clone,/clone->SetTriggerCount\( GetTriggerCount\(\) \)/);
  assert.match(clone,/clone->SetDrawCount\( GetDrawCount\(\) \)/);
  assert.doesNotMatch(clone,/SetAxisAngleDegree/);
  assert.equal(proof.cases.length,4);
  for(const entry of proof.cases){assert.deepEqual(entry.handles,[1,2,3]);
    for(const call of entry.calls){assert.equal(call.nullUnit,true);assert.deepEqual(call.axis,[0,0,0]);
      for(const key of ['minRate','maxRate','drawCount','triggerCount','triggerTime'])assert.equal(call[key],-1);
      assert.equal(call.nextFrame,true);assert.deepEqual(call.position,[1,2,3]);}}
});

test('native optional ScaleByUnit propagation is distinct from EffectSet local scale',()=>{
  const plain=proof.cases.find(c=>c.variant==='plain');
  const giant=proof.cases.find(c=>c.variant==='giant');
  const conditional=proof.cases.filter(c=>c.variant==='conditional-unit-scale');
  assert.ok(plain.calls.every(c=>c.scaleByUnit.every(n=>n===1)));
  assert.ok(giant.calls.every(c=>JSON.stringify(c.scaleByUnit)==='[4,5,6]'));
  for(const entry of conditional)assert.ok(entry.calls.every(c=>JSON.stringify(c.scaleByUnit)===JSON.stringify(entry.applyUnitScale?[4,5,6]:[1,1,1])));
});

test('Trace child restores its own template caps, trigger, attachment, axis and clock rather than parent overrides',()=>{
  const runtime=createEffectRuntime({index:{templates:{parent,child}}});
  const root=runtime.emitParticle('parent',{position:[10,20,30],rotate:[17,123,45],facing:-1,
    scale:[9,8,7],triggerCount:8,triggerTime:4,emitRate:0,billboardType:'BT_NONE',trace:true,traceMore:true,follow:true,
    anchor:()=>[500,600,700],sourceControl:()=>({position:[5,6,7],velocity:[0,0,0],nowLifeTime:1,animationTime:4}),
    effectParentId:321,cancel:()=>false,depth:2});
  const emitter=runtime.emitters.get(root.children[0]);
  assert.deepEqual(Object.keys(emitter.options).sort(),['depth','effectQuality','parentParticleId','position','traceMore']);
  assert.deepEqual(emitter.options.effectQuality,{level:'high',particleDivisor:1},'display quality propagates independently of native constructor overrides');
  assert.equal(emitter.options.traceMore,false);
  assert.equal(emitter.options.depth,3);assert.equal(emitter.options.parentParticleId,root.id);
  assert.equal(emitter.limit,1);assert.equal(emitter.duration,-1);assert.equal(emitter.max,1);
  assert.equal(emitter.options.scale,undefined,'EffectSet scale is not native ScaleByUnit');
  assert.equal(emitter.particles.size,0,'original bNextFrame child starts on the next packet');
  runtime.step(.01,{});const born=[...runtime.particles.values()].find(p=>p.name==='child');
  assert.ok(born,'own Emitrate survives parent emitRate=0');assert.deepEqual(born.axis,[0,0,0]);
  assert.equal(born.age,0);assert.equal(born.facing,1);assert.equal(born.lifetime,2);
  assert.equal(emitter.count,1);
});

for(const facing of [-1,1])for(const rotate of [[0,0,45],[17,123,90]])
test(`independent child literal radius and velocity stay unrotated, parent facing ${facing} and axis ${rotate}`,()=>{
  const runtime=createEffectRuntime({index:{templates:{parent,child}}});
  const root=runtime.emitParticle('parent',{position:[10,20,30],rotate,facing,traceMore:true});
  runtime.step(.01,{});const p=[...runtime.particles.values()].find(p=>p.name==='child');
  assert.deepEqual(p.position,[11,22,33]);assert.deepEqual(p.axis,[0,0,0]);
  runtime.step(.1,{});runtime.step(.1,{});
  assert.deepEqual(p.position,[21,22,33],'source accumulator consumes the previous +10 X packet in world axes');
  assert.deepEqual(root.axis,rotate.map((n,i)=>n+(i===1&&facing<0?180:0)),'parent axis is still applied to the parent');
});

test('parent destruction stops independent child emission and retains its original live tail',()=>{
  const runtime=createEffectRuntime({index:{templates:{parent,child}}}),root=runtime.emitParticle('parent',{rotate:[0,0,45]});
  runtime.step(.01,{});const p=[...runtime.particles.values()].find(p=>p.name==='child'),emitter=runtime.emitters.get(p.emitterId);
  runtime.stop(root.emitterId,true);assert.equal(runtime.particles.has(p.id),true);
  assert.equal(emitter.options.parentParticleId,null);assert.equal(emitter.done,true);
  runtime.step(.5,{});assert.equal(runtime.particles.has(p.id),true);assert.equal(emitter.count,1);
  runtime.step(2,{});assert.equal(runtime.count,0);
});

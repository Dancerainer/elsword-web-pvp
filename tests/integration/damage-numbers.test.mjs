import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {layoutDamageDigits,emitDamageNumber} from '../../apps/web/damage-number-layout.mjs';

const manifest=JSON.parse(readFileSync(new URL('../../artifacts/ui/damage-numbers/manifest.json',import.meta.url)));
test('original PicChar center advance is independent of digit width and facing',()=>{
  assert.deepEqual(layoutDamageDigits(1234.9,[100,500,0],30),[
    {digit:'1',position:[40,500,0]},{digit:'2',position:[70,500,0]},
    {digit:'3',position:[100,500,0]},{digit:'4',position:[130,500,0]},
  ]);
  assert.deepEqual(layoutDamageDigits(12,[100,500,0],26).map(g=>g.position[0]),[74,100]);
  for(const amount of [0,-1,NaN,Infinity,1e22])assert.deepEqual(layoutDamageDigits(amount,[0,0,0],30),[]);
});
test('CreateNewParticle bypasses the zero Emitrate and births all digits simultaneously',()=>{
  const runtime=createEffectRuntime({index:manifest});
  assert.equal(emitDamageNumber(runtime,manifest,{type:'hit',amount:2000,damageNumber:{style:'normal',position:[100,500,0]}}),4);
  assert.equal(runtime.count,4);
  assert.deepEqual([...runtime.particles.values()].map(p=>[p.age,p.options.digit,p.position,p.values.Color]),[
    [0,'2',[40,500,0],[1,.8,0,1]],[0,'0',[70,500,0],[1,.8,0,1]],
    [0,'0',[100,500,0],[1,.8,0,1]],[0,'0',[130,500,0],[1,.8,0,1]],
  ]);
  // Actual UIMajorParticle.txt:1002 declaration; fixed V5 Particle.h:230..231,
  // 349..351 consumes the PREVIOUS accumulator, initially zero. Velocity
  // .cpp:1999..2001,5487 prepares the next interval after movement.
  assert.deepEqual(manifest.templates.PicCharDamage.events.filter(e=>e.property==='Velocity').map(e=>[e.start,e.value[1]]),
    [[0,400],[.1,-400],[.2,200],[.25,-200],[.3,0],[.5,300]]);
  const first=[...runtime.particles.values()][0];
  // Analytic native packet areas: 0,400*.05,400*.05,-400*.1,200*.05,
  // -200*.05. Native Vec3 positions are 500,520,540,500,510,500; the
  // float interval areas differ by <3e-6 when added to JS display positions.
  runtime.step(.05);assert.equal(first.position[1],500);
  runtime.step(.05);assert.equal(first.position[1],520);assert.equal(first.values.Velocity[1],-400);
  runtime.step(.1);assert.equal(first.position[1],540);assert.equal(first.values.Velocity[1],200);
  runtime.step(.05);assert.equal(first.position[1],500);assert.deepEqual(first.values.Size,[40,20,1]);
  runtime.step(.05);assert.ok(Math.abs(first.position[1]-510)<1e-5);assert.deepEqual(first.values.Size,[40,40,1]);
  runtime.step(.35);assert.ok(Math.abs(first.position[1]-500)<1e-5);
  // Particle.cpp:1801..1811: nominal alpha=1-(.65-.5)/(.8-.5)=.5.
  // The binary32 event clock is .649999976; retain its rounding tolerance.
  assert.ok(Math.abs(first.values.Color[3]-.5)<2e-7);
  runtime.step(.151);assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
});
test('native sequence limit is shared across damage strings, not re-created per hit',()=>{
  const runtime=createEffectRuntime({index:manifest}),event={type:'hit',amount:2000,damageNumber:{style:'normal',position:[0,0,0]}};
  for(let i=0;i<30;i++)emitDamageNumber(runtime,manifest,event);
  assert.equal(runtime.count,100);
  assert.equal(emitDamageNumber(runtime,manifest,{...event,damageNumber:{...event.damageNumber,style:'red'}}),4);
  assert.equal(runtime.count,104);runtime.clear();assert.equal(runtime.count,0);
});
test('rejected hits, missing anchors and unknown source styles produce no invented number',()=>{
  const runtime=createEffectRuntime({index:manifest});
  for(const event of [{type:'hit',amount:12},{type:'hitRejected',amount:12,damageNumber:{style:'normal',position:[0,0,0]}},
    {type:'hit',amount:12,damageNumber:{style:'guessCritical',position:[0,0,0]}},
    {type:'hit',amount:12,damageNumber:{style:'normal',position:[NaN,0,0]}}])assert.equal(emitDamageNumber(runtime,manifest,event),0);
  assert.equal(runtime.count,0);assert.equal(runtime.emitParticle('missing'),null);
});

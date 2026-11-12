import test from 'node:test';
import assert from 'node:assert/strict';
import {compileEvents,sampleEvents,sampleProperty,seededRandom} from '../../packages/effect-runtime/index.mjs';
import {visualIndex,profile} from '../helpers/rf-passive-fixture-v12.mjs';

// This compares the retained v17 sampling algorithm with the optimized host.
// It is an equivalence regression, never a 2016 original-client golden answer.
const defaults={Color:[1,1,1,1],Size:[1,1,1],Rotate:[0,0,0],Velocity:[0,0,0],Scale:1,Stretch:1,DirSpeed:0,AniSpeed:1,Tex0UV:[0,0],Tex1UV:[0,0],Tex2UV:[0,0]};
const previousSample=(channels,age)=>Object.fromEntries([...new Set([...Object.keys(defaults),...channels.keys()])].map(key=>[key,sampleProperty(channels,key,age)]));
for(const name of ['Raven_Hand_Fire05','RavenHandFireP01','RavenHandFireP02','RavenHandFireP03','XCrash_ScrachP01'])
test(`${name} preserves every authored/default channel, order and random stream at original event boundaries`,()=>{
  for(const seed of [1,2016,0xffffffff]){
    const random=seededRandom(seed),channels=compileEvents(visualIndex.templates[name],random);
    const ages=[0,.0001,.001,.01,.03,.05,.1,.2,.25,.3,.35,.5,.6,.8,.9,1];
    for(const age of ages){const actual=sampleEvents(channels,age),old=previousSample(channels,age);
      assert.deepEqual(actual,old);assert.deepEqual(Object.keys(actual),Object.keys(old));}
    // Sampling compiled declarations must not consume additional random values.
    const untouched=seededRandom(seed);compileEvents(visualIndex.templates[name],untouched);
    assert.equal(random(),untouched());
  }
});
test('XCrash fire closure retains the target 17 timed emitters and literal source child caps/draw count',()=>{
  const raw=profile.damageEffects.DamageEffect_SA_RRF_XCrash_Fire_FX.raw;
  const entries=Object.entries(raw).filter(([key])=>/^TIME_PARTICLE\d+$/.test(key));
  assert.equal(entries.length,17);
  assert.ok(entries.every(([,entry])=>entry.PARTICLE_NAME==='Raven_Hand_Fire05'&&entry.POSITION_TYPE===0&&entry.USE_GLOBAL_TIME===1));
  const parent=visualIndex.templates.Raven_Hand_Fire05;
  assert.equal(parent.fields.Emitrate,100);assert.equal(parent.fields.NumParticles,80);assert.equal(parent.fields.Lifetime,.9);
  assert.deepEqual(parent.repeated.TraceParticleList,['RavenHandFireP01','RavenHandFireP02','RavenHandFireP03']);
  for(const name of parent.repeated.TraceParticleList){const fields=visualIndex.templates[name].fields;
    assert.equal(fields.NumParticles,1);assert.equal(fields.TriggerCount,1);}
  assert.equal(visualIndex.templates.RavenHandFireP03.fields.DrawCount,2);
});

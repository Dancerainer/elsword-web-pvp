import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAwakeningBeadController,writeAwakeningBeadVertices,RAVEN_BEAD_TEMPLATE} from '../../apps/web/awakening-bead.mjs';
import {compileEvents,sampleEvents} from '../../packages/effect-runtime/index.mjs';
const index=JSON.parse(readFileSync(new URL('../../contracts/rf-awakening-bead-fx-v14.json',import.meta.url)));

test('original target HUD flame retains 2D source texture, explicit colors, size and timing',()=>{
  const t=index.templates[RAVEN_BEAD_TEMPLATE];
  assert.equal(t.fields.particleType,'PT_2D_PLANE');assert.equal(t.fields.Emitrate,20);
  assert.equal(t.fields.Lifetime,.2);assert.equal(t.fields.NumParticles,20);assert.equal(t.fields.DrawCount,3);
  assert.equal(t.fields.SourceBlendMode,'D3DBLEND_SRCALPHA');assert.equal(t.fields.DestBlendMode,'D3DBLEND_DESTALPHA');
  assert.equal(t.textures['secretVelder_perpit_fire_flame.dds'].source.sha256,'f70a64220a5b9a1448b291bbd23447479432c3b69f52988474e6bf248550c0aa');
  const channels=compileEvents(t,()=>.5);
  assert.deepEqual(sampleEvents(channels,0).Size,[30,30,1]);assert.deepEqual(sampleEvents(channels,0).Color,[1,1,.5,1]);
  assert.deepEqual(sampleEvents(channels,.2).Size,[50,50,1]);assert.equal(sampleEvents(channels,.2).Color[3],0);
  assert.deepEqual(sampleEvents(channels,0).Velocity,[0,-75,0]);
  assert.equal(index.clientMeasured,false);
});

test('available third bead owns one persistent emitter and spending it destroys the flame immediately',()=>{
  const view=createAwakeningBeadController({index});
  for(const orbs of [0,1,2]){for(let i=0;i<120;i++)view.step(1/60,orbs);assert.equal(view.runtime.count,0);}
  for(let i=0;i<300;i++)view.step(1/60,3);
  assert.equal(view.proof().emitters,1);assert.ok(view.runtime.count>0&&view.runtime.count<=20);
  const id=[...view.runtime.emitters.keys()][0];for(let i=0;i<60;i++)view.step(1/60,3);
  assert.equal([...view.runtime.emitters.keys()][0],id,'no per-frame sequence restart');
  view.step(0,2);assert.equal(view.runtime.count,0);assert.equal(view.proof().emitters,0);
  view.step(1/60,3);view.clear();assert.equal(view.runtime.emitters.size,0);assert.equal(view.runtime.count,0);
});

test('RHW centered quad applies full size, source rotation and top-row UV without camera input',()=>{
  const particles=[{values:{Size:[30,50,1],Rotate:[0,0,90],Color:[1,.3,.1,.5]},position:[78,76,0]}],buffer=new Float32Array(48);
  assert.equal(writeAwakeningBeadVertices(particles,buffer),6);
  assert.deepEqual([...buffer.slice(0,4)],[103,61,0,0]);
  assert.deepEqual([...buffer.slice(8,12)],[53,61,0,1]);
  assert.deepEqual([...buffer.slice(16,20)],[103,91,1,0]);
  assert.equal(buffer[7],.5);assert.throws(()=>writeAwakeningBeadVertices(particles,new Float32Array(47)),/cap exceeded/);
});

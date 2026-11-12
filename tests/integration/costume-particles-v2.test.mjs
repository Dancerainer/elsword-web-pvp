import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createCostumeParticles} from '../../apps/web/costume-particles.mjs';

test('royal ear particles consume UI-major source, follow both equipment bones, hide, replace and release',()=>{
  const index=JSON.parse(readFileSync(new URL('../../artifacts/costumes/particles.json',import.meta.url)));
  const t=index.templates['costume:Common_Event09_Eff'];
  assert.equal(t.sourceFamily,'ui-major');assert.equal(t.source.name,'UIMajorParticle.txt');
  assert.equal(t.fields.ZWriteEnable,false);assert.equal(t.fields.ZEnable,undefined,'do not use same-named GameMajor declaration');
  const runtime=createEffectRuntime({index}),actor={id:'owner',hp:10},state={actors:[actor]},frozen=JSON.stringify(actor);
  let x=50,bindings=[{template:t.name,position:()=>[x,100,0]},{template:t.name,position:()=>[x,120,0]}];
  const view=createCostumeParticles({runtime,sample:()=>bindings});
  view.step(state);assert.equal(runtime.emitters.size,2);
  for(let i=0;i<80;i++){x++;view.step(state);runtime.step(1/60,state);}
  assert.ok(runtime.particles.size>0);assert.ok(runtime.particles.size<=8);
  assert.ok([...runtime.emitters.values()].every(e=>e.position[0]===x));
  assert.equal(JSON.stringify(actor),frozen,'presentation does not mutate gameplay');
  actor.hidden=true;view.step(state);assert.ok([...runtime.emitters.values()].every(e=>e.options.hidden));
  actor.hidden=false;view.step(state);assert.ok([...runtime.emitters.values()].every(e=>!e.options.hidden));
  bindings=[{template:t.name,position:()=>[0,0,0]}];view.step(state);
  assert.equal(runtime.emitters.size,1);assert.equal(runtime.particles.size,0,'old appearance particles are destroyed');
  view.clear();assert.equal(runtime.emitters.size,0);assert.equal(view.proof().sequences,0);
});

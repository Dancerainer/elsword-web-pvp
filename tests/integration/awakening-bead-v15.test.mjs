import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAwakeningBeadController} from '../../apps/web/awakening-bead.mjs';
const json=name=>JSON.parse(readFileSync(new URL('../../contracts/'+name,import.meta.url)));
const original=json('rf-awakening-bead-fx-v14.json'),index=json('rf-awakening-bead-fx-v15.json');

test('Raven flame birth band is centered on the third orb frame, rather than the decorated texture extent',()=>{
  assert.deepEqual(index.targetFrameLayout.leftTop,[50,54]);
  assert.deepEqual(index.targetFrameLayout.size,[46,41]);
  assert.deepEqual(index.presentation.beadCenter,[73,74.5,0]);
  assert.deepEqual(index.presentation.hudLocalPosition,[73,55.5,0]);
  const view=createAwakeningBeadController({index,nativeRandom:{randomFloat:(min,max)=>(min+max)/2}});
  for(let i=0;i<4;i++)view.step(1/60,3);
  const newborn=[...view.runtime.particles.values()].find(p=>p.age===0);
  assert.ok(newborn);
  assert.deepEqual(newborn.position.slice(0,2),[73,74.5]);
  assert.deepEqual(view.proof().anchor,[73,55.5,0]);
  view.step(0,2);assert.equal(view.runtime.count,0);
});

test('alignment leaves original material, lifetime, emitter rate and particle ranges unchanged',()=>{
  assert.deepEqual(index.templates,original.templates);
  assert.deepEqual(index.consumer,original.consumer);
  assert.deepEqual(index.targetLayout,original.targetLayout);
  assert.equal(index.clientMeasured,false);
  assert.match(index.presentation.classification,/display alignment/);
});

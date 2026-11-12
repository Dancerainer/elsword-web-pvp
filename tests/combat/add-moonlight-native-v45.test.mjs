/** Original actor/effect helpers and collision/damage through the production
 * accepted-hit policy. Static original guards are distinct from client tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
for(const stack of [1,2,3])test(`actual Moonlight field${stack} stack → original Z contact → original explosion mesh damages and consumes439`,()=>{
 const {sim,a,b}=originalAddFixture('DE',{skillId:29024});a.mp=a.mpMax;b.x=115;
 for(let frame=0;frame<350;frame++){
  sim.step(1/60,{add:{pressed:frame===0?['A']:[],held:frame===0?['A']:[]}});
  if(b.buffs.some(row=>row.templateId===439&&row.accumulationCount===stack))break;
 }
 assert.equal(b.buffs.find(row=>row.templateId===439)?.accumulationCount,stack);const hp=b.hp;
 sim.step(1/60,{add:{pressed:['Z'],held:['Z']}});for(let frame=0;frame<20;frame++)sim.step(1/60,{});
 const explosion=sim.state.events.find(e=>e.type==='addMoonlightExplosion');assert.equal(explosion?.stack,stack);
 const hits=sim.state.events.filter(e=>e.type==='hit'&&e.origin?.id===explosion.effectId);
 assert.equal(hits.length,1);assert.ok(hits[0].amount>0);assert.equal(hits[0].data.DAMAGE.MAGIC,[4.65,9.3,13.95][stack-1]);
 assert.equal(hits[0].data.PVP_RATE,.42);assert.ok(b.hp<hp);assert.equal(b.buffs.some(row=>row.templateId===439),false);
 assert.equal(sim.state.events.filter(e=>e.type==='addMoonlightExplosion').length,1,'the triggered explosion cannot recursively consume another stack');
});

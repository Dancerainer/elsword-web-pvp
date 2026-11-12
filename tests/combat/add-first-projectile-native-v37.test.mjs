/** Fresh zero-DP Add commands with original character/effect poses and source
 * collision WASM. Placement is fixture setup; the attack uses normal input. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';

for(const profession of ['LP','MM','DE'])for(const facing of [-1,1])test(`${profession} fresh zero-DP X ${facing} emits and hits before any earlier damage`,()=>{
 const {sim,a,b}=originalAddFixture(profession);a.facing=facing;b.x=250*facing;
 assert.equal(a.sourceAdd.dp,0,'authored fresh dissolution resource');
 const hp=b.hp;
 for(let i=0;i<12;i++)sim.step(1/60,{},{snapshot:false});
 assert.equal(b.hp,hp);assert.equal(a.sourceAdd.dp,0,'idle cannot mask the missing first projectile');
 sim.drainEvents();const events=[];
 for(let i=0;i<180;i++){
  sim.step(1/60,i===0?{[a.id]:{pressed:['X'],held:['X']}}:{},{snapshot:false});
  events.push(...sim.drainEvents());
 }
 assert.ok(events.some(e=>e.type==='effectStarted'&&e.setName==='EffectSet_AN_Combo_X_Projectile'),'normal first X dispatches the original projectile set');
 const firstSpend=events.find(e=>e.type==='addCommandDpSpent');
 assert.ok(firstSpend);assert.equal(firstSpend.amount,0);assert.equal(firstSpend.declaredAmount,2);
 assert.ok(events.some(e=>e.type==='hit'&&e.actorId===a.id&&e.targetId===b.id&&e.amount>0),'original native posed attack reaches the defender');
 assert.ok(b.hp<hp);
});

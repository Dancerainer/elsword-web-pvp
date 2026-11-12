/** Actual enhanced Drone Activator contact: the four authored display IDs
 * remain alive, trace the recipient and expire with the original mark timer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
test('MM original four target marks survive later ticks, follow target movement, then end with the mark',()=>{
 const {sim,a,b}=originalAddFixture('MM',{skillId:29013});a.mp=a.mpMax;a.sourceAdd.dp=8000;b.x=1500;
 for(let i=0;i<210;i++)sim.step(1/60,{add:{pressed:i===0?['A']:[],held:i===0?['A']:[]}});
 b.x=250;
 for(let i=0;i<200&&!a.sourceAddDroneMark;i++)sim.step(1/60,{add:{pressed:i===0?['A']:[],held:i===0?['A']:[]}});
 assert.ok(a.sourceAddDroneMark,'the actual original projectile acquires a target');
 const marks=sim.state.effects.filter(e=>e.sourceAddDroneMarkVisual),ids=marks.map(e=>e.id);assert.equal(ids.length,4);
 for(const e of marks){assert.equal(e.traceActorId,b.id);assert.equal(e.skillId,29035);}
 const start=marks.map(e=>[...(e.currentAnchor??e.birthAnchor).position]);b.x+=100;
 for(let i=0;i<12;i++)sim.step(1/60,{});
 const moved=ids.map(id=>sim.state.effects.find(e=>e.id===id));assert.ok(moved.every(Boolean),'non-damaging source-owned displays cannot retire on their first tick');
 const anchor=sim.effectAnchorSampler({definition:{BONE_NAME:'Bip01'}},b);
 for(let i=0;i<4;i++){
  assert.ok(moved[i].currentAnchor.position[0]>start[i][0]+50);
  assert.deepEqual(moved[i].currentAnchor.position,anchor.position);
 }
 for(let i=0;i<500&&a.sourceAddDroneMark;i++)sim.step(1/60,{});
 assert.equal(a.sourceAddDroneMark,undefined);assert.equal(sim.state.effects.some(e=>ids.includes(e.id)),false);
 assert.equal(sim.state.events.filter(e=>e.type==='effectEnded'&&ids.includes(e.effectId)).length,4);
});

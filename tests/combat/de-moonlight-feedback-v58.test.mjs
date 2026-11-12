/** Source2016 declarations/selected frame + actual original poses/native
 * Garpai collision. This is current Web behavior, not original-client play. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const dt=1/60,stack=b=>b.buffs.find(q=>q.templateId===439)?.accumulationCount??0;
const display=e=>e.setName?.startsWith('EffectSet_Moonlight_Rhapsody_Debuff_Accumulation_Display_');
const stateName=(sim,a)=>sim.profileFor(a).states[a.state].sourceState??a.state;
function until(f,predicate,input={},limit=200){for(let i=0;i<limit&&!predicate();i++)f.sim.step(dt,input,{snapshot:false});assert.ok(predicate(),'bounded real input/state reached');}
function owned(f,frameSeq=100){
 const wire=JSON.parse(JSON.stringify(encodeOwnedState(f.sim,f.a.id,{epoch:1,frameSeq})));
 validateOwnedState(wire);validateOwnedReferences(wire,f.a,f.sim.profileFor(f.a),f.sim.map,{actors:f.sim.state.actors,profiles:f.sim.profiles});
 applyOwnedState(f.sim,f.a.id,wire);return wire;
}

for(const formed of [false,true])test(`Moonlight formed=${formed}: a real aura applies one periodic stack and one matching display; native Z explodes and staggers once`,()=>{
 const f=originalAddFixture('DE',{skillId:29024}),{sim,a,b}=f;a.mp=a.mpMax;b.x=115;b.hp=b.hpMax=9999999;
 if(formed){a.sourceAdd.formation=true;a.sourceAdd.dp=8000;a.sourceAdd.mutation=1;sim.step(dt,{}, {snapshot:false});}
 sim.step(dt,{add:{pressed:['A'],held:['A']}},{snapshot:false});
 const times=[];let old=0;
 until(f,()=>stack(b)===1,{},250);
 const period=a.sourceAddCombat.moonlight.period;
 assert.equal(period,formed?Math.fround(.66):1);
 for(let wanted=1;wanted<=3;wanted++){
  until(f,()=>stack(b)===wanted,{},100);times.push(sim.state.time);
  const shown=sim.state.effects.filter(e=>e.ownerId===b.id&&!e.dead&&display(e));
  assert.equal(shown.length,1,'a stack is one original alternative display, never all three simultaneously');
  assert.ok(shown[0].setName.endsWith('_0'+wanted));
  const before=stack(b);for(let i=0;i<8;i++)sim.step(dt,{}, {snapshot:false});assert.equal(stack(b),before,'one wave cannot instantly add its remaining two stacks');
  if(wanted===1)owned(f);
 }
 for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]>=period-2*dt);
 const changes=sim.state.events.filter(e=>e.type==='effectStarted'&&e.actorId===b.id&&display(e));
 assert.equal(changes.length,3,'stack display is replaced only when the count changes');
 const hp=b.hp;sim.step(dt,{add:{pressed:['Z'],held:['Z']}},{snapshot:false});
 until(f,()=>sim.state.events.some(e=>e.type==='addMoonlightExplosion'),{},80);
 const explosion=sim.state.events.find(e=>e.type==='addMoonlightExplosion');assert.equal(explosion.stack,3);
 until(f,()=>sim.state.events.some(e=>e.type==='hit'&&e.origin?.id===explosion.effectId),{},30);
 const hit=sim.state.events.find(e=>e.type==='hit'&&e.origin?.id===explosion.effectId);
 assert.ok(hit.amount>0);assert.equal(hit.data.DAMAGE.MAGIC,13.95);assert.equal(hit.data.PVP_RATE,.42);assert.equal(hit.data.REACT_TYPE,2);
 assert.ok(b.hp<hp);assert.equal(stack(b),0);assert.ok(b.state.includes('DAMAGE_BIG'));
 assert.equal(sim.state.events.filter(e=>e.type==='addMoonlightExplosion').length,1);
});

test('Moonlight real enemy outside the finite source aura does not gain new stacks, then returning waits for a later pulse',()=>{
 const f=originalAddFixture('DE',{skillId:29024}),{sim,a,b}=f;a.mp=a.mpMax;b.x=115;
 sim.step(dt,{add:{pressed:['A'],held:['A']}},{snapshot:false});until(f,()=>stack(b)===1,{},250);
 b.x=2000;for(let i=0;i<135;i++)sim.step(dt,{}, {snapshot:false});assert.equal(stack(b),1);
 // Return after the last wave's original .5-second attack helper expires.
 // Returning during a live half-second wave may legitimately contact it.
 until(f,()=>a.sourceAddCombat.moonlight.accumulator>.7,{},100);
 const pulseCount=sim.state.events.filter(e=>e.type==='addMoonlightPulse').length;
 Object.assign(b,{x:115,y:a.y,z:a.z,grounded:a.grounded,lineId:a.lineId,vx:0,vy:0});
 until(f,()=>stack(b)===2,{},100);
 assert.ok(sim.state.events.filter(e=>e.type==='addMoonlightPulse').length>pulseCount,'a later original wave, rather than out-of-range per-frame accumulation, grants the next stack');
});

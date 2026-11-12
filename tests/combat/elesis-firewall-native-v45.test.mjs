import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {requestElesisFirewall,tickElesisFirewalls,validateElesisFirewalls} from '../../packages/combat-core/elesis-firewall-v45.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const tick=(f,dt=1/60)=>{f.sim.state.time+=dt;tickElesisFirewalls(f.sim,f.a,dt);f.sim.tickEffects(dt);};
function source(branchId='none',gap=500,dt=1/60){const f=elesisFixture('BH',{skillId:28018,gap,branchId});
 // A real input constructs the source trait policy, then independent NPC
 // ticks isolate the immunity-to-time-stop path from character animation.
 f.sim.step(dt,{elesis:{pressed:['A'],held:['A']}},{snapshot:false});
 for(let i=0;i<10&&!f.a.sourceElesisFirewallRequests;i++)f.sim.step(dt,{}, {snapshot:false});
 assert.ok(f.a.sourceElesisFirewallRequests);return f;}
test('22 originalNPC contact and5s custom position wall use native helpers and stay fixed while caster moves',()=>{
 const f=source();for(let i=0;i<30&&!f.sim.state.events.some(e=>e.type==='elesisFirewallNpcWait');i++)tick(f);
 const event=f.sim.state.events.find(e=>e.type==='elesisFirewallNpcWait');assert.ok(event.afterContact);assert.ok(Math.abs(event.position[0]-f.b.x)<120);
 const e=f.sim.state.effects.find(e=>e.name==='DamageEffect_Wall_of_Prominence_Attack_Main');assert.ok(e);assert.equal(e.definition.SCALE_X,1.2);assert.equal(e.definition.SCALE_Y,1.44);
 const anchor=structuredClone(e.birthAnchor);f.a.x+=1000;for(let i=0;i<10;i++)tick(f);assert.deepEqual(e.currentAnchor,anchor);assert.ok(f.b.hp<f.b.hpMax);
 for(let i=0;i<310;i++)tick(f);assert.ok(!f.sim.state.effects.some(e=>e.skillId===28018&&e.damage));
});
test('22 no target uses original .29 walk limit and global NPC clock progresses during caster STOP',()=>{
 const f=source('none',5000);f.a.hitStop=10;for(let i=0;i<25;i++)tick(f);
 const event=f.sim.state.events.find(e=>e.type==='elesisFirewallNpcWait');assert.ok(event);assert.equal(event.afterContact,false);
 // The verified original NPC consumer integrates nowSpeed before copying
 // passive3000 and subtracts RELOAD_ACCEL2000 each physics frame. At60Hz
 // the .29 gate expires on frame18: one zero frame +17*(3000-2000/60)/60.
 assert.ok(Math.abs(event.position[0]-(-600)-840.5555556)<.01,'original passive/now hand-off and frame-quantized .29 lifetime');
 assert.equal(f.a.hitStop,10,'NPC clock does not consume character STOP');
});

test('22 original passive speed begins after physics without changing the .066 attack gate',()=>{
 for(const dt of [1/60,1/120]){
  const f=elesisFixture('BH',{skillId:28018,gap:100});requestElesisFirewall(f.sim,f.a);
  const w=f.a.sourceElesisFirewallRequests[0],start=[...w.position];assert.equal(w.nowSpeed,0);
  tick(f,dt);assert.deepEqual(w.position,start);assert.equal(w.nowSpeed,3000);
  tick(f,dt);assert.ok(Math.abs(w.position[0]-start[0]-(3000-2000*dt)*dt)<.0001);
  for(let i=0;i<40&&!f.sim.state.events.some(e=>e.type==='elesisFirewallNpcWait');i++)tick(f,dt);
  const hit=f.sim.state.events.find(e=>e.type==='elesisFirewallNpcContact');assert.equal(hit?.targetId,'target');
  assert.ok(hit.time>=.066,'source attack-open is preserved');assert.ok(f.sim.state.events.find(e=>e.type==='elesisFirewallNpcWait')?.afterContact);
 }
});

test('22 real close100 cast acquires the enemy at60/120Hz and emits an actual damaging wall',()=>{
 for(const dt of [1/60,1/120]){
  const f=source('none',100,dt);
  for(let i=0;i<60&&!f.sim.state.events.some(e=>e.type==='elesisFirewallNpcWait');i++)tick(f,dt);
  assert.ok(f.sim.state.events.find(e=>e.type==='elesisFirewallNpcWait')?.afterContact);
  for(let i=0;i<20;i++)tick(f,dt);assert.ok(f.b.hp<f.b.hpMax);
 }
});

test('22 an authored platform remains the independent NPC floor and wall damages its actual platform target',()=>{
 const f=elesisFixture('BH',{skillId:28018,position:[1140,3320,0],gap:160});
 f.a.lineId=f.a.lastTouchLineId=f.b.lineId=f.b.lastTouchLineId=5;
 requestElesisFirewall(f.sim,f.a);
 for(let i=0;i<35&&!f.sim.state.events.some(e=>e.type==='elesisFirewallNpcWait');i++)tick(f);
 const wait=f.sim.state.events.find(e=>e.type==='elesisFirewallNpcWait');assert.ok(wait?.afterContact);assert.equal(wait.position[1],3320);
 const e=f.sim.state.effects.find(e=>e.name==='DamageEffect_Wall_of_Prominence_Attack_Main');assert.equal(e.birthAnchor.position[1],3320);
 for(let i=0;i<20;i++)tick(f);assert.ok(f.b.hp<f.b.hpMax);
});
test('22 original pending NPC queue has bounded full/critical ownership and receiver never issues a second wall',()=>{
 const f=source(),v=elesisFixture('BH',{skillId:28018,gap:500});v.sim.networkOwnerId='target';
 const p=validateOwnedState(encodeOwnedState(f.sim,'elesis',{epoch:2,frameSeq:2}));
 validateOwnedReferences(p,v.a,v.profile,v.map,{actors:v.sim.state.actors,profiles:v.sim.profiles});applyOwnedState(v.sim,'elesis',p);
 assert.ok(v.a.sourceElesisFirewallRequests);for(let i=0;i<30;i++)tick(v);assert.ok(!v.sim.state.events.some(e=>e.type==='elesisFirewallNpcWait'));
 const bad=structuredClone(v.a);bad.sourceElesisFirewallRequests[0].position[0]=Infinity;assert.throws(()=>validateElesisFirewalls(bad,v.profile,v.map));
 for(const [key,value]of [['nowSpeed',2500],['vy',-100]]){const forged=structuredClone(v.a);forged.sourceElesisFirewallRequests[0][key]=value;assert.throws(()=>validateElesisFirewalls(forged,v.profile,v.map));}
});

test('22 Useful original .55 gap produces more actual main hard-stagger contacts than the1s source gap',()=>{
 const counts=[];
 for(const branch of ['none','memo-64']){
  const f=source(branch);f.b.hp=f.b.hpMax=1e9;
  for(let i=0;i<30&&!f.sim.state.events.some(e=>e.type==='elesisFirewallNpcWait');i++)tick(f);
  const e=f.sim.state.effects.find(e=>e.name==='DamageEffect_Wall_of_Prominence_Attack_Main');assert.ok(e);
  for(let i=0;i<180;i++){f.b.x=e.birthAnchor.position[0]+30;f.b.y=e.birthAnchor.position[1];f.b.z=e.birthAnchor.position[2];tick(f);}
  const hits=f.sim.state.events.filter(h=>h.type==='hit'&&h.origin?.id===e.id);counts.push(hits.length);
  const minimum=branch==='none'?1:.55;for(let i=1;i<hits.length;i++)assert.ok(hits[i].time-hits[i-1].time>=minimum-.00001);
 }
 assert.ok(counts[1]>=counts[0]*1.5,counts.join('/'));
});

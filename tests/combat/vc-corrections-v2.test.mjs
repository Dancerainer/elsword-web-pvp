/** User-reported regressions; live sampled keys, real target assets/map.
 * Numeric expectations are source equations/declarations, not exported traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {createLiteralMesh,stepShadowMesh} from '../../packages/combat-core/shadow-mesh.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const close=(a,b,t=.05)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function mesh(name,{position=[0,1000,0],facing=1,rotation=[0,facing<0?180:0,0],landY=-10000}={}){
 const t=vcProfile.effectTemplates[name];return {s:createLiteralMesh({name,position,facing,rotation,landY,fields:t.fields,events:t.events,velocity:t.initialVelocity??[0,0,0]}),events:t.events};
}
test('angled air cannon moves down in both facings using its original 2000 velocity and -45 roll',()=>{
 for(const facing of[-1,1]){const {s,events}=mesh('RVC_C_dashJumpX_bullet_M01',{facing,rotation:[0,facing<0?180:0,-45]});
  stepShadowMesh(s,.125,events);close(s.position[0],facing*250/Math.sqrt(2));close(s.position[1],1000-250/Math.sqrt(2));close(s.position[2],0);}
});
test('Napalm uses gravity, ground bounce and the same saved mesh position',()=>{
 const {s,events}=mesh('RVC_C_NapalmGrenade_Bullet_M01_1',{position:[0,100,0],landY:0});
 stepShadowMesh(s,.125,events);assert.deepEqual(s.position,[100,184.375,0]);assert.deepEqual(s.velocity,[800,550,0]);
 for(let i=0;i<7;i++)stepShadowMesh(s,.125,events);
 assert.ok(s.position[1]>=0);assert.equal(s.elasticX,.5);assert.ok(s.animationSpeed<1,'source ground elasticity applied');
});
test('mesh Velocity fade integrates its source midpoint, independently of particle fades',()=>{
 const {s,events}=mesh('SA_RVC_IGNITION_CROW_INCINERATION_M01');
 for(let i=0;i<4;i++)stepShadowMesh(s,.25,events);
 close(s.position[0],.34*1500);close(s.velocity[0],3000);assert.equal(s.animationName,'IGNITION_CROW_CROW_END');
 const drop=mesh('RVC_IGNITION_CROW_DROPFIRE');for(let i=0;i<3;i++)stepShadowMesh(drop.s,.25,drop.events);
 close(drop.s.position[1],1000-(.3*1200+.4*850+.05*500));close(drop.s.velocity[1],-500);
});
function inputSequence(buffer,time,i,mode,direction){
 // Physical sampled double tap, no synthetic DASH and no direct state entry.
 if(i===0||i===2)buffer.down(direction,time);if(i===1||i===10)buffer.up(direction,time);
 if(i===3)buffer.down('UP',time);if(i===4)buffer.up('UP',time);
 const attacks=mode==='zxx'?[[10,'Z'],[20,'X'],[30,'X']]:mode==='xx'?[[10,'X'],[20,'X'],[40,'X']]:[[10,'X']];
 for(const [at,key]of attacks){if(i===at)buffer.down(key,time);if(i===at+1)buffer.up(key,time);}
}
for(const facing of[-1,1])for(const mode of['zxx','x','xx'])test(`two consecutive 668${mode.toUpperCase()} sequences restore control, facing ${facing}`,()=>{
 const {sim,a}=vcFixture({position:[facing*-700,3080,0],gap:2500,facing}),buffer=createInputBuffer({sampledLevels:true}),events=[];
 for(let i=0;i<300;i++){
  inputSequence(buffer,sim.state.time+.001,i%150,mode,facing===1?'RIGHT':'LEFT');
  sim.step(1/60,{vc:buffer.consume(sim.state.time+1/60)},{snapshot:false});events.push(...sim.drainEvents());
  if(i===149||i===299){assert.equal(a.state,'RSI_WAIT');assert.equal(a.grounded,true);assert.ok(!a.skillDisableGravity);}
 }
 const wanted=mode==='zxx'?'RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX':mode==='x'?'RSI_DASH_JUMP_COMBO_X':'RVC_DASH_JUMP_COMBO_XX_FINISH';
 assert.equal(events.filter(e=>e.type==='stateChanged'&&e.state===wanted).length,2,'second full physical input sequence must execute');
 if(mode==='x')assert.ok(events.filter(e=>e.type==='stateChanged'&&e.state==='RSI_JUMP_LANDING').every(e=>e.time%2.5<1.5),'single X cannot hover after animation end');
});
for(const facing of[-1,1])for(const mode of['ground','air'])test(`${mode} cannon contact creates real explosion damage, facing ${facing}`,()=>{
 const {sim,a,b}=vcFixture({position:[facing*-700,3080,0],gap:500,facing}),buffer=createInputBuffer({sampledLevels:true}),events=[];
 for(let i=0;i<160;i++){
  if(mode==='air')inputSequence(buffer,sim.state.time+.001,i,'x',facing===1?'RIGHT':'LEFT');
  else{if(i===0)buffer.down('X',.001);if(i===1)buffer.up('X',sim.state.time+.001);}
  sim.step(1/60,{vc:buffer.consume(sim.state.time+1/60)},{snapshot:false});events.push(...sim.drainEvents());
 }
 const created=events.filter(e=>e.type==='reactionEffectCreated'),ids=new Set(created.map(e=>e.effectId));
 assert.ok(created.length>0);assert.ok(b.hp<b.hpMax);assert.ok(events.some(e=>e.type==='hit'&&e.amount>1000&&ids.has(e.origin.id)),'damage must belong to actual impact child');
});
for(const id of[24213,24022])test(`skill ${id} creates ground flames on the authored map, not below its floor`,()=>{
 const {sim,a}=vcFixture({skillId:id,position:[-800,3080,0],gap:2700}),events=[];let moving=0;
 for(let i=0;i<300;i++){
  sim.step(1/60,{vc:{pressed:i===0?['A']:[]}},{snapshot:false});events.push(...sim.drainEvents());
  moving+=sim.state.effects.filter(e=>e.sourceShadowMesh?.literalMotion).length;
 }
 const flame=id===24213?'DamageEffect_RVC_Napalm_Grenade_Flame_Damage':'DAMAGE_EFFECT_IGNITION_CROW_GROUND';
 const ground=events.filter(e=>e.type==='damageSecondaryCreated'&&e.name===flame);
 assert.ok(moving>0);assert.ok(ground.length>=3,JSON.stringify(events.filter(e=>e.type==='damageSecondaryCreated')));
 for(const e of ground){assert.ok(e.position[0]>-1600&&e.position[0]<1600);close(e.position[1],3080,.1);}
 assert.equal(a.state,'RSI_WAIT');
});
test('an in-flight grenade survives owner transfer with its motion and rejects corrupt matrices',()=>{
 const owner=vcFixture({skillId:24213,gap:2700}),receiver=vcFixture({skillId:24213,gap:2700});
 for(let i=0;i<45;i++)owner.sim.step(1/60,{vc:{pressed:i===0?['A']:[]}},{snapshot:false});
 const packet=encodeOwnedState(owner.sim,'vc',{frameSeq:45}),m=packet.effects.find(e=>e.sourceShadowMesh?.literalMotion);
 assert.ok(m);validateOwnedState(packet);validateOwnedReferences(packet,owner.a,vcProfile,owner.map);applyOwnedState(receiver.sim,'vc',packet);
 const restored=receiver.sim.state.effects.find(e=>e.networkId===m.id);assert.deepEqual(restored.sourceShadowMesh,m.sourceShadowMesh);
 const bad=structuredClone(packet);bad.effects.find(e=>e.id===m.id).sourceShadowMesh.basis=[1,2,3];assert.throws(()=>validateOwnedState(bad),/mesh-motion/);
});

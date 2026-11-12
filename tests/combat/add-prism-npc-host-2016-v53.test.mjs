import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {addPrismEndpointSpheres,prismHitTargets,validateAddPrismEndpoints,tickAddPrismEndpoints} from '../../packages/combat-core/add-prism-endpoints-2016.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const tick=(sim,n)=>{for(let i=0;i<n;i++)sim.step(1/60,{});};
function cast(){const f=originalAddFixture('LP',{skillId:29003});f.a.mp=f.a.mpMax;f.b.x=1200;f.sim.step(1/60,{add:{pressed:['A'],held:['A']}});tick(f.sim,90);return f;}
test('normal skill path creates independent invisible endpoints with original .7 Start/.5 Wait motion and stored KSM spheres',()=>{
 const {sim,a}=cast(),[npc]=a.sourceAddPrismEndpoints;assert.equal(npc.state,'WAIT');assert.equal(npc.hpMax,Math.fround(a.hpMax*.25));
 const spheres=addPrismEndpointSpheres({...npc,position:[0,0,0],yaw:0,state:'WAIT',animationTime:0});assert.equal(spheres.length,2);
 assert.ok(Math.abs(spheres[0].center[1]-79.62290954589844*2.2)<1e-4);assert.ok(Math.abs(spheres[0].radius-36.37307357788086*2.2)<1e-4);
 assert.ok(sim.state.events.some(e=>e.type==='sound'&&e.name==='ADD_PARTICLE_PRISM_01.ogg'));assert.ok(sim.state.events.some(e=>e.type==='sound'&&e.name==='ADD_PARTICLE_PRISM_LOOP_01.ogg'));
 assert.equal(a.unsupported.some(n=>n.id==='prism-npc-motion-host'),false);
});
test('real hit collector strikes original NPC geometry, uses NPC zero defence and preserves caster HP/defence',()=>{
 const {sim,a,b}=cast(),npc=a.sourceAddPrismEndpoints[0],hp=npc.hp,ownerHp=a.hp;a.stats.physicalDefence=99999;
 b.stats.physicalAttack=1000;b.stats.criticalRate=0;b.stats.passiveCriticalRate=0;b.stats.shadowCriticalRate=0;b.stats.finalDamageMultiplierMelee=1;
 const target=prismHitTargets(sim).find(t=>t.npc===npc);assert.equal(target.actor.stats.physicalDefence,0);assert.equal(target.actor.stats.magicDefence,0);
 const hit=sim.checkHits(b,[{kind:'sphere',center:[npc.position[0]+50,npc.position[1]+175,npc.position[2]],radius:1}],{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:1,HIT_TYPE:1,RE_ATTACK:1,HIT_GAP:.2,PVP_RATE:1},{},{kind:'character',state:b.state,stateSerial:b.stateSerial,powerMultiplier:1});
 assert.equal(hit,1);assert.equal(npc.hp,hp-1000);assert.equal(a.hp,ownerHp);assert.equal(npc.pendingState,'DAMAGE');sim.step(1/60,{});assert.equal(npc.state,'DAMAGE');tick(sim,31);assert.equal(npc.state,'WAIT');
});
test('HP0 requests DYING, first opposite-owner partner is killed and independent Wait clip ends before removal without deleting caster field',()=>{
 const {sim,a}=cast(),npc=a.sourceAddPrismEndpoints[0];npc.hp=0;tickAddPrismEndpoints(sim,a,.01);assert.equal(npc.pendingState,'DYING');tickAddPrismEndpoints(sim,a,.01);assert.equal(npc.state,'DYING');assert.equal(a.sourceAddPrismEndpoints[1].hp,0);
 assert.ok(sim.state.effects.some(e=>e.setName==='EffectSet_SA_AN_PARTICLE_PRISM'&&!e.dead));tick(sim,35);assert.equal(a.sourceAddPrismEndpoints.length,0);assert.ok(sim.state.effects.some(e=>e.setName==='EffectSet_SA_AN_PARTICLE_PRISM'&&!e.dead));
});
test('endpoint independent clocks, pending state and HP survive owner encode/validate/reconstruction; malformed identities and motion are rejected',()=>{
 const {sim,a}=cast();a.sourceAddPrismEndpoints[0].pendingState='DAMAGE';const wire=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:1,frameSeq:91})));
 validateOwnedState(wire);validateOwnedReferences(wire,a,sim.profileFor(a),sim.map,{actors:sim.state.actors,profiles:sim.profiles});const before=structuredClone(a.sourceAddPrismEndpoints);a.sourceAddPrismEndpoints=[];applyOwnedState(sim,a.id,wire);assert.deepEqual(a.sourceAddPrismEndpoints,before);
 for(const patch of [n=>n.npcId=1604,n=>n.animationTime=NaN,n=>n.yaw=Infinity,n=>n.pendingState='ATTACK',n=>n.extra=1]){const bad=structuredClone(before);patch(bad[0]);assert.throws(()=>validateAddPrismEndpoints(bad,{owner:a}));}
});

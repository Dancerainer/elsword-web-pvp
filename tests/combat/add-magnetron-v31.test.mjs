import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {MAGNETRON_ORBIT,MAGNETRON_PROJECTILE,MAGNETRON_EXPLOSION} from '../../packages/combat-core/add-magnetron.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const tick=(sim,n,input={})=>{for(let i=0;i<n;i++)sim.step(1/60,input);};
// Original target skill tree assigns29205 only to LP, despite the player's
// table listing it as common Add. Do not promote the skill to the other paths.
for(const id of ['LP'])test(`actual ${id} Magnetron produces three original120-degree orbits and follows movement`,()=>{
 const {sim,a,b,profile}=originalAddFixture(id,{skillId:29205});a.mp=400;b.x=1200;
 tick(sim,1,{add:{pressed:['A'],held:['A']}});tick(sim,90);
 let orbits=sim.state.effects.filter(e=>e.name===MAGNETRON_ORBIT);assert.equal(orbits.length,3);
 assert.deepEqual(orbits.map(e=>e.birthAnchor.rotation[1]),[0,120,240]);
 const before=orbits.map(e=>e.currentAnchor.position[0]);tick(sim,20,{add:{held:['RIGHT']}});
 orbits=sim.state.effects.filter(e=>e.name===MAGNETRON_ORBIT);assert.equal(orbits.length,3);
 assert.ok(orbits.every((e,i)=>e.currentAnchor.position[0]>before[i]+10));
 const raw=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:0,frameSeq:90})));const state=validateOwnedState(raw);
 validateOwnedReferences(state,a,profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});applyOwnedState(sim,a.id,state);
 assert.equal(sim.state.effects.filter(e=>e.name===MAGNETRON_ORBIT).length,3);
 tick(sim,910);assert.equal(sim.state.effects.filter(e=>e.name===MAGNETRON_ORBIT).length,0,'original15s lifetime reclaims all orbits');
});
test('actual command hit consumes one Magnetron and its homing projectile creates original damaging explosion',()=>{
 const {sim,a,b,profile}=originalAddFixture('LP',{skillId:29205});a.mp=400;b.x=1200;
 tick(sim,1,{add:{pressed:['A'],held:['A']}});tick(sim,85);Object.assign(b,{x:130,y:3080,z:0,vx:0,vy:0,lineId:2,grounded:true});
 tick(sim,1,{add:{pressed:['Z'],held:['Z']}});
 let shot;for(let i=0;i<80&&!shot;i++){tick(sim,1);shot=sim.state.effects.find(e=>e.name===MAGNETRON_PROJECTILE);}
 assert.ok(shot,JSON.stringify({state:a.state,position:[a.x,a.y,a.z],target:[b.x,b.y,b.z],events:sim.state.events.slice(-16),notes:a.unsupported.slice(-5)}));assert.equal(shot.sourceAddLockOn.targetId,b.id);
 assert.equal(sim.state.effects.filter(e=>e.name===MAGNETRON_ORBIT).length,2);
 const raw=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:0,frameSeq:91})));const state=validateOwnedState(raw);
 validateOwnedReferences(state,a,profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});applyOwnedState(sim,a.id,state);
 const bad=structuredClone(raw),badShot=bad.effects.find(e=>e.name===MAGNETRON_PROJECTILE);badShot.sourceAddLockOn.targetId=a.id;
 assert.throws(()=>validateOwnedReferences(validateOwnedState(bad),a,profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles}),/add-lock-on-target/);
 tick(sim,160);
 assert.ok(sim.state.events.some(e=>e.type==='effectStarted'&&e.name===MAGNETRON_EXPLOSION));
 assert.ok(sim.state.events.some(e=>e.type==='hit'&&e.targetId===b.id&&e.origin.skillId===29205&&e.amount>0));
});

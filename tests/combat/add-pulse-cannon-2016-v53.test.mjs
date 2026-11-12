import test from 'node:test';
import assert from 'node:assert/strict';
import profile from '../../packages/combat-core/lp-profile.json' with {type:'json'};
import {ADD_PULSE_PROJECTILE,addPulseOrder2016,payAddPulseMaintenance2016,bindAddPulseFront2016,addPulseSteeringAllowed2016} from '../../packages/combat-core/add-pulse-cannon-2016.mjs';
import {advanceAddLockOn,validateAddLockOn} from '../../packages/combat-core/add-lock-on.mjs';
import {advanceAddMmLot6,selectAddMmLot6} from '../../packages/combat-core/add-mm-lot6-2016.mjs';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
test('native permutation excludes the current last candidate until the final remaining item, rather than a uniform shuffle',()=>{
 assert.deepEqual(addPulseOrder2016(()=>0),[1,2,3,4,5,6]);assert.deepEqual(addPulseOrder2016(()=>32767),[3,5,2,4,1,6]);
 assert.throws(()=>addPulseOrder2016(()=>32768));
});
test('normal MP25 equality and formed strict actual local10 gate are independent; missing DP never consumes MP or defaults to500',()=>{
 const notes=[],a={id:'a',professionId:'LP',mp:25,sourceAdd:{formation:false,dp:1000}},sim={profileFor:()=>profile,note:(...v)=>notes.push(v)};
 assert.equal(payAddPulseMaintenance2016(sim,a),true);assert.equal(a.mp,0);a.mp=24.999;assert.equal(payAddPulseMaintenance2016(sim,a),false);
 a.sourceAdd.formation=true;a.mp=100;assert.equal(payAddPulseMaintenance2016(sim,a),false);assert.equal(a.mp,100);assert.equal(a.sourceAdd.dp,1000);assert.equal(notes[0][0],'pulse-maintenance-dp-input');
 sim.addPulseMaintenanceInput=()=>({dpArgument:1000});assert.equal(payAddPulseMaintenance2016(sim,a),false);assert.equal(a.sourceAdd.dp,1000);
 sim.addPulseMaintenanceInput=()=>({dpArgument:75});assert.equal(payAddPulseMaintenance2016(sim,a),true);assert.equal(a.sourceAdd.dp,925);assert.equal(a.mp,100);
});
function lotFixture(){
 const a={id:'a',professionId:'LP',team:0,x:0,y:0,z:0,facing:1,lineId:7},b={id:'b',team:1,x:-200,y:0,z:0,hp:100},calls=[];
 const e={name:ADD_PULSE_PROJECTILE,skillId:29006,hitCount:0,damage:structuredClone(profile.damageEffects[ADD_PULSE_PROJECTILE].raw),sourceShadowMesh:{position:[0,0,0],dirSpeed:333,basis:[[1,0,0],[0,1,0],[0,0,1]],gravity:[0,0,0],literalMotion:true}};
 const sim={state:{actors:[a,b]},map:{lines:[{lineId:7,start:[-1000,0,0],end:[1000,0,0]}]},profileFor:()=>profile,nativeSkills:{vectorLockOn(v){calls.push(v);return {manualDirDegree:v.manualDirDegree};}}};
 bindAddPulseFront2016(e,a,sim.map);return {sim,a,b,e,calls};
}
test('normal LOT6 entry acquires behind the birth snapshot, but ONLY_FRONT gates steering; defaults are strict150..300 and do not use owner1200 as search radius',()=>{
 const {sim,a,b,e,calls}=lotFixture();advanceAddLockOn(sim,e,a,.01);assert.equal(e.sourceAddLot6.targetId,'b');advanceAddLockOn(sim,e,a,.01);assert.equal(calls.length,0);
 b.x=200;advanceAddLockOn(sim,e,a,.01);assert.equal(calls.length,1);assert.deepEqual(calls[0].targetPosition,[200,100,0]);assert.equal(e.sourceShadowMesh.dirSpeed,333);validateAddLockOn(e,profile,a,sim.state.actors);
 for(const x of [150,300,800]){b.x=x;assert.equal(selectAddMmLot6(sim,e,a,[0,0,0]),null);}
 b.x=200;assert.equal(selectAddMmLot6(sim,e,a,[0,0,0]),b);assert.equal(addPulseSteeringAllowed2016(sim,e,a,[1201,0,0]),false);
 e.sourceAddLot6.targetId=null;b.x=800;advanceAddMmLot6(sim,e,a,.01);assert.equal(e.sourceAddLot6.targetId,null);assert.equal(e.sourceShadowMesh.dirSpeed,333);
});
test('birth line/facing snapshot survives owner movement; missing line skips only the additional front gate',()=>{
 const {sim,a,e}=lotFixture();a.x=500;a.facing=-1;assert.equal(addPulseSteeringAllowed2016(sim,e,a,[100,0,0]),true);assert.equal(addPulseSteeringAllowed2016(sim,e,a,[-100,0,0]),false);
 e.sourceAddPulseFront.lineIndex=-1;assert.equal(addPulseSteeringAllowed2016(sim,e,a,[-100,0,0]),true);e.skillId=29034;advanceAddMmLot6(sim,e,a,.01);validateAddLockOn(e,profile,a,sim.state.actors);
});
test('Pulse ownership validation rejects a removed or malformed source front snapshot',()=>{
 const {sim,a,e}=lotFixture();advanceAddMmLot6(sim,e,a,.01);for(const mutate of [v=>delete v.sourceAddPulseFront,v=>v.sourceAddPulseFront.lineIndex=-2,v=>v.sourceAddPulseFront.positive=1,v=>v.sourceAddPulseFront.position[0]=NaN]){const bad=structuredClone(e);mutate(bad);assert.throws(()=>validateAddLockOn(bad,profile,a,sim.state.actors));}
});
for(const skillId of [29006,29034])for(const formed of [false,true])test(`actual Pulse${skillId} held cast formed=${formed} keeps four mandatory and four held extras under the explicit V58 description policy`,()=>{
 const {sim,a,b}=originalAddFixture('LP',{skillId});a.mp=300;a.sourceAdd.dp=8000;b.x=2000;for(let i=0;i<180&&!sim.skillAvailability(a.id,0).available;i++)sim.step(1/60,{});assert.equal(sim.skillAvailability(a.id,0).available,true);
 if(formed){sim.step(1/60,{add:{pressed:['AWAKEN'],held:['AWAKEN']}});for(let i=0;i<240&&(!a.sourceAdd.formation||!sim.skillAvailability(a.id,0).available);i++)sim.step(1/60,{});assert.equal(a.sourceAdd.formation,true);assert.equal(sim.skillAvailability(a.id,0).available,true);}sim.drainEvents();
 const shots=[],payments=[];let transported=false;const capture=()=>{for(const e of sim.drainEvents()){if(e.type==='effectStarted'&&e.name===ADD_PULSE_PROJECTILE)shots.push(e);if(e.type==='addPulseMaintenancePaid')payments.push(e);}const live=sim.state.effects.find(e=>e.name===ADD_PULSE_PROJECTILE&&!e.dead&&e.sourceAddLot6);if(live&&!transported){assert.ok(live.sourceAddPulseFront);const wire=encodeOwnedState(sim,a.id,{epoch:1,frameSeq:1});validateOwnedState(wire);validateOwnedReferences(wire,a,profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});transported=true;}};
 sim.step(1/60,{add:{pressed:['A'],held:['A']}});capture();for(let i=0;i<300;i++){sim.step(1/60,{add:{held:['A']}});capture();}
 assert.equal(shots.length,8);assert.ok(shots.every(e=>/^Weapon0[1-6]$/.test(e.definition.BONE_NAME)));assert.equal(transported,true);
 if(formed){assert.equal(payments.length,4);assert.ok(payments.every(e=>e.resource==='MP'&&e.amount===25&&e.policy==='v58-user-authorized-skill-description'));}
 assert.equal(a.unsupported.some(v=>v.id==='pulse-maintenance-dp-input'),false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {addDroneMarkContact,ADD_DRONE_MARK_PROJECTILE} from '../../packages/combat-core/add-drone-mark.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const tick=(sim,n,input={})=>{for(let i=0;i<n;i++)sim.step(1/60,input);};
function fixture(skillId,{mutation=false,marked=true}={}){
 const f=originalAddFixture('MM',{skillId});f.a.loadout[1]={skillId:29035,level:1,branchId:'none'};f.a.mp=f.a.mpMax;f.a.sourceAdd.dp=8000;f.b.x=650;
 if(mutation){assert.equal(f.sim.tryAwakening(f.a),true);tick(f.sim,120);f.a.sourceAdd.mutation=1;f.a.sourceAdd.dp=8000;f.a.mp=f.a.mpMax;}
 if(marked){const e=f.sim.createEffect({...f.a,skillId:29035},{NAME:ADD_DRONE_MARK_PROJECTILE});assert.equal(addDroneMarkContact(f.sim,f.a,f.b,e),true);e.dead=true;}
 if(skillId===29211)f.b.x=1200;
 tick(f.sim,1,{add:{pressed:['A'],held:['A']}});return f;
}
for(const [id,name]of [[29219,'DamageEffect_AAT_Rushing_Drone'],[29211,'DamageEffect_AMM_Countdown_Bomb_Projectile']])test(`MM ${id} connects to the accepted marked target with native steering and survives owner reconstruction`,()=>{
 const {sim,a,b,profile}=fixture(id);tick(sim,id===29211?21:35);
 const e=sim.state.effects.find(e=>e.name===name);assert.ok(e);assert.equal(e.sourceAddLockOn.targetId,b.id);
 assert.equal(e.sourceAddMarkedDrone.unlockRemaining,0,'Activator setter .1s gate has elapsed at this observation');
 assert.ok(e.sourceAddLockOn.useManualDir);
 assert.equal(e.sourceAddMarkedDrone.targetEpoch,0);assert.equal(e.powerMultiplier,Math.fround(a.skillScale*1.2));
 const raw=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:0,frameSeq:30}))),state=validateOwnedState(raw),context={actors:sim.state.actors,profiles:sim.profiles};
 validateOwnedReferences(state,a,profile,sim.map,context);applyOwnedState(sim,a.id,state);
 const invalid=structuredClone(raw),shot=invalid.effects.find(e=>e.name===name);shot.sourceAddLockOn.targetId=a.id;
 assert.throws(()=>validateOwnedReferences(validateOwnedState(invalid),a,profile,sim.map,context),/add-lock-on-target/);
 tick(sim,90);assert.ok(sim.state.events.some(e=>e.type==='hit'&&e.targetId===b.id&&e.origin?.skillId===id&&e.amount>0));
});
test('a marked mutation Rushing Drone fires its second shot at .6 rather than both at .4',()=>{
 const {sim,a}=fixture(29219,{mutation:true}),shots=()=>sim.state.events.filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_AAT_Rushing_Drone');
 for(let frame=0;frame<70&&!shots().length;frame++)tick(sim,1);
 assert.equal(shots().length,1,'first native animation event emits only one');assert.ok(a.animationTime>=.4&&a.animationTime<.6);
 for(let frame=0;frame<70&&shots().length<2;frame++)tick(sim,1);
 assert.equal(shots().length,2);assert.ok(a.animationTime>=.6,'formation cast speed uses animation time, not wall time');
 assert.ok(shots()[1].time>shots()[0].time);assert.equal(a.sourceAdd.mutation,0);
});
test('unmarked Rushing Drone keeps its original forward path and no invented target',()=>{
 const {sim}=fixture(29219,{marked:false});tick(sim,28);
 const e=sim.state.effects.find(e=>e.name==='DamageEffect_AAT_Rushing_Drone');assert.ok(e);assert.equal(e.sourceAddLockOn,undefined);assert.equal(e.sourceAddMarkedDrone,undefined);
});

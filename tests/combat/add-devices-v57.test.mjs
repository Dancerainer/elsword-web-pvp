import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {PANZER_RED,PANZER_BG} from '../../packages/combat-core/add-panzer-v57.mjs';
import {ADD_FLICK_MARKED_SUB} from '../../packages/combat-core/add-drone-lock.mjs';
import {addDroneMarkContact,ADD_DRONE_MARK_PROJECTILE} from '../../packages/combat-core/add-drone-mark.mjs';
import {createWorldColorController} from '../../apps/web/world-color.mjs';
const dt=1/60;
const step=(sim,input={})=>sim.step(dt,input,{snapshot:false});
const tick=(sim,n,input={})=>{for(let i=0;i<n;i++)step(sim,input);};
const until=(sim,predicate,limit,input={})=>{for(let i=0;i<limit&&!predicate();i++)step(sim,input);assert.ok(predicate(),'bounded original state reached');};
function wire(f){const state=validateOwnedState(JSON.parse(JSON.stringify(encodeOwnedState(f.sim,f.a.id,{epoch:0,frameSeq:f.sim.state.step}))));
 validateOwnedReferences(state,f.a,f.profile,f.sim.map,{actors:f.sim.state.actors,profiles:f.sim.profiles});return state;}
for(const direction of ['UP','DOWN'])test(`Panzer actual held input ${direction}, red line, source angle, owner restore and one angled fire`,()=>{
 const f=originalAddFixture('MM',{skillId:29032}),{sim,a}=f;a.mp=a.mpMax;a.sourceAdd.dp=8000;
 step(sim,{add:{pressed:['A'],held:['A']}});
 until(sim,()=>a.state.endsWith('_AIMING'),180,{add:{held:['A']}});
 assert.equal(a.sourceAddCombat.panzer.angle,0);assert.ok(sim.state.effects.some(e=>e.ownerId===a.id&&e.name===PANZER_RED&&!e.dead));
 assert.ok(sim.state.effects.some(e=>e.ownerId===a.id&&e.setName===PANZER_BG&&!e.dead));
 tick(sim,25,{add:{held:['A',direction]}});
 const s=a.sourceAddCombat.panzer;assert.ok(direction==='UP'?s.angle>15:s.angle< -15);assert.ok(Math.abs(s.angle)<31);
 const before=structuredClone(s),state=wire(f);sim.state.nextEffectId=900000;applyOwnedState(sim,a.id,state);
 assert.deepEqual(a.sourceAddCombat.panzer,before);
 const forged=structuredClone(state);forged.actor.sourceAddCombat.panzer.angle=Infinity;assert.throws(()=>validateOwnedState(forged));
 for(const kind of ['missing','foreign','angle','charge']){const bad=structuredClone(state);
  if(kind==='missing')delete bad.actor.sourceAddCombat.panzer;
  else if(kind==='foreign')bad.actor.sourceAddCombat.panzer.skillId=29012;
  else if(kind==='angle')bad.actor.sourceAddCombat.panzer.angle=43;
  else bad.actor.sourceAddCombat.panzer.charge=4;
  assert.throws(()=>{const parsed=validateOwnedState(bad);validateOwnedReferences(parsed,a,f.profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});},TypeError,kind);
 }
 step(sim);until(sim,()=>a.state.endsWith('_FIRE'),30);
 assert.ok(!sim.state.effects.some(e=>e.ownerId===a.id&&!e.dead&&(e.name===PANZER_RED||e.setName===PANZER_BG)));
 until(sim,()=>sim.state.events.some(e=>e.type==='addPanzerFired'),180);
 const fired=sim.state.events.filter(e=>e.type==='addPanzerFired');assert.equal(fired.length,1);
 assert.ok(Math.abs(fired[0].angle-before.angle)<50/60+1e-5,'release consumes the final source FrameMove packet before its EventProcess');
 const shot=sim.state.effects.find(e=>e.setName==='EffectSet_SI_SA_AAT_Panzer_Buster_Fire'&&e.name==='DamageEffect_Panzer_Buster_Fire');
 assert.ok(shot);assert.equal(shot.birthAnchor.rotation[2],fired[0].angle);assert.equal(shot.definition.ROTATE_Z,undefined);wire(f);
 const birthY=shot.sourceShadowMesh.position[1];tick(sim,6);assert.ok(direction==='UP'?shot.sourceShadowMesh.position[1]>birthY+100:shot.sourceShadowMesh.position[1]<birthY-100,'actual native attack carrier consumes the angle in movement');
 tick(sim,180);assert.equal(a.sourceAddCombat.panzer,undefined);
});
test('Panzer preserves charge across aim direction changes and retires aiming handles on interruption',()=>{
 const f=originalAddFixture('MM',{skillId:29032}),{sim,a}=f;a.mp=a.mpMax;a.sourceAdd.dp=8000;
 step(sim,{add:{pressed:['A'],held:['A']}});until(sim,()=>a.state.endsWith('_AIMING'),180,{add:{held:['A']}});
 tick(sim,100,{add:{held:['A','UP']}});assert.equal(a.sourceAddCombat.panzer.angle,30);
 tick(sim,90,{add:{held:['A','DOWN']}});
 assert.ok(sim.state.events.filter(e=>e.type==='stateChanged').length>=1);
 until(sim,()=>a.state.endsWith('_FIRE'),240,{add:{held:['A','UP']}});
 assert.ok(a.sourceAddCombat.panzer.charge>3&&a.sourceAddCombat.panzer.charge<3.1);
 sim.enter(a,'RSI_WAIT','current-web-interruption');assert.equal(a.sourceAddCombat.panzer,undefined);
 assert.ok(!sim.state.effects.some(e=>e.ownerId===a.id&&!e.dead&&(e.name===PANZER_RED||e.setName===PANZER_BG)));
});
for(const marked of [false,true])test(`Flick Disc actual cast ${marked?'marked LOT4':'unmarked LOT6'}, exact source Sub and owner roundtrip`,()=>{
 const f=originalAddFixture('MM',{skillId:29210}),{sim,a,b}=f;a.loadout[1]={skillId:29035,level:1,branchId:'none'};a.mp=a.mpMax;a.sourceAdd.dp=8000;b.x=650;
 if(marked){const e=sim.createEffect({...a,skillId:29035},{NAME:ADD_DRONE_MARK_PROJECTILE});assert.equal(addDroneMarkContact(sim,a,b,e),true);e.dead=true;}
 step(sim,{add:{pressed:['A'],held:['A']}});until(sim,()=>sim.state.effects.some(e=>e.name===ADD_FLICK_MARKED_SUB),120);
 const sub=sim.state.effects.find(e=>e.name===ADD_FLICK_MARKED_SUB),main=sim.state.effects.find(e=>e.name==='DamageEffect_AMM_Flick_Disc_Dynamo_Damage_Main');assert.ok(main);
 assert.equal(sub.damage.LOCK_ON_DATA.LOCK_ON_TYPE,6,'raw original template unchanged');
 if(marked){assert.equal(sub.sourceAddLockOn.targetId,b.id);assert.ok(sub.sourceAddMarkedDrone.unlockRemaining>0);assert.equal(sub.sourceAddLot6,undefined);
  assert.equal(sub.powerMultiplier,Math.fround(a.skillScale*1.2000000476837158));assert.equal(main.powerMultiplier,sub.powerMultiplier);
 }else{assert.equal(sub.sourceAddMarkedDrone,undefined);assert.equal(sub.powerMultiplier,a.skillScale);}
 const state=wire(f);sim.state.nextEffectId=900000;applyOwnedState(sim,a.id,state);tick(sim,10);
 const restored=sim.state.effects.find(e=>e.networkId===sub.id);assert.ok(restored);
 if(marked){assert.equal(restored.sourceAddLockOn.targetId,b.id);assert.equal(restored.sourceAddLockOn.useManualDir,true);assert.equal(restored.sourceAddLot6,undefined);}
 wire(f);
 tick(sim,80);assert.ok(sim.state.events.some(event=>event.type==='hit'&&event.targetId===b.id&&event.origin?.skillId===29210&&event.amount>0),'actual source hit geometry remains effective');
});
test('marked Rushing uses the source .1 delay, clears gravity and bypasses ordinary line following after owner restore',()=>{
 const f=originalAddFixture('MM',{skillId:29219}),{sim,a,b}=f;a.loadout[1]={skillId:29035,level:1,branchId:'none'};a.mp=a.mpMax;a.sourceAdd.dp=8000;b.x=1200;b.y+=250;
 const mark=sim.createEffect({...a,skillId:29035},{NAME:ADD_DRONE_MARK_PROJECTILE});assert.equal(addDroneMarkContact(sim,a,b,mark),true);mark.dead=true;
 step(sim,{add:{pressed:['A'],held:['A']}});until(sim,()=>sim.state.effects.some(e=>e.name==='DamageEffect_AAT_Rushing_Drone'),120);
 const e=sim.state.effects.find(e=>e.name==='DamageEffect_AAT_Rushing_Drone');assert.ok(e.sourceAddMarkedDrone.unlockRemaining>0&&e.sourceAddMarkedDrone.unlockRemaining<=Math.fround(.1));
 assert.deepEqual(e.sourceShadowMesh.gravity,[0,0,0]);assert.equal(e.sourceShadowMesh.followBeforePosition,undefined);assert.equal(e.damage.FOLLOW_LINE,f.profile.damageEffects[e.name].raw.FOLLOW_LINE,'raw declaration retained separately from instance flags');
 const report=wire(f);sim.state.nextEffectId=900000;applyOwnedState(sim,a.id,report);tick(sim,12);wire(f);
 const restored=sim.state.effects.find(r=>r.networkId===e.id);assert.ok(restored);assert.deepEqual(restored.sourceShadowMesh.gravity,[0,0,0]);assert.equal(restored.sourceShadowMesh.followBeforePosition,undefined);
 const bad=structuredClone(wire(f)),shot=bad.effects.find(r=>r.name===e.name);shot.sourceShadowMesh.gravity[1]=-2000;assert.throws(()=>validateOwnedState(bad),/marked-drone-gravity/);
});
test('actual Activator selection, fire, marker and idle restore world color after cast rather than repeated flashes',()=>{
 const {sim,a,profile}=originalAddFixture('MM',{skillId:29035});a.mp=a.mpMax;a.sourceAdd.dp=8000;
 const color=createWorldColorController({profile});let selected=false,fired=false,mark=false,lateDark=0;
 for(let i=0;i<900;i++){
  const available=sim.skillAvailability(a.id,0),cast=!selected||selected&&!fired&&available.available&&available.mode==='generator-fire';
  step(sim,cast?{add:{pressed:['A'],held:['A']}}:{});
  selected||=a.sourceAdd.generator!==null;fired||=sim.state.events.some(e=>e.type==='addGeneratorFired');mark||=!!a.sourceAddDroneMark;
  const c=color.step(sim.state,dt);if(i>600&&c.some(n=>n!==1))lateDark++;
 }
 assert.equal(selected,true);assert.equal(fired,true);assert.equal(mark,true);assert.equal(lateDark,0);
 assert.equal(color.proof().active,false);
});

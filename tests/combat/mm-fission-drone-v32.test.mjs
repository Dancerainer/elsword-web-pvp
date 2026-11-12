import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {addDroneMarkContact,ADD_DRONE_MARK_PROJECTILE} from '../../packages/combat-core/add-drone-mark.mjs';
import {inheritAddFissionDroneLock,validateAddFissionSplit} from '../../packages/combat-core/add-dynamo-effect-state.mjs';
import {advanceAddLockOn} from '../../packages/combat-core/add-lock-on.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

const tick=(sim,n,input={})=>{for(let i=0;i<n;i++)sim.step(1/60,input);};
for(const mutation of [false,true])for(const facing of [1,-1])test(`marked Fission ${mutation?'mutation':'base'} facing${facing} uses original DA timing and inherits its accepted target once`,()=>{
 const {sim,a,b,profile}=originalAddFixture('MM',{skillId:29209});
 a.loadout[1]={skillId:29035,level:1,branchId:'none'};a.mp=a.mpMax;a.sourceAdd.dp=8000;b.x=1200;
 if(mutation){assert.equal(sim.tryAwakening(a),true);tick(sim,120);a.sourceAdd.mutation=1;a.sourceAdd.dp=8000;a.mp=a.mpMax;}
 const mark=sim.createEffect({...a,skillId:29035},{NAME:ADD_DRONE_MARK_PROJECTILE});
 assert.equal(addDroneMarkContact(sim,a,b,mark),true);mark.dead=true;a.facing=facing;
 tick(sim,1,{add:{pressed:['A'],held:['A']}});
 const parentName='DamageEffect_ADD_Dividing_Missile_Dynamo'+(mutation?'_Mutation':'')+'_DA';
 let parent;
 for(let i=0;i<100&&!parent;i++){tick(sim,1);parent=sim.state.effects.find(e=>e.name===parentName);}
 assert.ok(parent,'qualified .4 animation callback chooses original DA variant');
 assert.equal(parent.lifeTimeSeconds,Math.fround(.2*(a.passivePolicy?.add?.dynamoDurationMultiplier??1)));
 assert.equal(parent.sourceAddLockOn.targetId,b.id);assert.equal(parent.sourceAddMarkedDrone.targetEpoch,0);
 assert.equal(parent.sourceShadowMesh.dirSpeed,1250,'qualified root retarget speed');
 assert.equal(parent.powerMultiplier,Math.fround(a.skillScale*1.2));
 let children=[];
 for(let i=0;i<90&&!children.length;i++){tick(sim,1);children=sim.state.effects.filter(e=>e.sourceAddFissionSplit?.parentName===parentName);}
 const angles=mutation?[45,-45,135,-135,0,90,180,-90]:[45,-45,135,-135];
 assert.equal(children.length,angles.length);assert.deepEqual(children.map(e=>e.birthAnchor.rotation[2]),angles);
 assert.ok(children.every(e=>e.name==='DamageEffect_ADD_Dividing_Missile_Dynamo_Small_DA'&&e.definition.SCALE_X===.66));
 assert.ok(children.every(e=>e.sourceAddLockOn.targetId===b.id&&e.sourceAddMarkedDrone.targetEpoch===0&&e.sourceAddMarkedDrone.unlockRemaining===0));
 assert.ok(children.every(e=>e.powerMultiplier===parent.powerMultiplier),'inherited frozen damage does not apply x1.2 twice');
 tick(sim,1);assert.ok(children.every(e=>e.sourceShadowMesh.dirSpeed===1000),'child retains original1000 speed, not root1250');
 const wire=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:0,frameSeq:100}))),state=validateOwnedState(wire);
 validateOwnedReferences(state,a,profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});applyOwnedState(sim,a.id,state);
 assert.equal(sim.state.effects.filter(e=>e.sourceAddFissionSplit?.parentName===parentName).length,angles.length);
 const bad=structuredClone(wire),shot=bad.effects.find(e=>e.sourceAddFissionSplit);
 shot.sourceAddFissionSplit.parentName='DamageEffect_ADD_Dividing_Missile_Dynamo';
 assert.throws(()=>validateOwnedState(bad),/fission/,'cross-variant metadata cannot claim DA geometry');
 if(mutation)assert.equal(a.sourceAdd.mutation,0);
});

test('Fission lock inheritance is scoped to the declared DA DIE child and does not reacquire a respawned target',()=>{
 const name='DamageEffect_ADD_Dividing_Missile_Dynamo_Small_DA',parentName='DamageEffect_ADD_Dividing_Missile_Dynamo_DA';
 const parent={name:parentName,sourceAddMarkedDrone:{targetEpoch:3,unlockRemaining:0},sourceAddLockOn:{targetId:'b',manualDirDegree:[0,0,0],useManualDir:false},
  damage:{DIE_DAMAGE_EFFECT0:{INHERITLOCKONDATA:1,DAMAGE_EFFECT_NAME:name}}};
 const child={name,skillId:29209,sourceAddFissionSplit:{parentName,member:'DIE_DAMAGE_EFFECT0'}};
 assert.equal(inheritAddFissionDroneLock(parent,child),true);assert.notEqual(child.sourceAddLockOn.manualDirDegree,parent.sourceAddLockOn.manualDirDegree);
 assert.equal(inheritAddFissionDroneLock(parent,{...child,name:'DamageEffect_AAT_Rushing_Drone'}),false);
 assert.equal(inheritAddFissionDroneLock({...parent,damage:{DIE_DAMAGE_EFFECT0:{DAMAGE_EFFECT_NAME:name}}},{...child}),false);
 validateAddFissionSplit(child);
 let calls=0;child.sourceShadowMesh={position:[0,0,0]};
 const a={id:'a',team:1,x:0,y:0,z:0},b={id:'b',team:2,hp:100,x:50,y:0,z:0};
 const sim={state:{actors:[a,b]},networkEpochFor:()=>4,skillsFor:()=>({vectorLockOn:()=>{calls++;throw new Error('must not steer at a new life');}})};
 advanceAddLockOn(sim,child,a,1/60);assert.equal(calls,0);assert.equal(child.sourceAddLockOn.useManualDir,false);
});

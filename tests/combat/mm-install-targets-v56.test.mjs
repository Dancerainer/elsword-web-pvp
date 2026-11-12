import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectAddPhantomLot8,advanceAddMmLot6,addMmLot6Contact,ADD_PHANTOM_LOT8} from '../../packages/combat-core/add-mm-lot6-2016.mjs';
import {startAddStarfall,tickAddStarfall,startAddShootingChaser,tickAddShootingChaser,addShootingChaserContact,CHASER_SETS} from '../../packages/combat-core/add-analysis-skills.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/mm-profile.json',import.meta.url)));
const actor=(id,x)=>({id,professionId:'MM',team:id==='owner'?0:1,hp:100,x,y:0,z:0,lineId:0,landPosition:[x,0,0],facing:1,sourceAdd:{formation:false,mutation:0},stateSerial:1,skillScale:2});
function fixture(){const a=actor('owner',0),b=actor('first',100),c=actor('second',300),events=[];
 const sim={state:{actors:[a,b,c],effects:[],nextEffectId:1},rng:()=>123/32768,profileFor:()=>profile,map:{lines:[{lineId:0,start:[-1000,0,0],end:[1000,0,0]}]},note:()=>{},emit:(type,id,data)=>events.push({type,id,...data}),
  effectAnchorSampler:(_e,t)=>({position:[t.x,t.y,t.z]}),
  createEffect:(a,d,o)=>{const e={id:sim.state.nextEffectId++,ownerId:a.id,name:d.NAME,...o};sim.state.effects.push(e);return e;},
  spawnSet:(a,name)=>sim.state.effects.push({id:sim.state.nextEffectId++,ownerId:a.id,name,setName:name})};
 const e={name:ADD_PHANTOM_LOT8,skillId:29015,damage:structuredClone(profile.damageEffects[ADD_PHANTOM_LOT8].raw),hitCount:0,
  sourceShadowMesh:{position:[0,0,0],basis:[[1,0,0],[0,1,0],[0,0,1]],literalMotion:true,gravity:[0,0,0],dirSpeed:6000}};
 return {sim,a,b,c,e,events};
}
test('Phantom original LOT8 uses rand%100%N in collection order rather than closest distance',()=>{
 const {sim,a,b,c,e}=fixture();assert.equal(selectAddPhantomLot8(sim,e,a,[0,0,0]),c,'123%100%2=1');
 sim.state.actors=[a,...Array.from({length:101},(_,i)=>actor('n'+i,101-i))];
 assert.equal(selectAddPhantomLot8(sim,e,a,[0,0,0]).id,'n23','123%100 limits selection to first100');
 let calls=0;sim.state.actors=[a,b];sim.rng=()=>{calls++;return 0;};
 assert.equal(selectAddPhantomLot8(sim,e,a,[0,0,0]),b);assert.equal(calls,1,'N1 still draws exactly once');
});
test('Phantom min is unread, max equality is included, and empty history clears without same-call retry',()=>{
 const {sim,a,b,e}=fixture();sim.state.actors=[a,b];e.damage.LOCK_ON_DATA.PVP_TARGET_RANGE_MIN_MAX={'1':100,'2':200};b.x=0;
 assert.equal(selectAddPhantomLot8(sim,e,a,[0,0,0]),b);b.x=200;assert.equal(selectAddPhantomLot8(sim,e,a,[0,0,0]),b);
 b.x=200.01;assert.equal(selectAddPhantomLot8(sim,e,a,[0,0,0]),null);b.x=100;
 addMmLot6Contact(e,b);assert.equal(selectAddPhantomLot8(sim,e,a,[0,0,0]),null);assert.deepEqual(e.sourceAddLot6.history,[]);
 assert.equal(selectAddPhantomLot8(sim,e,a,[0,0,0]),b);
 b.invincible=true;assert.equal(selectAddPhantomLot8(sim,e,a,[0,0,0]),null);
});
test('normal Phantom update selects through LOT8 after unlock and aims at actual User position plus100',()=>{
 const {sim,a,c,e}=fixture();const aims=[];sim.nativeSkills={vectorLockOn:v=>{aims.push(v.targetPosition);return {manualDirDegree:[57.29578,0,0]};}};
 for(let i=0;i<40&&!e.sourceAddLot6?.targetId;i++)assert.equal(advanceAddMmLot6(sim,e,a,1/60),true);
 assert.equal(e.sourceAddLot6.targetId,c.id);advanceAddMmLot6(sim,e,a,1/60);assert.deepEqual(aims[0],[300,100,0]);
 addMmLot6Contact(e,c);e.hitCount++;advanceAddMmLot6(sim,e,a,1/60);
 assert.equal(e.sourceAddLot6.targetId,'first');assert.equal(e.sourceAddLot6.retargetRemaining,Math.fround(.3));
});
test('missing Starfall carrier still decrements/resets interval and executes selection/identity repeat gate',()=>{
 const {sim,a,b}=fixture();startAddStarfall(sim,a);const row=a.sourceAddNative[0].rows[0];sim.state.effects=[];let calls=0,attacks=0;
 const hooks={selectTarget:()=>{calls++;return b;},attackCarrier:()=>attacks++};
 tickAddStarfall(sim,a,.6,hooks);assert.equal(calls,1);assert.equal(row.interval,Math.fround(.5));assert.equal(row.lastTargetId,b.id);
 tickAddStarfall(sim,a,.6,hooks);assert.equal(row.skipSame,true);tickAddStarfall(sim,a,.6,hooks);assert.equal(row.skipSame,false);assert.equal(attacks,0);
});
test('Chaser initial closest selector excludes exact min/max and retains the first tied interior candidate',()=>{
 const {sim,a,b,c}=fixture();b.x=550;c.x=0;startAddShootingChaser(sim,a);assert.equal(a.sourceAddNative[0].targetId,null);
 b.x=200;c.x=-200;startAddShootingChaser(sim,a);assert.equal(a.sourceAddNative[0].targetId,b.id);
});
test('Chaser consumes main records whole then gives remainder to the first residual, never the last',()=>{
 const {sim,a,b,c,events}=fixture();const third=actor('third',400);sim.state.actors.push(third);startAddShootingChaser(sim,a);const attacker=sim.state.effects[0];
 for(const [t,n]of [[b,5],[c,2],[third,7]])for(let i=0;i<n;i++)addShootingChaserContact(sim,a,t,attacker,[t.x,0,0]);
 tickAddShootingChaser(sim,a,1);assert.deepEqual(events.filter(e=>e.type==='addChaserAllocated').map(e=>[e.targetId,e.units,e.setName,e.power]),
  [[c.id,2,CHASER_SETS[1],4],[b.id,2,CHASER_SETS[1],4]]);
});

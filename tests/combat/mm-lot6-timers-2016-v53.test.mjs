import test from 'node:test';
import assert from 'node:assert/strict';
import profile from '../../packages/combat-core/mm-profile.json' with {type:'json'};
import {advanceAddMmLot6,addMmLot6Contact,validateAddMmLot6} from '../../packages/combat-core/add-mm-lot6-2016.mjs';
function fixture(flick=false){
 const name=flick?'DamageEffect_AMM_Flick_Disc_Dynamo_Damage_Sub':'DamageEffect_AMM_Countdown_Bomb_Projectile';
 const a={id:'a',team:0,professionId:'MM',x:0,y:0,z:0,facing:1},b={id:'b',team:1,x:100,y:0,z:0,hp:100},c={...b,id:'c',x:200};
 const e={name,hitCount:0,damage:structuredClone(profile.damageEffects[name].raw),sourceShadowMesh:{literalMotion:true,position:[0,0,0],basis:[[1,0,0],[0,1,0],[0,0,1]],dirSpeed:333,gravity:[0,0,0]}};
 const calls=[],sim={state:{actors:[a,b,c]},profileFor:()=>profile,nativeSkills:{vectorLockOn(v){calls.push(structuredClone(v));return {manualDirDegree:[57.29577951308232,0,0]};}}};
 const step=dt=>advanceAddMmLot6(sim,e,a,dt);return {sim,a,b,c,e,calls,step};
}
test('848 consumes the crossing callback and84c expires before the switch; countdown search starts steering on the following callback',()=>{
 const {e,calls,step}=fixture();step(.31);assert.equal(e.sourceAddLot6.targetId,null);step(.01);assert.equal(e.sourceAddLot6.targetId,'b');assert.equal(calls.length,0);step(.01);assert.equal(calls.length,1);
 assert.ok(Math.abs(calls[0].manualDirDegree[0]-57.29578)<1e-4,'original manual direction is a scaled vector, not Euler yaw');
 e.sourceAddLot6.activeRemaining=.005;step(.01);assert.equal(calls.length,1);validateAddMmLot6(e);
});
test('878 uses effect attack count; a geometric history contact alone does not unlock the Flick switch',()=>{
 const {e,b,step,calls}=fixture(true);addMmLot6Contact(e,b);step(.01);assert.equal(calls.length,0);e.hitCount=1;step(.01);assert.equal(calls.length,1);assert.equal(e.sourceAddLot6.targetId,'c');
 assert.deepEqual(calls[0].targetPosition,[333,0,0],'mode3 compensates toward current forward direction rather than immediately steering at the new target');
 step(.01);assert.deepEqual(calls[1].targetPosition,[200,0,0]);
});
test('754>758 retargets from old aim point and87c suppresses complete steering callbacks including its crossing',()=>{
 const {e,b,c,step,calls}=fixture();step(.31);step(.01);step(.01);addMmLot6Contact(e,b);e.hitCount=1;e.damage.LOCK_ON_DATA.RETARGET_COOLTIME_AFTER_ATTACK=.2;step(.01);
 assert.equal(e.sourceAddLot6.targetId,c.id);assert.equal(e.sourceAddLot6.processedSerial,1);assert.deepEqual(calls.at(-1).targetPosition,[100,0,0]);const before=calls.length;
 step(.1);step(.11);assert.equal(calls.length,before);step(.01);assert.equal(calls.length,before+1);assert.deepEqual(calls.at(-1).targetPosition,[200,0,0]);
});
test('failed hit-triggered selection writes NPC slot only and retains the old valid User UID',()=>{
 const {sim,e,b,step}=fixture();sim.state.actors=sim.state.actors.slice(0,2);step(.31);step(.01);step(.01);addMmLot6Contact(e,b);e.hitCount=1;step(.01);
 assert.equal(e.sourceAddLot6.targetId,'b');assert.equal(e.sourceAddLot6.npcTargetId,null);assert.deepEqual(e.sourceAddLot6.history,[]);validateAddMmLot6(e);
});
test('dead resolved User clears all identity slots before mesh search; absent object preserves slots and does not stop',()=>{
 const dead=fixture();dead.step(.31);dead.step(.01);dead.b.hp=0;dead.b.pvpDead=true;dead.step(.01);assert.equal(dead.e.sourceAddLot6.targetId,'c');
 const absent=fixture();absent.step(.31);absent.step(.01);absent.sim.state.actors=absent.sim.state.actors.slice(0,1);absent.step(.01);assert.equal(absent.e.sourceAddLot6.targetId,'b');assert.equal(absent.e.sourceShadowMesh.dirSpeed,333);
});
test('empty-target search keeps750>=754>=758 and local ownership gates',()=>{
 const {e,sim,step}=fixture();step(.31);e.hitCount=2;step(.01);assert.equal(e.sourceAddLot6.targetId,null);e.hitCount=0;sim.networkOwnerId='remote';step(.01);assert.equal(e.sourceAddLot6.targetId,null);sim.networkOwnerId=null;step(.01);assert.equal(e.sourceAddLot6.targetId,'b');
});
test('strict packet validation rejects malformed timers and extra fields',()=>{
 const {e,step}=fixture();step(.01);validateAddMmLot6(e);for(const mutation of [s=>s.activeRemaining=Infinity,s=>s.retargetRemaining=10000,s=>s.npcTargetId=7,s=>s.extra=0]){const bad=structuredClone(e);mutation(bad.sourceAddLot6);assert.throws(()=>validateAddMmLot6(bad));}
});

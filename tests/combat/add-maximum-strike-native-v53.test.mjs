import test from 'node:test';
import assert from 'node:assert/strict';
import {maximumStrikeVector,maximumStrikeNextStage,advanceMaximumStrikeLockOn} from '../../packages/combat-core/add-maximum-strike-native-v53.mjs';
import {maximumStrikeHitCompleted} from '../../packages/combat-core/add-maximum-strike-native-v53.mjs';
const SHOT='DamageEffect_ATT_Maximum_Strike_Bullet_Attack',DEG=Math.fround(57.2957763671875);
// Expected arithmetic and boundaries are independently transcribed from the
// attested 2016 instructions: 31eebdf0, 31c74350, 31f04350. No source-client
// dynamic trace is claimed by these source-consumer regression cases.
test('native curve interpolates normalized old/new vectors, without post-normalization or clamping',()=>{
 const base={position:[0,0,0],manualDirDegree:[DEG,0,0],targetPosition:[0,100,0],curveSpeed:50};
 const half=maximumStrikeVector({...base,dt:.01});
 assert.deepEqual(half,[Math.fround(DEG/2),Math.fround(DEG/2),0]);
 assert.ok(Math.hypot(...half)<DEG*.71);
 assert.deepEqual(maximumStrikeVector({...base,dt:.04}),[-DEG,Math.fround(2*DEG),0]);
});
test('native stage event excludes equal current endpoint, includes previous endpoint, retains large-delta clause and one stage maximum',()=>{
 const raw={DAMAGE_DATA_NEXT:{},DAMAGE_DATA_NEXT2:{},DAMAGE_DATA_CHANGE_TIME_GLOBAL_TIME:{1:.313,2:.626}};
 assert.equal(maximumStrikeNextStage(raw,0,{beforeGlobal:.3,afterGlobal:.313,dt:.013}),0);
 assert.equal(maximumStrikeNextStage(raw,0,{beforeGlobal:.313,afterGlobal:.32,dt:.007}),1);
 assert.equal(maximumStrikeNextStage(raw,0,{beforeGlobal:.8,afterGlobal:1.4,dt:.6}),1);
 assert.equal(maximumStrikeNextStage(raw,0,{beforeGlobal:0,afterGlobal:.9,dt:.9}),1);
 assert.equal(maximumStrikeNextStage(raw,1,{beforeGlobal:.9,afterGlobal:1.8,dt:.9}),2);
});
test('Maximum accepted contact clears steering and preserves the original travelling mesh',()=>{
 const e={name:SHOT,skillId:29022,sourceAddLockOn:{targetId:'b'},sourceAddMaximumStrikeOrbit:{angle:1}};
 assert.equal(maximumStrikeHitCompleted({name:'other',skillId:29022}),false);
 assert.equal(maximumStrikeHitCompleted(e),true);assert.notEqual(e.dead,true);
 assert.equal(e.endReason,undefined);assert.equal(e.sourceAddLockOn,undefined);
 assert.equal(e.sourceAddMaximumStrikeOrbit,undefined);assert.equal(maximumStrikeHitCompleted(e),true);
});
test('no target or no current mesh stays unsupported without inventing a circle or collision helper',()=>{
 const e={name:SHOT,skillId:29022,sourceAddMaximumStrikeOrbit:{sphereIndex:0,targetEpoch:0,angle:1}};
 assert.equal(advanceMaximumStrikeLockOn({},e,{},1/60),true);assert.equal(e.sourceAddMaximumStrikeOrbit,undefined);
});

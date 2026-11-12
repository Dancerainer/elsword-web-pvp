import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {MAXIMUM_STRIKE_SHOT,startMaximumStrike,fireMaximumStrike,tickMaximumStrike,maximumStrikeAcceptedHit} from '../../packages/combat-core/add-maximum-strike.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
const tick=sim=>sim.step(1/60,{});
function fixture(facing=1){
 const f=originalAddFixture('DE',{skillId:29022});const {sim,a,b}=f;
 a.facing=facing;b.x=250*facing;b.forceInvincible=4;
 const shot=sim.createEffect({...a,skillId:29022},{NAME:MAXIMUM_STRIKE_SHOT},{birthAnchor:{position:[a.x,a.y+150,a.z],rotation:[0,facing<0?180:0,0],facing}});
 shot.sourceAddLockOn={targetId:b.id,manualDirDegree:[0,facing<0?180:0,0],useManualDir:false};
 return {...f,shot};
}

for(const facing of [1,-1])test(`a real travelling Maximum hits a second actor behind its first contact; facing ${facing}`,()=>{
 const {sim,a,b,shot}=fixture(facing);b.forceInvincible=0;b.x=150*facing;
 const behind=structuredClone(b);behind.id='behind';behind.x=450*facing;sim.state.actors.push(behind);
 delete shot.sourceAddLockOn;
 let basisAfterFirst=null,travelAfterFirst=false;
 for(let frame=0;frame<70;frame++){
  const old=[shot.x,shot.y,shot.z];tick(sim);
  const ownHits=sim.state.events.filter(e=>e.type==='hit'&&e.origin?.id===shot.id);
  if(ownHits.length&&!shot.dead){
   if(basisAfterFirst){assert.deepEqual(shot.sourceShadowMesh.basis,basisAfterFirst);travelAfterFirst||=old[0]!==shot.x;}
   else basisAfterFirst=structuredClone(shot.sourceShadowMesh.basis);
  }
 }
 const hits=sim.state.events.filter(e=>e.type==='hit'&&e.origin?.id===shot.id);
 assert.deepEqual(hits.map(e=>e.targetId),[b.id,behind.id]);
 assert.ok(travelAfterFirst);assert.equal(shot.endReason,'template-life-time');
 assert.equal(sim.state.events.filter(e=>e.type==='damageSecondaryCreated'&&e.parentEffectId===shot.id).length,2);
 assert.equal(sim.state.events.filter(e=>e.type==='sound'&&e.origin?.id===shot.id&&e.name==='HitPlasma1.wav').length,2);
});
// Current Web/Native-sampler regressions; V56 restores the original continuation
// after accepted contact, replacing the historical V53 termination policy.
for(const facing of [1,-1])test(`invincible retained target curves, then accepted contact continues until original mesh expiry; facing ${facing}`,()=>{
 const {sim,a,b,shot}=fixture(facing),hp=b.hp,points=[];
 for(let i=0;i<20;i++){tick(sim);points.push([shot.x,shot.y,shot.z]);assert.equal(shot.sourceAddMaximumStrikeOrbit,undefined);}
 assert.equal(b.hp,hp);assert.equal(shot.hitCount,0);assert.equal(shot.sourceAddLockOn.targetId,b.id);
 assert.ok(!sim.state.events.some(e=>e.type==='damageSecondaryCreated'&&e.parentEffectId===shot.id));
 assert.ok(new Set(points.map(p=>p[0])).size>15);
 const packet=encodeOwnedState(sim,a.id,{epoch:0,frameSeq:20}),context={actors:sim.state.actors,profiles:sim.profiles};
 validateOwnedReferences(validateOwnedState(packet),a,sim.profileFor(a),sim.map,context);
 const action=encodeCriticalAction(packet,{id:1,effectIds:new Set([shot.id])});assert.equal(action.effects[0].sourceAddMaximumStrikeOrbit,undefined);
 applyOwnedState(sim,a.id,validateOwnedState(packet));const restored=sim.state.effects.find(e=>e.id===shot.id);
 b.forceInvincible=0;b.invincible=false;
 for(let i=0;i<45&&restored.hitCount===0;i++)tick(sim);
 assert.notEqual(restored.dead,true);assert.equal(restored.endReason,undefined);
 assert.equal(restored.sourceAddLockOn,undefined);
 assert.equal(sim.state.events.filter(e=>e.type==='hit'&&e.origin?.id===shot.id).length,1);
 assert.equal(sim.state.events.filter(e=>e.type==='damageSecondaryCreated'&&e.parentEffectId===shot.id).length,1);
 assert.equal(sim.state.events.filter(e=>e.type==='sound'&&e.name==='HitPlasma1.wav'&&e.origin?.id===shot.id).length,1);
 assert.equal(sim.state.effects.some(e=>e.id===shot.id),true);
 for(let i=0;i<90;i++)tick(sim);
 assert.equal(restored.endReason,'template-life-time');
 assert.equal(sim.state.events.filter(e=>e.type==='hit'&&e.origin?.id===shot.id).length,1);
});
test('source-authored down invincibility preserves the held target without spending a hit receipt',()=>{
 const {sim,b,shot}=fixture();b.forceInvincible=0;sim.enter(b,'RSI_DAMAGE_DOWN_FRONT','source-down');
 for(let i=0;i<30;i++)tick(sim);
 assert.equal(shot.hitCount,0);assert.ok(!shot.dead);assert.equal(shot.sourceAddMaximumStrikeOrbit,undefined);
 assert.equal(shot.sourceAddLockOn.targetId,b.id);sim.enter(b,'RSI_WAIT','source-down-ended');
 for(let i=0;i<60&&shot.hitCount===0;i++)tick(sim);
 assert.equal(shot.hitCount,1);assert.notEqual(shot.dead,true);
 assert.equal(shot.sourceAddLockOn,undefined);
});
test('retained invincible target can expire without impact, sound or fabricated post-contact circle',()=>{
 const {sim,b,shot}=fixture(),hp=b.hp;for(let i=0;i<90;i++)tick(sim);
 assert.equal(b.hp,hp);assert.equal(shot.endReason,'template-life-time');
 assert.equal(sim.state.events.filter(e=>e.type==='hit'&&e.origin?.id===shot.id).length,0);
 assert.equal(sim.state.events.filter(e=>e.type==='sound'&&e.name==='HitPlasma1.wav').length,0);
 assert.equal(shot.sourceAddMaximumStrikeOrbit,undefined);
});
test('static analysis Mutation increases stored shot and child power by 10 percent per point, not holding duration',()=>{
 const {sim,a,b}=originalAddFixture('DE',{skillId:29022});b.x=1200;
 a.sourceAdd.formation=true;a.sourceAdd.mutation=3;a.skillId=29022;a.skillScale=2;startMaximumStrike(sim,a);
 const s=a.sourceAddCombat.maximumStrike;assert.equal(s.remaining,60);assert.equal(s.totalLifetime,60);
 assert.equal(s.power,Math.fround(2*(1+3*.10000000149011612)));assert.equal(a.sourceAdd.mutation,0);
 assert.equal(fireMaximumStrike(sim,a),true);
 const shot=sim.state.effects.find(e=>e.name===MAXIMUM_STRIKE_SHOT);assert.equal(shot.powerMultiplier,s.power);
 maximumStrikeAcceptedHit(sim,a,b,{NO_DAMAGE:0},{skillId:29027});
 tickMaximumStrike(sim,a,.51);assert.equal(fireMaximumStrike(sim,a),true);assert.equal(s.targetId,null);
});
test('last release restores native C-E or C cooldown, retaining its cast-mode multiplier after mode change',()=>{
 for(const [age,formed,expected] of [[3,false,24],[30,false,27],[3,true,37.5],[50,true,40.5]]){
  const {sim,a,b}=originalAddFixture('DE',{skillId:29022,passives:formed?[29410]:[]});b.x=2000;a.skillId=29022;a.skillScale=1;a.sourceAdd.formation=formed;
  startMaximumStrike(sim,a);const s=a.sourceAddCombat.maximumStrike;
  for(let i=0;i<5;i++){s.ready=0;assert.equal(fireMaximumStrike(sim,a),true);assert.equal(a.cooldowns[29022],.5);}
  s.remaining=60-age;s.ready=0;a.sourceAdd.formation=false;assert.equal(fireMaximumStrike(sim,a),true);
  assert.equal(a.cooldowns[29022],expected);assert.equal(a.sourceAddCombat.maximumStrike,undefined);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {MAXIMUM_STRIKE_ORB,MAXIMUM_STRIKE_SHOT,maximumStrikeAcceptedHit,tickMaximumStrike,fireMaximumStrike} from '../../packages/combat-core/add-maximum-strike.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
const tick=(sim,n,input={})=>{for(let i=0;i<n;i++)sim.step(1/60,input);};
const orbs=sim=>sim.state.effects.filter(e=>e.name===MAXIMUM_STRIKE_ORB&&!e.dead);
function prepared({formation=false,mutation=0,facing=1}={}){
 const f=originalAddFixture('DE',{skillId:29022});f.a.mp=f.a.mpMax;f.b.x=1200;f.a.facing=facing;
 f.a.sourceAdd.dp=8000;
 if(formation){assert.equal(f.sim.tryAwakening(f.a),true);tick(f.sim,120);f.a.mp=f.a.mpMax;f.a.sourceAdd.dp=8000;}
 f.a.sourceAdd.mutation=mutation;
 tick(f.sim,1,{add:{pressed:['A'],held:['A']}});tick(f.sim,104);assert.equal(orbs(f.sim).length,6);return f;
}
// These expectations come from target skill/data declarations and the user's
// explicit same-key/refund behavior. They are not original-client traces.
test('Maximum Strike creates six original rotated orb poses at foot+150 and follows the caster',()=>{
 const {sim,a,profile}=prepared();
 assert.equal(profile.skillCatalog.find(s=>s.skillId===29022).raw.SA_EFFECTIVE_TIME['1'],60);
 assert.equal(profile.skillCatalog.find(s=>s.skillId===29022).raw.SA_CHARGING_TIME['1'],2,'2016 declaration says2s, player recalled1s');
 assert.deepEqual(orbs(sim).map(e=>e.birthAnchor.rotation[1]),[0,60,120,180,240,300]);
 assert.ok(orbs(sim).every(e=>e.currentAnchor.position[1]===Math.fround(a.y+150)));
 const before=a.x;tick(sim,30,{add:{held:['RIGHT']}});assert.ok(a.x>before+10);
 for(const e of orbs(sim)){assert.equal(e.currentAnchor.position[0],a.x);assert.ok(sim.effectBoneSampler(e,a,'Dummy02')?.every(Number.isFinite));}
});
test('same key consumes one orb, spends no extra resource and keeps the current action; .5s interval blocks a second shot',()=>{
 const {sim,a}=prepared();tick(sim,8);const state=a.state,serial=a.stateSerial;a.mp=0;a.sourceAdd.dp=0;
 tick(sim,1,{add:{pressed:['A'],held:['A']}});
 assert.equal(orbs(sim).length,5);assert.equal(a.state,state);assert.equal(a.stateSerial,serial);
 assert.ok(a.mp<1);assert.equal(a.sourceAdd.dp,0);assert.equal(sim.state.events.filter(e=>e.type==='addMaximumStrikeFired').length,1);
 tick(sim,1);tick(sim,1,{add:{pressed:['A'],held:['A']}});assert.equal(orbs(sim).length,5);
 assert.ok(sim.state.events.some(e=>e.type==='skillRejected'&&e.reason==='maximum-strike-interval'));
 tick(sim,31);tick(sim,1,{add:{pressed:['A'],held:['A']}});assert.equal(orbs(sim).length,4);
});
for(const facing of [1,-1])test(`no remembered target launches a travelling original projectile facing${facing}`,()=>{
 const {sim,a}=prepared({facing});assert.equal(fireMaximumStrike(sim,a),true);
 const shot=sim.state.effects.find(e=>e.name===MAXIMUM_STRIKE_SHOT);assert.ok(shot);assert.equal(shot.sourceAddLockOn,undefined);
 const x=shot.x;tick(sim,25);assert.ok((shot.x-x)*facing>100,JSON.stringify({x,now:shot.x,motion:shot.sourceShadowMesh}));
 tick(sim,45);assert.ok(!sim.state.effects.some(e=>e.id===shot.id),'original projectile lifetime reclaims it');
});
test('most recent accepted enemy is remembered without auto firing; expired memory fires forward',()=>{
 const {sim,a,b}=prepared();b.x=300;
 maximumStrikeAcceptedHit(sim,a,b,{NO_DAMAGE:0},{skillId:29027});assert.equal(orbs(sim).length,6);
 tickMaximumStrike(sim,a,2.01);assert.equal(fireMaximumStrike(sim,a),true);
 const shot=sim.state.effects.find(e=>e.name===MAXIMUM_STRIKE_SHOT);assert.equal(shot.sourceAddLockOn,undefined);
});
test('tracking preserves an invincible remembered target, does not spend damage on it, and expires',()=>{
 const {sim,a,b}=prepared();Object.assign(b,{x:250,forceInvincible:4});
 maximumStrikeAcceptedHit(sim,a,b,{NO_DAMAGE:0},{skillId:29027});assert.equal(fireMaximumStrike(sim,a),true);
 const shot=sim.state.effects.find(e=>e.name===MAXIMUM_STRIKE_SHOT);assert.equal(shot.sourceAddLockOn.targetId,b.id);
 const hp=b.hp,trace=[];for(let i=0;i<54;i++){tick(sim,1);trace.push([shot.x,shot.y,shot.z]);}
 assert.equal(b.hp,hp);assert.ok(shot.sourceAddLockOn.useManualDir);assert.ok(trace.some(p=>Math.hypot(p[0]-b.x,p[1]-b.y)<400));
 assert.ok(new Set(trace.map(p=>p[0])).size>20,'tracking is a travelling projectile');
 tick(sim,10);assert.ok(!sim.state.effects.some(e=>e.id===shot.id));
});
test('live target hit uses original shot and impact child with real damage',()=>{
 const {sim,a,b}=prepared();b.x=300;
 maximumStrikeAcceptedHit(sim,a,b,{NO_DAMAGE:0},{skillId:29027});assert.equal(fireMaximumStrike(sim,a),true);
 tick(sim,80);
 const hits=sim.state.events.filter(e=>e.type==='hit'&&e.targetId===b.id&&e.origin?.skillId===29022);
 assert.ok(hits.some(e=>e.amount>0),JSON.stringify({position:[b.x,b.y],events:sim.state.events.slice(-12),notes:a.unsupported.slice(-5)}));
 assert.ok(sim.state.events.some(e=>e.type==='effectStarted'&&e.name.includes('Maximum_Strike')&&e.name.includes('Explosion')));
});
for(const formation of [false,true])test(`unused orbs refund25 each as ${formation?'DP':'MP'} at expiry and once at death`,()=>{
 const {sim,a}=prepared({formation});a.mp=0;a.sourceAdd.dp=0;
 tickMaximumStrike(sim,a,61);
 assert.equal(orbs(sim).length,0);assert.equal(a.sourceAddCombat.maximumStrike,undefined);
 assert.equal(formation?a.sourceAdd.dp/20:a.mp,150);tickMaximumStrike(sim,a,1);
 assert.equal(sim.state.events.filter(e=>e.type==='addMaximumStrikeRefund').length,1);
 const d=prepared({formation});d.a.mp=0;d.a.sourceAdd.dp=0;d.a.hp=0;
 tick(d.sim,1);
 const refund=d.sim.state.events.find(e=>e.type==='addMaximumStrikeRefund');assert.equal(refund.resource,formation?'DP':'MP');assert.equal(refund.amount,150);
 tick(d.sim,2);assert.equal(d.sim.state.events.filter(e=>e.type==='addMaximumStrikeRefund').length,1);
});
test('full and critical owner reports retain six unique original orbits and reject forged ownership',()=>{
 const {sim,a,b,profile}=prepared();maximumStrikeAcceptedHit(sim,a,b,{NO_DAMAGE:0},{skillId:29027});
 const raw=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:0,frameSeq:105}))),state=validateOwnedState(raw),context={actors:sim.state.actors,profiles:sim.profiles};
 validateOwnedReferences(state,a,profile,sim.map,context);applyOwnedState(sim,a.id,state);assert.equal(orbs(sim).length,6);
 const ids=new Set(orbs(sim).map(e=>e.id)),critical=encodeCriticalAction(raw,{id:'maximum-v32',effectIds:ids});
 assert.deepEqual(critical.actor.sourceAddCombat.maximumStrike,raw.actor?.sourceAddCombat?.maximumStrike??raw.sourceAddCombat.maximumStrike);
 assert.equal(critical.effects.filter(e=>e.sourceAddMaximumStrike).length,6);
 const duplicate=structuredClone(raw),two=duplicate.effects.filter(e=>e.sourceAddMaximumStrike);two[1].sourceAddMaximumStrike.index=two[0].sourceAddMaximumStrike.index;
 assert.throws(()=>validateOwnedState(duplicate),/duplicate-owner-maximum-strike-orb/);
 const bad=structuredClone(raw);bad.actor.sourceAddCombat.maximumStrike.targetId=a.id;
 assert.throws(()=>validateOwnedReferences(validateOwnedState(bad),a,profile,sim.map,context),/maximum-strike-source/);
});

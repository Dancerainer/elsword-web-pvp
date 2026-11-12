/** Production Add actions/poses and actual owner envelopes. Synthetic contact
 * fixtures exercise the original payload, not a target-client trajectory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addFixture} from '../helpers/add-fixture.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {PROFESSION_PROFILES} from '../../packages/professions/profiles.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const manifest=read('artifacts/lp/manifest.json'),pose=read('artifacts/lp/'+manifest.runtimePose);
const characterPose=composeCharacterPose(pose,pose.sharedPose?read('artifacts/lp/'+pose.sharedPose):null);
const effectIndex=mergeEffectIndexes(read('artifacts/lp/'+manifest.effectAssetIndex),mergeVisualEffectIndexes(...manifest.visualEffectIndexes.map(p=>read('artifacts/lp/'+p))));
const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read('artifacts/lp/'+p)]));
const samplers=createNativeSamplers({profile:PROFESSION_PROFILES.LP,characterPose,effectIndex,effectPoses});
const keys={pressed:new Set(['A']),held:new Set(['A']),released:new Set(),ordered:[]};

function pulseFixture(){
 const f=addFixture('LP',{skillId:29217,passives:[29404],samplers});
 f.a.sourceAdd.formation=true;f.a.sourceAdd.dp=2000;f.a.awakening.remaining=99999;f.a.skillId=29217;
 const e=f.sim.createEffect(f.a,{NAME:'DamageEffect_AN_Pulse_Bullet_Ball'});
 const result=f.sim.applyHit(f.a,f.b,e.damage.DAMAGE_DATA,{kind:'effect',id:e.id,skillId:29217,powerMultiplier:1,impactPoint:[f.b.x,f.b.y,f.b.z]});
 assert.equal(result.accepted,true);return f;
}
const check=(sim,a,report)=>{
 const verified=validateOwnedState(JSON.parse(JSON.stringify(report)));
 validateOwnedReferences(verified,a,sim.profileFor(a),sim.map,{actors:sim.state.actors,profiles:sim.profiles});return verified;
};

for(const state of ['RSI_WAIT','RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK'])test('Fantasy actual input from '+state+' spends no new DP/MP and preserves original cooldown',()=>{
 const {sim,a,b}=pulseFixture();assert.equal(a.sourceAddFantasyTracer.targets[0].targetId,b.id);
 sim.enter(a,state,'original-state-fixture');a.mp=0;a.cooldowns[29217]=4;
 const dp=a.sourceAdd.dp,mutation=a.sourceAdd.mutation,query=sim.skillAvailability(a.id,0);
 assert.equal(query.available,true);assert.equal(query.mode,'fantasy-tracer');assert.equal(query.mpCost,0);
 sim.processInput(a,keys);assert.equal(a.state,'ANSI_COMBO_NASOD_ARMOR_READY');
 assert.equal(a.sourceAdd.dp,dp);assert.equal(a.sourceAdd.mutation,mutation);assert.equal(a.mp,0);assert.equal(a.cooldowns[29217],4);
 assert.equal(a.sourceAddFantasyTracer.targets[0].used,true);assert.equal(a.sourceAddCombat.nasodTargetId,b.id);
 const report=check(sim,a,encodeOwnedState(sim,a.id));
 const mirror=pulseFixture();applyOwnedState(mirror.sim,mirror.a.id,check(mirror.sim,mirror.a,report));
 assert.deepEqual(mirror.a.sourceAddFantasyTracer,a.sourceAddFantasyTracer);
});

test('Fantasy cannot turn a stopped or ordinary damage-state skill query into a free cast',()=>{
 const {sim,a}=pulseFixture();a.cooldowns[29217]=4;
 sim.enter(a,'RSI_DAMAGE_SMALL_FRONT','hit-reaction-fixture');assert.equal(sim.skillAvailability(a.id,0).available,false);
 sim.enter(a,'RSI_WAIT','fixture');a.worldStop=1;assert.equal(sim.skillAvailability(a.id,0).reason,'time-stopped');
 const before=structuredClone(a.sourceAddFantasyTracer);sim.processInput(a,keys);assert.deepEqual(a.sourceAddFantasyTracer,before);
});

test('Quicksilver source main link survives real owner transport and historical action validation',()=>{
 const one=addFixture('LP',{skillId:29011,samplers}),two=addFixture('LP',{skillId:29011,samplers});
 one.a.sourceAdd.dp=1000;
 one.sim.processInput(one.a,keys);one.sim.processStateEvents(one.a,0,.01);one.sim.tickEffects(1/60);
 const e=one.sim.state.effects.find(e=>e.sourceAddQuicksilverLink&&!e.dead);assert.ok(e);
 const report=check(one.sim,one.a,encodeOwnedState(one.sim,one.a.id,{epoch:0,frameSeq:1}));
 applyOwnedState(two.sim,two.a.id,check(two.sim,two.a,report));
 const received=two.sim.state.effects.find(e=>e.sourceAddQuicksilverLink&&!e.dead);
 assert.deepEqual(received.sourceAddQuicksilverLink,e.sourceAddQuicksilverLink);
 assert.deepEqual(received.currentAnchor,e.currentAnchor);
 assert.deepEqual(received.damage,e.damage);
 const earlier=encodeCriticalAction(report,{id:1,frameSeq:1});
 one.sim.enter(one.a,'RSI_WAIT','early-cancel-fixture');
 const current=encodeOwnedState(one.sim,one.a.id,{epoch:0,frameSeq:2});current.actions=[earlier];
 assert.doesNotThrow(()=>check(one.sim,one.a,current));assert.equal(e.dead,true);
 for(const alter of [s=>s.mainAnchor.position[0]=Infinity,s=>s.mainScale[0]=1e8,s=>s.group++,s=>s.other=true]){
  const invalid=structuredClone(report);alter(invalid.effects.find(e=>e.sourceAddQuicksilverLink).sourceAddQuicksilverLink);
  assert.throws(()=>check(two.sim,two.a,invalid));
 }
});

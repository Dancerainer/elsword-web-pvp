/** Independent target2016 fields, u16 table words and original consumer gates.
 * Current input/resource/damage execution is tested without target trace claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addFixture,addNative} from '../helpers/add-fixture.mjs';
import {addPassiveSample2016} from '../../packages/combat-core/add-passive-sample-2016.mjs';
import {addEspDamageMultiplier2016} from '../../packages/combat-core/add-mind-passives-2016.mjs';
import {requestAddMutation2016,consumeAddMutation} from '../../packages/combat-core/add-systems.mjs';
import {initializeAddPassives,applyAddMindControlRefund} from '../../packages/combat-core/add-passives.mjs';
import {createBuffFromFactor} from '../../packages/combat-core/buffs.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/de-profile.json',import.meta.url))),f=Math.fround;
const values={abilityValue:(table,level)=>table[level]};
const actor=(formed=false)=>({id:'de',professionId:'DE',sourceHitSeed:3227,mp:0,mpMax:330,sourceAdd:{formation:formed,mutation:1,dp:0},passivePolicy:{skillLevels:{29412:3,29413:3,29414:3}}});
test('original v1a4(0) samples are correlated reads, preserve the explicit u16 input and do not draw combat RNG',()=>{
 const a=actor(),sim={state:{seed:123},rng:()=>{throw Error('not CRT/random advancement');}};
 for(let i=0;i<3;i++){const r=addPassiveSample2016(sim,a);assert.equal(r.supported,true);assert.equal(r.offset,0);assert.equal(r.index,3227);assert.equal(r.tableValue,1600);assert.equal(r.value,f(.05));}
 assert.equal(sim.state.seed,123);delete a.sourceHitSeed;assert.equal(addPassiveSample2016(sim,a).supported,false);
});
test('Mind Control selected eight BuffTempletIDs use direct .3/.4/.5, while ID1 and unlearned remain neutral',()=>{
 for(const [level,rate]of [[1,.3],[2,.4],[3,.5]]){const p=structuredClone(profile);p.skillCatalog.find(s=>s.skillId===29412).maxLevel=level;
  const policy=initializeAddPassives(p,{nativeValues:values,passiveIds:[29412]});
  assert.equal(policy.add.mindControlDebuffDurationMultiplier,rate);
  assert.deepEqual(policy.add.mindControlDebuffTemplateIds,[52,53,61,161,172,184,223,291]);assert.equal(policy.add.mindControlDebuffTemplateIds.includes(1),false);
 }
 assert.equal(initializeAddPassives(profile,{nativeValues:values,passiveIds:[]}).add.mindControlDebuffDurationMultiplier,1);
});
test('Mind Control actual time finalizer multiplies incoming10 seconds by remaining30 percent at learned level1',()=>{
 const {sim,a,b}=addFixture('DE'),p=sim.profileFor(a);a.passivePolicy={...a.passivePolicy,add:{mindControlDebuffTemplateIds:[52,53,61,161,172,184,223,291],mindControlDebuffDurationMultiplier:.3}};
 const factor={BUFF_TEMPLET_ID:52,RATE:{1:100},BEHAVIOR:{COMBINATION:{1:46},BBT_STUN:{}},
  FINALIZER:{COMBINATION:{1:1,2:3},BFT_TIME:{BUFF_DURATION_TIME_TYPE:1,NORMAL_TIME:{1:10}},BFT_HITTED_COUNT:{BUFF_USE_COUNT_TYPE:0,COUNT:{1:1}}}};
 const result=createBuffFromFactor(p,{factor,sourceActor:b,targetActor:a,roll:0,nativeValues:addNative.skillValues});
 assert.equal(result.supported,true,JSON.stringify(result.unsupported));assert.equal(result.buff.finalizers.find(t=>t.kind==='time').remaining,3);
});
test('Mind Control cost refund permits table equality, reads current mode and rejects free/manual recasts without any sample',()=>{
 const a=actor(),sim={profileFor:()=>profile,state:{seed:987},emit:()=>{},rng:()=>{throw Error('must not draw');}};
 assert.equal(applyAddMindControlRefund(sim,a,{skillId:29019},{mode:'cast',formation:false,mpCost:200,dpCost:0}),20);
 a.sourceHitSeed=0;assert.equal(applyAddMindControlRefund(sim,a,{}, {mode:'cast',formation:false,mpCost:200,dpCost:0}),0);
 a.sourceHitSeed=3227;let requested=0;
 assert.equal(applyAddMindControlRefund(sim,a,{}, {mode:'cast',formation:true,mpCost:0,dpCost:1600},{changeDp:(_a,n)=>{requested=n;return n*1.5;}}),240);assert.equal(requested,160);
 delete a.sourceHitSeed;assert.equal(applyAddMindControlRefund(sim,a,{}, {mode:'phase-return',formation:false,mpCost:20,dpCost:0}),0);
 assert.equal(sim.state.seed,987);
});
test('Mind Circle request -3 with one point recovers three requests before storing zero; both producer fields gate it',()=>{
 for(const formed of [false,true]){const a=actor(formed),events=[];a.equipmentAttributes={addDpGainBonus:.5};
  const used=requestAddMutation2016(a,-3,{profile,emit:(type,id,data)=>events.push({type,id,...data,observedMutation:a.sourceAdd.mutation})});
  assert.equal(used,1);assert.equal(a.sourceAdd.mutation,0);assert.equal(a.mp,formed?45:0);assert.equal(a.sourceAdd.dp,formed?0:1350);
  const restore=events.find(e=>e.type==='addMindCircleRecovered');assert.equal(restore.request,-3);assert.equal(restore.magnitude,3);assert.equal(restore.observedMutation,1);
 }
 const a=actor(true),p=structuredClone(profile);p.skillCatalog.find(s=>s.skillId===29413).raw.SA_ADD_DP_VALUE_ABS['3']=0;
 requestAddMutation2016(a,-1,{profile:p});assert.equal(a.mp,0,'missing DP producer also blocks the formed MP branch');
});
test('max-consume callers pass their own actual min request, and signedINT_MIN is not mathematical positive infinity',()=>{
 const a=actor(true);assert.equal(consumeAddMutation(a,3,{profile}),1);assert.equal(a.mp,15);
 a.mp=100;a.sourceAdd.mutation=1;requestAddMutation2016(a,-2147483648,{profile});assert.equal(a.mp,0);assert.equal(a.sourceAdd.mutation,0);
 assert.throws(()=>requestAddMutation2016(a,-2147483649,{profile}));assert.throws(()=>requestAddMutation2016(a,1,{profile}));
});
test('ESP ordered sample equality applies the selected RECEIVER factor; absent passive and greater sample remain1',()=>{
 const a=actor(),sim={profileFor:()=>profile,state:{seed:123}};a.sourceHitSeed=5473;
 assert.equal(addPassiveSample2016(sim,a).tableValue,2240);assert.equal(addEspDamageMultiplier2016(sim,a),f(.3));
 a.sourceHitSeed=0;assert.equal(addEspDamageMultiplier2016(sim,a),1);a.sourceHitSeed=5473;a.passivePolicy.skillLevels={};assert.equal(addEspDamageMultiplier2016(sim,a),1);
 a.passivePolicy.skillLevels={29414:3};a.professionId='RF';assert.equal(addEspDamageMultiplier2016(sim,a),1);assert.equal(sim.state.seed,123);
});
test('actual DE input commits Mind Control refund before writing the current skill cooldown',()=>{
 // The actual configured top-tier skill is29033 (the preserved upgrade of
 //29019). Its original listed180MP gives an18MP level3 refund.
 const {sim,a}=addFixture('DE',{skillId:29033,passives:[29412]});a.sourceHitSeed=3227;a.mp=a.mpMax;const before=a.mp;
 let cooldownAtRefund='unobserved';const emit=sim.emit.bind(sim);sim.emit=(type,id,data)=>{if(type==='addMindControlRefund')cooldownAtRefund=a.cooldowns[29033]??0;emit(type,id,data);};
 sim.step(1/60,{add:{pressed:['A'],held:['A']}},{snapshot:false});
 assert.ok(sim.state.events.some(e=>e.type==='skillStarted'&&e.skillId===29033));assert.equal(cooldownAtRefund,0);
 assert.equal(a.mp,before-180+18);assert.ok(a.cooldowns[29033]>0);
});
test('actual final damage invokes ESP on the receiving Add and preserves the same earlier base formula',()=>{
 const run=seed=>{const {sim,a,b}=addFixture('DE',{passives:[29414]});b.passivePolicy=structuredClone(a.passivePolicy);b.sourceHitSeed=seed;
  a.stats.criticalPercent=0;a.equipmentAttributes.criticalRate=0;b.hp=1e7;b.hpMax=1e7;
  const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:2,HIT_TYPE:1,NO_MISS:1,ATTACK_TYPE:1};
  const result=sim.applyHit(a,b,data,{kind:'command',id:1,powerMultiplier:1,impactPoint:[b.x,b.y,b.z]});assert.equal(result.accepted,true);return result.amount;};
 const ordinary=run(0),reduced=run(5473);assert.ok(ordinary>0);assert.ok(Math.abs(reduced-ordinary*f(.3))<.001);
});

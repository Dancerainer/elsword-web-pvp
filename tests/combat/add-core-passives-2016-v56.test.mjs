/** Static source rows plus explicit current Web/native instances. No original
 * runtime seed production or measured client battle is implied. */
import test from 'node:test';
import assert from 'node:assert/strict';
import source from '../../contracts/add-core-passives-source-v56.json' with {type:'json'};
import {addFixture} from '../helpers/add-fixture.mjs';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {beginAddFormation,activateAddFormation,stopAddFormation,gainAddMutation,addNaturalMpRecoveryRate,applyAddCooldownProc,addHitMpMultiplier} from '../../packages/combat-core/add-systems.mjs';
import {addCoreFormationBuffs2016,advanceAddCorePassives2016,addCoreArmorFeedback2016,addBodyDamageBytes2016,reduceAddTimeControlSlots2016} from '../../packages/combat-core/add-core-passives-v56.mjs';
import {addPassiveSample2016} from '../../packages/combat-core/add-passive-sample-2016.mjs';
import {tickAddFantasyTracer,addFantasyTracerPlan} from '../../packages/combat-core/add-fantasy-tracer.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,validateOwnedBuffReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {tickBuffs} from '../../packages/combat-core/buffs.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createOwnerStatusClock} from '../../packages/online/owner-status-clock.mjs';
import {encodeOwnedStatus} from '../../packages/online/owned-status.mjs';
import {createOwnerBuffSender} from '../../packages/online/owner-buff-sync.mjs';

test('new catalog keeps original BF619/669 and exact BFT530/669 finalizers without visual assets',()=>{
 const c=source.buffCatalog;
 assert.equal(c.buffFactors[619].raw.BUFF_TEMPLET_ID,530);
 assert.deepEqual([1,2,3].map(n=>c.buffFactors[619].raw.BEHAVIOR.BBT_CHANGE_WALK_RUN_SPEED.PERCENT[n]),[1.035,1.048,1.061]);
 assert.deepEqual(c.buffTemplates[530].raw.FINALIZER.COMBINATION,{'1':11});
 assert.equal(c.buffTemplates[669].raw.BEHAVIOR.BBT_CHANGE_NOW_MP_PER_SECOND.TIME_INTERVAL,1);
 assert.deepEqual([1,2,3].map(n=>c.buffFactors[669].raw.BEHAVIOR.BBT_CHANGE_NOW_MP_PER_SECOND.FIX_VALUE[n]),[.5,.75,1]);
 assert.equal(c.buffTemplates[530].raw.DISPLAYER,undefined);assert.equal(c.buffTemplates[669].raw.DISPLAYER,undefined);
});
for(const [before,count,points,mp]of [[0,2,2,15],[5,2,6,0],[5,1,6,15],[6,1,6,0]])test(`Transform positive request ${before}+${count} rewards once only on original non-overflow branch`,()=>{
 const {a,profile}=addFixture('MM',{passives:[29405]});a.mp=0;a.sourceAdd.mutation=before;
 gainAddMutation(a,count,{profile});assert.equal(a.sourceAdd.mutation,points);assert.equal(a.mp,mp);
});
test('Fantasy awakening recovery uses actual option-adjusted/clamped DP payment',()=>{
 const {a,profile}=addFixture('LP',{passives:[29404]});a.mp=0;a.sourceAdd.dp=8000;a.equipmentAttributes.addDpConsumptionReduction=.5;
 const before=a.sourceAdd.dp;beginAddFormation(a,{profile});
 assert.equal(a.mp,Math.fround((before-a.sourceAdd.dp)*.5/20));
});
test('Fantasy record keeps equality1 enabled and equality0 retained; removal is strict negative',()=>{
 const {a,profile}=addFixture('LP',{skillId:29202,passives:[29404]});a.sourceAdd.formation=true;
 a.sourceAddFantasyTracer={targets:[{skillId:29202,targetId:'target',targetEpoch:0,remaining:3,used:false}],activeSkillId:null};
 tickAddFantasyTracer(a,2);assert.equal(a.sourceAddFantasyTracer.targets[0].used,false);
 assert.equal(addFantasyTracerPlan(a,profile.skillCatalog.find(s=>s.skillId===29202),{mode:'cast'},{profile}).mode,'fantasy-tracer');
 tickAddFantasyTracer(a,1);assert.equal(a.sourceAddFantasyTracer.targets[0].remaining,0);assert.equal(a.sourceAddFantasyTracer.targets[0].used,true);
 tickAddFantasyTracer(a,.01);assert.equal(a.sourceAddFantasyTracer.targets.length,0);
});
test('Battle Gear awakening chance uses explicit original getter sample; absent input cannot invent a point',()=>{
 for(const [sample,expected]of [[{supported:true,value:.5},2],[{supported:true,value:.50001},1],[undefined,1]]){
  const {a,profile}=addFixture('LP',{passives:[29400]});a.sourceAdd.dp=8000;
  beginAddFormation(a,{profile,passiveSample:sample});assert.equal(a.sourceAdd.mutation,expected);
 }
});
for(const id of ['LP','MM','DE'])test(`${id} awakening applies actual BF669 interval with single tick/no remainder carry`,()=>{
 const passive={LP:29401,MM:29406,DE:29411}[id],{sim,a,profile}=addFixture(id,{passives:[passive]});
 a.sourceAdd.dp=8000;beginAddFormation(a,{profile});activateAddFormation(a,{profile});addCoreFormationBuffs2016(sim,a);
 assert.ok(a.buffs.some(row=>row.templateId===669));a.mp=0;
 sim.advanceActorBuffs(a,2.5);assert.equal(a.mp,1,'one update gives one original amount');
 sim.advanceActorBuffs(a,.6);assert.equal(a.mp,1,'overrun from2.5 was discarded');
 sim.advanceActorBuffs(a,.4);assert.equal(a.mp,2);
 assert.equal(addNaturalMpRecoveryRate(a,profile),0,'no parallel continuous description sum');
});
test('Body of Transcendence actual619 changes movement and is removed after original positive-hyper flag ends',()=>{
 const {sim,a,profile}=originalAddFixture('LP',{passives:[29402]});a.sourceAdd.dp=8000;const baseSpeed=a.stats.moveSpeedMultiplier;
 beginAddFormation(a,{profile});activateAddFormation(a,{profile});addCoreFormationBuffs2016(sim,a);
 const buff=a.buffs.find(row=>row.templateId===530);assert.ok(buff);
 assert.equal(buff.behaviors[0].value,Math.fround(1.061));assert.equal(buff.finalizers[0].forceEnd,false);
 assert.ok(a.stats.moveSpeedMultiplier>1);
 const wire=validateOwnedState(encodeOwnedState(sim,a.id,{epoch:0,frameSeq:1}));
 const context={actors:sim.state.actors,profiles:sim.profiles};
 assert.doesNotThrow(()=>validateOwnedReferences(validateOwnedState(JSON.parse(JSON.stringify(wire))),a,sim.profileFor(a),sim.map,context));
 const bad=structuredClone(wire);bad.actor.buffs.find(row=>row.templateId===530).factorId=669;
 assert.throws(()=>validateOwnedState(bad),/invalid-owner/);
 const other=structuredClone(wire);other.actor.buffs[0].sourceActorId='target';validateOwnedState(other);
 assert.throws(()=>validateOwnedReferences(other,a,sim.profileFor(a),sim.map,context),/add-hyper-finalizer/);
 assert.throws(()=>validateOwnedBuffReferences(wire.actor.buffs,a,sim.profiles.MM,context),/add-hyper-finalizer/);
 const mixed={...context,actors:context.actors.map(row=>row.id==='target'?{...row,professionId:'MM',profileId:sim.profiles.MM.profileId}:row)};
 assert.throws(()=>validateOwnedBuffReferences(other.actor.buffs,a,sim.profileFor(a),mixed),/add-hyper-finalizer/);
 for(const mutate of [row=>{row.remaining=.5;},row=>{row.kind='time';row.sourceDuration=1;}]){
  const malformed=structuredClone(wire);mutate(malformed.actor.buffs[0].finalizers[0]);assert.throws(()=>validateOwnedState(malformed),/invalid-owner/);
 }
 const forced=structuredClone(buff);forced.finalizers[0].forceEnd=true;
 const options={targetActor:a,nativeValues:sim.nativeSkillValues};
 assert.equal(tickBuffs(sim.profileFor(a),[forced],0,options).buffs.length,1);
 assert.equal(tickBuffs(sim.profileFor(a),[forced],1/60,options).buffs.length,0,'positive awakening does not suppress an explicit original force-end byte');
 applyOwnedState(sim,a.id,wire);stopAddFormation(a,{profile});sim.advanceActorBuffs(a,1/60);
 assert.ok(!a.buffs.some(row=>row.templateId===530));assert.equal(a.stats.moveSpeedMultiplier,baseSpeed);
});
test('V55 reliable619 overtakes old unawakened pose, survives remote polling and authoritative end cannot be revived',()=>{
 const from=addFixture('LP',{passives:[29402],networkOwnerId:'add'}),to=addFixture('LP',{passives:[29402],networkOwnerId:'target'});
 const sync=createLocalOwnershipSync({ownerStatusVersion:1,combatPlaybackVersion:1,clock:()=>0}),ids=['add','target'];
 sync.reconcile(to.sim,{snapshot:to.sim.snapshot(),ownership:{mode:'local-owner-v1',ownerStatusVersion:1,combatPlaybackVersion:1,
  actors:Object.fromEntries(ids.map(id=>[id,{epoch:3,frameSeq:0}]))},owners:{}},'target');
 const clock=createOwnerStatusClock(),sender=createOwnerBuffSender();
 const sample=frame=>{const body=encodeOwnedState(from.sim,'add',{epoch:3,frameSeq:frame});Object.assign(body.actor,clock.encode(body.actor,3,frame).actor);
  const status=encodeOwnedStatus(body);sender.capture(status);return {body,status,snapshot:sender.snapshot()};};
 try{
  const old=sample(1);from.a.sourceAdd.dp=8000;beginAddFormation(from.a,{profile:from.profile});activateAddFormation(from.a,{profile:from.profile});addCoreFormationBuffs2016(from.sim,from.a);
  const active=sample(10);assert.equal(sync.receiveBuffs(to.sim,'add',active.snapshot,'target'),true);
  assert.equal(sync.receiveStatus(to.sim,'add',active.status,'target'),true);
  assert.equal(sync.receivePeer(to.sim,'add',old.body,'target'),true);
  const remote=to.sim.actor('add');assert.equal(remote.awakening.remaining,0);
  for(let i=0;i<3;i++)to.sim.advanceActorBuffs(remote,1/60);
  assert.ok(remote.buffs.some(b=>b.templateId===530),'remote stale model flag cannot end a newer owner-confirmed Buff');
  stopAddFormation(from.a,{profile:from.profile});from.sim.advanceActorBuffs(from.a,1/60);const ended=sample(20);
  assert.equal(sync.receiveBuffs(to.sim,'add',ended.snapshot,'target'),true);assert.equal(remote.buffs.length,0);
  sync.receiveStatus(to.sim,'add',active.status,'target');sync.receiveBuffs(to.sim,'add',active.snapshot,'target');
  assert.equal(remote.buffs.length,0,'old status/reliable retry cannot resurrect the ended619');
  remote.sourceAdd.formation=true;addCoreFormationBuffs2016(to.sim,remote);
  assert.equal(remote.buffs.length,0,'late foreign activation events cannot re-grant authoritative self Buffs');
 }finally{sync.clear();}
});
test('Body feedback initially ready, strict sample<chance, full-pool proc still resets and elapsed can overshoot',()=>{
 const {sim,a}=addFixture('LP',{passives:[29402]});a.sourceAdd.mutation=6;a.sourceHitSeed=3227;
 // Independently sealed original table index3227 contains1600, or .05.
 assert.equal(addPassiveSample2016(sim,a).tableValue,1600);const data={DYNAMO_PARTICLE_RATE_TYPE:3};
 assert.equal(addCoreArmorFeedback2016(sim,a,data,gainAddMutation).applied,true);
 assert.equal(a.sourceAdd.mutation,6);assert.equal(a.sourceAddCorePassives.armorMutationElapsed,0);
 advanceAddCorePassives2016(sim,a,2.6);assert.equal(a.sourceAddCorePassives.armorMutationElapsed,Math.fround(2.6));
 assert.equal(addCoreArmorFeedback2016(sim,a,data,gainAddMutation).applied,true);
});
test('anonymous Body DD bytes require the distinct original31c181c0 input; no invented damage flags',()=>{
 assert.equal(addBodyDamageBytes2016({dynamoType:3,chance:.14}).supported,false);
 assert.deepEqual(addBodyDamageBytes2016({dynamoType:3,chance:.14,sample:Math.fround(.14)}).bytes,{'0x4b4':1,'0x4c1':1});
});
test('Time Control exact two4-slot consumer skips unlearned/C/D/ignored/nonpositive and clears ignore after both groups',()=>{
 const slots=[{skillId:1,level:1},{skillId:2,level:1},{skillId:3,level:1},{skillId:4,level:0},null,{skillId:5,level:1},{skillId:6,level:1},{skillId:7,level:1}],
  catalog=[1,2,3,4,5,6,7].map(skillId=>({skillId,type:skillId===2?12:skillId===3?13:7})),cooldowns={1:8,2:8,3:8,4:8,5:8,6:0,7:-1},ignore=[5];
 const r=reduceAddTimeControlSlots2016({slots,catalog,cooldowns,ignore,factor:.25});
 assert.equal(r.supported,true);assert.deepEqual(r.changed,[{skillId:1,before:8,after:2}]);assert.deepEqual(ignore,[]);
 assert.equal(reduceAddTimeControlSlots2016({slots:[],catalog,cooldowns,factor:.25}).supported,false);
});
test('Time Control source sample equality, PvP half chance/factor, both bars; not1-factor or current slot only',()=>{
 const {a,profile}=addFixture('DE',{skillId:29026,passives:[29411]});
 const skill=profile.skillCatalog.find(row=>row.skillId===29026);assert.ok([7,14,15,16].includes(skill.type));
 a.loadout=[{skillId:29026,level:skill.maxLevel},null,null,null,{skillId:29023,level:1},null,null,null];a.cooldowns={29026:20,29023:12};
 const result=applyAddCooldownProc(a,skill,{profile,sample:{supported:true,value:Math.fround(.2)},gameMode:'PVP'});
 assert.equal(result.applied,true);assert.deepEqual(a.cooldowns,{29026:5,29023:3});
 const before={...a.cooldowns};assert.equal(applyAddCooldownProc(a,skill,{profile}).applied,false);assert.deepEqual(a.cooldowns,before);
});
test('Overlimit both MP getters use72fc even when explicit7300 input differs',()=>{
 const {a,profile}=addFixture('DE',{passives:[29410]});a.sourceAdd.formation=true;
 const changed=structuredClone(profile);changed.skillCatalog.find(row=>row.skillId===29410).raw.SA_MP_GAIN_GET_HIT_REL['4']=9;
 assert.equal(addHitMpMultiplier(a,{},'received',{profile:changed}),1.15);
});

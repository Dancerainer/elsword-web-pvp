import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {advanceElesisDashAccumulator,windmillExtraMp,windmillEndReason,caDashWaveLifetime} from '../../packages/combat-core/profession-source-v53.mjs';
import {calculateBrandishSelfCost,evaluateTargetSelfDamage2016} from '../../packages/combat-core/target-self-damage-v53.mjs';
import {acceptLegacyFireRecord,absorbLegacyFireRecords} from '../../packages/combat-core/legacy-fire-stores-v53.mjs';
import {firewallInitialBody} from '../../packages/combat-core/elesis-firewall-v45.mjs';
import {scanElesisAvatarFire} from '../../packages/combat-core/elesis-fire-absorb-v45.mjs';
import {ravenSourceCommandResult} from '../../packages/combat-core/rf-command-source-v53.mjs';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {comboStopFixture} from '../../tools/combat/rf_combo_stop_v7.mjs';
import {passiveFixture,frames} from '../helpers/passive-v20-fixture.mjs';
import {lordKnightFrame,lordKnightSkillEvent} from '../../packages/combat-core/lk-skills.mjs';
import {elesisFrame} from '../../packages/combat-core/elesis-skills.mjs';
import {encodeOwnedState,validateOwnedState,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const f=Math.fround,near=(a,b,eps=.001)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`),keys=(held=[],pressed=[])=>({held:new Set(held),pressed:new Set(pressed)});
test('GM original four dash states accumulate float delta;28204 retains and any other state clears',()=>{
 const a={sourceElesisSkills:{dashAccumulator:0},skillId:null};
 for(const state of ['RSI_DASH','RSI_DASH_END','RSI_DASH_JUMP','RSI_DASH_JUMP_LANDING']){a.state=state;advanceElesisDashAccumulator(a,.125);}
 assert.equal(a.sourceElesisSkills.dashAccumulator,.5);a.state='ESI_SI_A_EL_LEAP_CRASH';a.skillId=28204;
 advanceElesisDashAccumulator(a,.125);assert.equal(a.sourceElesisSkills.dashAccumulator,.5);
 a.state='RSI_WAIT';a.skillId=null;advanceElesisDashAccumulator(a,.125);assert.equal(a.sourceElesisSkills.dashAccumulator,0);
});
test('Windmill MP is per callback with exact double divisor and strict independent post gates',()=>{
 const q=windmillExtraMp(.028);near(q,1,1e-6);
 assert.equal(windmillEndReason({elapsed:2.1,base:2.1,mp:0,delta:.028,held:false}),null);
 assert.equal(windmillEndReason({elapsed:2.1001,base:2.1,mp:q,delta:.028,held:true}),null);
 assert.equal(windmillEndReason({elapsed:2.1001,base:2.1,mp:q-.001,delta:.028,held:true}),'lk-windmill-extra-mp-insufficient');
 const max=2.1+2.799999952316284;
 assert.equal(windmillEndReason({elapsed:max,base:2.1,mp:999,delta:.028,held:true}),null);
 assert.equal(windmillEndReason({elapsed:max+.001,base:2.1,mp:999,delta:.028,held:true}),'lk-windmill-extension-limit');
});
test('Windmill actual callbacks charge before post and END uses its own elapsed gate',()=>{
 const raw=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url))),a={id:'lk',state:'ESSI_SA_ESK_WINDMILL',stateTime:2.2,mp:100,grounded:false,stats:{moveSpeedMultiplier:1},sourceLordKnight:{autoGuardCooldown:0},skillContext:{key:'S',level:1},skillId:21010};
 const entries=[],sim={profileFor:()=>raw,skill:id=>raw.skillCatalog.find(s=>s.skillId===id),emit:()=>{},enter:(a,n,reason)=>entries.push([n,reason])};
 lordKnightFrame(sim,a,keys(['S']),.028);near(a.mp,99,.00001);lordKnightSkillEvent(sim,a,keys(['S']));assert.equal(entries.length,0);
 lordKnightSkillEvent(sim,a,keys(['A']));assert.equal(entries.at(-1)[0],'ESSI_SA_ESK_WINDMILL_END');
 a.state='ESSI_SA_ESK_WINDMILL_END';a.stateTime=0;lordKnightFrame(sim,a,keys(),.028);near(a.mp,99,.00001);
});
test('CA charged wave changes original mesh .3 lifetime independently of uniform size',()=>{
 assert.equal(caDashWaveLifetime(0),f(.3));assert.equal(caDashWaveLifetime(3),.5997000336647034);
 assert.throws(()=>caDashWaveLifetime(NaN));
});
test('CA self wrapper preserves F1/F2 distinction, does not recap second result and applies666 last',()=>{
 const data={DAMAGE_TYPE:0,ATTACK_TYPE:1,DAMAGE:{PHYSIC:30,MAGIC:0},PVP_RATE:.6};let calls=0;
 const result=calculateBrandishSelfCost({hp:1000,hpMax:1000,data,evaluate:dd=>{near(dd.DAMAGE.PHYSIC,1,1e-6);assert.equal(dd.CRITICAL_RATE,0);return {supported:true,amount:++calls===1?20:950};}});
 assert.equal(calls,2);assert.equal(result.cost,950,'second result can take HP below first10% check');
 calls=0;const capped=calculateBrandishSelfCost({hp:1000,hpMax:1000,data,buff666:true,evaluate:()=>{calls++;return {supported:true,amount:1000};}});
 assert.equal(calls,1);near(capped.cost,600.030029296875);
 assert.equal(calculateBrandishSelfCost({hp:199,hpMax:1000,data,evaluate:()=>{throw Error();}}).exempt,true);
 assert.equal(calculateBrandishSelfCost({hp:200,hpMax:1000,data,evaluate:()=>({supported:true,amount:1})}).exempt,false);
});
test('CA selected original physical self evaluator applies mode1 defence before PvP and additive final channels',()=>{
 const args={data:{DAMAGE_TYPE:0,ATTACK_TYPE:1,DAMAGE:{PHYSIC:2},PVP_RATE:.6},physicalAttack:1000,magicAttack:0,
  physicalDefence:(348+62*85*.10000000149011612)/2,magicDefence:0,ownerLevel:85,mode:1,
  ownerDamageDelta:.2,receiverDamageDelta:-.1,swordMultiplier:1,attackTypeMultiplier:1,percentReduction:0,receiverMultiplier:1,ownerMultiplier:1};
 const r=evaluateTargetSelfDamage2016(args);assert.ok(r.supported);near(r.amount,660);
 assert.equal(evaluateTargetSelfDamage2016({...args,ownerLevel:undefined}).supported,false);
});
test('CA received callback skips missed .15 indices and permits final index7 without catch-up',()=>{
 const {sim,a}=elesisFixture('CA',{skillId:28022,gap:5000});a.skillId=28022;sim.enter(a,'SI_SA_SDK_BRANDISH_BREAKER_LOOP','source-test');
 const before=a.hp;elesisFrame(sim,a,keys(),.46);
 assert.equal(a.sourceElesisSkills.loops,3);assert.equal(sim.state.events.filter(e=>e.type==='elesisBrandishExtended').length,1);assert.ok(a.hp<before);
 a.sourceElesisSkills.loops=6;a.sourceElesisSkills.loopTime=1.04;elesisFrame(sim,a,keys(),.02);
 assert.equal(a.sourceElesisSkills.loops,7);const count=sim.state.events.filter(e=>e.type==='elesisBrandishExtended').length;
 elesisFrame(sim,a,keys(),.2);assert.equal(sim.state.events.filter(e=>e.type==='elesisBrandishExtended').length,count);
});
test('legacy FIRE accepts priority/duration ordered comparison and absorption removes entire two records',()=>{
 const a={};const record={type:3,effectiveValue:5,power:10,sourceActorId:'x'},gates={immune:false,allowEnchant:true};
 assert.ok(acceptLegacyFireRecord(a,record,gates));assert.equal(acceptLegacyFireRecord(a,{...record,power:9,effectiveValue:9},gates),false);
 assert.equal(acceptLegacyFireRecord(a,{...record,effectiveValue:4},gates),false);
 assert.ok(acceptLegacyFireRecord(a,{...record,effectiveValue:6,sourceActorId:'y'},gates));
 assert.ok(acceptLegacyFireRecord(a,{type:100,effectiveValue:10,power:999,sourceActorId:'z'},gates));
 assert.deepEqual(absorbLegacyFireRecords(a),[3,100]);assert.equal(a.sourceLegacyFireStores,undefined);
});
test('Avatar consumes both legacy records once each and Buff37/293 remain separate stores',()=>{
 const {sim,a,b}=elesisFixture('BH',{skillId:28208,gap:200});a.skillId=28208;sim.enter(a,'ESI_SI_A_SPK_AVATAR_OF_THE_FIRE','source-test');a.mp=0;
 const gates={immune:false,allowEnchant:true};for(const type of [3,100])acceptLegacyFireRecord(b,{type,effectiveValue:5,power:100,sourceActorId:a.id},gates);
 sim.grantBuff(a,b,294,1,null);scanElesisAvatarFire(sim,a);assert.equal(a.mp,30);assert.equal(b.sourceLegacyFireStores,undefined);assert.ok(!b.buffs.some(v=>v.templateId===37));
 const event=sim.state.events.find(e=>e.type==='elesisFireAbsorbed');assert.equal(event.count,3);assert.deepEqual(event.removedLegacyTypes,[3,100]);
});
test('Firewall creation keeps its body at height30 equality and snaps only strict near eligible lines',()=>{
 const map={lines:[{lineId:1,type:0,start:[-100,0,0],end:[100,0,0]},{lineId:2,type:4,start:[-100,20,0],end:[100,20,0]}]};
 assert.deepEqual(firewallInitialBody([0,30,0],map),{position:[0,30,0],lineId:null});
 assert.deepEqual(firewallInitialBody([0,29,0],map),{position:[0,0,0],lineId:1});
 assert.deepEqual(firewallInitialBody([0,100,0],map),{position:[0,100,0],lineId:null});
});
test('RF ZZZX capture excludes both sides of original [.166,.59), then uses later .333 latch arm',()=>{
 const profile={target:{unitClass:107}},result={state:null,flags:2};
 for(const [time,flag]of [[.165,0],[.166,2],[.589,2],[.59,0]])assert.equal(ravenSourceCommandResult(profile,{state:'RSI_COMBO_ZZZ',animationTime:time},keys(['X'],['X']),result,0).flags,flag);
 assert.equal(ravenSourceCommandResult(profile,{state:'RSI_COMBO_ZZZ',animationTime:.333},keys(),result,2).state,null);
 assert.equal(ravenSourceCommandResult(profile,{state:'RSI_COMBO_ZZZ',animationTime:.334},keys(),result,2).state,'RRF_COMBO_ZZZX');
});
test('RF actual source ZZZX state executes three1.53 attacks and four1.15 child declarations, survives JSON owner restore',async()=>{
 const {s:sim,a}=await comboStopFixture({facing:1,hit:false}),raw=sim.profileFor(a);
 sim.enter(a,'RRF_COMBO_ZZZX','source-test');a.skillId=null;
 for(let i=0;i<180;i++)sim.step(1/60,{}, {snapshot:false});
 const created=sim.state.events.filter(e=>e.type==='effectStarted');
 const primary=created.filter(e=>e.name==='DamageEffect_RRF_Combo_ZZZX_01'),children=created.filter(e=>e.name==='DamageEffect_RRF_Up_Spine_ZZZX');
 assert.equal(primary.length,3);assert.equal(children.length,4);
 assert.equal(raw.damageEffects.DamageEffect_RRF_Combo_ZZZX_01.raw.DAMAGE_DATA.DAMAGE.MAGIC,1.53);
 assert.equal(raw.damageEffects.DamageEffect_RRF_Up_Spine_ZZZX.raw.DAMAGE_DATA.DAMAGE.MAGIC,1.15);
 const report=validateOwnedState(encodeOwnedState(sim,a.id));assert.ok(report);assert.equal(a.state,'RSI_WAIT');
});
test('BF437 uses shared owner byte, handles wrap, and restores the exact threshold',async()=>{
 const s=await passiveFixture(),a=s.actor('rf');a.sourceHitCountByte=253;s.grantBuff(a,a,437,3,null);
 let row=a.buffs.find(b=>b.templateId===408).finalizers.find(v=>v.kind==='hit');assert.equal(row.sourceByteEnd,260);
 const packet=encodeOwnedState(s,a.id);assert.doesNotThrow(()=>validateOwnedState(packet));
 const missing=structuredClone(packet);delete missing.actor.sourceHitCountByte;
 assert.throws(()=>validateOwnedState(missing),/hit-counter-byte/,'A threshold report cannot borrow a stale receiver counter');
 a.sourceHitCountByte=1;frames(s,1);row=a.buffs.find(b=>b.templateId===408).finalizers.find(v=>v.kind==='hit');
 assert.equal(row.sourceByteEnd,4);assert.equal(row.remaining,3);
 const other=await passiveFixture();other.restore(JSON.parse(JSON.stringify(s.snapshot())));a.sourceHitCountByte=4;other.actor('rf').sourceHitCountByte=4;
 frames(s,1);frames(other,1);assert.deepEqual(s.snapshot(),other.snapshot());assert.ok(!a.buffs.some(b=>b.templateId===408));
});

test('An installed Raven profile may construct another simulation, while a conflicting source declaration is rejected',async()=>{
 const first=await passiveFixture(),a=first.actor('rf');
 const original=structuredClone(first.profile.states.RRF_COMBO_ZZZX);
 const options={profile:first.profile,map:first.map,preset:{passives:[],guildPassives:[]},
  actors:[{id:'reused',team:0,position:[a.x,a.y,a.z],lineId:a.lineId,passives:[],guildPassives:[]}]};
 const second=createSimulation(options);
 assert.deepEqual(second.profile.states.RRF_COMBO_ZZZX,first.profile.states.RRF_COMBO_ZZZX);
 const bad=structuredClone(first.profile);bad.states.RRF_COMBO_ZZZX.raw.DISABLE_GRAVITY_TIME_END=123;
 assert.throws(()=>createSimulation({...options,profile:bad}),/Conflicting target2016 Raven closure/);
 assert.deepEqual(first.profile.states.RRF_COMBO_ZZZX,original,'Failed construction cannot mutate the supplied profile');
});

/** Target declarations and qualified source operations are the expectations.
 * Input repeatability and mixed actor routing are simulator invariants, not a
 * recording of the target2016 client's timing, damage or network protocol. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createWayOfSword,advanceWayOfSword,wayOfSwordHitDelta,wayOfSwordReceivedDelta,createLordKnightResourcePools} from '../../packages/combat-core/lord-knight.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {PvpMatch,OPENING_HA_SKILL_IDS} from '../../packages/pvp/index.mjs';
import {createOwnedBodyArrivalGuard} from '../../packages/online/owned-body-arrival.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
const rf=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const lk=JSON.parse(readFileSync(process.env.LK_PROFILE_FIXTURE??new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const empty=()=>Array(8).fill(null);
const map={sceneId:'explicit-mixed-fixture',lines:[{lineId:0,start:[-2000,0,0],end:[2000,0,0]}],spawns:[
  {kind:'SetTeamStartPos',teamFlag:1,position:[0,0,0],lineId:0,facingRight:1,index:0},
  {kind:'SetTeamStartPos',teamFlag:0,position:[150,0,0],lineId:0,facingRight:0,index:1},
]};
const make=(extra={})=>createSimulation({profile:rf,profiles:{RF:rf,LK:lk},preset:{guildPassives:[]},
  presets:{LK:{version:'lk-fixture',loadout:empty()}},seed:2016,map,actors:[
    {id:'rf',professionId:'RF',team:0,x:0,y:0,loadout:empty()},
    {id:'lk',professionId:'LK',team:1,x:150,y:0,facing:-1,loadout:empty(),awakening:{orbs:3}},
  ],...extra});
const normal={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:1,ATTACK_TYPE:2,HIT_ADD_MP:1,WAY_OF_SWORD_TYPE:1};
test('each actor selects its own exact target profile, command, physics and preset',()=>{
  const s=make();assert.equal(s.profileFor(s.actor('rf')).target.unitClass,107);assert.equal(s.profileFor(s.actor('lk')).target.unitClass,100);
  assert.equal(s.profileFor(s.actor('lk')).physics.RUN_SPEED,740);assert.equal(s.profileFor(s.actor('rf')).physics.RUN_SPEED,725);
  s.step(1/60,{rf:{pressed:['Z']},lk:{pressed:['Z']}});
  assert.equal(s.profileFor(s.actor('rf')).states[s.actor('rf').state].animationName,'ComboZ1');
  assert.equal(s.profileFor(s.actor('lk')).states[s.actor('lk').state].sourceState,'ESSI_COMBO_Z1');
  assert.equal(s.actor('lk').actorVersions.preset,'lk-fixture');
});
test('LK loadout rejects RF skills and unknown professions while allowing sourced skill callbacks',()=>{
  const s=make();assert.throws(()=>s.configureLoadout([{skillId:24027},...empty().slice(1)],'lk'),/not an LK/);
  assert.equal(s.configureLoadout([{skillId:21026},...empty().slice(1)],'lk')[0].skillId,21026);
  assert.equal(s.configureLoadout([{skillId:21219},...empty().slice(1)],'lk')[0].skillId,21219);
  assert.throws(()=>make({actors:[{id:'bad',professionId:'XX',x:0,y:0}]}),/Unknown actor profession/);
});
test('shared RSI names never execute Raven native callback or Nasod lifecycle on LK',()=>{
  let lkCalls=0;
  const commands={handlesFuture:()=>false,handlesEvent:()=>false,runFuture:a=>{if(a.professionId==='LK')lkCalls++;return {handled:false,animationBeforeTime:a.animationTime,animationOneshotTimer:0,passiveSpeed:a.passiveSpeed};},runEvent:()=>({handled:false}),runStart:a=>{if(a.professionId==='LK')lkCalls++;return {handled:false};}};
  const s=make({nativeCommands:commands});s.enter(s.actor('lk'),'RSI_COMBO_X','fixture');s.step(1/60,{});
  assert.equal(lkCalls,0);assert.notEqual(s.commandsFor(s.actor('lk')),commands);
  assert.equal(s.commandsFor(s.actor('lk')).ruleVersion,'lk-target2016-command-bindings-v3-dash-x-skip');
  const a=s.actor('lk');a.awakening.pendingOrbs=3;a.awakening.pendingAvailableOrbs=3;s.activateAwakening(a);
  assert.equal(a.awakening.remaining,90);assert.equal(a.core.phase,'absent');assert.equal(a.core.gauge,0);
  s.injectHit({attackerId:'lk',targetId:'rf',damageData:normal});s.tickCore(a,1);assert.equal(a.core.level,0);
  a.hp=10000;a.mp=0;s.expireAwakening(a);assert.equal(a.hp,10000);assert.equal(a.mp,0);
});
test('real target Kick raw force-down consumer applies independently of RF passives',()=>{
  const s=make();s.configureLoadout([{skillId:21219},...empty().slice(1)],'lk');s.actor('lk').skillId=21219;s.actor('lk').skillContext={level:1};
  const result=s.injectHit({attackerId:'lk',targetId:'rf',damageData:{...normal,FORCE_DOWN:10}});
  assert.equal(result.accepted,true);assert.equal(s.drainEvents().find(e=>e.type==='hit').data.FORCE_DOWN,-50);
});
test('LK Vitality and Warrior Physique consume their target values without RF passive hooks',async()=>{
  const nativeSkillValues=await instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values-v1/skill-values-source.wasm',import.meta.url)));
  const sim=make({nativeSkillValues,presets:{RF:{passives:[]},LK:{loadout:empty()}}}),a=sim.actor('lk'),b=sim.actor('rf');
  assert.equal(a.passivePolicy.vitality.multiplier,Math.fround(1.15));assert.equal(a.passivePolicy.received.damageMultiplier,Math.fround(.85));
  assert.equal(a.passivePolicy.burning.enabled,false);assert.equal(a.passivePolicy.stats.hpMultiplier,Math.fround(1.06));assert.equal(a.hpMax,Math.fround(50000*Math.fround(1.06)));
  a.mp=0;sim.injectHit({attackerId:'lk',targetId:'rf',damageData:{...normal,HIT_ADD_MP:8}});assert.equal(a.mp,Math.fround(8*Math.fround(1.15)));
  sim.step(.1,{});a.mp=0;b.invincible=false;sim.injectHit({attackerId:'lk',targetId:'rf',damageData:{...normal,HIT_ADD_MP:8,ATTACK_TYPE:1}});assert.equal(a.mp,8);
  a.invincible=false;const hit=sim.injectHit({attackerId:'rf',targetId:'lk',damageData:normal});assert.equal(hit.accepted,true);assert.equal(hit.amount,1000*Math.fround(.85));
  const missing=structuredClone(lk);delete missing.skillCatalog.find(row=>row.skillId===21400).raw.SA_MP_GAIN_ON_HIT_REL['4'];
  assert.throws(()=>make({nativeSkillValues,profiles:{RF:rf,LK:missing}}),/Target LK 21400.SA_MP_GAIN_ON_HIT_REL at max level missing/);
});
test('target Way of Sword gauge constants and fixed-source hysteresis never inherit V5 defaults',()=>{
  const r=createWayOfSword(lk);
  assert.equal(wayOfSwordHitDelta(lk,r,{WAY_OF_SWORD_TYPE:1,DAMAGE:{PHYSIC:2}},1),Math.fround(Math.fround(Math.fround(2)*Math.fround(67.2))*Math.fround(-3)));
  advanceWayOfSword(lk,r,4801);assert.deepEqual(r,{point:4800,state:2});advanceWayOfSword(lk,r,-100);assert.deepEqual(r,{point:4700,state:2});
  assert.equal(wayOfSwordReceivedDelta(lk,r,normal),-72);assert.equal(wayOfSwordReceivedDelta(lk,r,{...normal,REACT_TYPE:10}),null);
  advanceWayOfSword(lk,r,-4700);assert.deepEqual(r,{point:0,state:0});advanceWayOfSword(lk,r,-4900);assert.deepEqual(r,{point:-4800,state:-2});
  assert.throws(()=>wayOfSwordHitDelta({...lk,referenceSemantics:{wayOfSword:{targetFields:{}}}},r,normal),/Missing target2016/);
});
test('mixed profiles preserve byte-identical seeded replay and reject actor class changes on restore',()=>{
  const a=make(),b=make();for(let i=0;i<160;i++){const input={rf:{held:i<60?['RIGHT']:[],pressed:i===0?['Z']:[]},lk:{held:i<80?['LEFT']:[],pressed:i===2?['X']:[]}};a.step(1/60,input);b.step(1/60,input);}assert.deepEqual(a.snapshot(),b.snapshot());
  const snapshot=a.snapshot(),c=make();c.restore(snapshot);for(let i=0;i<50;i++){a.step(1/60,{});c.step(1/60,{})}assert.deepEqual(a.snapshot(),c.snapshot());
  snapshot.actors[1].professionId='RF';assert.throws(()=>c.restore(snapshot),/profession\/profile/);
});
test('the same frozen room restores in RF and LK browsers with different local default profiles',()=>{
  const server=make(),client=make({profile:lk});
  server.step(1/60,{lk:{pressed:['Z']}});client.restore(server.snapshot());assert.deepEqual(client.snapshot(),server.snapshot());
  for(let i=0;i<20;i++){server.step(1/60,{});client.step(1/60,{})}assert.deepEqual(client.snapshot(),server.snapshot());
  const unknown=server.snapshot();unknown.profileId='unregistered-class';assert.throws(()=>client.restore(unknown),/version\/map\/profile/);
});
test('owned state uses LK effect catalog and rejects RF gauge or LK Nasod spoofing',()=>{
  const a=make(),b=make();a.spawnSet(a.actor('lk'),Object.keys(lk.effectSets)[0]);a.actor('lk').wayOfSword={point:-100,state:-1};
  const report=encodeOwnedState(a,'lk');validateOwnedReferences(report,a.actor('lk'),lk,map);applyOwnedState(b,'lk',report);assert.equal(b.actor('lk').wayOfSword.point,-100);
  const bad=structuredClone(report);bad.actor.core.gauge=20;assert.throws(()=>validateOwnedReferences(bad,a.actor('lk'),lk,map),/invalid-lk-nasod/);
  const wrongSide=structuredClone(report);wrongSide.actor.wayOfSword.state=2;assert.throws(()=>validateOwnedReferences(wrongSide,a.actor('lk'),lk,map),/invalid-lk-way/);
  const wrong=encodeOwnedState(a,'rf');wrong.actor.wayOfSword={point:0,state:0};validateOwnedState(wrong);assert.throws(()=>validateOwnedReferences(wrong,a.actor('rf'),rf,map),/invalid-rf-way/);
  wrong.actor.professionId='LK';assert.throws(()=>validateOwnedState(wrong),/invalid-owner-state/);
});
test('historical LK pass actions resolve declarations from the frozen roster identity',()=>{
  const sim=make(),guard=createOwnedBodyArrivalGuard(),remote=sim.actor('lk'),local=sim.actor('rf');
  remote.x=150;local.x=0;guard.reset('lk',1);const first=guard.capture(sim,'lk','rf');
  guard.accept(sim,'lk',{epoch:1,frameSeq:0,actions:[]},'rf',first);
  const before=guard.capture(sim,'lk','rf');remote.x=-150;
  // The wire carries no profession identity. Native Rolling has CAN_PASS=1
  // in LK's target declaration; that state does not exist in the RF profile.
  assert.equal(lk.states.ESSI_SI_A_ES_ROLLING.raw.CAN_PASS_UNIT,1);
  guard.accept(sim,'lk',{epoch:1,frameSeq:2,actions:[{frameSeq:1,actor:{x:0,y:0,z:0,state:'ESSI_SI_A_ES_ROLLING',animationTime:0}}]},'rf',before);
  assert.equal(remote.x,-150);assert.equal(guard.diagnostics.observedPass,1);assert.equal(local.x,0);
});
test('bidirectional cross-profession buff references use the frozen source actor catalog',()=>{
  const sim=make(),context={profiles:sim.profiles,actors:sim.state.actors};
  for(const [sourceId,targetId,templateId,factorId]of [['lk','rf',78,70],['rf','lk',31,null]]){
    const source=sim.actor(sourceId),target=sim.actor(targetId),profile=sim.profileFor(target),sourceProfile=sim.profileFor(source);
    assert.ok(sourceProfile.buffTemplates[templateId]);assert.equal(profile.buffTemplates[templateId],undefined);
    // Reference-validation fixture only: behavior execution remains separately
    // covered by native buff tests. No synthetic buff is used as client gold.
    const report=encodeOwnedState(sim,targetId);report.actor.buffs=[{schemaVersion:1,templateId,factorId,skillLevel:1,
      sourceActorId:sourceId,targetActorId:targetId,accumulationLimit:1,resistance:0,durationMultiplier:1,
      behaviors:[],finalizers:[{kind:'time',sourceDuration:1,remaining:1}],displayer:{}}];
    validateOwnedState(report);assert.doesNotThrow(()=>validateOwnedReferences(report,target,profile,map,context));
    const spoof=structuredClone(report);spoof.actor.buffs[0].sourceActorId=targetId;assert.throws(()=>validateOwnedReferences(spoof,target,profile,map,context),/unknown-owner-buff/);
    spoof.actor.buffs[0].sourceActorId='not-a-room-player';assert.throws(()=>validateOwnedReferences(spoof,target,profile,map,context),/invalid-owner-buff-source/);
    if(factorId!=null){spoof.actor.buffs[0].sourceActorId=sourceId;spoof.actor.buffs[0].factorId=118;assert.throws(()=>validateOwnedReferences(spoof,target,profile,map,context),/invalid-owner-buff-factor-template/);}
  }
});
test('shared target buff display closure keeps source-native wound/fire records on either profession',async()=>{
  const commonBuffs=JSON.parse(readFileSync(process.env.COMMON_BUFFS_FIXTURE??new URL('../../contracts/common-buff-catalog.json',import.meta.url)));
  const nativeSkillValues=await instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values-v1/skill-values-source.wasm',import.meta.url)));
  const sim=make({commonBuffs,nativeSkillValues,seed:1}),receiver=make({commonBuffs,nativeSkillValues,seed:1});
  for(const actor of sim.state.actors){actor.buffResistances={0:0,1:0};actor.debuffDurationMultiplier=1;}
  const wound=rf.damageEffects.RAVEN_OVER_TAKER_CHARGED_BOLT.raw.DAMAGE_DATA.BUFF_FACTOR;
  const findFactor=(value,id)=>{if(!value||typeof value!=='object')return null;if(value.BUFF_TEMPLET_ID===id&&value.RATE)return value;for(const child of Object.values(value)){const result=findFactor(child,id);if(result)return result;}return null;};
  const fire=findFactor(lk.damageEffects,37);assert.ok(fire,'exact LK source fire buff factor exists');
  assert.ok(sim.grantBuff(sim.actor('rf'),sim.actor('lk'),wound));assert.ok(sim.grantBuff(sim.actor('lk'),sim.actor('rf'),fire));
  sim.step(.02,{});const context={profiles:sim.profiles,actors:sim.state.actors};
  for(const [id,setName]of [['lk','EffectSet_DEBUFF_WOUND'],['rf','EffectSet_DEBUFF_FIRE']]){
    const report=encodeOwnedState(sim,id);validateOwnedReferences(report,sim.actor(id),sim.profileFor(sim.actor(id)),map,context);
    assert.ok(report.effects.some(effect=>effect.setName===setName&&effect.buffTemplateId!=null));
    applyOwnedState(receiver,id,report);assert.ok(receiver.state.effects.some(effect=>effect.ownerId===id&&effect.setName===setName&&effect.buffTemplateId!=null));
  }
  const spoof=encodeOwnedState(sim,'lk');spoof.actor.buffs[0].sourceActorId='unknown';assert.throws(()=>validateOwnedReferences(spoof,sim.actor('lk'),sim.profileFor(sim.actor('lk')),map,context),/invalid-owner-buff-source/);
  const conflict=structuredClone(commonBuffs);conflict.buffTemplates[31].raw.ACCUMULATION_LIMIT=999;assert.throws(()=>make({commonBuffs:conflict}),/Conflicting original/);
  const offensive=structuredClone(commonBuffs);offensive.damageEffects.fake={};assert.throws(()=>make({commonBuffs:offensive}),/buff-only/);
  assert.equal(sim.profileFor(sim.actor('lk')).states.RRF_COMBO_ZZXFRONTX,undefined);assert.equal(sim.profileFor(sim.actor('lk')).damageEffects.RAVEN_NASOD_BALL,undefined);
});
test('LK original intro/result clips, opening HA cooldown and registered score resource retention',()=>{
  const sim=make();const pvp=new PvpMatch({mode:'1v1',map,players:[{id:'rf',team:0},{id:'lk',team:1}],versions:{referenceVersion:'target',presetVersion:'fixture',programVersion:'fixture'},specialResourcePools:createLordKnightResourcePools()});
  pvp.start(sim);assert.ok(sim.actor('lk').pvpPresentation.animationName.startsWith('LK_')||['Start','SK_Start'].includes(sim.actor('lk').pvpPresentation.animationName));
  assert.equal(sim.actor('lk').cooldowns[21603],180);assert.ok(OPENING_HA_SKILL_IDS.includes(21603));
  assert.equal(sim.actor('lk').cooldowns[24600],undefined);assert.equal(sim.actor('rf').cooldowns[21603],undefined);
  const pools=createLordKnightResourcePools(),actor=sim.actor('lk');actor.wayOfSword={point:-4800,state:-2};const values=pools.map(pool=>pool.read(actor));for(let i=0;i<2;i++)pools[i].write(actor,values[i]*.5);assert.deepEqual(actor.wayOfSword,{point:-2400,state:-1});
  assert.equal(pools[0].read(sim.actor('rf')),null);
  for(const point of [-4800,4800]){actor.wayOfSword={point,state:Math.sign(point)*2};const before=pools.map(pool=>pool.read(actor));pools.forEach((pool,i)=>pool.write(actor,before[i]*0));assert.deepEqual(actor.wayOfSword,{point:0,state:0});}
  // Existing revival policy
  // (packages/combat-core/lord-knight.mjs): retained full balance
  // ends active into charging. Current Web policy, not original2016 gold.
  for(const expected of [{point:-4800,state:-1},{point:4800,state:1}]){const point=expected.point;actor.wayOfSword={point,state:Math.sign(point)*2};const before=pools.map(pool=>pool.read(actor));pools.forEach((pool,i)=>pool.write(actor,before[i]));assert.deepEqual(actor.wayOfSword,expected);validateOwnedReferences(encodeOwnedState(sim,'lk'),actor,sim.profileFor(actor),map);}
});

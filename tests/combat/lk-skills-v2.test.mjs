import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {createSkillTraitPolicy,skillTraitDamageData,skillTraitBuffFactor} from '../../packages/combat-core/skill-traits.mjs';
import {encodeOwnedState,validateOwnedState,applyOwnedState} from '../../packages/online/owned-state.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const base=process.env.LK_NATIVE_FIXTURE_ROOT??root,assets=process.env.LK_ASSET_FIXTURE_ROOT??resolve(root,'artifacts/lk');
const read=p=>JSON.parse(readFileSync(p));
const profile=read(resolve(root,'packages/combat-core/lk-profile.json'));
const preset=authoredEquipmentPreset(read(resolve(root,'config/lk-preset.json')));
const map={...read(resolve(base,'artifacts/scene/sander-garpai-rock-pvp/manifest.json')),...read(resolve(base,'artifacts/scene/sander-garpai-rock-pvp/collision.json'))};
const fx=read(resolve(assets,'fx/index.json')),index=mergeEffectIndexes(read(resolve(assets,'effect-assets.json')),fx);
const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(resolve(assets,p))]));
const pose=read(resolve(assets,'runtime-pose.json'));
const native=await createNativeRuntime({manifest:read(resolve(base,'artifacts/native/manifest.json')),map,
  loadBinary:file=>readFileSync(resolve(base,'artifacts/native',file))});
function make(id=21026,branchId='none',extra={},passives=profile.defaultPassiveSkillIds){
  // Explicit neutral equipment reproduces this isolated skill fixture's
  // previous implicit stats while retaining the production PvP formula.
  // EquipmentMP0 + sourced baseMP300 leaves the cost expectations unchanged.
  return createSimulation({profile,map,preset:{...preset,guildPassives:[],bannedSkillIds:[900],
    attributes:{hpMax:1000000,mpMax:0,physicalAttack:1000,magicAttack:1000,
      animationSpeedMultiplier:1,moveSpeedMultiplier:1,jumpSpeedMultiplier:1},
    loadout:[{skillId:id,branchId},null,null,null,null,null,null,null]},seed:2016,
    actors:[{id:'lk',professionId:'LK',team:0,position:[2022.98,2840,0],lineId:6,facing:-1,guildPassives:[],passives},
      {id:'target',professionId:'LK',team:1,position:[1858.11,2840,0],lineId:6,facing:1,guildPassives:[],passives:[],loadout:Array(8).fill(null)}],
    ...createNativeSamplers({profile,characterPose:pose,effectIndex:index,effectPoses:poses}),
    nativeGeometry:native.geometry,nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,
    ...extra});
}
// Independent literal target2016 m_MPConsumption/m_SkillCoolTime rows.
const rows=[[21026,100,6],[21217,15,3],[21027,150,10],[21028,250,16],[21029,100,6],
  [21219,30,6],[21031,180,14],[21030,300,20],[21218,50,15],[21034,100,7],
  [21203,50,7],[21204,40,7],[21007,300,21],[21008,250,25],[21205,40,7],[21009,200,16],
  [21010,150,15],[21206,10,null],[21011,100,8],[21603,300,180]];
for(const [id,mp,cd] of rows)test(`LK ${id}: original assets, real cast, lifecycle, finite damage and online snapshot`,()=>{
  const sim=make(id),actor=sim.actor('lk');sim.drainEvents();
  sim.step(1/60,{lk:{pressed:['A'],held:['A']}});
  assert.equal(actor.mp,300-mp);assert.equal(actor.cooldowns[id],cd??0);
  const events=sim.drainEvents();
  for(let i=0;i<600;i++){sim.step(1/60,{lk:{held:i<90&&id===21026?['A']:[]}});events.push(...sim.drainEvents());}
  assert.equal(events.filter(e=>e.type==='skillStarted'&&e.skillId===id).length,1);
  assert.equal(actor.skillId,null,`${id} must leave all skill stages`);
  assert.ok(events.filter(e=>e.type==='hit').every(e=>Number.isFinite(e.amount)&&e.amount>=0));
  assert.ok(!sim.state.unsupported.some(n=>n.id.startsWith('damage:')));
  validateOwnedState(encodeOwnedState(sim,'lk'));
  if(![21217,21218,21206].includes(id))assert.ok(events.some(e=>e.type==='attackWindow'||e.type==='effectStarted'&&profile.damageEffects[e.name]),`${id} must execute actual damage route`);
  if(![21218,21206].includes(id))assert.ok(events.some(e=>e.type==='hit'&&e.actorId==='lk'&&e.amount>0),`${id} actual hit missing: ${JSON.stringify(sim.state.unsupported.map(x=>x.id))}`);
});

test('all38 LK branches resolve the target2016 MEMO enum and alter an executable policy',()=>{
  let count=0;
  for(const skill of profile.skillCatalog.filter(s=>s.topTier&&!s.passive))for(const branch of skill.branches){
    const p=createSkillTraitPolicy(skill,branch.id);
    assert.equal(profile.enums.MEMO_ID[p.memoTypeName],branch.memoType);
    const keys=['mpMultiplier','cooldownMultiplier','damageMultiplier','hitGapMultiplier','rangeMultiplier','buffDurationMultiplier','buffStrengthMultiplier'];
    assert.ok(keys.some(k=>p[k]!==1)||p.forceDownAdd||p.targetMpBurn||p.hitMpMultiplier||p.mpRefundChance||p.forceCritical||p.ignoreDefence);
    assert.ok(!p.unsupported.some(s=>s.includes('Unimplemented target trait')));
    count++;
  }
  assert.equal(count,38);
});
test('LK branch effects use independent source values: absorb/useful/buff strength/refund',()=>{
  const policy=(id,branch)=>createSkillTraitPolicy(profile.skillCatalog.find(s=>s.skillId===id),branch);
  assert.equal(policy(21028,'memo-21').hitMpMultiplier,1.4);
  assert.equal(policy(21205,'memo-57').hitMpMultiplier,1.4);
  assert.equal(policy(21010,'memo-61').hitMpMultiplier,1.4);
  assert.deepEqual(skillTraitDamageData({HIT_GAP:.14},policy(21031,'memo-38')),{HIT_GAP:.14});
  // Original MEMO rows38/23 refer to legacy skill IDs21005/21004. The
  // public DD hook must match that ID before halving its authored interval.
  for(const [id,memo,originalId]of [[21031,'memo-38',21005],[21030,'memo-23',21004]]){
    const useful=policy(id,memo);assert.equal(useful.originalSkillId,originalId);
    assert.equal(useful.hitGapMultiplier,.5);assert.equal(useful.damageMultiplier,.7);assert.deepEqual(useful.unsupported,[]);
    assert.deepEqual(skillTraitDamageData({APPLIED_SKILL_ID:originalId,HIT_GAP:.14},useful),{APPLIED_SKILL_ID:originalId,HIT_GAP:.07});
    assert.deepEqual(skillTraitDamageData({APPLIED_SKILL_ID:999,HIT_GAP:.14},useful),{APPLIED_SKILL_ID:999,HIT_GAP:.14});
  }
  assert.equal(policy(21030,'memo-23').damageMultiplier,.7);
  assert.equal(policy(21206,'memo-54').mpRefundChance,.1);assert.equal(policy(21206,'memo-54').mpRefundFraction,.5);
  assert.equal(policy(21011,'memo-56').mpRefundChance,.25);assert.equal(policy(21011,'memo-56').mpRefundFraction,.33);
  const raw=profile.buffFactors[70].raw,changed=skillTraitBuffFactor(raw,policy(21204,'memo-41'));
  const ratio=raw.BEHAVIOR.BBT_CHANGE_PHYSIC_DEFENCE.PERCENT['1'];
  assert.equal(changed.BEHAVIOR.BBT_CHANGE_PHYSIC_DEFENCE.PERCENT['1'],Math.fround(ratio+(ratio-1)*.3));
});
test('IronBody grants target factor714, applies5s armor and defence and duration branch7.5s without replacing motion',()=>{
  for(const [branch,duration]of [['none',5],['memo-24',7.5]]){
    const sim=make(21218,branch),a=sim.actor('lk');sim.step(1/60,{lk:{pressed:['A']}});
    const buff=a.buffs.find(b=>b.templateId===18);assert.ok(buff);assert.equal(buff.finalizers[0].sourceDuration,duration);
    assert.equal(a.stats.finalDefenceMultiplier,Math.fround(.614));assert.equal(a.state,'RSI_WAIT');
    assert.equal(a.superArmor,true,'no-state skill applies armor within its cast packet');
    sim.step(1/60,{});assert.equal(a.superArmor,true);
    for(let i=0;i<duration*60+5;i++){sim.step(1/60,{});sim.drainEvents();}
    assert.equal(a.buffs.some(b=>b.templateId===18),false);assert.equal(a.superArmor,false);
  }
});
test('IronBody cleanses the final debuff and immediately recomposes stats, controls and same-packet armor',()=>{
  const sim=make(21218),a=sim.actor('lk'),b=sim.actor('target');sim.rng=()=>0;
  assert.ok(sim.grantBuff(b,a,118,1),JSON.stringify(a.unsupported));assert.ok(a.stats.accuracy<1);
  sim.rng=()=>.99;sim.step(1/60,{lk:{pressed:['A']}});
  assert.ok(!a.buffs.some(v=>v.templateId===38));assert.equal(a.stats.accuracy,1);
  assert.deepEqual(a.buffControls,{inputBlock:false,dashBlock:false});assert.equal(a.superArmor,true);
  const state=a.state;sim.injectHit({attackerId:'target',targetId:'lk',damageData:{DAMAGE:{PHYSIC:1},DAMAGE_TYPE:0,REACT_TYPE:1}});
  assert.equal(a.state,state);assert.equal(a.superArmor,true);
});
test('Armageddon maintains original buff322 and attached sword helper until exact source duration expires',()=>{
  const sim=make(21008,'memo-47'),a=sim.actor('lk');sim.step(1/60,{lk:{pressed:['A']}});
  for(let i=0;i<180;i++){sim.step(1/60,{});sim.drainEvents();}
  const buff=a.buffs.find(b=>b.templateId===322);assert.ok(buff);assert.equal(buff.finalizers[0].sourceDuration,32.5);
  assert.ok(sim.state.effects.some(e=>e.ownerId==='lk'&&e.definition.USE_SUB_ATTACK_LIST_SET===1));
});
test('Counter front-only strict target0.06..0.5 window rejects CAN_REVENGE0 and saves incoming source damage',()=>{
  for(const [time,front,can,expected]of [[.06,true,1,false],[.061,true,1,true],[.499,true,1,true],[.5,true,1,false],[.1,false,1,false],[.1,true,0,false]]){
    const sim=make(21206),a=sim.actor('lk'),b=sim.actor('target');sim.step(1/60,{lk:{pressed:['A']}});
    a.animationTime=time;a.invincible=false;b.x=a.x+(front?a.facing:-a.facing)*100;
    const hp=a.hp,result=sim.injectHit({attackerId:'target',targetId:'lk',damageData:{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:2},REACT_TYPE:1,CAN_REVENGE:can}});
    assert.equal(result.countered===true,expected);
    if(expected){assert.equal(a.hp,hp);assert.equal(a.sourceLordKnight.revengePower,2);assert.equal(a.state,'ESSI_REVENGE_ATTACK');}
  }
});

const near=(a,b,epsilon=1e-3)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} != ${b}`);
const traitRows=read(resolve(root,'tests/fixtures/lk-traits-v2.json')).rows;
function traceCast(id,branch='none',roll=.99,chargeFrames=90){
  const sim=make(id,branch,{},[]),a=sim.actor('lk'),b=sim.actor('target');sim.rng=()=>roll;b.mp=100;
  sim.drainEvents();sim.step(1/60,{lk:{pressed:['A'],held:['A']}});
  const start={mp:a.mp,cooldown:a.cooldowns[id],policy:structuredClone(a.skillContext?.traitPolicy)};
  if(id===21206){a.animationTime=.1;a.invincible=false;sim.injectHit({attackerId:'target',targetId:'lk',
    damageData:{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:2},REACT_TYPE:1,CAN_REVENGE:1}});}
  let first=null,firstTargetMp=null;const buffs=new Map(),events=[];
  for(let i=0;i<420;i++){
    sim.step(1/60,{lk:{held:i<chargeFrames&&id===21026?['A']:[]}});
    const packet=sim.drainEvents();events.push(...packet);
    if(!first){first=packet.find(e=>e.type==='hit'&&e.actorId==='lk'&&e.amount>0);if(first)firstTargetMp=b.mp;}
    for(const actor of [a,b])for(const buff of actor.buffs)if(!buffs.has(buff.templateId))buffs.set(buff.templateId,structuredClone(buff));
  }
  validateOwnedState(encodeOwnedState(sim,'lk'));
  return {sim,a,b,start,first,firstTargetMp,buffs,events};
}
const baselineCasts=new Map();
for(const [id,memo,kind,value,second]of traitRows)test(`LK branch ${id}/memo-${memo}: actual cast ${kind} against independent target expectation`,()=>{
  if(!baselineCasts.has(id))baselineCasts.set(id,traceCast(id));
  const base=baselineCasts.get(id),v=traceCast(id,'memo-'+memo),cost=rows.find(r=>r[0]===id)[1];
  assert.ok(v.events.some(e=>e.type==='skillStarted'&&e.skillId===id));
  if(!['duration','buffStrength','cooldown','refund'].includes(kind)||id!==21218)assert.ok(v.first,'actual hit required');
  if(['damage','heavy','critical','usefulPartial'].includes(kind))near(v.first.amount/base.first.amount,value*(kind==='critical'?1.5:1));
  if(kind==='critical')assert.equal(v.first.critical,true);
  if(kind==='heavy')near(v.start.cooldown,base.start.cooldown*second);
  if(kind==='mp'||kind==='brilliant'||kind==='ignoreDefence')near(300-v.start.mp,cost*value);
  if(kind==='cooldown')near(v.start.cooldown,base.start.cooldown*value);
  if(kind==='brilliant')near(v.start.cooldown,base.start.cooldown*second);
  if(kind==='ignoreDefence'){
    {assert.notEqual(v.first.data.IGNORE_DEFENCE,1);assert.equal(v.start.policy.defencePierceMultiplier,.75);}
    assert.ok(v.start.policy.unsupported.some(s=>s.includes('defensive-effect bypass')));
  }
  if(kind==='usefulPartial'){
    assert.equal(v.start.policy.hitGapMultiplier,.5);assert.deepEqual(v.start.policy.unsupported,[]);
    if(Number.isFinite(base.first.data.HIT_GAP))near(v.first.data.HIT_GAP,base.first.data.HIT_GAP*.5);
  }
  if(kind==='forceDown')near(v.first.data.FORCE_DOWN,(base.first.data.FORCE_DOWN??0)+value);
  if(kind==='absorb'){
    assert.equal(v.first.time,base.first.time,'recovery-only trait retains the same natural regeneration interval');
    near(v.first.mp-base.first.mp,(base.first.data.HIT_ADD_MP??0)*(value-1));
  }
  if(kind==='burn')near(base.firstTargetMp-v.firstTargetMp,value);
  if(kind==='duration')near(v.buffs.get(second)?.finalizers.find(f=>f.kind==='time').sourceDuration,value);
  if(kind==='buffStrength')near(v.buffs.get(second)?.behaviors.find(b=>b.stat==='physicalDefence').value,value);
  if(kind==='refund'){
    near(v.start.mp,300-cost);
    for(const [roll,yes]of [[value-.0001,true],[value,false]]){
      const trial=traceCast(id,'memo-'+memo,roll);near(trial.start.mp,300-cost+(yes?Math.fround(cost*second):0));
    }
  }
});

test('LK passive21400 applies target1.15 on command MP and excludes special attacks',()=>{
  // Each fresh source frame isolates the passive's attack-type condition;
  // an additional same-frame injection would correctly share its resource gate.
  for(const [ATTACK_TYPE,expected]of [[0,11.5],[1,10]]){
    const sim=make(),a=sim.actor('lk');a.mp=0;
    sim.injectHit({attackerId:'lk',targetId:'target',damageData:{DAMAGE:{PHYSIC:1},DAMAGE_TYPE:0,REACT_TYPE:1,ATTACK_TYPE,HIT_ADD_MP:10}});
    near(a.mp,expected);
  }
});
test('LK passive21403 applies target HP1.06 and incoming damage0.85',()=>{
  const sim=make(),a=sim.actor('lk');assert.equal(a.hpMax,1060000);a.invincible=false;sim.rng=()=>.99;
  const hit=sim.injectHit({attackerId:'target',targetId:'lk',damageData:{DAMAGE:{PHYSIC:1},DAMAGE_TYPE:0,REACT_TYPE:1}});
  near(hit.amount,850);
});
test('LK passive21401 checks target9% chance, front/normal/ground conditions and7s internal cooldown',()=>{
  for(const [roll,front,normal,grounded,yes]of [[.089,true,true,true,true],[.09,true,true,true,false],[0,false,true,true,false],[0,true,false,true,false],[0,true,true,false,false]]){
    const sim=make(),a=sim.actor('lk'),b=sim.actor('target');sim.rng=()=>roll;a.grounded=grounded;a.invincible=false;b.x=a.x+(front?a.facing:-a.facing)*100;
    sim.injectHit({attackerId:'target',targetId:'lk',damageData:{DAMAGE:{PHYSIC:1},DAMAGE_TYPE:0,REACT_TYPE:1,ATTACK_TYPE:normal?0:2}});
    assert.equal(a.state.startsWith('ESSI_SI_P_ESK_AUTO_GUARD'),yes);
    if(yes){assert.equal(a.sourceLordKnight.autoGuardCooldown,7);sim.enter(a,'RSI_WAIT','test-next-hit');a.invincible=false;
      sim.injectHit({attackerId:'target',targetId:'lk',damageData:{DAMAGE:{PHYSIC:1},DAMAGE_TYPE:0,REACT_TYPE:1,ATTACK_TYPE:0}});
      assert.equal(a.state.startsWith('ESSI_SI_P_ESK_AUTO_GUARD'),false);}
  }
});
test('LK passive21402 source command callback triggers at declared clock with target21% and own power curve',()=>{
  for(const [roll,yes]of [[.209,true],[.21,false]]){
    const sim=make(),a=sim.actor('lk');sim.rng=()=>roll;sim.enter(a,'RSI_COMBO_Z','test-original-command');
    for(let i=0;i<24;i++)sim.step(1/60,{});
    const effects=sim.drainEvents().filter(e=>e.type==='effectStarted'&&e.setName==='EffectSet_SI_P_ELK_WIND_SLICER');
    assert.equal(effects.length>0,yes);
    if(yes){const hit=sim.state.effects.find(e=>e.skillId===21402);if(hit)near(hit.powerMultiplier,1.15);}
  }
});
test('LK passive21404 source debuff callback stacks target7.5% five times and expires after20s',()=>{
  const sim=make(),a=sim.actor('lk'),b=sim.actor('target');sim.rng=()=>.5;
  for(let i=1;i<=6;i++){
    assert.ok(sim.grantBuff(b,a,70,1));const buff=a.buffs.find(v=>v.templateId===232);assert.ok(buff);
    assert.equal(buff.accumulationCount,Math.min(i,5));near(a.stats.physicalAttack/a.buffBaseStats.physicalAttack,1+.075*Math.min(i,5));
    assert.equal(buff.finalizers[0].sourceDuration,20);
  }
  for(let i=0;i<1205;i++){sim.step(1/60,{});sim.drainEvents();}
  assert.ok(!a.buffs.some(v=>v.templateId===232));near(a.stats.physicalAttack,a.buffBaseStats.physicalAttack);
});
test('LK owned state rejects nonfinite/negative consumer timers, wrong booleans and invalid effect handles',()=>{
  const sim=make();sim.step(1/60,{});const baseline=encodeOwnedState(sim,'lk');
  for(const [key,values]of Object.entries({autoGuardCooldown:[-1,NaN],charge:[-1,Infinity],rollingDuration:[-1,NaN],revengePower:[-1,Infinity],counterLaunch:[0,1,'true'],megaEffects:[[-1],[0],[.5]],windmillEffects:[[0],[2.5]]}))
    for(const value of values){const bad=structuredClone(baseline);bad.actor.sourceLordKnight={autoGuardCooldown:0,[key]:value};assert.throws(()=>validateOwnedState(bad));}
});

test('IronBody cleanses RF-only Wound31 through its source catalog and restores its last dash restriction',()=>{
  const rf=read(resolve(root,'packages/combat-core/rf-profile.json'));
  const sim=make(21218,'none',{profiles:{RF:rf,LK:profile},actors:[
    {id:'lk',professionId:'LK',team:0,position:[2022.98,2840,0],lineId:6,facing:-1,guildPassives:[],passives:[]},
    {id:'target',professionId:'RF',team:1,position:[1858.11,2840,0],lineId:6,facing:1,guildPassives:[],passives:[],loadout:Array(8).fill(null)},
  ]},[]),a=sim.actor('lk'),b=sim.actor('target');sim.rng=()=>0;
  assert.equal(sim.profileFor(a).buffTemplates[31],undefined);
  assert.ok(sim.grantBuff(b,a,rf.damageEffects.RAVEN_OVER_TAKER_CHARGED_BOLT.raw.DAMAGE_DATA.BUFF_FACTOR));
  sim.rng=()=>.99;
  sim.advanceActorBuffs(a,0);assert.equal(a.buffControls.dashBlock,true);
  sim.step(1/60,{lk:{pressed:['A']}});
  assert.ok(!a.buffs.some(v=>v.templateId===31));assert.equal(a.buffControls.dashBlock,false);assert.equal(a.superArmor,true);
});

test('Counter and AutoGuard precede destruction rage; one incoming hit cannot trigger both',()=>{
  for(const [counter,guard]of [[true,false],[false,true],[false,false]]){
    const sim=make(21206),a=sim.actor('lk'),b=sim.actor('target');sim.rng=()=>guard?0:.99;
    a.wayOfSword={point:-4800,state:-2};a.grounded=true;a.invincible=false;b.x=a.x-100;
    if(counter){sim.step(1/60,{lk:{pressed:['A']}});a.animationTime=.1;a.invincible=false;}
    sim.drainEvents();const hit=sim.injectHit({attackerId:'target',targetId:'lk',damageData:{DAMAGE:{PHYSIC:1},DAMAGE_TYPE:0,REACT_TYPE:1,ATTACK_TYPE:0,CAN_REVENGE:1}});
    const events=sim.drainEvents();
    if(counter){assert.equal(hit.countered,true);assert.equal(a.state,'ESSI_REVENGE_ATTACK');assert.equal(a.destructionRageRemaining??0,0);}
    else if(guard){assert.ok(a.state.startsWith('ESSI_SI_P_ESK_AUTO_GUARD'));assert.ok(hit.amount>0);assert.equal(a.destructionRageRemaining??0,0);}
    else{assert.equal(a.state,'ESSI_DESTRUCTION_RAGE');assert.equal(hit.amount,0);assert.ok(a.destructionRageRemaining>0);}
    assert.ok(!(events.some(e=>e.type==='lkAutoGuard')&&events.some(e=>e.type==='wayOfSwordRage')));
  }
});
test('IronBody applies same-packet armor in active destruction and preserves existing rage armor',()=>{
  for(const prior of [0,1]){
    const sim=make(21218),a=sim.actor('lk');sim.rng=()=>.99;
    a.wayOfSword={point:-4800,state:-2};a.destructionRageRemaining=prior;
    sim.step(1/60,{lk:{pressed:['A']}});assert.equal(a.superArmor,true);
    const state=a.state,time=a.destructionRageRemaining;
    const hit=sim.injectHit({attackerId:'target',targetId:'lk',damageData:{DAMAGE:{PHYSIC:1},DAMAGE_TYPE:0,REACT_TYPE:1,ATTACK_TYPE:0}});
    assert.ok(hit.amount>0);assert.equal(a.state,state);assert.equal(a.destructionRageRemaining,time);
  }
});
test('Windmill cleanup owns every live visual handle and ends all of them when base duration elapses',()=>{
  const sim=make(21010),a=sim.actor('lk');sim.step(1/60,{lk:{pressed:['A']}});const created=new Set(),ended=new Set();
  for(let i=0;i<360;i++){
    sim.step(1/60,{});for(const e of sim.drainEvents()){
      if(e.type==='effectStarted'&&['EffectSet_ELSWORD_WINDMILL','EffectSet_ELSWORD_WINDMILL_LAND'].includes(e.setName))created.add(e.effectId);
      if(e.type==='effectEnded')ended.add(e.effectId);
    }
  }
  assert.ok(created.size>2);for(const id of created)assert.ok(ended.has(id),'unstopped Windmill handle '+id);
  assert.equal(a.sourceLordKnight.windmillEffects,undefined);assert.ok(!a.buffs.some(v=>v.templateId===318));
});
test('owned-state translates nested Windmill handles into receiver IDs and keeps them for source stop',()=>{
  const sender=make(21010),receiver=make(21010);receiver.state.nextEffectId=500;
  sender.step(1/60,{lk:{pressed:['A']}});for(let i=0;i<40;i++)sender.step(1/60,{});
  const report=encodeOwnedState(sender,'lk');assert.ok(report.actor.sourceLordKnight.windmillEffects.length>2);
  applyOwnedState(receiver,'lk',report);const ids=receiver.actor('lk').sourceLordKnight.windmillEffects;
  assert.ok(ids.every(id=>id>=500&&receiver.state.effects.some(e=>e.id===id)));
  receiver.enter(receiver.actor('lk'),'RSI_WAIT','test-stop');
  assert.ok(receiver.state.effects.filter(e=>ids.includes(e.id)).every(e=>e.dead));
});
test('Mega Slash holding the actual slot for at least1s applies target1.5 damage only after release',()=>{
  const short=traceCast(21026,'none',.99,0),charged=traceCast(21026,'none',.99,90);
  assert.ok(short.first&&charged.first);near(charged.first.amount/short.first.amount,1.5);
  assert.ok(charged.first.time>short.first.time+1);
});

test('Mega Slash held past seven seconds automatically fires once, with charged damage, and exits',()=>{
  const short=traceCast(21026,'none',.99,0),held=traceCast(21026,'none',.99,1000);
  assert.ok(held.first);near(held.first.amount/short.first.amount,1.5);
  assert.ok(held.first.time<3,'a held key must not stall the cast');
  assert.equal(held.events.filter(e=>e.type==='skillStarted'&&e.skillId===21026).length,1);
  assert.equal(held.a.skillId,null);
  assert.equal(held.a.state,'RSI_WAIT');
});

for(const [slot,key]of ['A','S','D','C','Q','W','E','R'].entries())
test(`Mega Slash ${key}: own slot releases early; stopped animation cannot bypass authored 1.7s web bound`,()=>{
  for(const release of [true,false]){
    const sim=make(),a=sim.actor('lk');
    const entry=a.loadout[0];a.loadout=Array(8).fill(null);a.loadout[slot]=entry;
    sim.step(1/60,{lk:{pressed:[key],held:[key]}});
    for(let i=0;i<90&&a.state.endsWith('_READY');i++)sim.step(1/60,{lk:{held:[key]}});
    assert.equal(a.state,'ESSI_SI_A_MEGASLASH_MEMO_CHARGE');
    a.stateTime=release?.2:1.65;a.animationStopped=true;
    sim.step(1/60,{lk:{held:release?['Z']:[key]}});
    if(!release){
      assert.equal(a.state,'ESSI_SI_A_MEGASLASH_MEMO_CHARGE');
      for(let i=0;i<5&&a.state.endsWith('_CHARGE');i++)sim.step(1/60,{lk:{held:[key]}});
    }
    assert.equal(a.state,'ESSI_SI_A_MEGASLASH_MEMO_FIRE');
    assert.equal(a.animationStopped,false);
    near(a.skillScale,release?1.2:1.8);
    validateOwnedState(encodeOwnedState(sim,'lk'));
  }
});
test('Armageddon original attached helper reaches beyond the ordinary sword during a real Z swing',()=>{
  const hits=[];
  for(const active of [false,true]){
    const sim=make(21008,'none',{},[]),a=sim.actor('lk'),b=sim.actor('target');sim.rng=()=>.99;
    b.x=a.x-400;
    if(active)assert.ok(sim.grantBuff(a,a,321,1));
    for(let i=0;i<90;i++)sim.step(1/60,{});sim.drainEvents();
    sim.step(1/60,{lk:{pressed:['Z']}});const events=[];
    for(let i=0;i<90;i++){sim.step(1/60,{});events.push(...sim.drainEvents());}
    hits.push(events.filter(e=>e.type==='hit'&&e.actorId==='lk'&&e.amount>0).length);
  }
  assert.equal(hits[0],0);assert.ok(hits[1]>0,'original Armageddon subattack line must hit at400 units');
});
for(const facing of [-1,1])test(`Armageddon real hand-bound helper permits rear Armor Break contact ${facing}`,()=>{
  for(const active of [false,true]){
    const sim=make(21204,'none',{},[]),a=sim.actor('lk'),b=sim.actor('target');a.facing=facing;b.x=a.x-150*facing;
    if(active)assert.ok(sim.grantBuff(a,a,321,1));
    for(let i=0;i<90;i++)sim.step(1/60,{});sim.drainEvents();
    sim.step(1/60,{lk:{pressed:['A']}});const hits=[];
    for(let i=0;i<90;i++){sim.step(1/60,{});hits.push(...sim.drainEvents().filter(e=>e.type==='hit'&&e.actorId==='lk'));}
    assert.equal(hits.length>0,active);
    if(active)assert.ok(b.buffs.some(buff=>buff.factorId===70));
  }
});

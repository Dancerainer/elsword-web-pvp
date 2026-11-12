import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-skill-fixture.mjs';
import {elesisSkillEvent,elesisPrepareHit,elesisOnHit,elesisReceived,elesisFrame,restoreElesisEffectControls,elesisInstanceDefinition,elesisHitFinalized} from '../../packages/combat-core/elesis-skills.mjs';
import {buffAttackTypeMultiplier} from '../../packages/combat-core/buffs.mjs';
import {synchronizeElesisSword} from '../../packages/combat-core/elesis-way-of-sword.mjs';
import {getSkillText} from '../../packages/localization/skills.mjs';
import {scanElesisAvatarFire} from '../../packages/combat-core/elesis-fire-absorb-v45.mjs';
const key=(held=[],pressed=[])=>({held:new Set(held),pressed:new Set(pressed)});
const cast=(s)=>s.step(1/60,{elesis:{pressed:['A'],held:['A']}},{snapshot:false});
const advance=(s,seconds,input={})=>{for(let i=0;i<Math.ceil(seconds*60);i++)s.step(1/60,{elesis:input},{snapshot:false});};
const data={ATTACK_TYPE:2,DAMAGE_TYPE:0,REACT_TYPE:2,HIT_TYPE:1,DAMAGE:{PHYSIC:1},PVP_RATE:1,HIT_ADD_MP:0};

test('upgraded Brutal Cutter retains missing raw enum and explicitly derives only 15-second/20% buff',()=>{
 const {make,profile}=elesisFixture('CA'),s=make(28038),a=s.actor('elesis');
 assert.equal(typeof profile.skillCatalog.find(x=>x.skillId===28038).raw.BUFF_FACTOR['1'],'object');
 cast(s);advance(s,.02);const b=a.buffs.find(x=>x.templateId===429);assert.ok(b);
 assert.equal(b.factorId,null);assert.equal(b.finalizers[0].sourceDuration,15);
 assert.equal(b.behaviors[0].chance,Math.fround(.2));
 s.rng=()=>.1999;assert.equal(elesisPrepareHit(s,a,data).DAMAGE.PHYSIC,2);
 s.rng=()=>.2001;assert.equal(elesisPrepareHit(s,a,data).DAMAGE.PHYSIC,1);
 s.rng=()=>0;assert.equal(elesisPrepareHit(s,a,{...data,ATTACK_TYPE:1}).DAMAGE.PHYSIC,1);
 s.advanceActorBuffs(a,15.01);assert.ok(!a.buffs.some(x=>x.templateId===429));
 assert.equal(elesisPrepareHit(s,a,data).DAMAGE.PHYSIC,1);
});
test('Brutal double attack changes actual accepted HP damage and expiry removes benefit',()=>{
 function hit(buff,scale=1){const s=elesisFixture('CA').make(null),a=s.actor('elesis'),b=s.actor('target');s.rng=()=>.1999;
  if(buff)s.grantBuff(a,a,466,1);const old=b.hp;s.applyHit(a,b,{...data,DAMAGE:{PHYSIC:scale}},{kind:'character',skillId:null});return old-b.hp;}
 const plain=hit(false),doubled=hit(true);assert.ok(plain>0);assert.ok(doubled>plain);assert.equal(doubled,hit(false,2));
});
test('Brutal blood-hit HP cost and damage multiplier consume original explicit 20%/1.4',()=>{
 const s=elesisFixture('CA').make(28038),a=s.actor('elesis'),hp=a.hp;cast(s);
 assert.ok(Math.abs(a.hp-(hp-a.hpMax*.2))<.02);assert.equal(a.skillScale,Math.fround(1.4));
});
test('War Prelude applies both original max-MP and attack-type branches, then restores base',()=>{
 const s=elesisFixture('GM').make(null),a=s.actor('elesis'),b=s.actor('target'),base=a.mpMax;
 s.grantBuff(a,a,298,1);assert.equal(a.mpMax,base+50);assert.equal(buffAttackTypeMultiplier(a,data),Math.fround(1.2));
 assert.equal(buffAttackTypeMultiplier(a,{...data,ATTACK_TYPE:1}),1);
 s.grantBuff(a,b,657,1);assert.equal(b.mpMax,base-50);assert.equal(buffAttackTypeMultiplier(b,{...data,ATTACK_TYPE:1}),Math.fround(.8));
 s.advanceActorBuffs(a,30.01);s.advanceActorBuffs(b,10.01);assert.equal(a.mpMax,base);assert.equal(b.mpMax,base);assert.equal(buffAttackTypeMultiplier(a,data),1);
});
test('Gale five-hit stack uses original linear +20% per stack and expires',()=>{
 const s=elesisFixture('GM').make(null),a=s.actor('elesis');for(let i=0;i<5;i++)s.grantBuff(a,a,245,1);
 const b=a.buffs.find(x=>x.templateId===246);assert.equal(b.accumulationCount,5);assert.ok(a.stats.hitMeleeMpMultiplier>1);
 s.advanceActorBuffs(a,100);assert.equal(a.stats.hitMeleeMpMultiplier,undefined);
});
test('GM Rushing Sword repeat pays already discounted final MP cost once',()=>{
 const s=elesisFixture('GM').make(28219,'none',{passives:[28403]}),a=s.actor('elesis');cast(s);
 const cost=a.sourceElesisSkills.mpPaid;assert.equal(cost,22);a.animationTime=.3;const old=a.mp;
 elesisSkillEvent(s,a,key(['A'],['A']));assert.equal(a.mp,old-cost);assert.equal(a.sourceElesisSkills.rushes,1);
});
test('Sonic Assault holding consumes charge MP and increases its actual hit',()=>{
 function run(hold){const s=elesisFixture('GM').make(28029),a=s.actor('elesis');cast(s);advance(s,2,{held:hold?['A']:[]});advance(s,3);
  return {s,a,hit:s.state.events.filter(x=>x.type==='hit'&&x.actorId===a.id).reduce((n,x)=>n+x.amount,0)};}
 const low=run(false),high=run(true);assert.ok(high.a.sourceElesisSkills.charge>.99);assert.ok(high.hit>low.hit);assert.ok(high.a.mp<low.a.mp);
});
test('cancels use strict original float boundary and dispatch fresh attack instead of consuming it',()=>{
 const {profile,make}=elesisFixture('GM');const row=Object.values(profile.states).find(x=>x.raw.ATTACK_CANCEL_AFTER_EX>0&&x.raw.ATTACK_CANCEL_AFTER_EX<x.clip.durationSeconds*.8&&x.id);
 const state=Object.entries(profile.states).find(([n,x])=>n.startsWith('ESI_')&&x.raw.ATTACK_CANCEL_AFTER_EX>0&&x.raw.ATTACK_CANCEL_AFTER_EX<x.clip.durationSeconds*.8);
 assert.ok(state);const s=make(28026),a=s.actor('elesis');a.skillId=28026;s.enter(a,state[0]);const original=a.state;
 a.animationTime=Math.fround(state[1].raw.ATTACK_CANCEL_AFTER_EX);elesisSkillEvent(s,a,key([],['Z']));assert.equal(a.state,original);
 a.animationTime+=.00001;elesisSkillEvent(s,a,key([],['Z']));assert.equal(a.state,'RSI_COMBO_Z');assert.equal(a.skillId,null);
});
test('BH Stigma actually stacks five times, detonates, removes mark, and sets its critical debuff',()=>{
 const s=elesisFixture('BH').make(null,'none',{passives:[28408]}),a=s.actor('elesis'),b=s.actor('target');s.rng=()=>0;
 for(let i=0;i<5;i++){if(a.sourceElesisSkills)a.sourceElesisSkills.stigmaCooldown=0;elesisOnHit(s,a,b,data,100);}
 assert.ok(!b.buffs.some(x=>x.templateId===290));assert.ok(b.buffs.some(x=>x.templateId===312));
 assert.ok(s.state.effects.some(x=>x.name==='DamageEffect_SBH_Judgement_Fire'));s.advanceActorBuffs(b,.01);assert.ok(b.knockdown.now<=0);
});
test('CA Blood Revenge restores real received HP and grants original additional-attack stack',()=>{
 const s=elesisFixture('CA').make(null),a=s.actor('elesis'),b=s.actor('target');b.passivePolicy=a.passivePolicy;
 const selected=elesisFixture('CA').make(null,'none',{passives:[28412]});b.passivePolicy=selected.actor('elesis').passivePolicy;
 b.hp-=1000;const old=b.hp;s.rng=()=>0;elesisReceived(s,a,b,data,1000);assert.ok(Math.abs(b.hp-old-150)<.01);
 assert.ok(b.buffs.some(x=>x.templateId===428));assert.ok(Math.abs(b.stats.additionalAttackPercent-9)<.001);
});
test('CA Overflow consumes its five-hit counter, increases real stats and cleanly expires',()=>{
 const s=elesisFixture('CA').make(null,'none',{passives:[28414]}),a=s.actor('elesis'),b=s.actor('target');s.rng=()=>0;
 for(let i=0;i<5;i++)elesisOnHit(s,a,b,data,100);assert.ok(!a.buffs.some(x=>x.templateId===426));assert.ok(a.buffs.some(x=>x.templateId===569));
 assert.equal(a.stats.finalDamageMultiplierMelee,Math.fround(1.3));s.advanceActorBuffs(a,100);assert.equal(a.stats.finalDamageMultiplierMelee,undefined);
});
for(const profession of ['GM','BH','CA'])test(profession+' highest skills/passives have independent Chinese coverage',()=>{
 const {profile}=elesisFixture(profession);const rows=profile.skillCatalog.filter(s=>s.topTier&&s.skillId!==900);
 assert.equal(rows.filter(s=>!s.passive).length,20);assert.equal(rows.filter(s=>s.passive).length,5);
 for(const r of rows){const text=getSkillText(r);assert.ok(text,r.skillId);assert.match(text.name,/[a-z]/i);}
});

for(const profession of ['GM','BH','CA'])for(const awake of [false,true])test(profession+' all twenty highest active skills yield real combat benefits; awake='+awake,()=>{
 const {profile,make}=elesisFixture(profession);
 for(const sk of profile.skillCatalog.filter(s=>s.topTier&&!s.passive&&s.skillId!==900)){
  const sim=make(sk.skillId,'none',{awake}),a=sim.actor('elesis'),b=sim.actor('target');let seenBuff=false;
  cast(sim);if(sk.mpCost>0)assert.ok(a.mp<a.mpMax,sk.skillId+' spends MP');else assert.ok(a.hp<a.hpMax,sk.skillId+' pays original HP cost');assert.ok(a.cooldowns[sk.skillId]>0,sk.skillId+' starts cooldown');
  for(let i=0;i<900;i++){
   sim.step(1/60,{elesis:sk.skillId===28217&&i===5?{pressed:['Z']}:sk.skillId===28214&&i===20?{pressed:['X']}:{held:[]}},{snapshot:false});
   seenBuff ||= a.buffs.length>0;
  }
  // Avatar's original0-damage carriers convert their newly applied burn to
  // MP. The obsolete passive leak dealt burn damage after that conversion.
  const absorption=sk.skillId===28208&&sim.state.events.some(e=>e.type==='elesisFireAbsorbed'&&e.mp>0);
  assert.ok(b.hp<b.hpMax||sk.skillId===28218&&seenBuff||absorption,profession+' '+sk.skillId+' must deliver its original benefit');
  assert.equal(a.skillId,null,sk.skillId+' terminates');
  assert.ok(!sim.state.effects.some(e=>e.ownerId===a.id&&e.damage),sk.skillId+' leaves no damage carrier after lifecycle');
 }
});
test('light trait reduces actual MP; heavy trait increases damage and original cooldown',()=>{
 const {profile,make}=elesisFixture('CA'),sk=profile.skillCatalog.find(x=>x.skillId===28021);
 const light=make(28021,sk.branches.find(x=>x.memoTypeName==='MI_LIGHT').id),base=make(28021),heavy=make(28021,sk.branches.find(x=>x.memoTypeName==='MI_HEAVY').id);
 for(const s of [light,base,heavy])cast(s);
 assert.ok(light.actor('elesis').mp>base.actor('elesis').mp);assert.ok(heavy.actor('elesis').cooldowns[28021]>base.actor('elesis').cooldowns[28021]);
 advance(base,5);advance(heavy,5);assert.ok(heavy.actor('target').hp<base.actor('target').hp);
});

test('unrelated buffs do not cap a test arena MP pool unless sourced maximum actually changes',()=>{
 const s=elesisFixture('GM').make(null),a=s.actor('elesis');a.mp=a.mpMax=1000;
 s.grantBuff(a,a,245,1);s.advanceActorBuffs(a,.1);assert.equal(a.mp,1000);assert.equal(a.mpMax,1000);
 s.grantBuff(a,a,298,1);assert.equal(a.mpMax,a.stats.mpMax);assert.equal(a.mp,350);
});

test('GM Agility grants a real speed stack for each Dodge execution, capped at ten',()=>{
 const s=elesisFixture('GM').make(28217,'none',{passives:[28402]}),a=s.actor('elesis'),base=a.stats.animationSpeedMultiplier;cast(s);
 assert.equal(a.buffs.find(x=>x.templateId===566)?.accumulationCount,1);assert.ok(a.stats.animationSpeedMultiplier>base);
 for(let i=0;i<12;i++)s.enter(a,'ESI_SI_A_EL_DODGE_AND_SLASH','authored-repeat-probe');
 assert.equal(a.buffs.find(x=>x.templateId===566)?.accumulationCount,10);s.advanceActorBuffs(a,10.01);assert.equal(a.stats.animationSpeedMultiplier,base);
});
test('CA Dark Force uses original learned 20% mode-specific damage and HP recovery values',()=>{
 const s=elesisFixture('CA').make(null,'none',{passives:[28410]}),a=s.actor('elesis'),b=s.actor('target');a.wayOfSword.state=-2;
 assert.equal(elesisPrepareHit(s,a,{...data,WAY_OF_SWORD_TYPE:6}).DAMAGE.PHYSIC,Math.fround(1.2));
 assert.equal(elesisPrepareHit(s,a,{...data,WAY_OF_SWORD_TYPE:3}).DAMAGE.PHYSIC,1);
 a.hp-=1000;const before=a.hp;elesisOnHit(s,a,b,{...data,WAY_OF_SWORD_TYPE:3},1000,{elesisSwordState:2});assert.ok(Math.abs(a.hp-before-200)<.01);
});

test('Brutal duration trait composes source 10s * upgrade1.5 * trait1.2 without increasing20% chance',()=>{
 const s=elesisFixture('CA').make(28038,'memo-42'),a=s.actor('elesis');cast(s);advance(s,.04);
 const b=a.buffs.find(x=>x.templateId===429);assert.equal(b.finalizers[0].sourceDuration,18);assert.equal(b.behaviors[0].chance,Math.fround(.2));
});
test('Avatar of Fire actually absorbs existing burns and returns original 10MP per identity',()=>{
 const s=elesisFixture('BH').make(28208),a=s.actor('elesis'),b=s.actor('target');s.rng=()=>0;
 s.grantBuff(a,b,301,1);s.grantBuff(a,b,294,1);a.mp=100;
 // Original registered327e73d0 scans existing fires independently of the
 // later damaging members; the older v45 contact-only expectation was wrong.
 a.skillId=28208;
 s.enter(a,'ESI_SI_A_SPK_AVATAR_OF_THE_FIRE','original-avatar-scan');
 const carrier=s.createEffect(a,{NAME:'DamageEffect_SPK_Avatar_of_the_Fire_Damage2'},
  {setName:'EffectSet_A_SPK_Avatar_of_the_Fire_Damage'}),before=a.mp;
 elesisHitFinalized(s,a,b,{NO_DAMAGE:1,APPLIED_SKILL_ID:28208},{kind:'effect',id:carrier.id});assert.equal(a.mp,before);
 scanElesisAvatarFire(s,a);
 assert.equal(a.mp,before+20);assert.ok(!b.buffs.some(x=>[37,293].includes(x.templateId)));
});

for(const profession of ['GM','BH'])test(profession+' original Annihilation percent buff accepts absent relation and reverses cleanly',()=>{
 const {profile,make}=elesisFixture(profession),s=make(null),a=s.actor('elesis');
 assert.equal(profile.buffFactors[247].raw.BEHAVIOR.BBT_CHANGE_ENCHANT_ATTACK_RATE.BUFF_RELATION_TYPE,undefined);
 assert.equal(profile.buffTemplates[247].raw.BEHAVIOR.BBT_CHANGE_ENCHANT_ATTACK_RATE.BUFF_RELATION_TYPE,undefined);
 const base=a.stats.enchantAttackRate;
 synchronizeElesisSword(s,a,{before:{state:0},after:{state:-2}},{updateWait:false});
 assert.ok(a.buffs.some(b=>b.templateId===247));assert.equal(a.stats.enchantAttackRate,Math.fround((base??1)*1.5));
 synchronizeElesisSword(s,a,{before:{state:-2},after:{state:0}},{updateWait:false});
 assert.equal(a.stats.enchantAttackRate,base);assert.ok(!a.buffs.some(b=>b.templateId===247));
});

test('CA original Dark Force PvP percent buff accepts its absent relation and reverses cleanly',()=>{
 const {profile,make}=elesisFixture('CA'),s=make(null),a=s.actor('elesis');
 assert.equal(profile.buffFactors[472].raw.BEHAVIOR.BBT_CHANGE_ENCHANT_ATTACK_RATE.BUFF_RELATION_TYPE,undefined);
 const base=a.stats.enchantAttackRate;s.grantBuff(a,a,472,1);
 assert.ok(a.buffs.some(b=>b.templateId===434));assert.equal(a.stats.enchantAttackRate,Math.fround((base??1)*1.5));
 synchronizeElesisSword(s,a,{before:{state:-2},after:{state:0}},{updateWait:false});
 assert.equal(a.stats.enchantAttackRate,base);assert.ok(!a.buffs.some(b=>b.templateId===434));
});

test('derived Extinction and Fire Wall controls restore idempotently for wire instances',()=>{
 const {profile,make}=elesisFixture('GM'),s=make(28033),a=s.actor('elesis');
 const e={skillId:28033,name:'EXTINCTION_ATTACK_DUMMY',setName:'EffectSet_SA_SSK_EXTINCTION_DAMAGE',sourceElesisExtinctionAngle:-45};
 restoreElesisEffectControls(profile,a,e);const scale=e.traitPolicy.rangeMultiplier;assert.equal(scale,1.3);
 restoreElesisEffectControls(profile,a,e);assert.equal(e.traitPolicy.rangeMultiplier,scale);
 assert.equal(elesisInstanceDefinition(profile,e,{}).ROTATE_Z,-45);
 assert.throws(()=>elesisInstanceDefinition(profile,{...e,sourceElesisExtinctionAngle:1},{}),/Invalid target/);
 const bh=elesisFixture('BH'),b=bh.make(28018).actor('elesis'),wall={skillId:28018,name:'DamageEffect_Wall_of_Prominence_Attack_Main'};
 restoreElesisEffectControls(bh.profile,b,wall);assert.equal(wall.lifeTimeSeconds,6);assert.equal(wall.templateFields.LifeTime,6);
 assert.equal(restoreElesisEffectControls({}, {}, e),e);
});

test('Judgment reaches original final carrier and two-second holding raises real damage',()=>{
 const {make}=elesisFixture('GM');
 function run(hold){const s=make(28007),a=s.actor('elesis');cast(s);advance(s,4,{held:hold?['A']:[]});advance(s,4);
  return {s,a,hits:s.state.events.filter(e=>e.type==='hit'&&e.actorId===a.id),damage:s.actor('target').hpMax-s.actor('target').hp};}
 const base=run(false),held=run(true);assert.ok(base.damage>0);assert.ok(held.damage>base.damage);assert.ok(Math.abs(held.a.sourceElesisSkills.judgmentCharge-2)<.00001);
 assert.ok(base.hits.some(e=>e.origin.kind==='effect'&&e.data.HIT_GAP===.05&&e.data.DAMAGE.PHYSIC===8.4));assert.equal(base.a.skillId,null);assert.equal(held.a.skillId,null);
});

test('Dance Endless selects original alternate damage and charges20MP for each extra dash',()=>{
 const {make}=elesisFixture('BH');
 function run(branch){const s=make(28016,branch);cast(s);advance(s,15);return {s,hits:s.state.events.filter(e=>e.type==='hit'&&e.actorId==='elesis')};}
 const base=run('none'),endless=run('memo-61'),costs=endless.s.state.events.filter(e=>e.type==='elesisDanceExtended');
 assert.ok(endless.hits.length>base.hits.length);assert.ok(costs.length>0);assert.ok(costs.every(e=>e.mpCost===20));
 assert.ok(endless.hits.some(e=>e.data.DAMAGE.MAGIC===4.97));assert.ok(endless.hits.some(e=>e.data.DAMAGE.MAGIC===12.9));
 assert.equal(endless.s.actor('elesis').skillId,null);assert.ok(!endless.s.state.effects.some(e=>e.damage));
 assert.ok(!endless.s.actor('elesis').unsupported.some(e=>String(e.reason).includes('MI_TRANSCENDENCE_1')));
 assert.equal(new Set(endless.s.actor('elesis').sourceElesisSkills.danceTargets).size,endless.s.actor('elesis').sourceElesisSkills.danceTargets.length);
});

test('Punish uses original PvP480 buff at armed Endurance level and expires after5seconds',()=>{
 const s=elesisFixture('CA').make(28218,'none',{passives:[28413]}),a=s.actor('elesis'),b=s.actor('target'),base=a.stats.physicalAttack;
 cast(s);advance(s,.1);s.applyHit(b,a,data,{kind:'character'});
 const buff=a.buffs.find(v=>v.templateId===441);assert.ok(buff);assert.equal(buff.factorId,480);assert.equal(buff.skillLevel,1);
 assert.ok(Math.abs(a.stats.physicalAttack-base*1.05)<.01);s.advanceActorBuffs(a,5.01);assert.equal(a.stats.physicalAttack,base);
});

test('Brandish original low-HP free extension adds real217percent hits and stops on release',()=>{
 const {make}=elesisFixture('CA');
 function run(held){const s=make(28022),a=s.actor('elesis');a.hp=a.hpMax*.1;const hp=a.hp;cast(s);advance(s,2,{held:held?['A']:[]});advance(s,5);
  return {s,a,hp,hits:s.state.events.filter(e=>e.type==='hit'&&e.actorId===a.id)};}
 const base=run(false),held=run(true);assert.ok(held.hits.length>base.hits.length);
 assert.ok(held.hits.some(e=>e.data.DAMAGE.PHYSIC===2.17));assert.equal(held.a.hp,held.hp);assert.equal(held.a.skillId,null);
 assert.ok(!held.s.state.effects.some(e=>e.damage));
 const released=make(28022),a=released.actor('elesis');a.hp=a.hpMax*.1;cast(released);advance(released,.85,{held:['A']});
 assert.equal(a.state,'SI_SA_SDK_BRANDISH_BREAKER_LOOP');advance(released,.05);assert.equal(a.state,'SI_SA_SDK_BRANDISH_BREAKER_FINISH');
});

test('original Blossom reward factors grant20second10percent attacks/1MP and immediate2second cooldown reduction',()=>{
 const s=elesisFixture('BH').make(null),a=s.actor('elesis'),base=a.stats.physicalAttack;a.mp=10;a.cooldowns={28016:5,28604:180,28017:1};
 s.grantBuff(a,a,296,3,null);assert.ok(Math.abs(a.stats.physicalAttack-base*1.1)<.01);s.advanceActorBuffs(a,1.01);assert.equal(a.mp,11);
 s.grantBuff(a,a,297,3,null);assert.deepEqual(a.cooldowns,{28016:3,28604:178,28017:0});s.advanceActorBuffs(a,.01);assert.ok(!a.buffs.some(b=>b.templateId===296));
 s.advanceActorBuffs(a,20.01);assert.equal(a.stats.physicalAttack,base);
});

test('Body of Fire250points use original500-point normalization for real burn damage/duration',()=>{
 function run(passives){const s=elesisFixture('BH').make(null,'none',{passives}),a=s.actor('elesis'),b=s.actor('target');s.rng=()=>0;
  s.grantBuff(b,a,301,1);const buff=structuredClone(a.buffs.find(v=>v.templateId===37)),before=a.hp;s.advanceActorBuffs(a,1.01);
  return {a,buff,damage:before-a.hp};}
 const base=run([]),fire=run([28405]);assert.equal(base.buff.resistance,0);assert.equal(fire.buff.resistance,.5);
 assert.equal(base.buff.finalizers[0].sourceDuration,15);assert.equal(fire.buff.finalizers[0].sourceDuration,7.5);
 assert.ok(base.damage>0);assert.ok(Math.abs(fire.damage*2-base.damage)<.02);assert.equal(fire.a.buffResistances['1'],0);
});

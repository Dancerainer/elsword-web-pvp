import test from 'node:test';
import assert from 'node:assert/strict';
import {GUILD_CATALOG,GUILD_DEFAULT_PASSIVES,initializeGuildSkills,installGuildBuffs,applyGuildStatPassives,guildGainModifiers,
  guildNonCombatModifiers,guildCriticalCounterRequest,startGuildRecovery,stepGuildRecovery,guildOnDeath,processGuildHeroSacrifice} from '../../packages/combat-core/guild-skills.mjs';
import {make} from '../helpers/rf-passive-fixture-v12.mjs';
import {createBuffFromFactor,consumeBuffHit} from '../../packages/combat-core/buffs.mjs';

const actor=(overrides={})=>{const a={id:'rf',team:0,hp:400000,hpMax:800000,mp:300,x:0,y:0,z:0,state:'RSI_WAIT',buffs:[],...overrides};initializeGuildSkills(a);return a;};
const near=(actual,expected,tolerance=1e-5)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);

test('target owns exactly twelve fixed Lv5 guild nodes, separate from RF equipment and ten-value abilities',()=>{
  assert.equal(GUILD_CATALOG.skills.length,12);assert.deepEqual(GUILD_DEFAULT_PASSIVES,Array.from({length:12},(_,i)=>500+i));
  assert.ok(GUILD_CATALOG.skills.every(s=>s.maxLevel===5&&s.passive&&s.readOnly));
  assert.deepEqual(GUILD_CATALOG.skills.map(s=>[s.treeRow,s.treeColumn]).sort(),Array.from({length:12},(_,i)=>[Math.floor(i/4),i%4]).sort());
  assert.equal(GUILD_CATALOG.skills.find(s=>s.skillId===510).abilities.SA_HP_GAIN_REL_MAX_HP,.3);
});

test('source guild stats add once and resource multipliers do not invent an MP base or multiply soul additions',()=>{
  const a=actor();assert.deepEqual(applyGuildStatPassives({physicalAttack:2000,magicAttack:2000},a),{physicalAttack:2100,magicAttack:2100,physicalDefence:50,magicDefence:50});
  const m=guildGainModifiers(a);near(m.receivedMpMultiplier,1.5);near(m.onHitMpMultiplier,1.05);near(m.receivedSoulAdd,.5);near(m.onHitSoulAdd,.07);
  const none=actor();initializeGuildSkills(none,{passiveIds:[]});assert.deepEqual(guildGainModifiers(none),{onHitMpMultiplier:1,receivedMpMultiplier:1,onHitSoulAdd:0,receivedSoulAdd:0});
});

test('granted EXP / ED / alchemy fields only modify their source dungeon / party / item consumers',()=>{
  const a=actor();assert.deepEqual(guildNonCombatModifiers(a),{experienceMultiplier:1,edMultiplier:1,itemRecoveryMultiplier:1});
  const m=guildNonCombatModifiers(a,{dungeon:true,guildPartyMembers:2,recoveryItem:true});near(m.experienceMultiplier,1.15);near(m.edMultiplier,1.1);near(m.itemRecoveryMultiplier,1.25);
  assert.equal(guildNonCombatModifiers(a,{dungeon:true,guildPartyMembers:1}).experienceMultiplier,1);
});

test('original Buff54/Template57 merge is immutable, idempotent and rejects conflicting existing definitions',()=>{
  const original={skillCatalog:[{skillId:24010}],buffFactors:{},buffTemplates:{}};const p=installGuildBuffs(original);
  assert.equal(original.buffFactors[54],undefined);assert.equal(p.skillCatalog,original.skillCatalog);assert.equal(p.buffFactors[54].raw.BUFF_TEMPLET_ID,57);
  assert.deepEqual(installGuildBuffs(p),p);assert.throws(()=>installGuildBuffs({buffFactors:{54:{raw:{BUFF_TEMPLET_ID:999}}}}),/Conflicting/);
});

test('counter requests original 3% registration, 30sec and 15 accepted hit count via existing real native Buff pipeline',async()=>{
  const s=await make({passives:[]});const p=installGuildBuffs(s.profile),a=s.actor('rf');initializeGuildSkills(a);
  const request=guildCriticalCounterRequest(a);assert.deepEqual([request.factorId,request.skillLevel],[54,5]);
  const create=roll=>createBuffFromFactor(p,{factor:54,skillLevel:5,sourceActor:a,targetActor:a,roll,nativeValues:s.nativeSkillValues});
  assert.equal(create(.031).accepted,false);const accepted=create(.029);assert.equal(accepted.accepted,true);
  assert.deepEqual(accepted.buff.finalizers.map(f=>[f.kind,f.remaining]),[['time',30],['hit',15]]);
  assert.ok(accepted.buff.behaviors.some(b=>b.stat==='criticalRate'&&b.value===100));
  a.buffs=[accepted.buff];assert.equal(guildCriticalCounterRequest(a),null);
  let current=a.buffs;for(let i=0;i<15;i++)current=consumeBuffHit(p,current,{kind:'hit'}).buffs;
  assert.equal(current[0].finalizers.find(f=>f.kind==='hit').remaining,0,'next original buff frame owns removal');
});

test('recovery source rolls only when eligible and active subsequent hits replace pulse size without re-rolling',()=>{
  const a=actor();let rolls=0;const random=()=>{rolls++;return .049;};
  const start=startGuildRecovery(a,{damage:10000,random});assert.equal(start.triggered,true);assert.equal(start.amount,4000);assert.equal(rolls,1);
  const updated=startGuildRecovery(a,{damage:20000,random});assert.equal(updated.triggered,false);assert.equal(updated.amount,8000);assert.equal(rolls,1);
  const reject=actor();assert.equal(startGuildRecovery(reject,{damage:10000,random:()=>.051}),null);
  assert.equal(startGuildRecovery(actor(),{damage:10000,noDamage:true,random}),null);
});

test('recovery uses MP gate, strict float32 gap, one pulse per frame and keeps fixed-reference cap boundary divergence visible',()=>{
  const a=actor();startGuildRecovery(a,{damage:10000,random:()=>0});
  assert.equal(stepGuildRecovery(a,Math.fround(.8)),null);const hp=a.hp;a.mp=0;assert.equal(stepGuildRecovery(a,.01),null);assert.equal(a.hp,hp);
  a.mp=1;assert.equal(stepGuildRecovery(a,.0001).restoredHp,4000);
  assert.equal(stepGuildRecovery(a,2).remainingPulses,1,'source does not loop multiple heals per frame');
  assert.equal(stepGuildRecovery(a,2).remainingPulses,0);assert.equal(a.hp,hp+12000);
  const b=actor();startGuildRecovery(b,{damage:250000,random:()=>0});near(b.guild.recovery.amount,80000,.02);
  const boundary=actor();startGuildRecovery(boundary,{damage:240000,random:()=>0});assert.equal(boundary.guild.recovery.amount,96000,'source uses >.3*HP threshold, not a guessed clamp at .25*HP');
  guildOnDeath(a);assert.deepEqual(a.guild.recovery,{pulses:0,elapsed:0,amount:0,effectRemaining:0});
});

test('hero death event triggers exactly once at original animation1.12 and never revives the corpse',()=>{
  const corpse=actor({hp:0,death:true,state:'RSI_DIE_FRONT'}),friend=actor({id:'friend',x:100,hp:200000});
  assert.equal(processGuildHeroSacrifice(corpse,[corpse,friend],{previousAnimationTime:0,animationTime:1.11}),null);
  const event=processGuildHeroSacrifice(corpse,[corpse,friend],{previousAnimationTime:1.11,animationTime:Math.fround(1.12)});
  near(event.heals[0].requestedHp,120000,.02);near(friend.hp,320000,.02);assert.equal(corpse.hp,0);assert.equal(corpse.death,true);
  assert.equal(processGuildHeroSacrifice(corpse,[corpse,friend],{previousAnimationTime:1,animationTime:2}),null);
  const restored=JSON.parse(JSON.stringify(corpse));assert.equal(processGuildHeroSacrifice(restored,[restored,friend],{previousAnimationTime:1,animationTime:2}),null);
});

test('hero excludes self, enemies, dead allies and exact15m boundary, uses 3D range and clamps live ally HP',()=>{
  const a=actor({hp:0,state:'RSI_DIE_BACK',death:true});const inside=actor({id:'in',x:1499,hp:790000});
  const same=actor({id:'rf',hp:100}),edge=actor({id:'edge',x:1500}),vertical=actor({id:'above',y:1500}),enemy=actor({id:'enemy',team:1}),deadFriend=actor({id:'dead',hp:0});
  const event=processGuildHeroSacrifice(a,[a,same,inside,edge,vertical,enemy,deadFriend],{previousAnimationTime:1,animationTime:2});
  assert.deepEqual(event.heals.map(h=>h.targetId),['in']);assert.equal(inside.hp,800000);assert.equal(event.heals[0].restoredHp,10000);
});

test('hero nonPvP path requires party membership and uses unhalved target30percent',()=>{
  const a=actor({hp:0,state:'RSI_DIE_FRONT'}),friend=actor({id:'f',hp:100});
  const event=processGuildHeroSacrifice(a,[friend],{previousAnimationTime:1,animationTime:2,pvp:false,isPartyMember:t=>t.id==='f'});
  near(event.heals[0].requestedHp,240000,.02);
});

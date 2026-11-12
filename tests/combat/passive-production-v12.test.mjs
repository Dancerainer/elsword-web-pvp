import test from 'node:test';
import assert from 'node:assert/strict';
import {make,frames,profile} from '../helpers/rf-passive-fixture-v12.mjs';
import {onHit,modifyOutgoingHit} from '../../packages/combat-core/passives.mjs';
import {forceDownContribution} from '../../packages/combat-core/reaction-policy.mjs';
const f=Math.fround;
// Target326a9860/328bc880 retain their original additive epsilon channels.
const magicDelta=f(f(1.075)-1+4.999999873689376e-5);
const forceDownMultiplier=f(1+f(f(.73)-1+4.999999873689376e-5));
// These are literal target2016 declarations and independently transcribed
// reference float operations, not a dump of a previously passing simulation.
const extraName='DamageEffect_RRF_ExplosiveHand_Impact_NEW';
const particles=['SA_RVC_DeadlyRaid_P02','SA_RVC_DeadlyRaid_P04','RWT_BARRAGE_ATTACK_Flame_Smoke02','RWT_BARRAGE_ATTACK_Flame_Smoke01','RWT_BARRAGE_ATTACK_Spark'];
function x(s){s.drainEvents();s.step(1/60,{pressed:['X'],held:['X']},{snapshot:false});frames(s,50);return s.state.events.filter(e=>e.type==='hit');}

test('six default passives execute real X; numeric values remain from target declarations',async()=>{
  // Critical evaluation takes the first Web RNG sample. Seed1's second
  // xorshift32 sample .015747428173199296 selects the10% passive branch.
  const s=await make({seed:1}),a=s.actor('rf');a.mp=0;
  assert.deepEqual(a.passives,[24400,24401,24402,24403,24404,24405]);
  assert.equal(a.stats.physicalAttack,1000+1000);assert.equal(a.stats.magicAttack,f(2000+2000*magicDelta));
  const hits=x(s);assert.equal(hits.length,2);
  assert.equal(hits[0].data.DAMAGE_TYPE,1);
  assert.equal(hits[0].data.DAMAGE.MAGIC,f(f(2.86)*f(1.3)));
  assert.equal(hits[0].data.FORCE_DOWN,f(f(13.88)*forceDownMultiplier));
  assert.equal(hits[1].origin.skillId,24402);
  assert.equal(hits[1].data.ATTACK_TYPE,1);assert.equal(hits[1].data.DAMAGE.MAGIC,2.39,'original explosion excludes the AT2 Burning Hand gate');
  assert.equal(hits[1].data.HIT_ADD_MP,0);assert.equal(a.mp,5);
  assert.equal(s.state.events.filter(e=>e.type==='additionalHitEffectCreated'&&e.name===extraName).length,1);
  const start=s.state.events.filter(e=>e.type==='effectStartParticles'&&e.name===extraName);
  assert.equal(start.length,1);assert.deepEqual(start[0].entries.map(e=>e.entry.PARTICLE_NAME),particles);
  assert.ok(start[0].entries.every(e=>e.entry.TRIGGER_COUNT===1&&e.entry.POSITION_TYPE===3));
  // Original328bc880->328932b0->321fc790 registers437->408. The current
  // accepted callback advances the new byte threshold; RT_DUMMY_DAMAGE7
  // from the subsequent explosion does not advance it a second time.
  const buff=a.buffs.find(b=>b.templateId===408);assert.ok(buff);
  assert.equal(buff.finalizers.find(v=>v.kind==='hit').remaining,6);assert.equal(a.sourceHitCountByte,1);
  assert.equal(a.stats.criticalRate,100);assert.equal(a.stats.criticalAttack,f(1.5*f(1.1)));
  assert.equal(a.passivePolicy.explosive.buffActivationSupported,true);
  assert.match(a.passivePolicy.explosive.buffActivationEvidence,/328bc880.*328932b0.*321fc790/);
});

test('24401 and 24402 disable independently on actual keyboard input',async()=>{
  const off=await make({seed:30,passives:[24400]}),hits=x(off);
  assert.equal(hits.length,1);assert.equal(hits[0].data.DAMAGE_TYPE,0);
  assert.equal(hits[0].data.DAMAGE.PHYSIC,2.86);assert.equal(hits[0].data.FORCE_DOWN,13.88);
  assert.equal(off.state.events.some(e=>e.type==='additionalHitEffectCreated'),false);
  const burning=await make({seed:30,passives:[24400,24401]}),converted=x(burning);
  assert.equal(converted.length,1);assert.equal(converted[0].data.DAMAGE.MAGIC,f(f(2.86)*f(1.3)));
});

test('24403 below30% and24404 reduction isolate their literal target fields from equipment/guild',async()=>{
  const low=await make({passives:[24400,24403]}),la=low.actor('rf');low.actor('target').hp=239999;
  const lowHit=x(low)[0];assert.equal(lowHit.amount,f((2000*2.86)*f(1.45)));
  const hardened=await make({passives:[24400],targetPassives:[24404]}),received=x(hardened)[0];
  assert.equal(received.amount,f((2000*2.86)*f(.76)));
  assert.equal(hardened.actor('target').passivePolicy.received.unresolvedMpGainField,f(.1));
  assert.equal(hardened.actor('target').passivePolicy.received.unresolvedSoulField,f(.09));
});

test('24405 native EPS charge is applied on production hit and receipt',async()=>{
  const s=await make({passives:[24405],targetPassives:[24405]}),a=s.actor('rf'),b=s.actor('target');x(s);
  const increment=f(f(f(1.12)-1)+f(.00005)),mult=f(1+increment);
  assert.equal(a.awakening.gauge,profile.referenceSemantics.awakening.onHitBase*mult);
  assert.equal(b.awakening.gauge,profile.referenceSemantics.awakening.onReceivedBase*mult);
  assert.equal(a.passivePolicy.awakening.unresolvedMagicAttackMultiplier,f(1.075));
  assert.equal(a.passivePolicy.awakening.unresolvedDurationField,f(.7));
});

test('X→keyboard A cancel keeps the original explosion type and first-particle event across JSON restore',async()=>{
  const a=await make({seed:1});a.actor('rf').mp=100;a.drainEvents();
  a.step(1/60,{pressed:['X'],held:['X']},{snapshot:false});frames(a,13);
  const initial=a.snapshot(),b=await make({seed:1});b.restore(JSON.parse(JSON.stringify(initial)));
  for(const s of [a,b]){s.step(1/60,{pressed:['A'],held:['A']},{snapshot:false});frames(s,20);}
  const hit=a.state.events.find(e=>e.type==='hit'&&e.origin.skillId===24402);
  const skill=a.state.events.find(e=>e.type==='skillStarted');assert.equal(skill.skillId,24203);
  assert.ok(skill.time<=hit.time);assert.equal(profile.states.RSI_A_RF_MEGADRILL_BREAK.raw.BURNING_NASOD_HAND_POSSIBLE,undefined);
  assert.equal(hit.data.ATTACK_TYPE,1);assert.equal(hit.data.DAMAGE_TYPE,1);assert.equal(hit.data.DAMAGE.MAGIC,2.39);
  assert.equal(a.state.events.filter(e=>e.type==='effectStartParticles'&&e.name===extraName).length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(a.snapshot())),JSON.parse(JSON.stringify(b.snapshot())));
});

test('target2016 additive KD loading precedes memo subtraction and excludes SPECIAL',async()=>{
  const s=await make(),policy=s.actor('rf').passivePolicy;
  const raw={DAMAGE:{PHYSIC:1},FORCE_DOWN:20,DECREASE_FORCE_DOWN:10,ATTACK_TYPE:2};
  const loaded=modifyOutgoingHit(policy,{damageData:raw,targetHp:800000,targetMaxHp:800000}).damageData;
  assert.equal(forceDownContribution(loaded),f(f(20)*forceDownMultiplier)-10);
  assert.equal(forceDownContribution(loaded,{penetrating:true}),-10);
  const memo3=modifyOutgoingHit(policy,{damageData:{...raw,DECREASE_FORCE_DOWN:3},targetHp:800000,targetMaxHp:800000}).damageData;
  assert.equal(forceDownContribution(memo3),f(f(20)*forceDownMultiplier)-3);
  assert.notEqual(forceDownContribution(memo3),f(f(20-3)*forceDownMultiplier),'subtracting memo before the passive changes the answer');
  const special=modifyOutgoingHit(policy,{damageData:{...raw,ATTACK_TYPE:1,FORCE_DOWN:-15},targetHp:800000,targetMaxHp:800000}).damageData;
  assert.equal(special.FORCE_DOWN,-15);assert.equal(forceDownContribution(special),-25);
  assert.deepEqual(raw,{DAMAGE:{PHYSIC:1},FORCE_DOWN:20,DECREASE_FORCE_DOWN:10,ATTACK_TYPE:2});
});

test('original additional-effect OR uses conditional independent RNG draws including raw rate without passive',async()=>{
  const s=await make(),on=s.actor('rf').passivePolicy,off=(await make({passives:[]})).actor('rf').passivePolicy;
  const raw={REACT_TYPE:2,CREATE_DAMAGE_EFFECT_NAME:extraName,CREATE_DAMAGE_EFFECT_RATE:.2};
  let draws=0;const queue=[.11,.19];
  const result=onHit(on,{damageData:raw,random:()=>{draws++;return queue.shift();},impactPoint:[1,2,3]});
  assert.equal(draws,2);assert.equal(result.additionalDamageEffect.trigger,'damage-data-rate');
  draws=0;onHit(on,{damageData:raw,random:()=>{draws++;return .05;}});assert.equal(draws,1);
  draws=0;onHit(off,{damageData:{...raw,CREATE_DAMAGE_EFFECT_RATE:0},random:()=>{draws++;return 0;}});assert.equal(draws,0);
  draws=0;assert.equal(onHit(off,{damageData:raw,random:()=>{draws++;return .19;}}).additionalDamageEffect.trigger,'damage-data-rate');assert.equal(draws,1);
});

test('source-only MegaDrill casts without an acquired armor grant; all traits and awakening checked',async()=>{
  const skill=profile.skillCatalog.find(s=>s.skillId===24203);
  const raw=profile.states[skill.state].raw;
  assert.equal(raw.SUPER_ARMOR,undefined);assert.equal(raw.SUPER_ARMOR_NOT_RED,undefined);
  assert.ok(!Object.keys(raw).some(k=>/^SUPER_ARMOR_TIME/.test(k)));
  for(const branchId of ['none',...skill.branches.map(b=>b.id)])for(const awakened of [false,true]){
    const s=await make({skillId:24203,positions:[[2022.98,2840,0],[1500,2840,0]]}),a=s.actor('rf');
    s.preset.customStateProtection={};
    if(branchId!=='none')s.configureLoadout([{skillId:24203,branchId},null,null,null,null,null,null,null]);
    if(awakened)a.awakening.remaining=10;
    s.step(1/60,{pressed:['A'],held:['A']},{snapshot:false});let states=0;
    for(let i=0;i<160;i++){
      if(a.state===skill.state){states++;assert.equal(a.superArmor,false);}
      s.step(1/60,{}, {snapshot:false});
    }
    assert.ok(states>1);assert.equal(a.skillId,null);
  }
});

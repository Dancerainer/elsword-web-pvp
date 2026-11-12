import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {make,profile} from '../helpers/rf-passive-fixture-v12.mjs';
import {createSkillTraitPolicy,skillTraitDamageData,skillTraitAppliesToData} from '../../packages/combat-core/skill-traits.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
const traitRows=JSON.parse(readFileSync(new URL('../fixtures/rf-traits-review-v1.json',import.meta.url))).rows;
const originalDDs=JSON.parse(readFileSync(new URL('../fixtures/rf-trait-dd-gates-v53.json',import.meta.url))).damageData;
const near=(a,b,epsilon=1e-3)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} != ${b}`);
async function traceCast(id,branch='none'){
  const sim=await make({skillId:id,passives:[],...(id===24217?{positions:[[2022.98,2840,0],[1700,2840,0]]}:{})}),a=sim.actor('rf'),b=sim.actor('target');sim.rng=()=>.99;
  sim.configureLoadout([{skillId:id,branchId:branch},null,null,null,null,null,null,null]);
  b.mp=100;sim.drainEvents();sim.step(1/60,{pressed:['A'],held:['A']},{snapshot:false});
  const start={mp:a.mp,cooldown:a.cooldowns[id],policy:structuredClone(a.skillContext.traitPolicy)};
  let first=null,firstTargetMp=null;const buffs=new Map(),events=[],shapes=[];
  const check=sim.checkHits.bind(sim);sim.checkHits=(actor,shapeList,data,hits,origin)=>{
    if(actor.id==='rf'&&origin.skillId===id)shapes.push(...shapeList.map(s=>structuredClone(s)));
    return check(actor,shapeList,data,hits,origin);
  };
  for(let i=0;i<420;i++){
    const input=id===24217&&i===14?{pressed:['Z']}:id===24008&&i===125?{pressed:['Z']}:{};
    sim.step(1/60,input,{snapshot:false});const packet=sim.drainEvents();events.push(...packet);
    if(!first){first=packet.find(e=>e.type==='hit'&&e.actorId==='rf'&&e.origin.skillId===id&&e.amount>0);if(first)firstTargetMp=b.mp;}
    for(const actor of [a,b])for(const buff of actor.buffs)if(!buffs.has(buff.templateId))buffs.set(buff.templateId,structuredClone(buff));
  }
  validateOwnedState(encodeOwnedState(sim,'rf'));
  return {sim,a,b,start,first,firstTargetMp,buffs,events,shapes};
}
const baseCasts=new Map();
test('original RF DDs distinguish unmarked Arc/WildCharge hits from the separately marked Arc MEMO variant',()=>{
  for(const [name,data]of Object.entries(originalDDs))assert.deepEqual(profile.damageEffects[name].raw.DAMAGE_DATA,data,name);
  const policy=createSkillTraitPolicy(profile.skillCatalog.find(s=>s.skillId===24008),'memo-61');
  assert.equal(skillTraitAppliesToData(originalDDs.RAVEN_OVER_TAKER_ARC_ENEMY,policy),false);
  assert.equal(skillTraitAppliesToData(originalDDs.RAVEN_OVER_TAKER_ARC_ENEMY_MEMO,policy),true);
  assert.equal(skillTraitAppliesToData({...originalDDs.RAVEN_OVER_TAKER_ARC_ENEMY_MEMO,APPLIED_MEMO_ID:6},policy),false,'nonzero memo type must also match');
  assert.equal(skillTraitAppliesToData(originalDDs.SI_SA_RRF_WILD_CHARGE_ATTACK,
    createSkillTraitPolicy(profile.skillCatalog.find(s=>s.skillId===24009),'memo-53')),false);
});
for(const [id,memo,kind,value,second] of traitRows)test(`RF review ${id}/memo-${memo}: actual cast ${kind} uses independent source expectation`,async()=>{
  if(!baseCasts.has(id))baseCasts.set(id,await traceCast(id));
  const base=baseCasts.get(id),v=await traceCast(id,'memo-'+memo),cost=profile.skillCatalog.find(s=>s.skillId===id).mpCost;
  assert.equal(v.events.filter(e=>e.type==='skillStarted'&&e.skillId===id).length,1);
  assert.ok(v.first,'actual skill hit required');
  if(['damage','heavy','usefulPartial'].includes(kind)||kind==='critical'&&id!==24009)near(v.first.amount/base.first.amount,value*(kind==='critical'?1.5:1));
  if(kind==='critical'){
    if(id===24009){
      // Legacy fixture label "critical" denotes MI_MAXIMIZE. Original Wild
      // Charge DD has no APPLIED ID, so this cast cannot receive that hook.
      assert.equal(v.start.policy.memoTypeName,'MI_MAXIMIZE');assert.equal(v.start.policy.criticalRateAdd,1);
      assert.equal(v.start.policy.damageMultiplier,.8);assert.equal(v.first.data.APPLIED_SKILL_ID,undefined);
      assert.equal(v.first.data.CRITICAL_RATE,undefined);assert.equal(v.first.critical,false);
      assert.deepEqual(v.first.data.DAMAGE,originalDDs.SI_SA_RRF_WILD_CHARGE_ATTACK.DAMAGE);
      assert.equal(v.events.find(e=>e.type==='effectStarted'&&e.effectId===v.first.origin.id)?.name,'SI_SA_RRF_WILD_CHARGE_ATTACK');
      near(v.first.amount/base.first.amount,1);
    }else assert.equal(v.first.critical,true);
  }
  if(kind==='heavy')near(v.start.cooldown,base.start.cooldown*second);
  if(['mp','brilliant','ignoreDefence'].includes(kind))near(300-v.start.mp,cost*value);
  if(kind==='cooldown')near(v.start.cooldown,base.start.cooldown*value);
  if(kind==='brilliant')near(v.start.cooldown,base.start.cooldown*second);
  if(kind==='ignoreDefence'){assert.notEqual(v.first.data.IGNORE_DEFENCE,1);assert.equal(v.start.policy.defencePierceMultiplier,.75);}
  if(kind==='usefulPartial'){
    const originalId={24029:24004,24028:24003,24032:24005}[id],policy=v.start.policy;
    assert.equal(policy.originalSkillId,originalId);assert.equal(policy.hitGapMultiplier,.5);assert.deepEqual(policy.unsupported,[]);
    assert.ok([id,originalId].includes(v.first.data.APPLIED_SKILL_ID),'actual DD resolves the selected original skill');
    assert.equal(skillTraitDamageData({APPLIED_SKILL_ID:originalId,HIT_GAP:.14},policy).HIT_GAP,.07);
    assert.equal(skillTraitDamageData({APPLIED_SKILL_ID:originalId,APPLIED_MEMO_ID:6,HIT_GAP:.14},policy).HIT_GAP,.14);
    if(Number.isFinite(base.first.data.HIT_GAP))near(v.first.data.HIT_GAP,base.first.data.HIT_GAP*.5);
  }
  if(kind==='forceDown')near(v.first.data.FORCE_DOWN,(base.first.data.FORCE_DOWN??0)+value);
  if(kind==='absorb')near(v.first.mp-v.start.mp,(base.first.mp-base.start.mp)*value);
  if(kind==='burn'){
    assert.equal(v.start.policy.targetMpBurn,value,'the configured Web adapter still retains its declared amount');
    assert.equal(v.first.data.APPLIED_SKILL_ID,undefined);assert.equal(v.first.origin.traitPolicy,null);
    assert.deepEqual(v.first.data.DAMAGE,originalDDs.RAVEN_OVER_TAKER_ARC_ENEMY.DAMAGE);
    assert.equal(v.events.find(e=>e.type==='effectStarted'&&e.effectId===v.first.origin.id)?.name,'RAVEN_OVER_TAKER_ARC_ENEMY');
    assert.equal(base.firstTargetMp,v.firstTargetMp,'unmarked first hit does not receive the marked MEMO variant hook');
  }
  if(kind==='range'){
    assert.ok(v.shapes.length&&base.shapes.length,'original source attack geometry required');
    near(v.shapes[0].radius/base.shapes[0].radius,value);
  }
  if(kind==='duration'||kind==='buffStrength'){
    assert.ok(v.buffs.size&&base.buffs.size);
    for(const [key,buff] of base.buffs){const changed=v.buffs.get(key);assert.ok(changed);
      if(kind==='duration')near(changed.finalizers.find(f=>f.kind==='time').sourceDuration,buff.finalizers.find(f=>f.kind==='time').sourceDuration*value);
      else for(const stat of buff.behaviors.filter(x=>x.kind==='stat'))near(changed.behaviors.find(x=>x.stat===stat.stat).value,1+(stat.value-1)*value);
    }
  }
});

test('RF additional hit effects never inherit another active skill trait after their source cast has finished',async()=>{
  for(const [id,branch] of [[24032,'memo-32'],[24025,'memo-11'],[24008,'memo-61']]){
    const sim=await make({passives:[24402]}),a=sim.actor('rf'),b=sim.actor('target');sim.rng=()=>0;
    // Source callback data is the actual HellDive punch's passive explosion.
    // Its delayed collision may happen after another skill begins.
    const data=profile.damageEffects.DAMAGE_EFFECT_RRF_HELL_DIVE_FIRST_PUNCH.raw.DAMAGE_DATA;
    a.skillId=id;a.skillContext={traitPolicy:createSkillTraitPolicy(profile.skillCatalog.find(s=>s.skillId===id),branch)};
    sim.applyHit(a,b,data,{kind:'effect',id:999,skillId:24219,traitPolicy:null,damageDirectionRight:a.facing>0,impactPoint:[b.x,b.y,b.z]});
    const extra=sim.state.effects.find(e=>e.name==='DamageEffect_RRF_ExplosiveHand_Impact_NEW');assert.ok(extra);
    assert.equal(extra.skillId,24402);assert.equal(extra.powerMultiplier,1);assert.equal(extra.traitPolicy,null);
    validateOwnedState(encodeOwnedState(sim,'rf'));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {skillTraitDamageData} from '../../packages/combat-core/skill-traits.mjs';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/vc-traits-review-v5.json',import.meta.url)));
const near=(a,b,eps=.002)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);

test('VC trait literal expectations match original hashed 2016 memo calls, independent of the player policy',()=>{
 const source=JSON.parse(readFileSync(new URL('../../.cache/vc/skill-note-declarations.json',import.meta.url)));
 assert.equal(source.source.sha256,fixture.sourceSha256);
 assert.equal(createHash('sha256').update(readFileSync(source.source.path)).digest('hex'),fixture.sourceSha256);
 const skills=JSON.parse(readFileSync(new URL('../../.cache/vc/skill-declarations.json',import.meta.url)));
 assert.equal(skills.source.sha256,'c8047731095475dda3f5bedb54e6e87509bc0438500acdf4005211ce0f5ed266');
 assert.equal(createHash('sha256').update(readFileSync(skills.source.path)).digest('hex'),skills.source.sha256);
 const notes=source.nativeCalls.flatMap(c=>Object.values(c.args.at(-1)?.MEMO_LIST??{}));
 for(const [id,memo,kind,...values]of fixture.rows){
  const original=skills.nativeCalls.map(c=>c.args.at(-1)).find(row=>row?.m_eID===id);
  assert.ok(original,`${id}: original skill declaration required`);
  const candidates=notes.filter(row=>[id,original.m_DeleteSkillIDByUpgrade].includes(row['2'])&&row['3']===memo);
  assert.ok(candidates.length,`${id}/${memo}: missing original memo`);
  assert.ok(candidates.some(row=>JSON.stringify(Object.keys(row).filter(k=>+k>=4).sort((a,b)=>a-b).map(k=>row[k]))===JSON.stringify(values)),`${id}/${memo}: source parameters differ`);
 }
 assert.equal(fixture.rows.length,36);
});

function cast(id,branch='none',roll=.99){
 const f=vcFixture({skillId:id,passives:[],position:[-600,3080,0],gap:id===24031?800:160}),{sim,a,b}=f;
 sim.configureLoadout([{skillId:id,branchId:branch},...Array(7).fill(null)],a.id);
 if(id===24031){a.y+=450;a.grounded=false;a.lineId=null;sim.enter(a,'RSI_JUMP_DOWN','explicit-trait-air-fixture');}
 sim.rng=()=>roll;b.mp=100;sim.drainEvents();
 let first;const apply=sim.applyHit.bind(sim);
 sim.applyHit=(attacker,defender,data,origin)=>{
  const mp=a.mp,targetMp=b.mp,begin=sim.state.events.length,result=apply(attacker,defender,data,origin);
  const hit=sim.state.events.slice(begin).find(e=>e.type==='hit'&&e.actorId===a.id&&e.origin?.skillId===id&&e.amount>0);
  if(hit&&!first)first={...structuredClone(hit),mpGain:a.mp-mp,targetMpDelta:b.mp-targetMp};
  return result;
 };
 const buffs=new Map(),events=[],initialMp=a.mp;
 sim.step(1/60,{pressed:['A'],held:['A']},{snapshot:false});
 const start={mp:a.mp,initialMp,cooldown:a.cooldowns[id],policy:structuredClone(a.skillContext.traitPolicy)};
 events.push(...sim.drainEvents());
 for(let i=1;i<720;i++){
  sim.step(1/60,{}, {snapshot:false});events.push(...sim.drainEvents());
  for(const actor of [a,b])for(const buff of actor.buffs)if(!buffs.has(buff.templateId))buffs.set(buff.templateId,structuredClone(buff));
 }
 return {first,start,buffs,events};
}
const baselines=new Map();
for(const [id,memo,kind,p,q]of fixture.rows)test(`VC ${id}/memo-${memo}: actual ${kind} from original geometry and hit`,()=>{
 if(!baselines.has(id))baselines.set(id,cast(id));
 const base=baselines.get(id),v=cast(id,'memo-'+memo),skill=vcProfile.skillCatalog.find(s=>s.skillId===id);
 assert.equal(v.events.filter(e=>e.type==='skillStarted'&&e.skillId===id).length,1);
 if(id!==24217){assert.ok(base.first,'baseline must actually hit');assert.ok(v.first,'branch must actually hit');}
 if(kind==='damage'||kind==='heavy')near(v.first.amount/base.first.amount,p);
 if(kind==='maximize'){assert.equal(v.first.critical,true);near(v.first.amount/base.first.amount,q*1.5);}
 if(kind==='heavy')near(v.start.cooldown,base.start.cooldown*q);
 if(kind==='cooldown')near(v.start.cooldown,base.start.cooldown*p);
 if(['mp','brilliant','ignoreDefence'].includes(kind))near(v.start.initialMp-v.start.mp,skill.mpCost*p);
 if(kind==='brilliant')near(v.start.cooldown,base.start.cooldown*q);
 // Latest user rule overrides source100% defence ignore with25%; source
 // literal parameters are still independently verified above.
 if(kind==='ignoreDefence'){assert.notEqual(v.first.data.IGNORE_DEFENCE,1);assert.equal(v.start.policy.defencePierceMultiplier,.75);}
 if(kind==='absorb'){assert.ok(base.first.mpGain>0,'original HIT_ADD_MP must be nonzero');near(v.first.mpGain,base.first.mpGain*p);}
 if(kind==='forceDown')near(v.first.data.FORCE_DOWN,(base.first.data.FORCE_DOWN??0)+p);
 if(kind==='burn'){
  // This is the attack-result callback after applyHit returns, not part of
  // its receive-MP phase. Observe the emitted mutation from that real hit.
  const burn=v.events.find(e=>e.type==='traitMpBurn');assert.ok(burn);
  near(burn.before-burn.after,p);assert.equal(burn.branchId,'memo-'+memo);
  assert.equal(base.events.some(e=>e.type==='traitMpBurn'),false);
 }
 if(kind==='usefulPartial'){
  near(v.first.amount/base.first.amount,q);
  const originalId={24028:24003,24022:24022}[id],policy=v.start.policy;
  assert.equal(policy.originalSkillId,originalId);assert.equal(policy.hitGapMultiplier,p);assert.deepEqual(policy.unsupported,[]);
  assert.ok([id,originalId].includes(v.first.data.APPLIED_SKILL_ID),'actual original DD matches the selected skill');
  assert.equal(skillTraitDamageData({APPLIED_SKILL_ID:originalId,HIT_GAP:.14},policy).HIT_GAP,.14*p);
  assert.equal(skillTraitDamageData({APPLIED_SKILL_ID:originalId,APPLIED_MEMO_ID:6,HIT_GAP:.14},policy).HIT_GAP,.14);
  if(Number.isFinite(base.first.data.HIT_GAP))near(v.first.data.HIT_GAP,base.first.data.HIT_GAP*p);
 }
 if(kind==='brutalUnresolved')assert.ok(v.start.policy.unsupported.includes('Unimplemented target trait MI_BRUTAL'));
 if(kind==='duration'){
  assert.ok(base.buffs.size,'actual enemy debuff must be applied');
  for(const [key,buff]of base.buffs){const changed=v.buffs.get(key);assert.ok(changed);near(changed.finalizers.find(x=>x.kind==='time').sourceDuration,buff.finalizers.find(x=>x.kind==='time').sourceDuration*p);}
 }
 if(kind==='regenerate'){
  assert.equal(v.events.filter(e=>e.type==='traitMpRefund').length,0);
  const awarded=cast(id,'memo-'+memo,0),refund=awarded.events.filter(e=>e.type==='traitMpRefund');
  assert.equal(refund.length,1);near(refund[0].amount,skill.mpCost*q);
  near(awarded.start.mp,awarded.start.initialMp-skill.mpCost+skill.mpCost*q);
 }
});

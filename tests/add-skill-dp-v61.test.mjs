/** The equipment exception is an explicit user rule. Cost and recovery
 * coefficients below are independently preserved target declarations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeAddSystems,addSkillResourceCost,commitAddSkillResources,changeAddDp,beginAddFormation,gainAddMutation,addHitResources} from '../packages/combat-core/add-systems.mjs';
const source=JSON.parse(readFileSync(new URL('../contracts/add-systems-source-v1.json',import.meta.url)));
const skill=id=>{const raw=source.skills[id];return {skillId:id,raw,type:raw.m_eType,maxLevel:1,mpCost:raw.m_MPConsumption?.[1]??0,cooldown:raw.m_SkillCoolTime?.[1]??0};};
const profile={components:source.components,skillCatalog:Object.keys(source.skills).map(Number).map(skill)};
function actor(id,reduction=0){const a={id:'add',professionId:id,hp:1000,hpMax:1000,mp:490,mpMax:500,x:10,y:20,z:30,
 equipmentAttributes:{addDpConsumptionReduction:reduction,addDpGainBonus:0},passivePolicy:{skillLevels:{}},skillScale:1,skillContext:{level:1}};
 initializeAddSystems(a);a.sourceAdd.dp=8000;return a;}
const collect=()=>{const events=[];return {events,emit:(type,id,row)=>events.push({type,id,...row})};};

for(const id of ['LP','MM','DE'])for(const reduction of [0,.5,1])test(`${id} V61 skill-use DP ignores equipment${reduction}; switching and command DP remain separate`,()=>{
 const a=actor(id,reduction),s=skill(id==='MM'?29013:29002),plan=addSkillResourceCost(a,s,{profile});
 assert.equal(plan.dpCost,id==='MM'?600:1200);commitAddSkillResources(a,s,plan,{profile});assert.equal(a.sourceAdd.dp,8000-plan.dpCost);
 const b=actor(id,reduction);assert.equal(beginAddFormation(b,{profile}),true);assert.equal(b.sourceAdd.dp,8000-1000*(1-reduction));
 const c=actor(id,reduction);changeAddDp(c,-500,{profile,reason:'original-de-aerial-zx'});assert.equal(c.sourceAdd.dp,8000-500*(1-reduction));
 const d=actor(id,reduction);changeAddDp(d,-500,{profile,reason:'void-field-maintenance',skillUse:true});assert.equal(d.sourceAdd.dp,7500);
});

for(const reduction of [0,.5,1])test(`DE Overlimit skill DP conversion ignores equipment${reduction} while the authored Time Control passive remains`,()=>{
 const a=actor('DE',reduction);a.sourceAdd.formation=true;const s=skill(29019);
 let plan=addSkillResourceCost(a,s,{profile});assert.equal(plan.mpCost,0);assert.equal(plan.dpCost,4000);
 a.passivePolicy.skillLevels[29411]=3;plan=addSkillResourceCost(a,s,{profile});assert.equal(plan.dpCost,3600);
});

test('Overlimit MP recovery publishes actual capped MP and suppresses a zero-cap float',()=>{
 for(const mp of [490,500]){const a=actor('DE',.5),q=collect();a.sourceAdd.formation=true;a.mp=mp;
  const s=skill(29019),p=addSkillResourceCost(a,s,{profile});commitAddSkillResources(a,s,p,{profile,emit:q.emit});
  const rows=q.events.filter(e=>e.type==='addOverlimitResourceRecovered');assert.equal(rows.length,mp===500?0:1);
  if(rows.length){assert.equal(rows[0].amount,10);assert.equal(rows[0].resource,'MP');assert.deepEqual(rows[0].position,[10,70,30]);}
 }
});

test('Overlimit dissolution recovery reports displayed DP from the actual cap, not its requested gain',()=>{
 for(const dp of [7990,8000]){const a=actor('DE',.5),q=collect();a.sourceAdd.dp=dp;a.passivePolicy.skillLevels[29410]=1;
  const s=skill(29019),p=addSkillResourceCost(a,s,{profile});commitAddSkillResources(a,s,p,{profile,emit:q.emit});
  const rows=q.events.filter(e=>e.type==='addOverlimitResourceRecovered');assert.equal(rows.length,dp===8000?0:1);
  if(rows.length){assert.equal(rows[0].rawAmount,10);assert.equal(rows[0].amount,.5);assert.equal(rows[0].resource,'DP');assert.deepEqual(rows[0].position,[10,70,30]);}
 }
});

test('MM switch uses the existing once-per-request Transform MP recovery and emits the actual amount',()=>{
 const a=actor('MM',.5),q=collect();a.passivePolicy.skillLevels[29405]=4;
 for(const id of [29013,29016]){const s=skill(id);commitAddSkillResources(a,s,addSkillResourceCost(a,s,{profile}),{profile,emit:q.emit});}
 const rows=q.events.filter(e=>e.type==='addMutationMpRecovered');assert.equal(rows.length,1);assert.equal(rows[0].amount,10);
 assert.equal(rows[0].resource,'MP');assert.deepEqual(rows[0].position,[10,70,30]);assert.equal(a.sourceAdd.mutation,1);assert.equal(a.mp,500);
 q.events.length=0;gainAddMutation(a,1,{profile,emit:q.emit});assert.equal(q.events.some(e=>e.type==='addMutationMpRecovered'),false);
 a.mp=0;a.sourceAdd.mutation=6;gainAddMutation(a,1,{profile,emit:q.emit});assert.equal(a.mp,0);assert.equal(q.events.some(e=>e.type==='addMutationMpRecovered'),false);
});

for(const id of ['LP','MM','DE'])for(const reduction of [0,.5,1])test(`${id} V61 ACTIVE contact DP ignores equipment${reduction}; COMMAND/ARMOR/received retain source paths`,()=>{
 const active={DYNAMO_PARTICLE_RATE_TYPE:1,DAMAGE_TYPE:1,DAMAGE:{MAGIC:2}},a=actor(id,reduction);a.sourceAdd.formation=true;
 assert.equal(addHitResources(a,active,{profile,step:1}),-80);assert.equal(a.sourceAdd.dp,7920);
 assert.equal(addHitResources(a,active,{profile,step:1}),0);assert.equal(a.sourceAdd.dp,7920,'existing once-per-packet gate remains');
 const c=actor(id,reduction);c.sourceAdd.formation=true;
 addHitResources(c,{...active,DYNAMO_PARTICLE_RATE_TYPE:2},{profile});assert.equal(c.sourceAdd.dp,8000-160*(1-reduction));
 const armor=actor(id,reduction);armor.sourceAdd.formation=true;addHitResources(armor,{...active,DYNAMO_PARTICLE_RATE_TYPE:3},{profile});assert.equal(armor.sourceAdd.dp,8000-160*(1-reduction));
 const r=actor(id,reduction);r.sourceAdd.dp=0;addHitResources(r,active,{profile});assert.equal(r.sourceAdd.dp,80,'dissolution skill DP gain does not acquire a reduction side effect');
 const special=actor(id,reduction);special.sourceAdd.formation=true;addHitResources(special,{...active,DYNAMO_PARTICLE_RATE_TYPE:0},{profile});assert.equal(special.sourceAdd.dp,8000,'original special-active component is0, no new skill DP charge');
 const received=actor(id,reduction);received.sourceAdd.formation=true;received.sourceAdd.dp=0;
 addHitResources(received,active,{profile,kind:'received',damage:100});assert.equal(received.sourceAdd.dp,800,'receiving damage retains original positive DP');
});
test('DE authored TimeControl29411 still applies independently to original ACTIVE contact skill DP',()=>{
 const a=actor('DE',1);a.sourceAdd.formation=true;a.passivePolicy.skillLevels[29411]=3;
 addHitResources(a,{DYNAMO_PARTICLE_RATE_TYPE:1,DAMAGE_TYPE:1,DAMAGE:{MAGIC:2}},{profile});assert.equal(a.sourceAdd.dp,7928);
});

const actualDamageProfiles=Object.fromEntries(['LP','MM','DE'].map(id=>[id,JSON.parse(readFileSync(new URL('../packages/combat-core/'+id.toLowerCase()+'-profile.json',import.meta.url)))]));
for(const id of ['LP','MM','DE'])for(const reduction of [0,.5,1])test(`${id} original MindBreak29214 DD ACTIVE contact ignores equipment${reduction}`,()=>{
 const data=actualDamageProfiles[id].damageEffects.DamageEffect_SI_A_AN_MIND_BREAK.raw.DAMAGE_DATA;
 assert.equal(data.APPLIED_SKILL_ID,29214);assert.equal(data.DYNAMO_PARTICLE_RATE_TYPE,1);assert.equal(data.DAMAGE_TYPE,1);assert.equal(data.DAMAGE.MAGIC,6.93);
 const a=actor(id,reduction);a.sourceAdd.formation=true;addHitResources(a,data,{profile});
 assert.ok(Math.abs((8000-a.sourceAdd.dp)-277.2)<.001,'original MAGIC6.93 * ACTIVE1 * FORMATION40 rawDP; equipment0/.5/1 must all spend the same amount');
});

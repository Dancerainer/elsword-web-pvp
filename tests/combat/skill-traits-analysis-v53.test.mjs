import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSkillTraitPolicy,skillTraitDamageData,applySkillTraitMeshLifetime,skillTraitBuffFactor} from '../../packages/combat-core/skill-traits.mjs';
const profile=name=>JSON.parse(readFileSync(new URL('../../packages/combat-core/'+name+'-profile.json',import.meta.url)));
const trait=(name,id,type)=>{const skill=profile(name).skillCatalog.find(s=>s.skillId===id);return createSkillTraitPolicy(skill,skill.branches.find(b=>b.memoTypeName===type).id);};
test('USEFUL scales original gap and does not create repeat permission, event counts, or inherit a missing APPLIED ID',()=>{
 const policy=trait('lk',21004,'MI_USEFUL');
 const data={APPLIED_SKILL_ID:21004,HIT_GAP:.1,RE_ATTACK:0};
 assert.equal(skillTraitDamageData(data,policy).HIT_GAP,.05);assert.equal(skillTraitDamageData(data,policy).RE_ATTACK,0);
 const noId={HIT_GAP:.1};assert.equal(skillTraitDamageData(noId,policy),noId);
 const other={...data,APPLIED_MEMO_ID:22};assert.equal(skillTraitDamageData(other,policy),other);
});
test('LONGSHOT changes the actual mesh lifetime without changing speed or attack windows',()=>{
 const policy=trait('bh',28209,'MI_LONGSHOT');
 for(const [initial,expected] of [[.3,Math.fround(.45)],[5,7.5],[3.5,5.25]]){
  const e={traitPolicy:policy,damage:{DAMAGE_DATA:{APPLIED_SKILL_ID:28209}},lifeTimeSeconds:initial,initialVelocity:[3000,0,0]};
  applySkillTraitMeshLifetime(e);assert.equal(e.lifeTimeSeconds,expected);assert.deepEqual(e.initialVelocity,[3000,0,0]);
 }
});
test('MAXIMIZE adds the original critical probability field; user lethal defence policy stays explicit',()=>{
 const skill={skillId:1,branches:[{id:'max',memoType:6,memoTypeName:'MI_MAXIMIZE',parameters:[.2,.8]}]};
 const policy=createSkillTraitPolicy(skill,'max');assert.equal(policy.forceCritical,false);
 assert.equal(skillTraitDamageData({APPLIED_SKILL_ID:1},policy).CRITICAL_RATE,.2);
 const lethal=createSkillTraitPolicy({...skill,branches:[{id:'lethal',memoType:8,memoTypeName:'MI_CRITICAL',parameters:[1.2]}]},'lethal');
 assert.equal(lethal.defencePierceMultiplier,.75);assert.equal(lethal.evidenceClass,'user-custom-lethal-25-percent-defence-v2');
});
test('buff mode3 strengthens distance from neutral using abs(p0-1)',()=>{
 const factor={BEHAVIOR:{BBT_CHANGE_PHYSIC_ATTACK:{PERCENT:{1:1.2}}}};
 const actual=skillTraitBuffFactor(factor,{buffDurationMultiplier:1,buffStrengthMultiplier:.8});
 assert.equal(actual.BEHAVIOR.BBT_CHANGE_PHYSIC_ATTACK.PERCENT[1],Math.fround(1.24));
 assert.equal(factor.BEHAVIOR.BBT_CHANGE_PHYSIC_ATTACK.PERCENT[1],1.2);
});

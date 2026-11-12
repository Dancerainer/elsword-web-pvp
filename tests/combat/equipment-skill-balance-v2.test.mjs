// Historical equipment inputs frozen at389e247; production v3 has separate coverage.
import {beforeBalanceV3} from '../helpers/equipment-balance-before-v3.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createSkillTraitPolicy,skillTraitDamageData} from '../../packages/combat-core/skill-traits.mjs';
import {traitDescription} from '../../packages/localization/skills.mjs';
import {calculateSourceEquipmentCandidate} from '../../packages/combat-core/source-equipment-base.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const ids=['RF','LK','VC'],profiles=Object.fromEntries(ids.map(id=>[id,read(`packages/combat-core/${id.toLowerCase()}-profile.json`)]));
const presets=Object.fromEntries(ids.map(id=>[id,beforeBalanceV3(read(`config/${id.toLowerCase()}-preset.json`))]));
const f=Math.fround,near=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);
const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},PVP_RATE:1,REACT_TYPE:1,HIT_ADD_MP:5,FORCE_DOWN:0,STOP_TIME_ATT:0,STOP_TIME_DEF:0};
function make(id){return createSimulation({profile:profiles[id],preset:{...presets[id],passives:[],guildPassives:[]},
 map:{lines:[{lineId:0,start:[-5000,0,0],end:[5000,0,0],type:'LT_NORMAL'}]},
 actors:['a','b'].map((name,i)=>({id:name,professionId:id,team:i,position:[i*500,0,0],lineId:0,passives:[],guildPassives:[],
 attributes:{hpMax:100000,physicalAttack:1000,magicAttack:1000,physicalDefence:400,magicDefence:400,damageReduction:0,criticalRate:0}}))});}

for(const id of ids)test(`${id} +9 weapon uses1.75 per item, preserves armor and career coefficients`,()=>{
 const input={...presets[id].sourceEquipment,profession:id,level:85};
 const now=calculateSourceEquipmentCandidate(input),old=calculateSourceEquipmentCandidate({...input,weaponEnhancement:11});
 assert.deepEqual(now.items.slice(1),old.items.slice(1));
 for(const [field,value]of Object.entries(now.items[0].base))assert.equal(now.items[0].enhanced[field],Math.trunc(f(value*f(1.75))));
 assert.ok(now.pvp.physicalAttack<old.pvp.physicalAttack);
 assert.throws(()=>calculateSourceEquipmentCandidate({...input,weaponEnhancement:10}),/enhancement/);
});

for(const id of ids)test(`${id} every recorded skill gets20% once, while unrelated normal/core hits retain base damage`,()=>{
 const expected=f(f(1000*f(1-f(400/875)))*1.2),normal=f(1000*f(1-f(400/875)));
 for(const skill of profiles[id].skillCatalog){
  const sim=make(id),a=sim.actor('a'),b=sim.actor('b');
  // Current action is deliberately unrelated: delayed skill ownership wins.
  a.skillId=null;
  const hit=sim.applyHit(a,b,data,{kind:'effect',skillId:skill.skillId,powerMultiplier:1});
  assert.equal(hit.accepted,true);near(hit.amount,expected);
 }
 for(const kind of ['character','effect','core']){
  const sim=make(id);sim.actor('a').skillId=profiles[id].skillCatalog.find(s=>!s.passive).skillId;
  near(sim.applyHit(sim.actor('a'),sim.actor('b'),data,{kind,skillId:null,powerMultiplier:1}).amount,normal);
 }
});

for(const id of ids)test(`${id} every lethal branch ignores25% defence, retains its own MP cost and reports the override`,()=>{
 const cases=profiles[id].skillCatalog.flatMap(s=>s.branches.filter(b=>b.memoTypeName==='MI_CRITICAL').map(b=>[s,b]));assert.ok(cases.length);
 for(const [skill,branch]of cases){
  const policy=createSkillTraitPolicy(skill,branch.id),before=JSON.stringify(branch);
  assert.equal(policy.mpMultiplier,branch.parameters[0]);assert.equal(policy.ignoreDefence,false);assert.equal(policy.defencePierceMultiplier,.75);
  const applied=skillTraitDamageData(data,policy);assert.notEqual(applied.IGNORE_DEFENCE,1);
  assert.match(traitDescription(branch),/Ignore 25% of enemy defense/);assert.equal(JSON.stringify(branch),before);
  for(const type of [0,1,2]){
   const sim=make(id),hit=sim.applyHit(sim.actor('a'),sim.actor('b'),{...applied,DAMAGE_TYPE:type,DAMAGE:{PHYSIC:1,MAGIC:1}},
    {kind:'effect',skillId:skill.skillId,traitPolicy:policy,powerMultiplier:1});
   // 400/875*.75 defence; explicit20% skill equipment stage; no critical or other grants.
   near(hit.amount,f(f(1000*f(1-f(f(400/875)*.75)))*1.2));assert.ok(hit.amount<1200);
  }
 }
});

test('secondary effects retain skill and lethal ownership through JSON restore without multiplying skill power again',()=>{
 const id='VC',profile=profiles[id],skill=profile.skillCatalog.find(s=>s.branches.some(b=>b.memoTypeName==='MI_CRITICAL'));
 const branch=skill.branches.find(b=>b.memoTypeName==='MI_CRITICAL'),policy=createSkillTraitPolicy(skill,branch.id);
 const sim=make(id),a=sim.actor('a'),b=sim.actor('b'),name=Object.keys(profile.damageEffects)[0];
 const parent=sim.createEffect(a,{NAME:name},{birthAnchor:{position:[0,0,0],facing:1}});
 parent.skillId=skill.skillId;parent.traitPolicy=policy;parent.powerMultiplier=1.4;
 parent.damage={HIT_DAMAGE_EFFECT0:{DAMAGE_EFFECT_NAME:name,POSITION_TYPE:3}};
 a.skillId=null;sim.createSecondaryDamage(parent,a,'HIT_DAMAGE_EFFECT');
 const child=sim.state.effects.at(-1);assert.equal(child.skillId,skill.skillId);assert.equal(child.powerMultiplier,1.4);assert.deepEqual(child.traitPolicy,policy);
 const restored=make(id);restored.restore(JSON.parse(JSON.stringify(sim.snapshot())));
 for(const s of [sim,restored]){
  const c=s.state.effects.at(-1),hit=s.applyHit(s.actor('a'),s.actor('b'),data,{kind:'effect',skillId:c.skillId,powerMultiplier:c.powerMultiplier,traitPolicy:c.traitPolicy});
  near(hit.amount,f(f(1000*f(1-f(f(400/875)*.75)))*1.4*1.2));
 }
 assert.deepEqual(JSON.parse(JSON.stringify(sim.snapshot())),JSON.parse(JSON.stringify(restored.snapshot())));
});

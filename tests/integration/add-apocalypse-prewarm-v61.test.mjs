import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import profile from '../../packages/combat-core/mm-profile.json' with {type:'json'};
import {getAddSkillResourceRoots,getAddApocalypsePrewarmGroups} from '../../packages/combat-core/add-skills.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {rebaseAddSummonEffectIndex} from '../../packages/combat-assets/add-summon-assets.mjs';
import {collectEffectTemplates,collectEffectMeshBudget} from '../../apps/web/effect-prewarm.mjs';

const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url)));
const skill=profile.skillCatalog.find(row=>row.skillId===29604),loadout=[{skillId:29604}];
const manifest=read('artifacts/mm/manifest.json');
const index=mergeVisualEffectIndexes(...manifest.visualEffectIndexes.map(file=>read('artifacts/mm/'+file)),
 rebaseAddSummonEffectIndex(read('artifacts/mm/summons/apocalypse/fx/index.json')));
const always='EffectSet_SI_HA_AMM_Apocalypse_Always',cast='EffectSet_SI_HA_AMM_Apocalypse';
const startHit='EffectSet_SI_HA_AMM_Apocalypse_Start_Hit';
const finish='EffectSet_SI_HA_AMM_Apocalypse_FinishAttack',finishHit='EffectSet_SI_HA_AMM_Apocalypse_Finish_Hit',finishHit2=finishHit+'2';
const callbacks=['EffectSet_SI_HA_AMM_Apocalypse_Attack_A_Projectile_PVP',
 'EffectSet_SI_HA_AMM_Apocalypse_Attack_B_Projectile_PVP','EffectSet_SI_HA_AMM_Apocalypse_Attack_C_PVP'];
const coldModels=['ADD_APOCALYPSE_M01','ADD_APOCALYPSE_M01_D','ADD_APOCALYPSE_M06',
 'ADD_APOCALYPSE_M06_D','ADD_APOCALYPSE_M07_D','ADD_APOCALYPSE_M08_D'];
const quality={level:'medium',particleDivisor:8};

test('Apocalypse equipped roots include original NPC state schedules and executable Pvp callbacks',()=>{
 const roots=new Set(getAddSkillResourceRoots(skill,profile)),globals=profile.summonDeclarations.apocalypse.globals;
 for(const [state,raw]of Object.entries(globals))for(const row of Object.values(raw?.EFFECT_SET_LIST_EX??{}))
  assert.ok(roots.has(row['1']),state+': '+row['1']);
 for(const name of callbacks){
  assert.ok(profile.summonDeclarations.apocalypse.callbackLiteralResources.includes(name));
  assert.ok(roots.has(name));
 }
 assert.ok(roots.has(always));assert.ok(roots.has(cast));
 assert.ok(!roots.has('EffectSet_SI_HA_AMM_Apocalypse_Attack_A_Projectile'),'unexecuted Dungeon literal is not promoted to an active burst');
 assert.deepEqual(getAddApocalypsePrewarmGroups(skill,{...profile,summonDeclarations:{}}),[]);
 assert.deepEqual(getAddApocalypsePrewarmGroups({...skill,executor:'UltimateFury'},profile),[]);
 assert.deepEqual(getAddApocalypsePrewarmGroups(skill,{...profile,target:{unitClass:122}}),[]);
 assert.deepEqual(getAddSkillResourceRoots(skill),[],'optional-profile legacy callers cannot invent NPC resources');
});

test('NPC burst groups preserve six opening hits, six plus four closing hits, and alternative state ownership',()=>{
 const groups=getAddApocalypsePrewarmGroups(skill,profile).map(group=>new Map(group));
 assert.equal(groups.length,8,'the eight playable states in add-summons.mjs, not callback function tables');
 for(const group of groups){assert.equal(group.get(always),1);assert.equal(group.get(cast),1);}
 const opening=groups.find(group=>group.has(startHit));assert.equal(opening.get(startHit),6);
 const endings=groups.filter(group=>group.has(finish));assert.equal(endings.length,2);
 for(const group of endings){assert.equal(group.get(finish),1);assert.equal(group.get(finishHit),6);assert.equal(group.get(finishHit2),4);}
 assert.deepEqual([...endings[0]],[...endings[1]],'finish and HP-empty death are alternative copies of the same authored schedule');
 assert.equal(groups.filter(group=>group.has(callbacks[0])).length,2,'normal and emergency A remain alternatives');
 for(const group of groups)assert.ok(callbacks.filter(name=>group.has(name)).length<=1);
 const changed=structuredClone(profile),raw=changed.summonDeclarations.apocalypse.globals.APOCALYPSE_START.EFFECT_SET_LIST_EX;
 raw['8']={...raw['7'],'2':1.6};
 assert.equal(new Map(getAddApocalypsePrewarmGroups(skill,changed).find(group=>new Map(group).has(startHit))).get(startHit),7,
  'capacity follows original declaration entries rather than a hand-coded six');
});

test('six original Start/Finish skin meshes enter both all-skill material warmup and the selected active burst',()=>{
 const before=JSON.stringify(profile),indexBefore=JSON.stringify(index);
 const all=profile.skillCatalog.filter(row=>row.supported&&row.selectable!==false).map(row=>({skillId:row.skillId}));
 const material=collectEffectTemplates(profile,index,all),budget=collectEffectMeshBudget(profile,index,loadout,{effectQuality:quality});
 const unequipped=collectEffectMeshBudget(profile,index,[],{effectQuality:quality});
 for(const name of coldModels){
  const template=index.templates[name],demand=budget.demands.get(name);
  assert.equal(template.fields.particleType,'PT_SKINMESH');assert.equal(template.fields.NumParticles,5);
  assert.ok(template.glb.startsWith('summons/apocalypse/'));
  assert.ok(material.has(name),name+' material');assert.ok(budget.templates.has(name),name+' equipped closure');
  assert.ok(demand,name+' actual mesh budget');assert.notEqual(demand.budgetScope,'resource-materials-only');
  assert.equal(demand.effectSetInstances,1);assert.equal(demand.peakParticles,5,'existing protected source clock/cap, without density reduction');
  assert.equal(demand.views,5*(template.fields.DrawCount??1));
  assert.equal(unequipped.templates.has(name),false,'an unequipped HA does not allocate its NPC state burst');
 }
 assert.equal(JSON.stringify(profile),before);assert.equal(JSON.stringify(index),indexBefore,'prewarming cannot mutate original templates or source schedules');
});

test('NPC burst maxima include independent B display and DIE explosion alongside Always',()=>{
 const budget=collectEffectMeshBudget(profile,index,loadout,{effectQuality:quality});
 const cube1=budget.demands.get('ADD_APOCALYPSE_Cube001'),cube3=budget.demands.get('ADD_APOCALYPSE_Cube003');
 const display='DamageEffect_AMM_APOCALYPSE_Attack_B_Projectile_FX';
 const carrier='DamageEffect_AMM_APOCALYPSE_Attack_B_Projectile_PVP';
 const explosion='DamageEffect_AMM_APOCALYPSE_Attack_B_Explosion_FX_PVP';
 const bSet=profile.effectSets[callbacks[1]].raw,carrierRaw=profile.damageEffects[carrier].raw;
 const count=(raw,pattern,key,name)=>Object.entries(raw).filter(([field,row])=>pattern.test(field)&&row[key]===name).length;
 // Original set prototype3:39195 creates two independent parents. The
 // 0.75s carrier's DIE child starts while the 1.3s display is still alive;
 // each owns its own passive emitters. This is not a second Always set.
 assert.equal(bSet.EFFECT1.NAME,display);assert.equal(bSet.EFFECT2.NAME,carrier);
 assert.equal(carrierRaw.DIE_DAMAGE_EFFECT0.DAMAGE_EFFECT_NAME,explosion);
 assert.equal(index.templates[carrierRaw.MAIN_EFFECT_NAME].fields.LifeTime,.75);
 for(const name of [display,explosion]){
  const raw=profile.damageEffects[name].raw;
  assert.equal(index.templates[raw.MAIN_EFFECT_NAME].fields.LifeTime,1.3);
  assert.equal(count(raw,/^PASSIVE_PARTICLE\d+$/,'PARTICLE_NAME','ADD_APOCALYPSE_Cube001'),8);
  assert.equal(count(raw,/^PASSIVE_PARTICLE\d+$/,'PARTICLE_NAME','ADD_APOCALYPSE_Cube003'),10);
 }
 for(const name of [always,finish])for(const cube of ['ADD_APOCALYPSE_Cube001','ADD_APOCALYPSE_Cube003'])
  assert.equal(count(profile.effectSets[name].raw,/^EFFECT\d+$/,'NAME',cube),8);
 assert.equal(count(profile.effectSets[cast].raw,/^EFFECT\d+$/,'NAME','ADD_APOCALYPSE_Cube001'),0);
 assert.equal(count(profile.effectSets[cast].raw,/^EFFECT\d+$/,'NAME','ADD_APOCALYPSE_Cube003'),0);
 assert.equal(cube1.effectSetInstances,8+8+8);assert.equal(cube1.peakParticles,3);assert.equal(cube1.views,72);
 assert.equal(cube3.effectSetInstances,8+10+10);assert.equal(cube3.peakParticles,2);assert.equal(cube3.drawCount,2);assert.equal(cube3.views,112);
 // Removing B leaves the two alternative closing states, each Always8 +
 // Finish8. Do not accidentally sum FINISH_ATTACK and DIE_ATTACK together.
 const withoutB=structuredClone(profile);delete withoutB.effectSets[callbacks[1]];
 const finishBudget=collectEffectMeshBudget(withoutB,index,loadout,{effectQuality:quality});
 assert.equal(finishBudget.demands.get('ADD_APOCALYPSE_Cube001').effectSetInstances,16);
 assert.equal(finishBudget.demands.get('ADD_APOCALYPSE_Cube003').effectSetInstances,16);
 // Removing either independent B source must remove precisely its own
 // passive sequences, while the original finish alternative remains valid.
 for(const omit of ['display','explosion']){
  const changed=structuredClone(profile);
  if(omit==='display')delete changed.effectSets[callbacks[1]].raw.EFFECT1;
  else delete changed.damageEffects[carrier].raw.DIE_DAMAGE_EFFECT0;
  const remaining=collectEffectMeshBudget(changed,index,loadout,{effectQuality:quality});
  assert.equal(remaining.demands.get('ADD_APOCALYPSE_Cube001').effectSetInstances,16,omit);
  assert.equal(remaining.demands.get('ADD_APOCALYPSE_Cube003').effectSetInstances,18,omit);
 }
 assert.equal(budget.quadCopies.get('ADD_APOCALYPSE_M02'),2,'Always plus closing display, not both alternative finish states');
 assert.equal(budget.quadCopies.get('ADD_Rushing_Drone_Loop_01'),4,'four original A carriers each own a passive emitter');
 const sourceSet=profile.effectSets[callbacks[0]].raw;
 assert.equal(Object.entries(sourceSet).filter(([key,row])=>/^EFFECT\d+$/.test(key)&&row.NAME==='DamageEffect_AMM_APOCALYPSE_Attack_A_Projectile_PVP').length,4);
 assert.equal(collectEffectMeshBudget(profile,index,[],{effectQuality:quality}).quadCopies.size,0);
});

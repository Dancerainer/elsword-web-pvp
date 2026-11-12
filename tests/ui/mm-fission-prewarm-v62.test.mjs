/** Source-bound allocation oracle only; no Native runtime, browser or GPU.
 * Counts are current Web's contact+DIE paths for one finite cast, not
 * original-client timing or a bound for cooldown-reset tail overlaps.
 * No continuity, frame-time or sustained CPU claim follows from this oracle. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectEffectMeshBudget,effectNumberUpperBound} from '../../apps/web/effect-prewarm.mjs';
import {addCompiledPrewarmBursts} from '../../apps/web/add-compiled-prewarm-v57.mjs';
import {allowDieDamageChild} from '../../packages/combat-core/shadow-mesh.mjs';
import mm from '../../packages/combat-core/mm-profile.json' with {type:'json'};
const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url),'utf8'));
const manifest=read('artifacts/mm/manifest.json');
const index={templates:Object.assign({},...[manifest.effectAssetIndex,...manifest.visualEffectIndexes].map(path=>read('artifacts/mm/'+path).templates))};
const parent='DamageEffect_ADD_Dividing_Missile_Dynamo',small=parent+'_Small';
const explosion='DamageEffect_AMM_Dividing_Missile_Dynamo_Explosion_';
const variants=[['',4,small,explosion+'Big'],['_Mutation',8,small,explosion+'Big_MUC'],
 ['_DA',4,small+'_DA',explosion+'Big'],['_Mutation_DA',8,small+'_DA',explosion+'Big_MUC']];
const compiled=(profile=mm,loadout=[{skillId:29209}],targetCount=1)=>addCompiledPrewarmBursts(profile,index,loadout,{tickSeconds:1/60,targetCount,upperBound:effectNumberUpperBound});

test('all four actual Fission variants have simultaneous contact and hit-limit DIE producers, not eight guessed hits',()=>{
 for(const [suffix,count,child,big]of variants){
  const raw=mm.damageEffects[parent+suffix].raw,childRaw=mm.damageEffects[child].raw;
  assert.equal(raw.DAMAGE_TIME,1);assert.equal(raw.DAMAGE_DATA.REACT_TYPE,11);assert.equal(raw.DAMAGE_DATA.CREATE_DAMAGE_EFFECT_NAME,big);
  const members=Object.entries(raw).filter(([key,row])=>/^DIE_DAMAGE_EFFECT\d+$/.test(key)&&row.DAMAGE_EFFECT_NAME===child);
  assert.equal(members.length,count);
  for(const [,row]of members){assert.equal(row.LIFE_TIME_ONLY,1);assert.equal(allowDieDamageChild(row,'hit-limit'),true);assert.equal(allowDieDamageChild(row,'template-land-crash'),false);}
  assert.equal(childRaw.DAMAGE_TIME,1);assert.equal(childRaw.DAMAGE_DATA.REACT_TYPE,11);
  assert.equal(childRaw.DAMAGE_DATA.CREATE_DAMAGE_EFFECT_NAME,explosion+'Small');
  assert.equal(childRaw.DIE_DAMAGE_EFFECT0.DAMAGE_EFFECT_NAME,explosion+'Small');
  assert.equal(allowDieDamageChild(childRaw.DIE_DAMAGE_EFFECT0,'hit-limit'),true);
 }
});

test('four alternative groups supplement only missing RT11 births; the existing walk still owns the DIE descendants',()=>{
 for(const targetCount of [1,2,3]){
  const result=compiled(mm,[{skillId:29209},{skillId:29035}],targetCount);
  assert.deepEqual(result.unconfirmedRoots,[]);assert.equal(result.groups.length,4);
  assert.deepEqual(result.groups,variants.map(([suffix,count,,big])=>[
   [parent+suffix,1],[big,targetCount],[explosion+'Small',count*targetCount],
  ]));
 }
 assert.deepEqual(compiled(mm,[]).groups,[]);
 assert.deepEqual(compiled(mm,[{skillId:29035}]).groups,[],'Drone Activator alone cannot reserve a Fission burst');
 assert.deepEqual(compiled(mm,[{skillId:29211}]).groups,[],'unrelated MM skill unchanged');
 assert.deepEqual(compiled({...mm,professionId:'lp',target:{...mm.target,unitClass:122}}).groups,[],'no cross-profession Fission allocation');
});

test('real planner reserves nine missile trail sequences and contact plus death explosions, without summing variants',()=>{
 for(const effectQuality of [{level:'medium',particleDivisor:8},{level:'high',particleDivisor:1}])for(const targetCount of [1,2]){
  const result=collectEffectMeshBudget(mm,index,[{skillId:29209},{skillId:29035}],{effectQuality,targetCount});
  // Current checkHits can accept each opposing actor before one post-loop
  // hit-limit retirement. Eight children each add DIE1+contact(targetCount),
  // and the parent adds contact(targetCount): 8 + 9*targetCount explosions.
  const explosions=8+9*targetCount;
  assert.equal(result.quadCopies.get('ADD_Rushing_Drone_Loop_01'),9,'parent plus eight split carriers; DrawCount is separate');
  assert.equal(index.templates.ADD_Rushing_Drone_Loop_01.fields.DrawCount,4);
  assert.equal(result.demands.get('ADD_Drone_Activator_Loop_01').effectSetInstances,9);
  for(const name of ['ADD_Cycle_SPARK_Explode03','ADD_Cycle_SPARK_Explode04'])assert.equal(result.quadCopies.get(name),explosions,name);
  assert.equal(result.demands.get('ADD_Cycle_SPARK_Explode01').effectSetInstances,explosions);
  assert.equal(result.demands.get('ADD_Cycle_SPARK_Explode01').drawCount,3,'original random DrawCount upper bound retained');
 }
 assert.equal(collectEffectMeshBudget(mm,index,[{skillId:29035}],{effectQuality:{level:'medium',particleDivisor:8}}).quadCopies.size,0);
});

test('missing original count/contact evidence remains an explicit incomplete budget rather than an invented maximum',()=>{
 const changed=structuredClone(mm);delete changed.damageEffects[parent+'_Mutation_DA'].raw.DAMAGE_TIME;
 const result=compiled(changed);assert.equal(result.groups.length,3);
 assert.ok(result.unconfirmedRoots.includes(parent+'_Mutation_DA'));
 const budget=collectEffectMeshBudget(changed,index,[{skillId:29209}],{effectQuality:{level:'medium',particleDivisor:8}});
 assert.equal(budget.quadCopies.get('ADD_Rushing_Drone_Loop_01'),1);
 assert.equal(budget.demands.get('ADD_Cycle_SPARK_Explode01').burstUpperBound,false);
 assert.ok(budget.unsupported.some(row=>row.detail.includes('Unconfirmed finite compiled producer')));
});

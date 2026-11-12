import test from 'node:test';
import assert from 'node:assert/strict';
import {loadContinuityInputs,sampleContinuity,baselinePresentationBudget} from '../../tools/validation/audit-fx-continuity-v60.mjs';
import {particlePresentationBudget,createEffectPresentationPolicy} from '../../packages/effect-runtime/presentation-quality.mjs';

const medium={level:'medium',particleDivisor:8},high={level:'high',particleDivisor:1};
const clockFields={CannonBlade_P01:[10,.25,10],CannonBlade_P02:[12,.28,12],CannonBlade_P03:[30,.15,30],CannonBlade_P05:[10,.25,10],
 Raven_ReadyS_P01:[15,.18,2],Raven_ReadyS_P06:[15,.18,2],ADD_PSYCHIC_STORM_11:[10,.2,10],ADD_PSYCHIC_STORM_L05:[10,.2,10]};
const baseline=process.env.WEB_PVP_BASELINE_REF ? await baselinePresentationBudget() : null;
const comparisonOptions={skip:baseline ? false : 'Set WEB_PVP_BASELINE_REF for historical comparisons'};

for(const id of ['RF','BM','VC','LP'])test(`${id}: short flame/ring cues retain overlap, original lifetimes and natural retirement`,()=>{
 const {index,profile}=loadContinuityInputs(id),quality=id==='LP'?{...medium,sourceFamily:'add'}:medium;
 const names=Object.keys(clockFields).filter(name=>id==='LP'?name.startsWith('ADD_'):!name.startsWith('ADD_'));
 const policy=createEffectPresentationPolicy(profile,quality),skillId=id==='LP'?29009:24026;
 assert.deepEqual(policy.actor({skillId,state:profile.skillCatalog.find(row=>row.skillId===skillId).state}),quality,'skill remains medium');
 for(const name of names){
  const template=index.templates[name],snapshot=JSON.stringify(template),[rate,life,max]=clockFields[name];
  assert.deepEqual([template.fields.Emitrate,template.fields.Lifetime,template.fields.NumParticles],[rate,life,max],name+' independent published declarations');
  assert.equal(template.fields.TraceParticleList,undefined);assert.equal(template.fields.FinalParticleList,undefined);
  const ownerSeconds=name.startsWith('Raven_ReadyS')?.3:name.endsWith('_L05')?1.5:name.endsWith('_11')?.9:1;
  const source=sampleContinuity(template,{quality:{...quality,...high},ownerSeconds}),after=sampleContinuity(template,{quality,ownerSeconds});
  assert.deepEqual(after.birthFrames,source.birthFrames,name+' source birth clock');
  assert.deepEqual(after.samples,source.samples,name+' source sampled color/size continuity');
  assert.equal(after.emptyFramesAfterFirst,0,name+' no internal disappearing frames');
  assert.ok(after.firstVisibleFrame>=0&&after.firstVisibleFrame<10,name+' timely first source packet');
  assert.ok(after.retired&&source.retired,name+' no residual sequence');
  assert.deepEqual(after.notes,[]);assert.equal(JSON.stringify(template),snapshot,'original declaration unmodified');
 }
});

for(const id of ['RF','BM','VC','LP'])test(id+' reproduces the reference visibility loss',comparisonOptions,()=>{
 const {index}=loadContinuityInputs(id),quality=id==='LP'?{...medium,sourceFamily:'add'}:medium;
 for(const name of Object.keys(clockFields).filter(name=>id==='LP'?name.startsWith('ADD_'):!name.startsWith('ADD_'))){
  const template=index.templates[name],ownerSeconds=name.startsWith('Raven_ReadyS')?.3:name.endsWith('_L05')?1.5:name.endsWith('_11')?.9:1;
  const before=sampleContinuity(template,{quality,ownerSeconds,budget:baseline.budget}),after=sampleContinuity(template,{quality,ownerSeconds});
  assert.ok(before.firstVisibleFrame<0||before.firstVisibleFrame>after.firstVisibleFrame||before.emptyFramesAfterFirst>after.emptyFramesAfterFirst,name+' reproduces old visibility loss');
  assert.ok(before.retired,name+' no residual reference sequence');
 }
});
for(const id of ['RF','LP'])test(`${id}: all unrelated budgets and every high-quality template are unchanged`,comparisonOptions,()=>{
 const {index}=loadContinuityInputs(id),quality=id==='LP'?{...medium,sourceFamily:'add'}:medium,changed=[];
 for(const template of Object.values(index.templates)){
  const max=template.fields.NumParticles??0,limit=template.fields.TriggerCount??-1;
  const after=particlePresentationBudget(template,max,limit,quality),before=baseline.budget(template,max,limit,quality);
  if(JSON.stringify(after)!==JSON.stringify(before))changed.push(template.name);
  assert.deepEqual(particlePresentationBudget(template,max,limit,{...quality,...high}),baseline.budget(template,max,limit,{...quality,...high}),template.name+' full source quality unchanged');
 }
 assert.deepEqual(changed.sort(),Object.keys(clockFields).filter(name=>id==='LP'?name.startsWith('ADD_'):!name.startsWith('ADD_')).sort());
});

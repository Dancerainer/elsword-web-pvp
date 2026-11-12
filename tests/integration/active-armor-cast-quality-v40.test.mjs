import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getProfessionProfile,PROFESSION_PROFILES} from '../../packages/professions/profiles.mjs';
import {createEffectPresentationPolicy,particlePresentationBudget,DEFAULT_EFFECT_QUALITY,FULL_EFFECT_QUALITY,
  ACTIVE_ARMOR_CAST_EFFECT_SET} from '../../packages/effect-runtime/presentation-quality.mjs';
import {collectActiveArmorCastQuadCopies,collectCommandTemplateQualities,collectEffectTemplates} from '../../apps/web/effect-prewarm.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';

const professions=['LK','RS','IS','GM','BH','CA'];
const names=['Ring_SI_A_ES_Endurance02','Ring_SI_A_ES_Endurance01','Light_SI_A_ES_Endurance03'];
const source=id=>JSON.parse(readFileSync(new URL('../../artifacts/'+id.toLowerCase()+'/fx/index.json',import.meta.url)));

test('only the exact active-armor startup set is high for all six careers, including no-state owner restoration',()=>{
  for(const [id,profile]of Object.entries(PROFESSION_PROFILES)){
    const policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY),active=professions.includes(id);
    assert.deepEqual([...policy.fullQualityEffectSets],active?[ACTIVE_ARMOR_CAST_EFFECT_SET]:[]);
    for(const skillId of [null,21218,28218,21026,28001]){
      const quality=policy.effect({setName:ACTIVE_ARMOR_CAST_EFFECT_SET,skillId});
      assert.equal(quality.level,active?'high':'medium',id+'/'+skillId);assert.equal(quality.particleDivisor,active?1:8);
    }
    if(!active)continue;
    const skillId=['GM','BH','CA'].includes(id)?28218:21218;
    assert.deepEqual(policy.actor({state:'RSI_WAIT',skillId}),DEFAULT_EFFECT_QUALITY);
    assert.deepEqual(policy.characterHit({origin:{skillId}}),DEFAULT_EFFECT_QUALITY);
    for(const setName of ['EffectSet_SI_A_EL_ENDURANCE','EffectSet_EL_ENDURANCE_POWER','EffectSet_EL_ENDURANCE_POWER_PUNISH',
      ACTIVE_ARMOR_CAST_EFFECT_SET+'_OTHER'])
      assert.deepEqual(policy.effect({setName,name:names[0],skillId}),DEFAULT_EFFECT_QUALITY,id+'/'+setName);
    assert.deepEqual(policy.effect({name:names[0],skillId}),DEFAULT_EFFECT_QUALITY,'shared texture alone cannot promote a skill');
  }
});

for(const id of professions)test(id+' original 2+2+1 startup packets retain timely births, bounded capacities and natural retirement',()=>{
  const profile=getProfessionProfile(id),index=source(id),before=JSON.stringify(index),policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY);
  const skillId=['GM','BH','CA'].includes(id)?28218:21218,quality=policy.effect({setName:ACTIVE_ARMOR_CAST_EFFECT_SET,skillId});
  const warmed=collectEffectTemplates(profile,index,[{skillId}]),qualities=collectCommandTemplateQualities(profile,index,DEFAULT_EFFECT_QUALITY);
  const entries=Object.entries(profile.effectSets[ACTIVE_ARMOR_CAST_EFFECT_SET].raw).filter(([key])=>/^EFFECT\d+$/.test(key)).map(([,entry])=>entry);
  assert.deepEqual(entries.map(entry=>entry.NAME),names);
  const births=[],runtime=createEffectRuntime({index,effectQuality:DEFAULT_EFFECT_QUALITY,onBirth:p=>births.push({name:p.name,time:clock})});
  let clock=0;
  for(const [i,name]of names.entries()){
    assert.ok(warmed.has(name));assert.deepEqual(qualities.get(name),FULL_EFFECT_QUALITY);
    const template=index.templates[name],f=template.fields;
    assert.equal(f.TriggerCount,[2,2,1][i]);assert.equal(f.NumParticles,50);
    assert.deepEqual(particlePresentationBudget(template,f.NumParticles,f.TriggerCount,quality),{divisor:1,max:50,limit:[2,2,1][i]});
  }
  const pending=[...entries];
  for(let frame=0;frame<180;frame++){
    clock=frame/60;
    for(let i=pending.length-1;i>=0;i--)if(clock+1e-6>=(pending[i].START_TIME??0)){
      runtime.add(pending[i].NAME,{effectQuality:quality});pending.splice(i,1);
    }
    runtime.step(1/60,{});
  }
  assert.deepEqual(names.map(name=>births.filter(p=>p.name===name).length),[2,2,1]);
  assert.ok(births.find(p=>p.name===names[0]).time<.12);
  assert.ok(births.find(p=>p.name===names[1]).time<.28);
  assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
  assert.equal(JSON.stringify(index),before,'quality does not rewrite original resource declarations');
});

test('prewarm reserves only equipped owners and the existing Elesis first-cast buff displayer',()=>{
  for(const id of professions){
    const elesis=['GM','BH','CA'].includes(id),skillId=elesis?28218:21218,profile=getProfessionProfile(id),index=source(id);
    const owners=[{loadout:[{skillId}]},{loadout:[{skillId},{skillId}]},{loadout:[]},{loadout:[{skillId:21026}]}];
    assert.deepEqual([...collectActiveArmorCastQuadCopies(profile,index,owners)],names.map(name=>[name,elesis?4:2]));
    assert.equal(collectActiveArmorCastQuadCopies(profile,index,owners.slice(2)).size,0);
    assert.equal(collectActiveArmorCastQuadCopies(profile,index,[]).size,0);
  }
  assert.equal(collectActiveArmorCastQuadCopies(getProfessionProfile('RF'),source('LK'),[{loadout:[{skillId:21218}]}]).size,0);
});

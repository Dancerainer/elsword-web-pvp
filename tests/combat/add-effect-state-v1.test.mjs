import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addInstanceDefinition,validateAddStormEffectState} from '../../packages/combat-core/add-effect-state.mjs';
const source=JSON.parse(readFileSync(new URL('../../contracts/add-systems-source-v1.json',import.meta.url)));
const profile={target:{unitClass:122},skillCatalog:[{skillId:29009,raw:source.skills[29009]}]};

test('Storm wire scalar reconstructs target set scale and original2016 foot birth without mutating template',()=>{
  const definition={NAME:'layer',SCALE_X:2,SCALE_Y:3,SCALE_Z:4};
  const loop={name:'layer',setName:'EffectSet_SI_SA_ALP_Psychic_Storm_Loop',sourceAddStormSize:1.93};
  const scaled=addInstanceDefinition(profile,loop,definition);
  assert.deepEqual(scaled,{NAME:'layer',SCALE_X:3.86,SCALE_Y:5.79,SCALE_Z:7.72});
  assert.equal(definition.SCALE_X,2);
  const direct=addInstanceDefinition(profile,{name:'DamageEffect_ALP_Psychic_Storm_Loop',sourceAddStormSize:1.31},{NAME:'DamageEffect_ALP_Psychic_Storm_Loop'});
  assert.deepEqual(direct,{NAME:'DamageEffect_ALP_Psychic_Storm_Loop',SCALE_X:1.31,SCALE_Y:1.31,SCALE_Z:1.31,BONE_NAME:'Bip01_Footsteps'});
  assert.equal(addInstanceDefinition(profile,{name:'other'},definition),definition);
});

test('Storm scalar rejects unbounded values, foreign professions, unrelated effects and missing source',()=>{
  const e={name:'DamageEffect_ALP_Psychic_Storm_Loop',sourceAddStormSize:1.93};
  for(const size of [0,1.5,2,NaN,Infinity,'1.93'])assert.throws(()=>validateAddStormEffectState({...e,sourceAddStormSize:size}),/storm-size/);
  for(const size of [1,1.31,1.62,1.9300000000000002])assert.equal(validateAddStormEffectState({...e,sourceAddStormSize:size},profile),true);
  assert.throws(()=>validateAddStormEffectState(e,{...profile,target:{unitClass:123}}),/storm-effect/);
  assert.throws(()=>validateAddStormEffectState({...e,name:'unrelated'},profile),/storm-effect/);
  assert.throws(()=>validateAddStormEffectState(e,{...profile,skillCatalog:[]}),/storm-source/);
  assert.equal(validateAddStormEffectState(null),true,'outer owner validator handles malformed effect object');
});

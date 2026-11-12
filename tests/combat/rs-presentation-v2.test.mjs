import test from 'node:test';
import assert from 'node:assert/strict';
import {index} from '../helpers/rs-fixture.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {DEFAULT_EFFECT_QUALITY,RS_SOURCE_CLOCK_CUES,particlePresentationBudget} from '../../packages/effect-runtime/presentation-quality.mjs';
const cases=[['EMK_RisingSlashP01',.2],['EMK_RisingSlashP03',.11],['SwordFire_P01',.2],['SwordFire_ReadyP01',.1],
  ['SwordFire_FM01',.1],['Elsword_ReadyS_P01',.14],['Elsword_ReadyS_P02',.11],['UnlimitedBladeP04',.05],
  ['DoubleSlash_P02',.06],['SwordFire_ComboXZZ',.16],['ERS_Luna_Buster00_P01',.12],
  ['EffectSet_ERS_Luna_Buster_P02',.12],['EffectSet_ERS_Luna_Buster_P03',.25],['EffectSet_ERS_Luna_Buster_P04',.06]];
for(const [name,window] of cases)test(`RS structural ${name} is actually born within original cast window at medium quality`,()=>{
  const births=[],runtime=createEffectRuntime({index,seed:2016,effectQuality:DEFAULT_EFFECT_QUALITY,onBirth:p=>births.push(p.name)});
  const emitter=runtime.add(name,{position:[0,500,0],landPosition:0});assert.ok(emitter);
  for(let i=0;i<Math.ceil(window*60);i++)runtime.step(1/60,{});
  assert.ok(births.includes(name),`${name} missing before ${window}s`);
  // Dense carrier parents now retain the first source packet and a bounded
  // cadence; the visible sparse meshes/runes still use the full source clock.
  assert.equal(emitter.divisor,['SwordFire_ReadyP01','SwordFire_ComboXZZ'].includes(name)?4:1);
  assert.ok(RS_SOURCE_CLOCK_CUES.has(name));
});
test('Dense Big Burst smoke and HA sparks retain their medium quality budget',()=>{
  for(const name of ['Smoke_Elsword_SI_A_Big_Burst06','Flare_Elsword_SI_A_Big_Burst04','EffectSet_ERS_Luna_Buster_P08']){
    const t=index.templates[name];assert.ok(t);assert.equal(particlePresentationBudget(t,t.fields.NumParticles,t.fields.TriggerCount??-1,DEFAULT_EFFECT_QUALITY).divisor,8);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {collectEffectTemplates} from '../../apps/web/effect-prewarm.mjs';
import {compileEvents} from '../../packages/effect-runtime/index.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const primary=read('contracts/rf-fx-index.json'),buff=read('contracts/rf-buff-display-fx-index.json');
test('three original buff displays extend the full skill resource closure without replacing its declarations',()=>{
  const index=mergeVisualEffectIndexes(primary,buff);assert.equal(Object.keys(primary.templates).length,314);
  assert.equal(Object.keys(index.templates).length,317);
  for(const name of Object.keys(primary.templates))assert.deepEqual(index.templates[name],primary.templates[name]);
  const warm=collectEffectTemplates(read('packages/combat-core/rf-profile.json'),index,[]);
  for(const name of ['SwordFireTip','UnitStunB','Emoticon_State_Abnormality_Bleeding']){
    assert.ok(warm.has(name));assert.ok(compileEvents(index.templates[name]).size>0);
    for(const texture of Object.values(index.templates[name].textures))assert.ok(readFileSync(new URL('../../artifacts/rf/'+texture.file,import.meta.url)).length);
  }
});
test('cross-version or conflicting resource declarations fail instead of silently changing source evidence',()=>{
  assert.throws(()=>mergeVisualEffectIndexes(primary,{...buff,referenceVersion:'different'}),/same target/);
  const changed=structuredClone(buff);changed.templates.DamageImpact.fields.DrawCount=99;
  assert.throws(()=>mergeVisualEffectIndexes(primary,changed),/Conflicting original/);
});

test('Shadow and weapon closure merges with original declarations and actual new model poses',()=>{
  const shadow=read('contracts/rf-shadow-weapon-fx-index.json');
  const index=mergeVisualEffectIndexes(primary,buff,shadow);
  assert.equal(Object.keys(index.templates).length,337);
  for(const template of Object.values(shadow.templates)){
    if(template.poseData)assert.ok(readFileSync(new URL('../../artifacts/rf/'+template.poseData,import.meta.url)).length);
    if(template.glb)assert.ok(readFileSync(new URL('../../artifacts/rf/'+template.glb,import.meta.url)).length);
  }
  const profile=read('packages/combat-core/rf-profile.json');
  assert.ok(profile.effectSets.EffectSet_Raven_Shadow_Buster);
  for(const number of [1,2,3])assert.ok(profile.damageEffects['DAMAGE_EFFECT_SHADOW_BACK_SLIDE_BULLET_'+number]);
  assert.ok(profile.resourceOnlyEffectSets.includes('EffectSet_Raven_Shadow_Buster'));
});

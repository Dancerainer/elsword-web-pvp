import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveEffectTemplateKey} from '../../packages/combat-assets/effect-template-key.mjs';

test('original EffectSet registry choice disambiguates identical mesh and particle names',()=>{
  const templates={shared:{kind:'particle'},'mesh::shared':{kind:'mesh',sourceName:'shared'}};
  for(const type of [2,3,4,5])assert.equal(resolveEffectTemplateKey(templates,'shared',type),'mesh::shared');
  for(const type of [6,7,8,9])assert.equal(resolveEffectTemplateKey(templates,'shared',type),'shared');
  assert.equal(resolveEffectTemplateKey(templates,'shared',undefined),'shared','untyped particle consumers retain original namespace');
  assert.equal(resolveEffectTemplateKey(templates,'missing',4),'missing');
});

test('wrong-kind or wrong-source templates never silently substitute for the requested registry',()=>{
  assert.equal(resolveEffectTemplateKey({shared:{kind:'particle'}},'shared',4),null);
  assert.equal(resolveEffectTemplateKey({shared:{kind:'particle'},'mesh::shared':{kind:'mesh',sourceName:'other'}},'shared',4),null);
  assert.equal(resolveEffectTemplateKey({shared:{kind:'mesh'},'particle::shared':{kind:'particle',sourceName:'shared'}},'shared',8),'particle::shared');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_KEY_BINDINGS,KEY_BINDING_ACTIONS,normalizeKeyBindings,validateKeyBindings,translateKeyboardCode,createKeyBindingTranslator,coreKeyLabel} from '../../packages/input/key-bindings.mjs';

test('default bindings cover exactly the sixteen supported actions and fixed existing skill slots',()=>{
  assert.equal(KEY_BINDING_ACTIONS.length,16);assert.ok(validateKeyBindings(DEFAULT_KEY_BINDINGS).valid);
  const entries=[['ArrowUp','UP'],['ArrowDown','DOWN'],['ArrowLeft','LEFT'],['ArrowRight','RIGHT'],['KeyZ','Z'],['KeyX','X'],['ControlLeft','AWAKEN'],['KeyQ','Q'],['KeyW','W'],['KeyE','E'],['KeyR','R'],['KeyA','A'],['KeyS','S'],['KeyD','D'],['KeyC','C'],['KeyV','SPECIAL']];
  for(const [code,action] of entries)assert.equal(translateKeyboardCode(code),action);
  assert.equal(translateKeyboardCode('Tab'),null);assert.equal(translateKeyboardCode('ControlRight'),null);
});
test('normalization copies without mutating defaults and custom physical keys preserve logical slots',()=>{
  const a=normalizeKeyBindings();a.bindings.skill1='Digit1';a.bindings.skill5='Digit5';
  assert.equal(translateKeyboardCode('Digit1',a),'Q');assert.equal(translateKeyboardCode('Digit5',a),'A');assert.equal(translateKeyboardCode('KeyQ',a),null);assert.equal(coreKeyLabel('Q',a),'1');assert.equal(DEFAULT_KEY_BINDINGS.bindings.skill1,'KeyQ');
});
test('malformed version, missing actions, duplicate key, shift aliases and arbitrary fields are rejected',()=>{
  for(const value of [null,[],{}, {schemaVersion:2,bindings:DEFAULT_KEY_BINDINGS.bindings}, {schemaVersion:1,bindings:{}}])assert.throws(()=>normalizeKeyBindings(value),TypeError);
  const duplicate=normalizeKeyBindings();duplicate.bindings.x='KeyZ';assert.equal(validateKeyBindings(duplicate).errors[0].code,'conflict');
  const aliases=normalizeKeyBindings();aliases.bindings.awaken='ShiftLeft';aliases.bindings.special='ShiftRight';assert.equal(validateKeyBindings(aliases).errors[0].code,'conflict');
  const extra=normalizeKeyBindings();extra.bindings.cheat='KeyT';assert.equal(validateKeyBindings(extra).errors[0].code,'unknown-action');extra.bindings=DEFAULT_KEY_BINDINGS.bindings;extra.extra=1;assert.equal(validateKeyBindings(extra).errors[0].code,'unknown-field');
});
test('right Ctrl has an independent action and independent press/release from left Ctrl',()=>{
  const config=normalizeKeyBindings();config.bindings.special='ControlRight';
  assert.ok(validateKeyBindings(config).valid);
  const translator=createKeyBindingTranslator(config);
  assert.equal(translator.down('ControlLeft'),'AWAKEN');assert.equal(translator.down('ControlRight'),'SPECIAL');
  assert.equal(translator.down('ControlRight'),null);
  assert.equal(translator.up('ControlLeft'),'AWAKEN');assert.equal(translator.up('ControlRight'),'SPECIAL');
  config.bindings.awaken='ControlRight';config.bindings.special='ControlLeft';
  translator.setBindings(config);assert.equal(translator.down('ControlRight'),'AWAKEN');
  assert.deepEqual(translator.releaseAll(),['AWAKEN']);
  config.bindings.special='ControlRight';assert.equal(validateKeyBindings(config).errors[0].code,'conflict');
});
test('OS, scoreboard, dialog and unsupported codes remain reserved',()=>{
  for(const code of ['Escape','Tab','Enter','F1','F12','MetaLeft','MetaRight','AltLeft','AltRight','PrintScreen','CapsLock','Delete','Unidentified','Keya','Digit10','__proto__','Control','']){const value=normalizeKeyBindings();value.bindings.special=code;assert.ok(!validateKeyBindings(value).valid,code);}
});
test('same physical key repeat emits no extra edge and config changes release old actions without pressing new ones',()=>{
  const translator=createKeyBindingTranslator();assert.equal(translator.down('KeyQ'),'Q');assert.equal(translator.down('KeyQ'),null);assert.equal(translator.up('KeyQ'),'Q');assert.equal(translator.up('KeyQ'),null);
  assert.equal(translator.down('ArrowLeft'),'LEFT');const next=normalizeKeyBindings();next.bindings.left='KeyJ';assert.deepEqual(translator.setBindings(next),['LEFT']);assert.equal(translator.up('ArrowLeft'),null);assert.equal(translator.down('KeyJ'),'LEFT');assert.deepEqual(translator.releaseAll(),['LEFT']);
});
test('rejected config keeps the old translator and held release association intact',()=>{
  const translator=createKeyBindingTranslator();translator.down('KeyZ');assert.throws(()=>translator.setBindings({schemaVersion:1,bindings:{}}));assert.equal(translator.up('KeyZ'),'Z');assert.equal(translator.translate('KeyZ'),'Z');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const preset = JSON.parse(await readFile(new URL('../../config/rf-preset.json',import.meta.url),'utf8'));
test('RF fixture retains eight simultaneous keys and disables cinematic features',()=>{
  assert.equal(preset.career,'UC_RAVEN_RECKLESS_FIST');
  assert.equal(preset.skillBarMode,'eight');assert.equal(preset.skillBarSwitching,false);
  assert.equal(preset.skillKeys.length,8);assert.equal(new Set(preset.skillKeys).size,8);
  assert.equal(preset.cameraDynamic,false);assert.equal(preset.skillCutIn,false);
  assert.equal(preset.showHpMpNumbers,true);assert.equal(preset.awakeningEnabled,true);assert.equal(preset.ravenCoreEnabled,true);
});
test('anonymous login document imports only login shell; game import follows authentication',async()=>{
  const html=await readFile(new URL('../../apps/web/index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/game\/game\.(?:js|css)|assets\/|babylon/i);
  const login=await readFile(new URL('../../apps/web/login.mjs',import.meta.url),'utf8');
  assert.match(login,/if \(\(await fetch\('\/api\/session'(?:,\s*\{[^}]*\})?\)\)\.ok\) await enter\(\)/);
});

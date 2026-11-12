import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectEffectTemplates} from '../../apps/web/effect-prewarm.mjs';
import {collectEffectPoseFiles,mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {createPoseLibrary} from '../../tools/assets/character/sample_pose.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const profile=read('packages/combat-core/rf-profile.json');
const visuals=mergeVisualEffectIndexes(read('artifacts/rf/fx/index.json'),read('artifacts/rf/buff-fx/index.json'),read('artifacts/rf/shadow-weapon-fx/index.json'));
test('668X original callback warms every named set effect before keyboard input',()=>{
  const names=collectEffectTemplates(profile,visuals,[]);
  for(const name of ['RRF_DASHJUMP_X','Flare_Raven_RFF_DashJumpAttackX1_Burst01','Impact_Raven_RFF_DashJumpAttackX1_Burst01'])assert.ok(names.has(name),name);
});
test('668XX landing loads original visible particle mesh poses as well as separate damage helpers',()=>{
  const collision=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),visuals),files=collectEffectPoseFiles(collision,visuals);
  for(const name of ['LimitCrusherAP03','LimitCrusherAM01','ROT_DASH_JUMP_ZX_Ground02','Raven_ReadyS_P02']){
    const t=visuals.templates[name];assert.equal(t.kind,'particle');assert.ok(files.includes(t.poseData),name);
    const library=createPoseLibrary(read('artifacts/rf/'+t.poseData));assert.ok(library.frames.length>0);
  }
  assert.equal(files.length,new Set(files).size);
  for(const f of files)assert.doesNotThrow(()=>read('artifacts/rf/'+f),f);
});


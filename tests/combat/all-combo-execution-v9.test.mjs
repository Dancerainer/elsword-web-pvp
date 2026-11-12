/** Exhaust the audited target state list with actual resources. This checks
 * execution/serialization stability only; it supplies no original PvP oracle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {collectEffectPoseFiles,mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
const read=f=>JSON.parse(readFileSync(new URL('../../'+f,import.meta.url)));
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const visual=mergeVisualEffectIndexes(...['fx','buff-fx','shadow-weapon-fx'].map(f=>read('artifacts/rf/'+f+'/index.json')));
const index=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),visual);
const poses=Object.fromEntries(collectEffectPoseFiles(index,visual).map(f=>[f,read('artifacts/rf/'+f)]));
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:f=>readFileSync(new URL('../../artifacts/native/'+f,import.meta.url))});
const states=read('reports/rf-all-combo-source-audit-v9.json').rows.filter(r=>r.presentAtBaseline).map(r=>r.state);
assert.equal(states.length,32);
function make(state){
  const sim=createSimulation({profile,map,preset,seed:2016,actors:[{id:'rf',team:0,position:[2023,2840,0],lineId:6,facing:-1},{id:'target',team:1,position:[1858,2840,0],lineId:6,facing:1}],
    ...createNativeSamplers({profile,characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex:index,effectPoses:poses}),
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,versions:native.versions});
  const actor=sim.actor('rf');if(/JUMP/.test(state)&&!/LAND/i.test(state)){actor.grounded=false;actor.lineId=null;actor.y+=250;}
  sim.enter(actor,state,'audited-state-execution-fixture');return sim;
}
function finite(value){if(typeof value==='number')assert.ok(Number.isFinite(value));else if(value&&typeof value==='object')Object.values(value).forEach(finite);}
for(const state of states)test('audited '+state+' executes actual source resources and JSON restores deterministically',()=>{
  const sim=make(state);
  for(let i=0;i<120;i++)sim.step(1/60,i===5?{pressed:['X']}:i===8?{pressed:['Z']}:i===16?{held:['DOWN']}: {},{snapshot:false});
  const snapshot=JSON.parse(JSON.stringify(sim.snapshot()));finite(snapshot);
  const restored=make(state);restored.restore(snapshot);
  for(let i=0;i<30;i++){sim.step(1/60,{}, {snapshot:false});restored.step(1/60,{}, {snapshot:false});}
  assert.deepEqual(JSON.parse(JSON.stringify(restored.snapshot())),JSON.parse(JSON.stringify(sim.snapshot())));
});

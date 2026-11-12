import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createSimulation,CORE_VERSION} from '../packages/combat-core/index.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes,collectEffectPoseFiles} from '../packages/combat-assets/effect-indexes.mjs';
import {loadReplayMap} from './replay-map.mjs';
import {createNativeRuntime} from '../packages/native-source/runtime.mjs';
import {NATIVE_RUNTIME_VERSION} from '../packages/native-source/runtime-version.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
const tracePath=process.argv[2];
if(!tracePath)throw Error('Usage: node tools/replay-trace.mjs /absolute/path/rf-simulation-trace.json');
const trace=JSON.parse(readFileSync(resolve(tracePath),'utf8'));
assert.equal(trace.purpose,'current-simulation-trace-not-native-ground-truth');
assert.deepEqual(trace.initial.versions,trace.final.versions,'Trace versions cannot change mid-recording');
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
assert.equal(trace.versions.program,CORE_VERSION,'Historical trace requires its original program commit');
assert.equal(trace.versions.preset,preset.presetVersion,'Trace requires its frozen preset');
const map=loadReplayMap({root,trace});
const overlays=['fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx','core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17'];
try{read('artifacts/rf/landing-fx/index.json');overlays.push('landing-fx');}catch(error){if(error.code!=='ENOENT')throw error;}
const fxIndex=mergeVisualEffectIndexes(...overlays.map(name=>read('artifacts/rf/'+name+'/index.json')));
const effectIndex=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),fxIndex);
const effectPaths=collectEffectPoseFiles(effectIndex,fxIndex);
const effectPoses=Object.fromEntries(effectPaths.map(path=>[path,read('artifacts/rf/'+path)]));
const samplers=createNativeSamplers({characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex,effectPoses,profile});
const nativeOptions={manifest:read('artifacts/native/manifest.json'),map,
  loadBinary:file=>readFileSync(resolve(root,'artifacts/native',file))};
assert.equal(nativeOptions.manifest.runtimeVersion,NATIVE_RUNTIME_VERSION,'RF requires the complete frozen source runtime');
const native=await createNativeRuntime(nativeOptions);
assert.deepEqual(Object.keys(trace.versions).filter(key=>key.startsWith('native')).sort(),Object.keys(native.versions).sort(),'Trace and runtime must contain the same frozen native modules');
for(const [name,value] of Object.entries(native.versions))assert.equal(trace.versions[name],value,`Trace requires its frozen ${name}`);
const simulation=createSimulation({profile,map,preset,seed:2016,...samplers,nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:trace.versions});
simulation.restore(trace.initial);simulation.drainEvents();
for(const input of trace.inputs){simulation.step(input.dt,input.inputs);simulation.drainEvents();}
function serialized(value){
  function check(node){if(typeof node==='number')assert.ok(Number.isFinite(node),'Snapshot numbers must be finite');
    else if(node && typeof node==='object')for(const child of Object.values(node))check(child);}
  check(value);return JSON.parse(JSON.stringify(value));
}
// The JSON wire format represents -0 as 0. No coordinate/timing tolerance is applied.
assert.deepEqual(serialized(simulation.snapshot()),trace.final,'Browser export must reproduce the complete serialized headless state');
const restoredNative=await createNativeRuntime(nativeOptions);
const restored=createSimulation({profile,map,preset,seed:2016,...samplers,nativeGeometry:restoredNative.geometry,nativeCommands:restoredNative.commands,nativeSkills:restoredNative.skills,nativeSkillValues:restoredNative.skillValues,nativeNasod:restoredNative.nasod,nativeCritical:restoredNative.critical,nativeManaBreak:restoredNative.manaBreak,versions:trace.versions});
restored.restore(trace.final);restored.drainEvents();
for(let i=0;i<120;i++){
  simulation.step(1/60,{});restored.step(1/60,{});simulation.drainEvents();restored.drainEvents();
  assert.deepEqual(serialized(simulation.snapshot()),serialized(restored.snapshot()),'JSON snapshot continuation diverged');
}
console.log(JSON.stringify({kind:'simulation-implementation',originalClientMeasured:false,
  sceneId:map.sceneId,
  recordingReason:trace.recordingReason,steps:trace.inputs.length,completeSerializedSnapshotEqual:true,
  jsonRestoredContinuationSteps:120,signedZeroPolicy:'standard JSON -0 to 0; no numeric tolerance',
  actors:trace.final.actors.map(a=>({id:a.id,hp:a.hp,mp:a.mp,state:a.state,awakeningSeconds:a.awakening.remaining,corePhase:a.core.phase,coreLevel:a.core.level}))}));

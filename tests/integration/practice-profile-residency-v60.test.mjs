/** The production practice boundary with real profession declarations. This
 * compares initialization/JS input semantics, not native combat or FPS. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {compactPoseDocument} from '../../packages/combat-assets/compact-pose.mjs';
import {PROFESSION_IDS} from '../../packages/professions/catalog.mjs';
import {getProfessionProfile,getProfessionPreset,PROFESSION_PROFILES,PROFESSION_PRESETS} from '../../packages/professions/profiles.mjs';
import {practiceActors as pairedPracticeActors} from '../../apps/web/map-runtime.mjs';
import {preparePracticeTarget,PRACTICE_TARGET_HP} from '../../apps/web/practice-resources.mjs';

// Production supplies the original value bridge before constructing actors.
// Without it Simulation intentionally leaves passivePolicy null, which is not
// a valid VC per-frame fixture. Never fabricate a policy to bypass that path.
const manifest=JSON.parse(readFileSync(new URL('../../artifacts/native/manifest.json',import.meta.url),'utf8'));
const valueModule=manifest.modules['skill-values'],valueBytes=readFileSync(new URL('../../artifacts/native/'+valueModule.file,import.meta.url));
assert.equal(createHash('sha256').update(valueBytes).digest('hex'),valueModule.sha256);
const skillValues=await instantiateNativeSkillValues(valueBytes);
const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
const roster=source.split('\n').find(line=>line.startsWith('const practiceActors='));
const start=source.indexOf('function createPracticeSimulation('),end=source.indexOf('async function loadAllProfessionPreferences(',start);
assert.ok(roster&&start>=0&&end>start,'extract the actual production practice function');
const definition=source.slice(start,end);
const map={sceneId:'practice-profile-residency-fixture',spawns:[
  {kind:'SetTeamStartPos',position:[0,0,0],lineId:0,facingRight:true},
  {kind:'SetTeamStartPos',position:[200,0,0],lineId:0,facingRight:false}],
  lines:[{lineId:0,start:[-1000,0,0],end:[1000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
let lkPose;
function simulationSamplers(id){
  if(id!=='LK')return {};
  // The actual default Wind Slicer passive can fire during the input trace;
  // its carrier requires the real Bip01 attachment, never a guessed position.
  lkPose??=compactPoseDocument(JSON.parse(readFileSync(new URL('../../artifacts/lk/runtime-pose.json',import.meta.url),'utf8')));
  const {effectAnchorSampler}=createNativeSamplers({profile:getProfessionProfile(id),characterPose:lkPose,
    effectIndex:{templates:{}},effectPoses:{},map});
  return {effectAnchorSampler};
}
function factory(id,allProfiles){
  let defaults;
  const context={pairedPracticeActors,getProfessionProfile,getProfessionPreset,PROFESSION_PROFILES,PROFESSION_PRESETS,
    commonBuffs:null,mapManifest:map,professionAssets:new Map([[id,{manifest:{referenceVersion:'source2016'}}]]),
    simulationSamplers:simulationSamplers(id),nativeRuntime:{versions:{nativeSkillValues:valueModule.sha256},skillValues},currentMapVersions:{},preparePracticeTarget,
    createSimulation(options){
      // The control differs only in the former registry arguments; actor,
      // seed, equipment, map and input all come from the same production body.
      const sim=createSimulation(allProfiles?{...options,profiles:PROFESSION_PROFILES,presets:PROFESSION_PRESETS}:options);
      defaults=structuredClone(sim.state.actors.map(actor=>actor.loadout));return sim;
    }};
  vm.createContext(context);vm.runInContext(roster+'\n'+definition,context);
  return {create:context.createPracticeSimulation,defaults:()=>defaults};
}
function semanticState(sim){const state=sim.snapshot();delete state.profileIds;return state;}
function input(frame){
  const held=frame<8?['RIGHT']:frame>=48&&frame<54?['LEFT']:[];
  const command=new Map([[12,'Z'],[24,'X'],[32,'UP'],[60,'A'],[72,'Z']]).get(frame);
  return {'player-1':{held,pressed:command?[command]:[],released:[]}};
}
for(const [index,id]of PROFESSION_IDS.entries())test(id+' practice retains default/saved loadout, events and snapshots with only its real profession',()=>{
  const before=factory(id,true),after=factory(id,false),includeTarget=index%2===0;
  const savedLoadout=id==='RF'?[null,{skillId:24027},...Array(6).fill(null)]:index%2?Array(8).fill(null):undefined;
  const old=before.create(id,savedLoadout,{includeTarget}),current=after.create(id,savedLoadout,{includeTarget});
  assert.deepEqual(Object.keys(old.profiles),PROFESSION_IDS);
  assert.deepEqual(Object.keys(current.profiles),[id]);assert.deepEqual(Object.keys(current.presets),[id]);
  assert.deepEqual(current.state.profileIds,{[id]:getProfessionProfile(id).profileId});
  assert.ok([...old.state.actors,...current.state.actors].every(actor=>actor.passivePolicy?.skillLevels),'both paths initialize real passives, including the HP-only mirror');
  assert.deepEqual(after.defaults(),before.defaults(),'the defaults used by loadAllProfessionPreferences are unchanged');
  assert.deepEqual(semanticState(current),semanticState(old));
  if(includeTarget)assert.equal(current.state.actors[1].hp,PRACTICE_TARGET_HP);
  const resetBefore=old.snapshot(),resetAfter=current.snapshot();
  for(let frame=0;frame<90;frame++){
    old.step(1/60,input(frame));current.step(1/60,input(frame));
    if(frame===35){
      const a=old.snapshot(),b=current.snapshot();old.restore(a);current.restore(b);
      assert.deepEqual(semanticState(current),semanticState(old),'own checkpoint restore preserves all state');
    }
  }
  assert.deepEqual(semanticState(current),semanticState(old),'same seed/input preserves actors, effects, events, versions and unsupported observations');
  assert.ok(current.state.events.length>resetAfter.events.length,'the comparison exercises emitted simulation events');
  // Restore keeps its exact registry guard. Historical full-registry traces
  // are not silently accepted as a differently configured simulation.
  assert.throws(()=>current.restore(old.snapshot()),/profession\/profile\/version mismatch/);
  const normalized=old.snapshot();normalized.profileIds={...current.state.profileIds};current.restore(normalized);
  assert.deepEqual(semanticState(current),semanticState(old));
  old.restore(resetBefore);current.restore(resetAfter);
  assert.deepEqual(current.snapshot(),resetAfter,'clean reset uses its original own-registry snapshot');
  assert.deepEqual(semanticState(current),semanticState(old));
});

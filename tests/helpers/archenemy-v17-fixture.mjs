import {authoredEquipmentPreset} from './authored-equipment-v21.mjs';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {collectEffectPoseFiles,mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
export const project=fileURLToPath(new URL('../../',import.meta.url));
const fixtureRoot=process.env.RF_FULL_SKILLS_FIXTURE_ROOT??project;
export const read=file=>JSON.parse(readFileSync(resolve(file.startsWith('artifacts/')?fixtureRoot:project,file)));
export const starts=read('contracts/rf-archenemy-start-fx-index-v17.json');
export const profile=read('packages/combat-core/rf-profile.json');
// Explicit integration fixture: root separately merges these exact four
// declarations into production. No speed/damage/state/map values change.
Object.assign(profile.effectTemplates,starts.templates);
profile.resourceOnlyTemplates=[...new Set([...(profile.resourceOnlyTemplates??[]),...Object.keys(starts.templates)])];
const preset=authoredEquipmentPreset(read('config/rf-preset.json'));
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
export const index=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),mergeVisualEffectIndexes(...
  ['fx','buff-fx','shadow-weapon-fx','skill-fx-v11','archenemy-fx-v17'].map(p=>read('artifacts/rf/'+p+'/index.json'))));
export const poses=Object.fromEntries(collectEffectPoseFiles(index).map(f=>[f,read('artifacts/rf/'+f)]));
export const samplers=createNativeSamplers({profile,characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex:index,effectPoses:poses});
export async function makeArc(facing=1){
  const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,
    loadBinary:file=>readFileSync(resolve(fixtureRoot,'artifacts/native',file))});
  return createSimulation({profile,map,preset:{...preset,loadout:[{skillId:24008},null,null,null,null,null,null,null]},
    actors:[{id:'rf',team:0,position:[facing<0?2022.98:1858.11,2840,0],lineId:6,facing},
      {id:'target',team:1,position:[facing<0?1942.98:1938.11,2840,0],lineId:6,facing:-facing}],
    ...samplers,nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,
    nativeSkillValues:native.skillValues,nativeNasod:native.nasod,nativeCritical:native.critical,seed:2016,versions:native.versions});
}

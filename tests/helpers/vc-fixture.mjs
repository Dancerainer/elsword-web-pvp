/** Actual 2016 VC helpers, converted keys, and authored Garpai collision. */
import {authoredEquipmentPreset} from './authored-equipment-v21.mjs';
import {readFileSync} from 'node:fs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
export const vcProfile=read('packages/combat-core/vc-profile.json'),vcPreset=authoredEquipmentPreset(read('config/vc-preset.json'));
const rawPose=read('artifacts/vc/runtime-pose.json'),characterPose=composeCharacterPose(rawPose,rawPose.sharedPose?read('artifacts/vc/'+rawPose.sharedPose):null),effectIndex=mergeEffectIndexes({templates:{}},read('artifacts/vc/fx/index.json'));
const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read('artifacts/vc/'+p)]));
export {effectIndex as vcEffectIndex,effectPoses as vcEffectPoses};
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:p=>readFileSync(new URL('../../artifacts/native/'+p,import.meta.url))});
export function vcFixture({skillId=24034,passives=vcProfile.defaultPassiveSkillIds,position=[0,3080,0],gap=250,facing=1,seed=2016}={}){
  const sim=createSimulation({profile:vcProfile,map,preset:{...vcPreset,loadout:[{skillId},...Array(7).fill(null)],guildPassives:[],passives},seed,
    actors:[{id:'vc',professionId:'VC',team:0,position,lineId:2,facing},
      {id:'target',professionId:'VC',team:1,position:[position[0]+gap*facing,position[1],position[2]],lineId:2,facing:-facing,loadout:Array(8).fill(null),passives:[]}],
    ...createNativeSamplers({profile:vcProfile,characterPose,effectIndex,effectPoses}),nativeGeometry:native.geometry,nativeCommands:native.commands,
    nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeNasod:native.nasod,nativeManaBreak:native.manaBreak,versions:native.versions});
  const a=sim.actor('vc'),b=sim.actor('target');a.mp=a.mpMax;
  return {sim,a,b,profile:vcProfile,native,map};
}

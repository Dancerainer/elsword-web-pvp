// Historical equipment inputs frozen at389e247; production v3 has separate coverage.
import {beforeBalanceV3} from './equipment-balance-before-v3.mjs';
/** Actual 2016 BM helpers, converted keys, and authored Garpai collision. */
import {readFileSync} from 'node:fs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
export const bmProfile=read('packages/combat-core/bm-profile.json'),bmPreset=beforeBalanceV3(read('config/bm-preset.json'));
const rawPose=read('artifacts/bm/runtime-pose.json'),characterPose=composeCharacterPose(rawPose,rawPose.sharedPose?read('artifacts/bm/'+rawPose.sharedPose):null),effectIndex=mergeEffectIndexes({templates:{}},read('artifacts/bm/fx/index.json'));
const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read('artifacts/bm/'+p)]));
export {effectIndex as bmEffectIndex,effectPoses as bmEffectPoses};
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:p=>readFileSync(new URL('../../artifacts/native/'+p,import.meta.url))});
export function bmFixture({skillId=24033,passives=bmProfile.defaultPassiveSkillIds,position=[0,3080,0],gap=250,facing=1,seed=2016,branchId='none',preset=bmPreset}={}){
  const sim=createSimulation({profile:bmProfile,map,preset:{...preset,loadout:[{skillId,branchId},...Array(7).fill(null)],guildPassives:[],passives},seed,
    actors:[{id:'bm',professionId:'BM',team:0,position,lineId:2,facing},
      {id:'target',professionId:'BM',team:1,position:[position[0]+gap*facing,position[1],position[2]],lineId:2,facing:-facing,loadout:Array(8).fill(null),passives:[]}],
    ...createNativeSamplers({profile:bmProfile,characterPose,effectIndex,effectPoses}),nativeGeometry:native.geometry,nativeCommands:native.commands,
    nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeNasod:native.nasod,nativeManaBreak:native.manaBreak,versions:native.versions});
  const a=sim.actor('bm'),b=sim.actor('target');a.mp=a.mpMax;
  return {sim,a,b,profile:bmProfile,native,map};
}

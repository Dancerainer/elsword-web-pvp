// Historical equipment inputs frozen at389e247; production v3 has separate coverage.
import {beforeBalanceV3} from '../helpers/equipment-balance-before-v3.mjs';
/** Real target assets and map; no invented collision boxes or reaction answers. */
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
const root=new URL('../../',import.meta.url);
export const read=p=>JSON.parse(readFileSync(new URL(p,root)));
export const profile=read('packages/combat-core/is-profile.json');
export const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
export const effectIndex=mergeEffectIndexes(read('artifacts/is/effect-assets.json'),read('artifacts/is/fx/index.json'));
export const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read('artifacts/is/'+p)]));
const pose=read('artifacts/is/runtime-pose.json');
export const characterPose=composeCharacterPose(pose,read('artifacts/is/'+pose.sharedPose));
export const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:p=>readFileSync(new URL('artifacts/native/'+p,root))});
export function make({facing=1,distance=165,height=0,skillId=null,mp=300,target=true,adapterNotes=[],unenhancedSwordFall=false}={}){
  const preset={...beforeBalanceV3(read('config/is-preset.json')),guildPassives:[],passives:[],loadout:[skillId?{skillId}:null,...Array(7).fill(null)]};
  // Production equips the highest replacement. Isolate the historical
  // unenhanced declaration for the independently frozen four-sword suite.
  const enhancedRow=profile.skillCatalog.find(s=>s.skillId===21033);
  const testedProfile=unenhancedSwordFall?{...profile,skillCatalog:profile.skillCatalog.filter(s=>s.skillId!==21033).map(s=>s.skillId===21019?{...s,topTier:true,supported:true,state:enhancedRow.state,executor:enhancedRow.executor}:s)}:profile;
  const sim=createSimulation({profile:testedProfile,map,preset,seed:2016,
    actors:[{id:'is',professionId:'IS',team:0,position:[0,3080,0],lineId:2,facing,mp,guildPassives:[],passives:[]},
      ...(target?[{id:'target',professionId:'IS',team:1,position:[distance*facing,3080+height,0],lineId:2,facing:-facing,guildPassives:[],passives:[],loadout:Array(8).fill(null)}]:[])],
    ...createNativeSamplers({profile,map,characterPose,effectIndex,effectPoses,onUnsupported:n=>adapterNotes.push(n)}),
    nativeGeometry:native.geometry,nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeManaBreak:native.manaBreak});
  sim.drainEvents();return sim;
}

import {addPlayerFeedbackVisuals} from '../../packages/combat-assets/player-feedback-visuals-v45.mjs';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const assetRoot=process.env.ELESIS_FIXTURE_ASSETS??resolve(root,'artifacts');
const read=p=>JSON.parse(readFileSync(p));
const map={...read(resolve(assetRoot,'scene/sander-garpai-rock-pvp/manifest.json')),...read(resolve(assetRoot,'scene/sander-garpai-rock-pvp/collision.json'))};
const native=await createNativeRuntime({manifest:read(resolve(assetRoot,'native/manifest.json')),map,loadBinary:p=>readFileSync(resolve(assetRoot,'native',p))});
const cache=new Map();
export function elesisFixture(profession='GM'){
 if(cache.has(profession))return cache.get(profession);
 const folder=profession.toLowerCase(),assets=resolve(assetRoot,folder),profile=read(resolve(root,`packages/combat-core/${folder}-profile.json`)),preset=read(resolve(root,`config/${folder}-preset.json`));
 const index=mergeEffectIndexes({templates:{}},addPlayerFeedbackVisuals(read(resolve(assets,'fx/index.json')),profession));
 const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(resolve(assets,p))]));
 const rawPose=read(resolve(assets,'runtime-pose.json')),characterPose=rawPose.sharedPose?composeCharacterPose(rawPose,read(resolve(assets,rawPose.sharedPose))):rawPose;
 function make(skillId,branchId='none',{passives=[],distance=165,awake=false,hold=false}={}){
  const sim=createSimulation({profile,map,preset:{...preset,guildPassives:[],passives,loadout:[skillId?{skillId,branchId}:null,...Array(7).fill(null)]},seed:2016,
   actors:[{id:'elesis',professionId:profession,team:0,position:[2022.98,2840,0],lineId:6,facing:-1,guildPassives:[],passives},
    {id:'target',professionId:profession,team:1,position:[2022.98-distance,2840,0],lineId:6,facing:1,guildPassives:[],passives:[],loadout:Array(8).fill(null)}],
   ...createNativeSamplers({profile,map,characterPose,effectIndex:index,effectPoses:poses}),
   nativeGeometry:native.geometry,nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeManaBreak:native.manaBreak});
  const a=sim.actor('elesis');if(awake)a.awakening.remaining=30;
  // PvP opening HA cooldown is independent of the isolated skill outcome test.
  a.cooldowns={};return sim;
 }
 const result={profile,preset,index,make};cache.set(profession,result);return result;
}

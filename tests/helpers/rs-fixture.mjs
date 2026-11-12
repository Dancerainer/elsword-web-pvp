import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
const root=resolve(import.meta.dirname,'../..');
export const read=p=>JSON.parse(readFileSync(resolve(root,p)));
export const profile=read('packages/combat-core/rs-profile.json'),preset=read('config/rs-preset.json');
export const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
export const index=mergeEffectIndexes(read('artifacts/rs/effect-assets.json'),read('artifacts/rs/fx/index.json'));
const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read('artifacts/rs/'+p)]));
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:p=>readFileSync(resolve(root,'artifacts/native',p))});
const rsPose=read('artifacts/rs/runtime-pose.json');
const samplers=createNativeSamplers({profile,characterPose:composeCharacterPose(rsPose,read('artifacts/rs/'+rsPose.sharedPose)),effectIndex:index,effectPoses:poses});
export function fixture({skillId=21026,branchId='none',facing=1,networkOwnerId=null,distance=164.87,position=[2022.98,2840,0],lineId=6}={}){
  const sim=createSimulation({profile,map,preset:{...preset,loadout:[{skillId,branchId},null,null,null,null,null,null,null]},seed:2016,networkOwnerId,
    actors:[{id:'rs',professionId:'RS',team:0,position:[...position],lineId,facing},
      {id:'target',professionId:'RS',team:1,position:[position[0]+distance*facing,position[1],position[2]],lineId,facing:-facing,passives:[],guildPassives:[],loadout:Array(8).fill(null)}],
    ...samplers,nativeGeometry:native.geometry,nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeManaBreak:native.manaBreak});
  const a=sim.actor('rs'),b=sim.actor('target');return {sim,a,b,profile,index,map};
}
export function steps(sim,count,input={}){for(let i=0;i<count;i++)sim.step(1/60,{rs:typeof input==='function'?input(i):input},{snapshot:false});}
export function cast(f){f.a.mp=f.a.mpMax;f.b.mp=f.b.mpMax;f.sim.step(1/60,{rs:{held:['A'],pressed:['A']}},{snapshot:false});}

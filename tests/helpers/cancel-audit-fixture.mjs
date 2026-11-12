/** Task-local production assets, source WASM and original Garpai geometry. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
const root=resolve(import.meta.dirname,'../..');
const read=p=>JSON.parse(readFileSync(resolve(root,p)));
export const cancelProfiles=Object.fromEntries(['RF','LK','VC','RS','BM','IS'].map(id=>[id,read('packages/combat-core/'+id.toLowerCase()+'-profile.json')]));
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:p=>readFileSync(resolve(root,'artifacts/native',p))});
const samplers=new Map();
function sampler(id){
  if(samplers.has(id))return samplers.get(id);
  const folder=id==='RF'?'rf':id.toLowerCase(),prefix='artifacts/'+folder+'/',profile=cancelProfiles[id];
  const pose=read(prefix+'runtime-pose.json'),characterPose=composeCharacterPose(pose,pose.sharedPose?read(prefix+pose.sharedPose):null);
  const effectIndex=mergeEffectIndexes({templates:profile.effectTemplates},read(prefix+'fx/index.json'));
  const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(prefix+p)]));
  const result=createNativeSamplers({profile,characterPose,effectIndex,effectPoses});samplers.set(id,result);return result;
}
export function cancelAuditFixture(id,{skillId,followSkillId,facing=1,awake=false,air=false,preset={}}={}){
  const profile=cancelProfiles[id],production=read('config/'+id.toLowerCase()+'-preset.json');
  const sim=createSimulation({profile,map,seed:2016,preset:{...production,loadout:[skillId?{skillId,branchId:'none'}:null,
    followSkillId?{skillId:followSkillId,branchId:'none'}:null,...Array(6).fill(null)],...preset},
    actors:[{id:'actor',professionId:id,team:0,position:[0,air?3400:3080,0],lineId:air?null:2,facing},
      {id:'target',professionId:id,team:1,position:[2200,3080,0],lineId:2,facing:-1,loadout:Array(8).fill(null),passives:[],guildPassives:[]}],
    ...sampler(id),nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,
    nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,nativeNasod:native.nasod,versions:native.versions});
  const a=sim.actor('actor');a.mp=a.mpMax;
  if(awake){a.awakening.remaining=30;a.awakening.orbs=1;}
  return {sim,a,profile:sim.profileFor(a),map,native};
}
export const cancelAuditInput=(held=[],pressed=[],extra={})=>({held:new Set(held),pressed:new Set(pressed),...extra});

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {getProfessionProfile,getProfessionPreset} from '../../packages/professions/profiles.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
const root=resolve(import.meta.dirname,'../..');
const read=p=>JSON.parse(readFileSync(resolve(root,p)));
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:p=>readFileSync(resolve(root,'artifacts/native',p))});
const cached=new Map();
export function rollFixture(profession,{speed=1,facing=1,create=createSimulation}={}){
  const profile=getProfessionProfile(profession),preset=getProfessionPreset(profession),directory='artifacts/'+profession.toLowerCase();
  if(!cached.has(profession)){
    const rawPose=read(directory+'/runtime-pose.json');
    const characterPose=rawPose.sharedPose?composeCharacterPose(rawPose,read(directory+'/'+rawPose.sharedPose)):rawPose;
    const index=mergeEffectIndexes(read(directory+'/effect-assets.json'),read(directory+'/fx/index.json'));
    const effectPoses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(directory+'/'+p)]));
    cached.set(profession,createNativeSamplers({profile,map,characterPose,effectIndex:index,effectPoses}));
  }
  const sim=create({profile,map,preset:{...preset,guildPassives:[],attributes:{...preset.attributes,animationSpeedMultiplier:speed},
      loadout:[{skillId:21217,branchId:'none'},{skillId:21026,branchId:'none'},...Array(6).fill(null)]},seed:2016,
    actors:[{id:'actor',professionId:profession,team:0,position:[2022.98,2840,0],lineId:6,facing,passives:[],guildPassives:[]},
      {id:'target',professionId:profession,team:1,position:[2022.98+2000*facing,2840,0],lineId:6,facing:-facing,passives:[],guildPassives:[],loadout:Array(8).fill(null)}],
    ...cached.get(profession),nativeGeometry:native.geometry,nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeManaBreak:native.manaBreak});
  const a=sim.actor('actor');a.mp=a.mpMax;
  return {sim,a,profile,step(input={}){sim.step(1/60,{actor:input},{snapshot:false});}};
}
export function castRoll(f){f.step({pressed:['A'],held:['A']});}
export function until(f,p,max=360){for(let i=0;i<max&&!p();i++)f.step();if(!p())throw Error('Roll fixture stuck: '+f.a.state+' / '+f.a.animationTime);}

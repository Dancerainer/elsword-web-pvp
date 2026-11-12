/** Production Add profiles, source WASM and authored Garpai map. Resource-only
 * cases do not provide guessed attack shapes; pose tests install real samplers. */
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {PROFESSION_PROFILES,PROFESSION_PRESETS} from '../../packages/professions/profiles.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
export const addMap={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const commonBuffs=read('artifacts/common-buffs/catalog.json');
export const addNative=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map:addMap,loadBinary:p=>readFileSync(new URL('../../artifacts/native/'+p,import.meta.url))});
export function addFixture(id='LP',{skillId=null,passives=[],targetProfession=id,targetTeam=1,networkOwnerId=null,samplers={},branchId='none'}={}){
  const profile=PROFESSION_PROFILES[id],preset={...PROFESSION_PRESETS[id],guildPassives:[],passives};
  const sim=createSimulation({profile,profiles:PROFESSION_PROFILES,preset,presets:{[id]:preset},commonBuffs,map:addMap,seed:2016,networkOwnerId,
    actors:[{id:'add',professionId:id,team:0,position:[0,3080,0],lineId:2,facing:1,loadout:[skillId?{skillId,branchId}:null,...Array(7).fill(null)]},
      {id:'target',professionId:targetProfession,team:targetTeam,position:[250,3080,0],lineId:2,facing:-1,loadout:Array(8).fill(null),passives:[],guildPassives:[]}],
    nativeGeometry:addNative.geometry,nativeCommands:addNative.commands,nativeSkills:addNative.skills,nativeSkillValues:addNative.skillValues,nativeCritical:addNative.critical,nativeNasod:addNative.nasod,nativeManaBreak:addNative.manaBreak,
    ...samplers});
  const a=sim.actor('add'),b=sim.actor('target');return {sim,a,b,profile,preset};
}
export const tick=(sim,seconds,input={})=>{for(let i=0;i<Math.ceil(seconds*60);i++)sim.step(1/60,input);};

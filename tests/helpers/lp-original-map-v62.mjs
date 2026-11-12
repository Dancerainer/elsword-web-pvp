/** Alternate authored-map fixture. Native geometry is created for this exact
 * map before constructing combat; no Garpai collision replacement in flight. */
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {PROFESSION_PROFILES,PROFESSION_PRESETS} from '../../packages/professions/profiles.mjs';
import {originalAddSamplers} from './add-native-pose-fixture.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../artifacts/'+p,import.meta.url)));
const cache=new Map(),commonBuffs=read('common-buffs/catalog.json');
export async function lpOriginalMapFixture(sceneId,{networkOwnerId=null}={}){
 let input=cache.get(sceneId);
 if(!input){
  const map={...read('scene/'+sceneId+'/manifest.json'),...read('scene/'+sceneId+'/collision.json')};
  const native=await createNativeRuntime({manifest:read('native/manifest.json'),map,loadBinary:p=>readFileSync(new URL('../../artifacts/native/'+p,import.meta.url))});
  input={map,native};cache.set(sceneId,input);
 }
 const {map,native}=input,profile=PROFESSION_PROFILES.LP,preset={...PROFESSION_PRESETS.LP,guildPassives:[],passives:[]};
 const sim=createSimulation({profile,profiles:PROFESSION_PROFILES,preset,presets:{LP:preset},commonBuffs,map,seed:2016,networkOwnerId,
  actors:[{id:'add',professionId:'LP',team:0,position:[0,0,0],facing:1,loadout:Array(8).fill(null)},
   {id:'target',professionId:'LP',team:1,position:[250,0,0],facing:-1,loadout:Array(8).fill(null),passives:[],guildPassives:[]}],
  nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
  nativeCritical:native.critical,nativeNasod:native.nasod,nativeManaBreak:native.manaBreak,...originalAddSamplers('LP')});
 return {sim,a:sim.actor('add'),b:sim.actor('target'),profile,preset};
}

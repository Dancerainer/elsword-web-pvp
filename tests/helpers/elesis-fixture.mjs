/** Actual target poses/effects and original Garpai collision; web test fixture. */
import {addPlayerFeedbackVisuals} from '../../packages/combat-assets/player-feedback-visuals-v45.mjs';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
const root=resolve(import.meta.dirname,'../..'),assetRoot=resolve(process.env.ELESIS_ASSET_ROOT??resolve(root,'artifacts'));
const json=file=>JSON.parse(readFileSync(file,'utf8')),read=file=>json(resolve(assetRoot,file));
export const elesisMap={...read('scene/sander-garpai-rock-pvp/manifest.json'),...read('scene/sander-garpai-rock-pvp/collision.json')};
export const elesisNative=await createNativeRuntime({manifest:read('native/manifest.json'),map:elesisMap,loadBinary:p=>readFileSync(resolve(assetRoot,'native',p))});
const cache=new Map();
export function elesisAssets(id){
  if(cache.has(id))return cache.get(id);
  const folder=id.toLowerCase(),profile=json(resolve(root,`packages/combat-core/${folder}-profile.json`)),preset=json(resolve(root,`config/${folder}-preset.json`));
  const manifest=read(folder+'/manifest.json'),rawPose=read(folder+'/'+manifest.runtimePose);
  const characterPose=composeCharacterPose(rawPose,rawPose.sharedPose?read(folder+'/'+rawPose.sharedPose):null);
  const visual=addPlayerFeedbackVisuals(read(folder+'/fx/index.json'),id),effectIndex=mergeEffectIndexes(read(folder+'/'+(manifest.effectAssetIndex??'effect-assets.json')),visual);
  const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(folder+'/'+p)]));
  const assets={profile,preset,characterPose,effectIndex,effectPoses,
    samplers:createNativeSamplers({profile,characterPose,effectIndex,effectPoses})};cache.set(id,assets);return assets;
}
export function elesisFixture(id='GM',{skillId,passives=[],position=[-600,3080,0],gap=200,facing=1,seed=2016,branchId='none',guildPassives=[]}={}){
  const {profile,preset,samplers}=elesisAssets(id),native=elesisNative,map=elesisMap;
  skillId??=profile.skillCatalog.find(s=>s.topTier&&!s.passive&&s.supported&&s.skillId!==900)?.skillId;
  const sim=createSimulation({profile,map,preset:{...preset,loadout:[{skillId,branchId},...Array(7).fill(null)],passives,guildPassives},seed,
    actors:[{id:'elesis',professionId:id,team:0,position,lineId:2,facing},
      {id:'target',professionId:id,team:1,position:[position[0]+gap*facing,position[1],position[2]],lineId:2,facing:-facing,loadout:Array(8).fill(null),passives:[],guildPassives:[]}],
    ...samplers,nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeCritical:native.critical,nativeNasod:native.nasod,nativeManaBreak:native.manaBreak,versions:native.versions});
  // The runtime privately installs verified common/source closures. Owned
  // reference validation must use that actual frozen match profile.
  const a=sim.actor('elesis'),b=sim.actor('target');a.mp=a.mpMax;return {sim,a,b,profile:sim.profileFor(a),preset,map,native};
}

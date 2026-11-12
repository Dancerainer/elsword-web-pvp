/** V51 shares only parsed source inputs and sealed WASM bytes. Every simulated
 * owner, baseline calibration and canonical replay gets new sampler caches,
 * WASM instances/memory and simulation state. No runtime instance is shared. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
export {makeNativeSimulation,makeKeyboard,calibrateLkInputs} from './network-native-fixture-v38.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function loadLkNetworkAssets(root,assetRoot){
  const seals={},read=(base,file)=>{const data=readFileSync(resolve(base,file));seals[file]={sha256:sha(data),bytes:data.length};return JSON.parse(data);};
  const profile=read(root,'packages/combat-core/lk-profile.json'),preset=read(root,'config/lk-preset.json');
  const characterPose=read(assetRoot,'lk/runtime-pose.json'),effectIndex=read(assetRoot,'lk/fx/index.json');
  const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(assetRoot,'lk/'+p)]));
  const map={...read(assetRoot,'scene/sander-garpai-rock-pvp/manifest.json'),...read(assetRoot,'scene/sander-garpai-rock-pvp/collision.json')};
  const manifest=read(assetRoot,'native/manifest.json'),binaries=Object.fromEntries(Object.values(manifest.modules).map(({file})=>{
    const data=readFileSync(resolve(assetRoot,'native',file));seals['native/'+file]={sha256:sha(data),bytes:data.length};return [file,data];}));
  const data={profile,preset:{...preset,passives:[],guildPassives:[],loadout:Array(8).fill(null)},map,seals};
  return {...data,async isolated(version){
    const [{createNativeRuntime},{createNativeSamplers,mergeEffectIndexes}]=await Promise.all([
      import(pathToFileURL(resolve(version.root,'packages/native-source/runtime.mjs')).href),
      import(pathToFileURL(resolve(version.root,'packages/combat-assets/index.mjs')).href)]);
    const native=await createNativeRuntime({manifest,map,loadBinary:file=>binaries[file]});
    const samplers=createNativeSamplers({profile,characterPose,effectIndex:mergeEffectIndexes({templates:profile.effectTemplates},effectIndex),effectPoses});
    return {...data,samplers,options:{...samplers,nativeGeometry:native.geometry,nativeSkillValues:native.skillValues,
      nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:native.versions}};
  }};
}

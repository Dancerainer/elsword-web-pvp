/** Original 2016 body helpers/pose and real Garpai lines, not synthetic reach. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const assetRoot=process.env.LK_TEST_ASSETS_ROOT??resolve(root,'artifacts');
const read=p=>JSON.parse(readFileSync(p));
const profile=read(resolve(root,'packages/combat-core/lk-profile.json'));
const characterPose=read(resolve(assetRoot,'lk/runtime-pose.json'));
const map={...read(resolve(assetRoot,'scene/sander-garpai-rock-pvp/manifest.json')),...read(resolve(assetRoot,'scene/sander-garpai-rock-pvp/collision.json'))};
const effectIndex=read(resolve(assetRoot,'lk/fx/index.json'));
const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(resolve(assetRoot,'lk',p))]));
export async function lkCommandFixture({facing=1,gap=85,position=[0,3080,0],lineId=2,preset={}}={}){
  const native=await createNativeRuntime({manifest:read(resolve(assetRoot,'native/manifest.json')),map,loadBinary:p=>readFileSync(resolve(assetRoot,'native',p))});
  const sim=createSimulation({profile,map,seed:2016,preset:{loadout:Array(8).fill(null),guildPassives:[],doubleTapWindowSeconds:.4,...preset},
    actors:[{id:'lk',professionId:'LK',team:0,position,lineId,facing},{id:'target',professionId:'LK',team:1,
      position:[position[0]+facing*gap,position[1],position[2]],lineId,facing:-facing}],
    ...createNativeSamplers({profile,characterPose,effectIndex:mergeEffectIndexes({templates:profile.effectTemplates},effectIndex),effectPoses}),nativeGeometry:native.geometry,
    nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:native.versions});
  return {sim,profile,map,actor:sim.actor('lk'),target:sim.actor('target')};
}

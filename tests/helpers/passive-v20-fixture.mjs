import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {profile,preset as livePreset,index,poses,fixtureRoot} from './rf-passive-fixture-v12.mjs';
import {authoredEquipmentPreset} from './authored-equipment-v21.mjs';
const preset=authoredEquipmentPreset(livePreset);
const {createSimulation}=await import(process.env.RF_PASSIVE_V20_CORE_MODULE??new URL('../../packages/combat-core/index.mjs',import.meta.url));
const read=file=>JSON.parse(readFileSync(resolve(fixtureRoot,file)));
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
export {profile,preset};
export async function passiveFixture({passives=preset.passives,targetPassives=[],seed=30,attributes={},targetAttributes={}}={}){
 const nativeRoot=process.env.RF_EFFECTS_V13_NATIVE_ROOT??fixtureRoot;
 const n=await createNativeRuntime({manifest:JSON.parse(readFileSync(resolve(nativeRoot,'artifacts/native/manifest.json'))),map,loadBinary:file=>readFileSync(resolve(nativeRoot,'artifacts/native',file))});
 return createSimulation({profile,map,preset:{...preset,loadout:Array(8).fill(null)},
  actors:[{id:'rf',team:0,position:[2022.98,2840,0],lineId:6,facing:-1,passives,guildPassives:[],attributes},
   {id:'target',team:1,position:[1858.11,2840,0],lineId:6,facing:1,passives:targetPassives,guildPassives:[],mp:0,attributes:targetAttributes}],
  ...createNativeSamplers({profile,characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex:index,effectPoses:poses}),
  nativeGeometry:n.geometry,nativeCommands:n.commands,nativeSkills:n.skills,nativeSkillValues:n.skillValues,
  nativeNasod:n.nasod,nativeCritical:n.critical,nativeManaBreak:n.manaBreak,seed,versions:n.versions});
}
export function frames(s,n){for(let i=0;i<n;i++)s.step(1/60,{}, {snapshot:false});}

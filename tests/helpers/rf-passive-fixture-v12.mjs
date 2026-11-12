import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes,collectEffectPoseFiles} from '../../packages/combat-assets/effect-indexes.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
export const fixtureRoot=process.env.RF_FULL_SKILLS_FIXTURE_ROOT??project;
const read=file=>JSON.parse(readFileSync(resolve(file.startsWith('artifacts/')?fixtureRoot:project,file)));
export const profile=read('packages/combat-core/rf-profile.json');
export const preset=read('config/rf-preset.json');
// Historical source/callback fixtures isolate equipment and guild policy.
// Keep the live preset export for passive-v20-fixture: its40/23/23 options
// are tested separately against the requested v20 production attributes.
export const legacyFixturePreset={...preset,initialAwakeningGauge:0,formulaVersion:null,guildPassives:[],attributes:{hpMax:800000,mpMax:300,physicalAttack:1000,magicAttack:1000,
  animationSpeedMultiplier:1.3,moveSpeedMultiplier:1.3,jumpSpeedMultiplier:1.21,
  damageReduction:0,awakeningChargeBonus:0}};
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
export const visualIndex=mergeVisualEffectIndexes(read('artifacts/rf/fx/index.json'),read('artifacts/rf/buff-fx/index.json'),read('artifacts/rf/shadow-weapon-fx/index.json'),read('artifacts/rf/awakening-fx/index.json'),read('artifacts/rf/critical-fx/index.json'),read('artifacts/rf/core-shield-fx/index.json'),read('artifacts/rf/skill-fx-v11/index.json'),read('artifacts/rf/xx2x-fx/index.json'),read('contracts/rf-xxx-explosion-fx-v13.json'),read('contracts/rf-archenemy-start-fx-index-v17.json'));
export const index=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),visualIndex);
export const poses=Object.fromEntries(collectEffectPoseFiles(index,visualIndex).map(f=>[f,read('artifacts/rf/'+f)]));
export async function make({skillId=24203,passives=preset.passives,targetPassives=[],seed=2016,positions=[[2022.98,2840,0],[1858.11,2840,0]],targetHp=800000,profile:fixtureProfile=profile}={}){
  const nativeRoot=process.env.RF_EFFECTS_V13_NATIVE_ROOT??fixtureRoot;
  const n=await createNativeRuntime({manifest:JSON.parse(readFileSync(resolve(nativeRoot,'artifacts/native/manifest.json'))),map,loadBinary:file=>readFileSync(resolve(nativeRoot,'artifacts/native',file))});
  return createSimulation({profile:fixtureProfile,map,preset:{...legacyFixturePreset,loadout:[{skillId},null,null,null,null,null,null,null]},
    actors:[{id:'rf',team:0,position:positions[0],lineId:6,facing:-1,passives,guildPassives:[]},{id:'target',team:1,position:positions[1],lineId:6,facing:1,passives:targetPassives,guildPassives:[],attributes:{...legacyFixturePreset.attributes,hpMax:targetHp}}],
    ...createNativeSamplers({profile:fixtureProfile,characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex:index,effectPoses:poses}),
    nativeGeometry:n.geometry,nativeCommands:n.commands,nativeSkills:n.skills,nativeSkillValues:n.skillValues,
    nativeNasod:n.nasod,nativeCritical:n.critical,nativeManaBreak:n.manaBreak,seed,versions:n.versions});
}
export function frames(s,count,inputs={}){for(let i=0;i<count;i++)s.step(1/60,inputs,{snapshot:false});}

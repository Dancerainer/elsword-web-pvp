import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const assetRoot=resolve(process.argv[2]??root); // Optional readonly converted input from another verified task.
const read=p=>JSON.parse(readFileSync(p));
const profile=read(root+'/packages/combat-core/rf-profile.json'),preset=read(root+'/config/rf-preset.json');
preset.presetVersion='rf-command-v7-800k-30pct-fixture';
preset.attributes={...preset.attributes,hpMax:800000,animationSpeedMultiplier:1.3,moveSpeedMultiplier:1.3,jumpSpeedMultiplier:1.3};
const map=read(assetRoot+'/artifacts/scene/sander-garpai-rock-pvp/collision.json');
const fx=mergeVisualEffectIndexes(...['fx','buff-fx','shadow-weapon-fx'].map(p=>read(assetRoot+'/artifacts/rf/'+p+'/index.json')));
const effectIndex=mergeEffectIndexes(read(assetRoot+'/artifacts/rf/effect-assets.json'),fx);
const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(assetRoot+'/artifacts/rf/'+p)]));
const samplers=createNativeSamplers({characterPose:read(assetRoot+'/artifacts/rf/runtime-pose.json'),effectIndex,effectPoses,profile});
const native=await createNativeRuntime({manifest:read(root+'/artifacts/native/manifest.json'),map,loadBinary:p=>readFileSync(root+'/artifacts/native/'+p)});
const all=[];
for(const downHold of [true,false]){
  const s=createSimulation({profile,preset,map,...samplers,nativeGeometry:native.geometry,nativeCommands:native.commands,
    nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeEffectRandom:native.effectRandom,versions:{...native.versions},
    actors:[{id:'rf',team:0,x:-650,y:3800,z:0,lineId:4,facing:1},{id:'target',team:1,x:-480,y:3800,z:0,lineId:4,facing:-1}]});
  s.drainEvents();const initial=s.snapshot();
  const a=s.actor('rf'),b=s.actor('target'),inputs=[],events=[];
  const step=(input={})=>{inputs.push(input);s.step(1/60,input,{snapshot:false});events.push(...s.drainEvents().filter(e=>['stateChanged','hit','landed','knockdownTriggered'].includes(e.type)).map(e=>({...e,attacker:{x:a.x,y:a.y,state:a.state,animationTime:a.animationTime},victim:{x:b.x,y:b.y,state:b.state,vy:b.vy,grounded:b.grounded}})));};
  const until=(fn,input={},max=240)=>{let n=0;while(!fn()&&n++<max)step(input);return n<=max;};
  step({pressed:['Z']});
  for(let cycle=0;cycle<3;cycle++){
    for(const [state,at,key,next] of [['RSI_COMBO_Z',.28,'Z','RSI_COMBO_ZZ'],['RSI_COMBO_ZZ',.38,'X','RSI_COMBO_ZZX'],['RSI_COMBO_ZZX',.59,'X','RSI_COMBO_ZZXX']]){
      until(()=>a.state===state&&a.animationTime>=at);step({pressed:[key]});until(()=>a.state===next);
    }
    until(()=>a.animationTime>=.6);step({pressed:['UP'],held:['UP']});
    step({pressed:['DOWN'],held:['DOWN']});step({pressed:['X'],held:['DOWN']});
    until(()=>a.grounded,downHold?{held:['DOWN']}:{},240);step({pressed:['Z']});
    until(()=>a.state==='RSI_COMBO_Z');
  }
  all.push({kind:'current-simulation-observation-not-native2016',downHold,presetFixture:preset.attributes,inputSteps:inputs.length,inputs,initial,finalSnapshot:s.snapshot(),
    hits:events.filter(e=>e.type==='hit').map(e=>({time:e.time,origin:e.origin,victim:e.victim})),events,
    final:{rf:{x:a.x,y:a.y,hp:a.hp,state:a.state},target:{x:b.x,y:b.y,hp:b.hp,state:b.state}},originalExpectations:null});
}
writeFileSync(root+'/reports/rf-loop-implementation-observations-v7.json',JSON.stringify(all,null,2)+'\n');
for(const r of all)console.log(JSON.stringify({downHold:r.downHold,steps:r.inputSteps,hits:r.hits.length,hitStates:r.hits.map(e=>e.victim.state),final:r.final}));

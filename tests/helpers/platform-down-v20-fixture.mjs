import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {collectEffectPoseFiles,mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {downSupportReaction} from '../../packages/combat-core/down-support.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),fixtures=process.env.RF_FULL_SKILLS_FIXTURE_ROOT??root;
const read=p=>JSON.parse(readFileSync(resolve(p.startsWith('artifacts/')?fixtures:root,p)));
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const fx=mergeVisualEffectIndexes(...['fx','buff-fx','shadow-weapon-fx','awakening-fx','core-shield-fx','critical-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17'].map(p=>read('artifacts/rf/'+p+'/index.json')));
const index=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),fx),poses=Object.fromEntries(collectEffectPoseFiles(index).map(f=>[f,read('artifacts/rf/'+f)]));
const samplers=createNativeSamplers({profile,characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex:index,effectPoses:poses});
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:f=>readFileSync(resolve(fixtures,'artifacts/native',f))});
export const clone=v=>JSON.parse(JSON.stringify(v));
export function makePlatformDown({facing=1,back=false,pickup=false}={}){
  const s=createSimulation({profile,preset,map,...samplers,nativeGeometry:native.geometry,nativeCommands:native.commands,
    nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,seed:2016,versions:native.versions,
    actors:[{id:'rf',team:0,position:[facing*700,3800,0],lineId:4,facing},
      {id:'target',team:1,position:[facing*785,3800,0],lineId:4,facing:back?facing:-facing},
      ...(pickup?[{id:'pickup',team:0,position:[facing*1050,3560,0],lineId:facing===1?9:10,facing:-facing}]:[])]});
  // Root owns index.mjs. This opt-in is solely a temporary source-hook fixture
  // for the isolated agent; production integration tests run with it absent.
  if(process.env.RF_PLATFORM_DOWN_CANDIDATE_HOOK==='1'){
    const original=s.processInput.bind(s);s.processInput=(a,k)=>{
      const next=downSupportReaction(a.state,{grounded:a.grounded,lineRadius:profile.referenceSemantics.lineRadius});
      if(next){s.enter(a,next.state,'source-down-lost-support');a.y=Math.fround(Math.fround(a.y)+next.offsetY);return;}
      original(a,k);
    };
  }
  return s;
}
export function platformTimeline({pickup=false}={}){
  return Array.from({length:180},(_,i)=>({rf:i===0?{pressed:['DOWN'],held:['DOWN']}:i===1?{pressed:['X'],held:['DOWN']}:{},
    ...(pickup?{pickup:i===15?{pressed:['Z']}:{}}:{})}));
}
export function runPlatform(options={}){
  const s=makePlatformDown(options),timeline=platformTimeline(options),frames=[],reactions=[];
  const hit=s.applyHit.bind(s);s.applyHit=(a,b,d,o)=>{const before=clone(b);const result=hit(a,b,d,o);
    if(result.accepted&&b.id==='target')reactions.push({attacker:a.id,time:s.state.time,before,after:clone(b),data:clone(d)});return result;};
  for(const input of timeline){s.step(1/60,input,{snapshot:false});const b=s.actor('target');frames.push({input:clone(input),target:clone(b)});}
  return {s,timeline,frames,reactions};
}

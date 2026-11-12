/** Original profile/pose/body samples on authored Garpai; all inputs are Web
 * simulation fixtures, not a captured original-client command trajectory. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {createSampledKeyboardBuffer} from '../../apps/web/sampled-keyboard.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function loadLkNetworkAssets(root,assetRoot){
  const seals={},read=(base,file)=>{const data=readFileSync(resolve(base,file));seals[file]={sha256:sha(data),bytes:data.length};return JSON.parse(data);};
  const profile=read(root,'packages/combat-core/lk-profile.json'),preset=read(root,'config/lk-preset.json');
  const characterPose=read(assetRoot,'lk/runtime-pose.json'),effectIndex=read(assetRoot,'lk/fx/index.json');
  const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(assetRoot,'lk/'+p)]));
  const map={...read(assetRoot,'scene/sander-garpai-rock-pvp/manifest.json'),...read(assetRoot,'scene/sander-garpai-rock-pvp/collision.json')};
  const manifest=read(assetRoot,'native/manifest.json'),native=await createNativeRuntime({manifest,map,loadBinary:file=>{
    const data=readFileSync(resolve(assetRoot,'native',file));seals['native/'+file]={sha256:sha(data),bytes:data.length};return data;}});
  const samplers=createNativeSamplers({profile,characterPose,effectIndex:mergeEffectIndexes({templates:profile.effectTemplates},effectIndex),effectPoses});
  return {profile,preset:{...preset,passives:[],guildPassives:[],loadout:Array(8).fill(null)},map,samplers,seals,
    options:{...samplers,nativeGeometry:native.geometry,nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:native.versions}};
}
export function makeNativeSimulation(version,assets,{owner=null,facing=1,gap=85,observer=false}={}){
  const actors=[{id:'a',professionId:'LK',team:0,position:[0,3080,0],lineId:2,facing},
    {id:'b',professionId:'LK',team:1,position:[gap*facing,3080,0],lineId:2,facing:-facing}];
  if(observer)actors.push({id:'observer',professionId:'LK',team:2,position:[-1800,3080,0],lineId:2,facing:1});
  const sim=version.simulation.createSimulation({profile:assets.profile,preset:assets.preset,map:assets.map,seed:2016,networkOwnerId:owner,...assets.options,actors});
  for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','initial network fixture');}sim.drainEvents();return sim;
}
export function makeKeyboard(){
  const keyboard=createSampledKeyboardBuffer();let held=[];
  return (desired,frame)=>{const time=(frame-1)/60+.001;for(const key of held)if(!desired.includes(key))keyboard.up(key,time);for(const key of desired)if(!held.includes(key))keyboard.down(key,time);
    held=[...desired];return keyboard.consume(frame/60,1/60);};
}
/** Adaptive calibration runs once against the fixed baseline. Every compared
 * network run receives the resulting frozen sampled-device packets. */
export function calibrateLkInputs(version,assets,{facing=1,gap=85,delay=5}={}){
  const sim=makeNativeSimulation(version,assets,{facing,gap}),actor=sim.actor('a'),target=sim.actor('b'),keyboard=makeKeyboard(),inputs=[],trace=[],hits=[];
  const forward=facing>0?'RIGHT':'LEFT';let frame=0;
  const step=(desired=[])=>{const packet=keyboard(desired,++frame);inputs.push(packet);sim.step(1/60,{a:packet},{snapshot:false});
    hits.push(...sim.drainEvents().filter(e=>e.type==='hit').map(e=>({frame,...e,sourceState:actor.state,targetState:target.state})));
    trace.push({frame,source:{state:actor.state,x:actor.x,y:actor.y},target:{state:target.state,x:target.x,y:target.y}});};
  const until=(fn,desired=[])=>{let count=0;while(!fn()&&count++<180)step(desired);assert.ok(fn(),'LK real input timed out at '+actor.state);};
  step([forward]);step();step([forward]);step([forward,'X']);step();until(()=>actor.animationTime>=.5);step(['UP']);until(()=>actor.state==='RSI_JUMP_UP',['UP']);
  for(let i=1;i<delay;i++)step(['UP',forward]);step(['DOWN',forward]);step(['DOWN',forward,'X']);until(()=>actor.grounded,['DOWN',forward]);step(['Z']);for(let i=0;i<100;i++)step();
  assert.deepEqual(hits.map(row=>row.sourceState),['RSI_DASH_COMBO_X','RSI_JUMP_COMBO_X','RSI_COMBO_Z']);
  assert.equal(hits[0].targetState,'RSI_DAMAGE_AIR_UP');assert.equal(hits[1].targetState,'RSI_DAMAGE_AIR_DOWN');assert.match(hits[2].targetState,/^RSI_DAMAGE_SMALL_/);
  return {facing,gap,delay,inputs,hits,trace,inputSha256:sha(JSON.stringify(inputs))};
}

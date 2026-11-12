/** Each profession loads its own original body/pose/effect closure. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
const root=resolve(import.meta.dirname,'../..'),json=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const map={...json('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...json('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const native=await createNativeRuntime({manifest:json('artifacts/native/manifest.json'),map,loadBinary:p=>readFileSync(resolve(root,'artifacts/native',p))});
const cache=new Map(),dt=1/60;
function assets(profession){
 if(cache.has(profession))return cache.get(profession);
 const folder=profession.toLowerCase(),profile=json(`packages/combat-core/${folder}-profile.json`),pose=json(`artifacts/${folder}/runtime-pose.json`),
  characterPose=composeCharacterPose(pose,pose.sharedPose?json(`artifacts/${folder}/${pose.sharedPose}`):null),
  effectIndex=mergeEffectIndexes(json(`artifacts/${folder}/effect-assets.json`),json(`artifacts/${folder}/fx/index.json`)),
  effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,json(`artifacts/${folder}/${p}`)])),
  samplers=createNativeSamplers({profile,characterPose,effectIndex,effectPoses});
 const result={profile,samplers};cache.set(profession,result);return result;
}
export function commonAirFixture(profession,facing,{high=false,gap=85}={}){
 const {profile,samplers}=assets(profession),position=high?[700*facing,3800,0]:[0,3080,0],lineId=high?4:2;
 const sim=createSimulation({profile,map,seed:2016,preset:{loadout:Array(8).fill(null),passives:[],guildPassives:[],doubleTapWindowSeconds:.4},
  actors:[{id:'player',professionId:profession,team:0,position,lineId,facing,passives:[],guildPassives:[]},
   {id:'target',professionId:profession,team:1,position:[position[0]+gap*facing,position[1],position[2]],lineId,facing:-facing,passives:[],guildPassives:[],loadout:Array(8).fill(null)}],
  ...samplers,nativeGeometry:native.geometry,nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeManaBreak:native.manaBreak});
 const a=sim.actor('player'),b=sim.actor('target'),buffer=createInputBuffer({sampledLevels:true}),packets=[],clocks=[];
 const step=()=>{const input=buffer.consume(sim.state.time+dt);packets.push(input);sim.step(dt,{player:input},{snapshot:false});clocks.push({state:a.state,serial:a.stateSerial,
  animationTime:a.animationTime,stopped:a.animationStopped,grounded:a.grounded,position:[a.x,a.y,a.z],targetHp:b.hp});};
 const edge=(key,on)=>{buffer[on?'down':'up'](key,sim.state.time+.001);step();},tap=key=>{edge(key,true);edge(key,false);};
 const until=(predicate,max=240)=>{for(let n=0;n<max&&!predicate();n++)step();if(!predicate())throw new Error(`${profession}: timed out at${a.state}@${a.animationTime}`);};
 return {sim,a,b,profile,samplers,packets,clocks,step,edge,tap,until};
}
export function runCommonAir(profession,facing,{kind='high-X',key='X',dash=false}={}){
 const high=kind==='high-X'||kind==='neighbor',f=commonAirFixture(profession,facing,{high,gap:kind==='contact-X'?85:-1300}),{sim,a,b,profile}=f,
  initialHp=b.hp,initialSamplers=f.samplers.actorSamplingStats();
 f.step();const forward=facing>0?'RIGHT':'LEFT';
 if(high){if(dash)f.tap(forward);f.edge(forward,true);}
 f.tap('UP');
 // Contact-X uses a real descending jump; this independently fixed input
 // timing hits the original standing target with the original sword helpers.
 for(let n=0;n<(kind==='contact-X'?20:4);n++)f.step();f.tap(key);
 const attackState=dash?(key==='X'?'RSI_DASH_JUMP_COMBO_X':'RSI_DASH_JUMP_COMBO_Z'):(key==='X'?'RSI_JUMP_COMBO_X':'RSI_JUMP_COMBO_Z');
 f.until(()=>a.state===attackState);const serial=a.stateSerial;
 for(let n=0;n<180;n++)f.step();
 const events=sim.state.events.filter(e=>e.actorId===a.id),hits=events.filter(e=>e.type==='hit'&&e.targetId===b.id),
  characterHits=hits.filter(e=>e.origin?.kind==='character'&&e.origin.state===attackState),raw=profile.states[attackState].raw;
 return {profession,actualUnitClass:sim.profileFor(a).target.unitClass,facing,kind,key,dash,attackState,serial,rawPlayType:raw.PLAY_TYPE,period:profile.states[attackState].clip.durationSeconds,
  characterHits:characterHits.map(e=>({amount:e.amount,data:e.data,origin:e.origin})),totalPlayerHits:hits.length,
  hpBefore:initialHp,hpAfter:b.hp,damageEvents:characterHits.reduce((sum,e)=>sum+e.amount,0),states:events.filter(e=>e.type==='stateChanged').map(e=>e.state),
  actualJump:events.filter(e=>e.type==='jump'),finalState:a.state,finalGrounded:a.grounded,packets:f.packets,clocks:f.clocks,
  samplerEvaluations:f.samplers.actorSamplingStats().evaluations-initialSamplers.evaluations};
}

import profile from '../combat-core/rf-profile.json' with {type:'json'};
import preset from '../../config/rf-preset.json' with {type:'json'};
import {Simulation} from '../combat-core/index.mjs';
import {createNativeRuntime} from '../native-source/runtime.mjs';
import {createNativeSamplers} from '../combat-assets/index.mjs';
import {MinimalSimulation} from './simulation.mjs';
import {loadMinimalNative} from './native.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';

export async function createExperiment({json,binary,mode='source'}){
 if(!['source','baseline'].includes(mode))throw Error('Unknown experiment mode');
 const [mapManifest,collision,characterPose,effectIndex,manifest,minimalManifest,build]=await Promise.all([
  json('scene/sander-garpai-rock-pvp/manifest.json'),json('scene/sander-garpai-rock-pvp/collision.json'),
  json('rf/runtime-pose.json'),json('minimal/effect-index.json'),json('native/manifest.json'),json('minimal/manifest.json'),json('minimal/build.json')]);
 const effectPoses=Object.fromEntries(await Promise.all([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(async p=>[p,await json('rf/'+p)])));
 const map={...mapManifest,...collision};
 const native=await createNativeRuntime({manifest,map,loadBinary:p=>binary('native/'+p)});
 const minimal=await loadMinimalNative(minimalManifest,p=>binary('minimal/'+p));
 const device=minimal.createDevice(),legacy=createInputBuffer();
 const p={...preset,presetVersion:'rf-minimal-comparison-v1',loadout:Array(8).fill(null),passives:[],awakeningEnabled:false,ravenCoreEnabled:false};
 const spawns=map.spawns.filter(s=>s.kind==='SetTeamStartPos').slice(0,2);
 const actors=spawns.map((s,i)=>({id:`player-${i+1}`,team:i,position:s.position,lineId:s.lineId,
   facing:i===0?(s.facingRight?1:-1):(spawns[0].facingRight?-1:1),passives:[]}));
 const samplers=createNativeSamplers({characterPose,effectIndex,effectPoses,profile});
 const Sim=mode==='source'?MinimalSimulation:Simulation;
 const sim=new Sim({profile,map,preset:p,actors,seed:2016,...samplers,nativeGeometry:native.geometry,nativeCommands:native.commands,
   movement:minimal.movement,versions:{...native.versions,...build,minimalInput:minimalManifest.modules.input.sha256,
    minimalMovement:minimalManifest.modules.movement.sha256,experimentMode:mode}});
 let frames=[],rawEdges=[],events=[];
 sim.drainEvents();
 const initial=sim.snapshot(),startDevice=device.snapshot();
 function enqueue(key,down,time){if(!['LEFT','RIGHT','UP','DOWN','Z'].includes(key))throw Error('Outside minimal input scope');
   device.enqueue(key,down,time);legacy[down?'down':'up'](key,time/1000);rawEdges.push({key,down,time});}
 function step(time,{targetAttack=false}={}){
   const nativePacket=device.sample(time,1/60),packet=mode==='source'?{
     ...nativePacket,sampledDevice:true,
     pureDouble:[...(nativePacket.pureDoubleLeft?['LEFT']:[]),...(nativePacket.pureDoubleRight?['RIGHT']:[])],
   }:legacy.consume(time/1000);
   if(mode==='source')legacy.consume(time/1000); // bounded A/B comparison queue
   const accepted=structuredClone(packet),a=sim.actor('player-1');
   // Scope control shared by BOTH candidates: no X, skill, awakening or follow-up attacks.
   if(!['RSI_WAIT','RSI_WALK'].includes(a.state)){accepted.pressed=accepted.pressed.filter(k=>k!=='Z');accepted.held=accepted.held.filter(k=>k!=='Z');}
   const target={held:targetAttack?['Z']:[],pressed:targetAttack?['Z']:[],released:[],...(mode==='source'?{sampledDevice:true,pureDouble:[]}:{})};
   sim.step(1/60,{'player-1':accepted,'player-2':target},{snapshot:false});
   const emitted=sim.drainEvents();events.push(...emitted);frames.push({time,inputs:{'player-1':accepted,'player-2':target}});
   return {packet:accepted,events:emitted};
 }
 return {sim,device,map,characterPose,profile,mode,enqueue,step,
   trace:()=>({schema:'rf-minimal-experiment-v1',evidence:'simulation-implementation; not target2016 ground truth',mode,
     versions:sim.versions,initial,rawEdges,frames,events,final:sim.snapshot(),deviceFinal:device.snapshot()}),
   reset(){sim.restore(initial);sim.drainEvents();device.restore(startDevice);legacy.clear();frames=[];rawEdges=[];events=[];},
 };
}

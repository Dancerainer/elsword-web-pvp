import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {instantiateNativeSkills} from '../../packages/native-source/skills.mjs';
import {makeArc,read,project,profile,samplers,poses} from './archenemy-v17-fixture.mjs';
export {read,project,profile,samplers,poses};
export const impactIndex=read('contracts/rf-archenemy-hit-fx-index-v19.json');
export const audioManifest=read('artifacts/audio/manifest.json');
export const newSkillsPath=resolve(project,'.cache/native-archenemy-skills-v19/skills.wasm');
export const json=value=>JSON.parse(JSON.stringify(value));
// Explicit candidate overlay: old ten-module immutable input still supplies
// nine retained binaries. Only skills is replaced by this task's rebuilt
// source module; root separately seals that exact pair for production.
export async function makeChain({facing=1,hyper=false,far=false}={}){
  const s=await makeArc(facing);
  s.nativeSkills=await instantiateNativeSkills(readFileSync(newSkillsPath));
  if(s.nativeSkills.contract.callbackGroupCount!==70)throw Error('ArcEnemy HYPER callback missing');
  s.configureLoadout([{skillId:24008},{skillId:24204},{skillId:24025},null,null,null,null,null],'rf');
  s.actor('rf').awakening.orbs=hyper?3:0;
  if(far)s.actor('target').x+=420*facing;
  return s;
}

export function inputTimeline({facing=1,hyper=false,far=false,air=false,trigger='melee'}={}){
  const frames=[];
  const push=(input,n=1)=>{for(let i=0;i<n;i++)frames.push(json(input));};
  if(hyper){push({pressed:['AWAKEN']});push({},90);}
  push({pressed:['A']});push({},180);
  if(far)push({held:[facing>0?'RIGHT':'LEFT']},40);
  if(air)push({rf:{held:['UP']},target:{held:['UP']}},12);
  push({pressed:[trigger==='active'?'S':trigger==='special'?'D':'Z']});push({},150);
  return frames.map((input,index)=>({index,time:(index+1)/60,dt:1/60,input}));
}

export async function runChain(options={},onStep=()=>{}){
  const s=await makeChain(options),timeline=inputTimeline(options),frames=[],reactions=[];
  let cursor=0;
  for(const frame of timeline){
    s.step(frame.dt,frame.input,{snapshot:false});
    const events=s.state.events.slice(cursor);cursor=s.state.events.length;
    for(const e of events)if(e.type==='hit'&&e.origin.skillId===24008){
      const b=s.actor(e.targetId);reactions.push({eventId:e.eventId,time:e.time,state:b.state,stateSerial:b.stateSerial,
        animation:b.animationName,animationTime:b.animationTime,hitStop:b.hitStop,worldStop:b.worldStop,
        position:[b.x,b.y,b.z],landPosition:json(b.landPosition),heightAboveLand:b.y-b.landPosition[1],velocity:[b.vx,b.vy],hit:json(e)});
    }
    onStep(s,events,frame);
    frames.push({time:s.state.time,input:frame.input,rf:{state:s.actor('rf').state,position:[s.actor('rf').x,s.actor('rf').y,s.actor('rf').z]},
      target:{state:s.actor('target').state,stateSerial:s.actor('target').stateSerial,animation:s.actor('target').animationName,
        animationTime:s.actor('target').animationTime,position:[s.actor('target').x,s.actor('target').y,s.actor('target').z],
        velocity:[s.actor('target').vx,s.actor('target').vy],hitStop:s.actor('target').hitStop,worldStop:s.actor('target').worldStop},
      owned:s.actor('rf').sourceArcEnemy?.data.length??0,
      effects:s.state.effects.filter(e=>e.sourceArcHandle||e.sourceArcStartMesh).map(e=>({id:e.id,name:e.name,
        position:(e.currentAnchor??e.birthAnchor)?.position,animationTime:e.animationTime,globalTime:e.sourceArcGlobalTime,
        speed:e.initialDirSpeed,life:e.meshLifetimeElapsed,attackTime:[e.damage?.ATTACK_TIME_START,e.damage?.ATTACK_TIME_END]})),events:json(events)});
  }
  return {s,timeline,frames,reactions};
}

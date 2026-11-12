import {ADD_FURY_DRONE,addLinkedDefinition} from './add-linked-effect-state.mjs';
import {assignAddFuryTargets} from './add-fury.mjs';
export const ADD_COMMAND_FURY_BEAM='DamageEffect_ANSI_AMM_COMBO_ZZXX';
const f=Math.fround;
const alive=b=>b?.hp>0&&!b.pvpDead&&!b.pvpDisconnected;
function stop(sim,a,e){if(!e.dead){e.dead=true;e.endEmitted=true;sim.emit('effectEnded',a.id,{effectId:e.id,reason:'mm-command-fury-ended'});}}
const move=(e,position,rotation)=>{e.currentAnchor={...(e.currentAnchor??e.birthAnchor),position:[...position],rotation:[...rotation]};[e.x,e.y,e.z]=position;};
const aim=(from,to)=>{const d=to.map((n,i)=>n-from[i]),len=Math.hypot(...d);return len?[0,Math.atan2(-d[2],d[0])*180/Math.PI,Math.asin(d[1]/len)*180/Math.PI]:[0,0,0];};
/** Native238's .2 received event. Native129 ZZZX never calls this producer. */
export function startAddCommandFury(sim,a){
 if(a.professionId!=='MM')return false;
 for(let index=0;index<3;index++){
  const point=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Weapon0'+(index+3)}},a,{profile:sim.profileFor(a)})?.position;
  if(!point){sim.note('mm-command-fury-source-bone:'+index,'Original Weapon03/04/05 source bones required',a);continue;}
  const e=sim.createEffect({...a,skillId:null,skillContext:null},{NAME:ADD_FURY_DRONE},{birthAnchor:{position:[...point],facing:a.facing,rotation:[0,a.facing<0?180:0,0]}});
  if(e)e.sourceAddFury={kind:'command',role:'drone',index,group:a.stateSerial,targetId:null,timer:0,...(index===0?{remaining:f(1.75),activeElapsed:0,anchor:[a.x,a.y,a.z]}:{})};
 }
 return true;
}
export function tickAddCommandFury(sim,a,dt){
 if(a.professionId!=='MM')return;
 const all=sim.state.effects.filter(e=>e.ownerId===a.id&&e.sourceAddFury?.kind==='command'&&!e.dead);
 for(const leader of all.filter(e=>e.sourceAddFury.role==='drone'&&e.sourceAddFury.index===0)){
  const s=leader.sourceAddFury,entries=all.filter(e=>e.sourceAddFury.group===s.group),drones=entries.filter(e=>e.sourceAddFury.role==='drone').sort((x,y)=>x.sourceAddFury.index-y.sourceAddFury.index);
  s.remaining=f(Math.max(0,s.remaining-dt));
  if(!alive(a)||!(a.sourceAdd?.dp>0)||s.remaining<=0){for(const e of entries)stop(sim,a,e);continue;}
  const candidates=sim.state.actors.map((b,index)=>({b,index,d:Math.hypot(b.x-s.anchor[0],b.y-s.anchor[1],b.z-s.anchor[2])})).filter(r=>alive(r.b)&&r.b.id!==a.id&&r.b.team!==a.team&&r.d<=750).sort((x,y)=>x.d-y.d||x.index-y.index).map(r=>r.b),ready=[];
  for(const drone of drones){
   const q=drone.sourceAddFury,target=sim.state.actors.find(b=>b.id===q.targetId&&b.team!==a.team&&alive(b)&&!b.invincible&&!(b.forceInvincible>0));
   const point=target&&(sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},target,{profile:sim.profileFor(target)})?.position??[target.x,target.y,target.z]);
   const position=(drone.currentAnchor??drone.birthAnchor).position,valid=point&&Math.hypot(...point.map((n,i)=>n-position[i]))<=700;
   let beam=entries.find(e=>e.sourceAddFury.role==='beam'&&e.sourceAddFury.index===q.index&&!e.dead);
   if(valid){
    move(drone,position,aim(position,point));const muzzle=sim.effectBoneSampler?.(drone,a,'Dummy01');
    if(muzzle){if(!beam){beam=sim.createEffect({...a,skillId:null,skillScale:drone.powerMultiplier,skillContext:null},{NAME:ADD_COMMAND_FURY_BEAM},{birthAnchor:{position:[...muzzle],facing:a.facing,rotation:aim(muzzle,point)}});if(beam)beam.sourceAddFury={kind:'command',role:'beam',index:q.index,group:q.group,targetId:target.id};}
     if(beam){beam.sourceAddFury.targetId=target.id;move(beam,muzzle,aim(muzzle,point));beam.sourceAddLinkScale=Math.hypot(...point.map((n,i)=>n-muzzle[i]))/950||Number.EPSILON;beam.definition=addLinkedDefinition(sim.profileFor(a),beam,beam.definition);}
    }
   }else if(beam)stop(sim,a,beam);
   q.timer=f(Math.max(0,q.timer-dt));if(!valid&&q.timer<=0){ready.push(q);q.timer=f(.5);}
  }
  assignAddFuryTargets(drones.map(e=>e.sourceAddFury),ready,candidates);
 }
}

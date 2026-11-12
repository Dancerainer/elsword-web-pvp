/** Target2016 32768200/32768510/32767260 installation driver.
 * Three ordinary records, fourth mutation record, and shared attempt budget. */
import {ADD_FURY_DRONE,ADD_FURY_BEAM,addLinkedDefinition} from './add-linked-effect-state.mjs';
import {tickAddCommandFury} from './add-command-fury-2016.mjs';
import {addInstallationFactoryActor2016} from './add-installation-power-2016.mjs';
const f=Math.fround;
function end(sim,a,e){e.dead=true;e.endEmitted=true;sim.emit('effectEnded',a.id,{effectId:e.id,reason:'add-ultimate-fury-ended'});}
function rows(sim,a){return sim.state.effects.filter(e=>e.ownerId===a.id&&e.sourceAddFury&&e.sourceAddFury.kind!=='command'&&!e.dead);}
function clear(sim,a,entries=rows(sim,a)){for(const e of entries)end(sim,a,e);}
function move(effect,position,rotation){effect.currentAnchor={...(effect.currentAnchor??effect.birthAnchor),position:[...position],rotation:[...rotation]};[effect.x,effect.y,effect.z]=position;}
function aim(from,to){const d=to.map((n,i)=>n-from[i]),length=Math.hypot(...d);return length?[0,Math.atan2(-d[2],d[0])*180/Math.PI,Math.asin(Math.max(-1,Math.min(1,d[1]/length)))*180/Math.PI]:[0,0,0];}
export function assignAddFuryTargets(drones,ready,candidates){
 for(let i=0;i<ready.length;i++){
  const row=ready[i];
  if(candidates.length===0)row.targetId=null;
  else if(candidates.length===1)row.targetId=candidates[0].id;
  else if(candidates.length===2){
   let found=false;
   // The native nested loop deliberately has no break: each free candidate
   // overwrites this row, and later ready rows see that new assignment.
   for(const candidate of candidates)if(!drones.some(d=>d.targetId===candidate.id)){row.targetId=candidate.id;found=true;}
   if(!found)row.targetId=candidates[0].id;
  }else if(i<candidates.length)row.targetId=candidates[i].id;
 }
}
export function startAddFury(sim,a,{consumeMutation}={}){
 clear(sim,a);const skill=sim.profileFor(a).skillCatalog.find(s=>s.skillId===29017);
 const factoryActor=addInstallationFactoryActor2016(a);
 const max=skill.raw.SA_MUTATION_CONSUME_MAX_COUNT?.[skill.maxLevel]??3;
 let count=3;if(a.sourceAdd?.formation&&a.sourceAdd.mutation>=max&&typeof consumeMutation==='function'){
  if(consumeMutation(a,max,{profile:sim.profileFor(a),emit:(...args)=>sim.emit(...args)})===max)count=4;
 }
 for(let index=0;index<count;index++){
  const e=sim.createEffect(factoryActor,{NAME:ADD_FURY_DRONE},{birthAnchor:{position:[a.x,a.y,a.z],facing:a.facing,rotation:[0,a.facing<0?180:0,0]}});
  if(e)e.sourceAddFury={role:'drone',index,group:a.stateSerial,targetId:null,timer:0,...(index===0?{remaining:skill.raw.SA_EFFECTIVE_TIME[skill.maxLevel],activeElapsed:0}:{})};
 }
}
export function tickAddFury(sim,a,dt){
 tickAddCommandFury(sim,a,dt);
 if(a.professionId!=='MM')return;const entries=rows(sim,a),drones=entries.filter(e=>e.sourceAddFury.role==='drone').sort((a,b)=>a.sourceAddFury.index-b.sourceAddFury.index),leader=drones.find(e=>e.sourceAddFury.index===0);
 if(!leader){if(entries.length)clear(sim,a,entries);return;}
 const profile=sim.profileFor(a),skill=profile.skillCatalog.find(s=>s.skillId===29017),s=leader.sourceAddFury;
 if(a.hp<=0||a.sourceAdd?.dp<=0||!a.sourceAdd?.generator){clear(sim,a,entries);return;}
 // Original driver waits for the actual factory mesh. A replacement owner
 // position cannot substitute for its three source attachment bones.
 const follower=sim.state.effects.find(e=>e.ownerId===a.id&&['DAMAGE_EFFECT_Drone_Activator_Generate','DAMAGE_EFFECT_Ultimate_Fury_Generate','DAMAGE_EFFECT_Shooting_Chaser_Generate','DAMAGE_EFFECT_Star_Fall_Generate'].includes(e.name)&&!e.dead);
 if(!follower){sim.note('add-fury-follower','Original Ultimate Fury follower mesh required',a);return;}
 s.remaining=Math.max(0,f(s.remaining-dt));
 if(s.remaining<=0||s.activeElapsed>=skill.raw.SA_DAMAGE_TIME[skill.maxLevel]){clear(sim,a,entries);return;}
 const range=skill.raw.SA_SCOPE_ABS_PVP[skill.maxLevel];
 const candidates=sim.state.actors.map((b,i)=>({b,i,d:Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)})).filter(({b,d})=>b.id!==a.id&&b.team!==a.team&&b.hp>0&&!b.pvpDead&&!b.pvpDisconnected&&d<=range).sort((x,y)=>x.d-y.d||x.i-y.i).slice(0,3).map(x=>x.b);
 const ready=[];
 for(const drone of drones){
  const q=drone.sourceAddFury,index=q.index,position=sim.effectBoneSampler?.(follower,a,'AttackDummy0'+(index+1));
  if(!position){sim.note('add-fury-follower-bone:'+index,'Original factory attachment bone unavailable',a);continue;}
  const shot=entries.find(e=>e.sourceAddFury.role==='beam'&&e.sourceAddFury.group===q.group&&e.sourceAddFury.index===index);
  // Validate the preceding target before assigning next-frame targets,
  // preserving the reference driver order and first-frame acquisition delay.
  const target=sim.state.actors.find(b=>b.id===q.targetId&&b.team!==a.team&&b.hp>0&&!b.pvpDead&&!b.pvpDisconnected&&!b.invincible);
  const targetBone=target&&(sim.effectAnchorSampler?.({definition:{BONE_NAME:'Dummy0'+(index+1)}},target,{profile:sim.profileFor(target)})?.position??[target.x,target.y,target.z]);
  const valid=targetBone&&Math.hypot(...targetBone.map((n,i)=>n-position[i]))<=700;
  move(drone,position,valid?aim(position,targetBone):[a.x,a.y,a.z]);
  if(valid){
   const muzzle=sim.effectBoneSampler?.(drone,a,'Dummy01')??position;
   let beam=shot;if(!beam){
    // Persistent damage keeps the original cast's skill scale even after the
    // actor has returned to commands or another skill.
    beam=sim.createEffect({...a,skillId:29017,skillScale:drone.powerMultiplier,skillContext:{traitPolicy:drone.traitPolicy}},{NAME:ADD_FURY_BEAM},{birthAnchor:{position:[...muzzle],facing:a.facing,rotation:aim(muzzle,targetBone)}});
    if(beam)beam.sourceAddFury={role:'beam',index,group:q.group,targetId:target.id};
   }
   if(beam){beam.sourceAddFury.targetId=target.id;move(beam,muzzle,aim(muzzle,targetBone));beam.sourceAddLinkScale=Math.max(1,Math.hypot(...targetBone.map((n,i)=>n-muzzle[i])))/profile.damageEffects[ADD_FURY_BEAM].raw.LINK_EFFECT_RATE;beam.definition=addLinkedDefinition(profile,beam,beam.definition);}
   if(index<3)s.activeElapsed=f(s.activeElapsed+dt);
  }else if(shot)end(sim,a,shot);
  q.timer=f(Math.max(0,(q.timer??0)-dt));
  if(!valid&&q.timer<=0){ready.push(q);q.timer=f(.5);}
 }
 assignAddFuryTargets(drones.map(d=>d.sourceAddFury),ready,candidates);
}

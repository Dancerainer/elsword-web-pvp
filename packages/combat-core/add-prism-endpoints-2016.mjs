/** Target1576/1577 conditional NPC domain. Numeric field handles are copied
 * values, not ownership of the caster's group; DYING never deletes the field.
 * The host supplies fixed-timeline dt as its reproducible wallclock input.
 * Original animation completion is an explicit host callback, never guessed. */
import source from '../../contracts/add-prism-endpoints-2016.json' with {type:'json'};
import {createPoseLibrary,createPoseSampleBuffer,samplePoseToRef,mapClipTime,compose,transform} from '../../tools/assets/character/sample_pose.mjs';
import {nativeBodyPushCandidate,nativeBodyPassBlocked} from './reaction-policy.mjs';
const f=Math.fround,library=createPoseLibrary(source.pose),poseBuffers=new WeakMap();
const declarations=n=>source.scripts['Particle_Prism_'+(n.npcId===1576?'Start':'End')+'.lua'].declarations;
export function addPrismEndpointState(n){return declarations(n)['PARTICLE_PRISM_'+(n.npcId===1576?'START':'END')+'_'+n.state];}
export const addPrismEndpointAudio=source.audio;
function stateChange(sim,a,n,state){n.state=state;n.animationTime=0;n.pendingState=null;const raw=addPrismEndpointState(n);if(raw?.RIGHT===1){n.yaw-=n.facing<0?180:0;n.facing=1;}if(state==='DYING')dying(sim,a,n);}
function motionDuration(n){const clip=library.clips.get(addPrismEndpointState(n)?.ANIM_NAME);return clip?.durationSeconds;}
export function startAddPrismEndpoints(sim,a,position,otherPosition,fieldHandle=null){
 for(const old of a.sourceAddPrismEndpoints??[])if(old.hp>0)old.hp=0;
 const skill=sim.profileFor(a).skillCatalog.find(s=>s.skillId===29003)||sim.profileFor(a).skillCatalog.find(s=>s.skillId===29029),duration=skill?.raw.SA_EFFECTIVE_TIME?.[skill.maxLevel];
 if(!Number.isFinite(duration)||!Number.isFinite(a.hpMax))return false;
 a.sourceAddPrismEndpoints??=[];
 const line=sim.map?.lines?.find(l=>l.lineId===(a.lineId??a.lastTouchLineId)),yaw=line?Math.atan2(-(line.end[2]-line.start[2]),line.end[0]-line.start[0])*180/Math.PI:0;
 for(let index=0;index<2;index++){const npc={id:(a.stateSerial*2)+index,npcId:index?1577:1576,ownerId:a.id,position:[...(index?otherPosition:position)],hp:f(a.hpMax*.25),hpMax:f(a.hpMax*.25),state:'START',elapsed:0,wallElapsed:0,duration,fieldHandle,animationTime:0,pendingState:null,facing:a.facing??1,yaw:f(yaw+((a.facing??1)<0?180:0))};a.sourceAddPrismEndpoints.push(npc);stateChange(sim,a,npc,'START');}
 sim.emit('addPrismEndpointsCreated',a.id,{npcIds:[1576,1577],hp:f(a.hpMax*.25),duration});return true;
}
function dying(sim,a,npc){
 // Exact first matching opposite ID / owner only, with nil/dead candidates
 // retained as the original list allows. The early return matters.
 for(const owner of sim.state.actors)for(const peer of owner.sourceAddPrismEndpoints??[])if(peer.npcId!==npc.npcId&&peer.ownerId===npc.ownerId){peer.hp=0;return;}
}
export function tickAddPrismEndpoints(sim,a,dt){
 if(a.pvpDisconnected||!(dt>0)||sim.networkOwnerId!=null&&sim.networkOwnerId!==a.id&&sim.networkCombatPlaybackVersion!==1)return;
 for(const npc of a.sourceAddPrismEndpoints??[]){
  if(npc.pendingState)stateChange(sim,a,npc,npc.pendingState);
  const before=npc.animationTime;npc.animationTime=f(npc.animationTime+dt);npc.elapsed=f(npc.elapsed+dt);npc.wallElapsed+=dt;
  const raw=addPrismEndpointState(npc);
  for(const [field,sound]of Object.entries(raw??{}))if(/^SOUND_PLAY\d+$/.test(field)&&before<sound['1']&&npc.animationTime>=sound['1'])sim.emit('sound',a.id,{name:sound['2'],position:[...npc.position],sourcePrismEndpointId:npc.id,evidence:'original2016 Prism NPC state sound'});
  if(npc.state!=='DYING'&&npc.state!=='REMOVED'){
   const owner=sim.state.actors.find(b=>b.id===npc.ownerId),limit=npc.npcId===1576?8.5:835;
   if(!owner||owner.hp<=0||npc.elapsed>=limit||npc.wallElapsed>npc.duration)npc.hp=0;
   if(npc.hp<=0)npc.pendingState='DYING';
  }
  const duration=motionDuration(npc);
  if(Number.isFinite(duration)&&npc.animationTime>=duration){
   if((npc.state==='START'||npc.state==='DAMAGE')&&!npc.pendingState)npc.pendingState='WAIT';
   else if(npc.state==='DYING'){npc.state='REMOVED';sim.emit('addPrismEndpointRemoved',a.id,{npcId:npc.npcId,id:npc.id,fieldRetained:true});}
  }
 }
 a.sourceAddPrismEndpoints=(a.sourceAddPrismEndpoints??[]).filter(n=>n.state!=='REMOVED');
}
export function applyAddPrismEndpointDamage(sim,a,id,amount,{reactType=1}={}){
 if(a.pvpDisconnected||sim.networkOwnerId!=null&&sim.networkOwnerId!==a.id||!Number.isFinite(amount)||amount<0)return false;
 const npc=a.sourceAddPrismEndpoints?.find(n=>n.id===id&&n.hp>0&&n.state!=='DYING');if(!npc)return false;
 const before=npc.hp;npc.hp=f(Math.max(0,npc.hp-amount));if(npc.hp>0&&amount>0&&reactType!==0)npc.pendingState='DAMAGE';sim.emit('addPrismEndpointDamaged',a.id,{id,hp:npc.hp,amount:before-npc.hp});return true;
}
export function addPrismEndpointSpheres(npc){
 const raw=addPrismEndpointState(npc),clip=library.clips.get(raw?.ANIM_NAME);if(!clip)return [];
 let buffer=poseBuffers.get(npc);if(!buffer){buffer=createPoseSampleBuffer(library);poseBuffers.set(npc,buffer);}
 const angle=npc.yaw*Math.PI/360,world=compose(npc.position,[2.2,2.2,2.2],[0,Math.sin(angle),0,Math.cos(angle)]);
 const matrices=samplePoseToRef(library,clip.name,mapClipTime(npc.animationTime,clip.durationSeconds,raw.PLAY_TYPE===0,clip.nativePlaybackField),buffer,{worldMatrix:world});
 return library.helpers.map(h=>{const m=matrices.get(h.name);return {kind:'sphere',center:transform(m,[0,0,0]),radius:h.nativeStoredBoundingRadius*Math.hypot(...m.slice(0,3)),source:{npcId:npc.npcId,helper:h.name,radiusEvidence:'original KSM stored bounding radius'}};});
}
export function prismHitTargets(sim){return sim.state.actors.filter(owner=>!owner.pvpDisconnected).flatMap(owner=>(owner.sourceAddPrismEndpoints??[]).filter(n=>n.hp>0&&n.state!=='DYING'&&n.state!=='REMOVED').map(npc=>{
 const stats=source.npcStats[String(npc.npcId)],actor={id:owner.id+':prism:'+npc.id,team:owner.team,professionId:owner.professionId,
  x:npc.position[0],y:npc.position[1],z:npc.position[2],facing:npc.facing,state:npc.state,animationTime:npc.animationTime,
  hp:npc.hp,hpMax:npc.hpMax,stats:{physicalDefence:stats.DEF_PHYSIC,magicDefence:stats.DEF_MAGIC},equipmentAttributes:{},buffs:[],
  sourceHittedType:declarations(npc).INIT_COMPONENT.HITTED_TYPE,sourceHittedTypeAtState:addPrismEndpointState(npc)?.HITTED_TYPE_AT_STATE,
  invincible:false,superArmor:false,sourcePrismOwnerId:owner.id,sourcePrismEndpointId:npc.id};
 return {owner,npc,actor,spheres:addPrismEndpointSpheres(npc)};
}));}
export function applyPrismTargetDamage(sim,target,amount,data){const owner=sim.state.actors.find(a=>a.id===target.sourcePrismOwnerId);return !!owner&&applyAddPrismEndpointDamage(sim,owner,target.sourcePrismEndpointId,amount,{reactType:data.REACT_TYPE});}
export function blockAddPrismUnits(sim,a,before,{canPush=true}={}){
 const body=sim.profileFor(a).body;
 for(const {owner,npc}of prismHitTargets(sim)){
  if(owner.team===a.team||addPrismEndpointState(npc)?.CAN_PASS_UNIT===1)continue;
  if(sim.dePredictionActive===a)sim.dePhysicalObjects.collider(npc,{position:npc.position,width:50,height:250,kind:'npc',mode:sim.dePhysicalMode,localPredicate:sim.networkOwnerId==null||sim.networkOwnerId===owner.id});
  // These original NPC states have CAN_PUSH_UNIT=0; actor false still permits
  // ProcessCanPush's asymmetric !target.CAN_PUSH branch.
  if(canPush||addPrismEndpointState(npc)?.CAN_PUSH_UNIT===0)[a.x,a.y,a.z]=nativeBodyPushCandidate({position:before,height:body.UNIT_HEIGHT,width:body.UNIT_WIDTH},{position:npc.position,height:250,width:50},{position:[a.x,a.y,a.z],direction:[a.facing,0,0]});
  if(nativeBodyPassBlocked({position:before,height:body.UNIT_HEIGHT},{position:npc.position,height:250},{position:[a.x,a.y,a.z]})){[a.x,a.y,a.z]=before;a.vx=0;}
 }
}
export function validateAddPrismEndpoints(rows,{owner}={}){
 if(!Array.isArray(rows)||rows.length>8||new Set(rows.map(n=>n?.id)).size!==rows.length)throw new TypeError('Invalid Prism endpoint list');
 for(const n of rows)if(!n||typeof n!=='object'||Object.keys(n).length!==15||!Number.isSafeInteger(n.id)||n.id<0||![1576,1577].includes(n.npcId)||typeof n.ownerId!=='string'||!n.ownerId||owner&&n.ownerId!==owner.id||!Array.isArray(n.position)||n.position.length!==3||!n.position.every(Number.isFinite)||!['START','WAIT','DAMAGE','DYING','REMOVED'].includes(n.state)||!(n.pendingState===null||['WAIT','DAMAGE','DYING'].includes(n.pendingState))||!Number.isFinite(n.animationTime)||n.animationTime<0||n.animationTime>60||![1,-1].includes(n.facing)||!Number.isFinite(n.yaw)||n.yaw< -360||n.yaw>360||!Number.isFinite(n.hp)||n.hp<0||!Number.isFinite(n.hpMax)||n.hpMax<=0||n.hp>n.hpMax||owner&&n.hpMax!==f(owner.hpMax*.25)||!Number.isFinite(n.elapsed)||n.elapsed<0||!Number.isFinite(n.wallElapsed)||n.wallElapsed<0||n.duration!==6.9||!(n.fieldHandle===null||Number.isSafeInteger(n.fieldHandle)&&n.fieldHandle>=0))throw new TypeError('Invalid Prism endpoint');
 return true;
}

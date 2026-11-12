/** Original2016 NPC1635 WALK/.29/contact/SUCCESS.01/WAIT5 path. The
 * independent bounded NPC host uses authored map lines and original attack
 * helpers; full generic NPC physics/absorb-magic remain unimplemented. */
import source from '../../contracts/elesis-firewall-npc-v45.json' with {type:'json'};
import {createPoseLibrary,createPoseSampleBuffer,samplePoseToRef,mapClipTime,compose,transform} from '../../tools/assets/character/sample_pose.mjs';
import {lineMotionBasis,groundedBodyPushPoint,lineType} from './map-mechanics.mjs';
import {createSkillTraitPolicy} from './skill-traits.mjs';
const f=Math.fround,set='EffectSet_Wall_of_Prominence_Attack',walk=source.raw.ELESIS_FIRE_WALL_WALK;
const library=createPoseLibrary(source.pose),buffer=createPoseSampleBuffer(library),clip=library.clips.get('EM_Stone_Wall_Wait');
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const wallYaw=w=>f(Math.atan2(-w.direction[2],w.direction[0])*180/Math.PI);
const fields=['phase','elapsed','position','direction','facing','lineId','sourceStateSerial','skillScale','branchId','level','vy','nowSpeed'];
export function validateElesisFirewalls(actor,profile,map){
 const queue=actor.sourceElesisFirewallRequests;if(queue===undefined)return true;
 if(!Array.isArray(queue)||!queue.length||queue.length>4||profile?.target?.unitClass!==121)throw new TypeError('Invalid original Firewall NPC queue');
 const seen=new Set(),skill=profile.skillCatalog.find(s=>s.skillId===28018);
 for(const w of queue){
  if(!w||typeof w!=='object'||Object.keys(w).length!==fields.length||fields.some(k=>!Object.hasOwn(w,k))||
   !['walk','success'].includes(w.phase)||!Number.isFinite(w.elapsed)||w.elapsed<0||w.elapsed>(w.phase==='walk'?.29:.01)||
   !vector(w.position)||w.position.some(v=>Math.abs(v)>1e7)||!vector(w.direction)||w.direction[1]!==0||Math.hypot(...w.direction)<=0||Math.hypot(...w.direction)>1.000001||
   ![1,-1].includes(w.facing)||w.lineId!==null&&!Number.isSafeInteger(w.lineId)||!Number.isSafeInteger(w.sourceStateSerial)||w.sourceStateSerial<1||seen.has(w.sourceStateSerial)||
   !Number.isFinite(w.skillScale)||w.skillScale<=0||w.skillScale>100||typeof w.branchId!=='string'||w.branchId.length>64||
   !Number.isSafeInteger(w.level)||w.level<1||w.level>skill.maxLevel||w.vy!==0||
   ![0,3000].includes(w.nowSpeed)||w.nowSpeed===0&&w.elapsed!==0||
   w.branchId!=='none'&&!skill.branches.some(b=>b.id===w.branchId&&b.selectable)||
   w.lineId!==null&&map&&!map.lines.some(l=>l.lineId===w.lineId))throw new TypeError('Invalid original Firewall NPC request');
  seen.add(w.sourceStateSerial);
 }
 return true;
}
export function requestElesisFirewall(sim,a){
 const initial=firewallInitialBody([a.x,a.y,a.z],sim.map),lineId=initial.lineId;
 const w={phase:'walk',elapsed:0,position:initial.position,direction:lineMotionBasis({lineId:lineId??a.lineId??a.lastTouchLineId},sim.map).direction.map((v,i)=>i===1?0:v*a.facing),
  facing:a.facing,lineId,sourceStateSerial:a.stateSerial,skillScale:a.skillScale,
  branchId:a.skillContext?.traitPolicy?.branchId??'none',level:a.skillContext?.level??sim.skill(28018,a).maxLevel,vy:0,nowSpeed:0};
 const queue=a.sourceElesisFirewallRequests??=[];if(queue.length>=4)throw new TypeError('Original Firewall NPC queue capacity');queue.push(w);
 validateElesisFirewalls(a,sim.profileFor(a),sim.map);sim.emit('elesisFirewallNpcRequested',a.id,{sourceNpcId:1635,sourceStateSerial:w.sourceStateSerial});
 sim.note('elesis-firewall-road-visual','Original NPC road particle chain is not yet a supported asset closure',a);
}
/** Original325154c0 separates the body from its ground reference. Only a
 * strictly-nearer-than30 eligible line moves the newly created body. */
export function firewallInitialBody(position,map){
 let result={position:position.map(f),lineId:null},distance=30;
 for(const line of map.lines){
  const type=lineType(line);if(line.active===false||[1,4,5,8].includes(type)||/LT_WALL|LT_JUMP_UP_|LT_UNIT_ROAD/.test(String(type)))continue;
  const d=line.end.map((v,i)=>v-line.start[i]),length=d.reduce((n,v)=>n+v*v,0);if(!(length>0))continue;
  const ratio=Math.max(0,Math.min(1,d.reduce((n,v,i)=>n+(position[i]-line.start[i])*v,0)/length)),point=line.start.map((v,i)=>v+d[i]*ratio),gap=Math.hypot(...point.map((v,i)=>v-position[i]));
  if(gap<distance){distance=gap;result={position:point.map(f),lineId:line.lineId};}
 }
 return result;
}
function npcShapes(w){
 const angle=wallYaw(w)*Math.PI/360,quaternion=[0,Math.sin(angle),0,Math.cos(angle)],world=compose(w.position,[.5,.5,.5],quaternion);
 const matrices=samplePoseToRef(library,clip.name,mapClipTime(w.elapsed,clip.durationSeconds,true,clip.nativePlaybackField),buffer,{worldMatrix:world});
 return library.helpers.map(h=>{const m=matrices.get(h.name);return {kind:'sphere',center:transform(m,[0,0,0]),
  radius:h.geometryBoundingSphereCandidate.radius*Math.hypot(...m.slice(0,3)),source:{helper:h.name,npcId:1635,
   radiusEvidence:'original X vertices; existing qualified sphere candidate, native constructor unmeasured'}};});
}
function move(sim,a,w,dt){
 // Original NPC Now calls physics before passive->now copying (3253ab17,
 // 3253ad57..7e). Physics decelerates current X by RELOAD_ACCEL before
 // integrating (325310c1..32531104). Start Lua writes passive3000, not now3000;
 // consequently the first physics frame has no horizontal displacement.
 const elapsed=f(dt),speed=f(Math.max(0,f(w.nowSpeed-f(source.raw.INIT_PHYSIC.RELOAD_ACCEL*elapsed)))),distance=f(speed*elapsed);
 w.nowSpeed=3000;
 const before=[...w.position];w.position=w.position.map((v,i)=>f(v+w.direction[i]*distance));
 const fake={x:w.position[0],y:w.position[1],z:w.position[2],lineId:w.lineId};
 const point=w.lineId!==null?groundedBodyPushPoint(fake,sim.map):null;
 if(point){w.position=point.map(f);w.vy=0;const line=sim.nativeGeometry?.nearest?.({position:w.position});if(line?.found)w.lineId=line.lineId;
  w.direction=lineMotionBasis({lineId:w.lineId},sim.map).direction.map((v,i)=>i===1?0:v*w.facing);return;}
 const vy=f(Math.max(-2000,f(w.vy-f(source.raw.INIT_PHYSIC.G_ACCEL*elapsed))));w.position[1]=f(w.position[1]+f(vy*elapsed));
 const land=sim.nativeGeometry?.land?.({position:w.position,radius:sim.profileFor(a).referenceSemantics.lineRadius,lastLineId:w.lineId});
 if(land?.found&&before[1]>=land.point[1]&&w.position[1]<=land.point[1]){w.position=land.point;w.lineId=land.lineId;w.vy=0;}
 else w.lineId=null;
 // Both WALK and SUCCESS native Start scripts set passive Y to0; the
 // same post-physics copy restores it even while the NPC is airborne.
 w.vy=0;
}
function emitWall(sim,a,w){
 const p=sim.profileFor(a),row=sim.skill(28018,a),proxy={...a,x:w.position[0],y:w.position[1],z:w.position[2],facing:w.facing,
  stateSerial:w.sourceStateSerial,skillId:28018,skillScale:w.skillScale,skillContext:{level:w.level,branchId:w.branchId,traitPolicy:createSkillTraitPolicy(row,w.branchId)}};
 const anchor={position:[...w.position],rotation:[0,wallYaw(w),0],facing:w.facing,
  evidence:'original NPC1635 WAIT custom position and raw set scales; bounded map/NPC host adapter'};
 for(const [member,raw]of Object.entries(p.effectSets[set].raw))if(/^EFFECT\d+$/.test(member)){
  const e=sim.createEffect(proxy,raw,{setName:set,clock:'custom',birthAnchor:structuredClone(anchor)});if(!e)continue;
  e.definitionMember=member;e.definition=firewallInstanceDefinition(p,e,e.definition);restoreFirewallEffect(p,e);
 }
 sim.emit('elesisFirewallNpcWait',a.id,{sourceNpcId:1635,position:[...w.position],afterContact:w.phase==='success',duration:5});
}
export function tickElesisFirewalls(sim,a,dt){
 if(!(dt>0)||!a.sourceElesisFirewallRequests||sim.networkOwnerId!=null&&sim.networkOwnerId!==a.id)return;
 validateElesisFirewalls(a,sim.profileFor(a),sim.map);
 // A cancelled/dead unissued request cannot leak into a new Web-owned life.
 if(a.hp<=0||a.pvpDead||a.pvpDisconnected){delete a.sourceElesisFirewallRequests;return;}
 const pending=[];
 for(const w of a.sourceElesisFirewallRequests){
  w.elapsed=f(w.elapsed+f(dt));move(sim,a,w,dt);
  if(w.phase==='success'){if(w.elapsed>f(.01)){emitWall(sim,a,w);continue;}}
  else{
   if(w.elapsed>f(walk.CT_ELESIS_FIRE_WALL_WAIT.STATE_TIME_OVER)){emitWall(sim,a,w);continue;}
   if(w.elapsed>=f(walk.ATTACK_TIME0['1'])){
    const shapes=npcShapes(w),target=sim.state.actors.find(b=>b.id!==a.id&&b.team!==a.team&&b.hp>0&&!b.pvpDead&&!b.pvpDisconnected&&!b.invincible&&!(b.forceInvincible>0)&&shapes.some(s=>sim.intersects(s,b)));
    if(target){w.phase='success';w.elapsed=0;sim.emit('elesisFirewallNpcContact',a.id,{sourceNpcId:1635,targetId:target.id,position:[...w.position]});}
   }
  }
  pending.push(w);
 }
 if(pending.length)a.sourceElesisFirewallRequests=pending;else delete a.sourceElesisFirewallRequests;
}
export function firewallInstanceDefinition(profile,effect,definition){
 if(effect.setName!==set)return definition;
 if(profile.target?.unitClass!==121||effect.skillId!==28018||!/^DamageEffect_Wall_of_Prominence_Attack_(?:Main|Sub)$/.test(effect.name))throw new TypeError('Invalid original Firewall NPC wall binding');
 // PlayEffectSetWithCustomPos owner is the skill caster, but the original
 // trace controller is the independent NPC, not that moving character.
 return {...definition,TRACE:0,TRACE_MORE:0,TRACE_MATRIX:0};
}
export function restoreFirewallEffect(profile,effect){
 if(effect.setName!==set)return;
 firewallInstanceDefinition(profile,effect,effect.definition);
 effect.sourceSkillMeshControl=true;effect.currentAnchor=structuredClone(effect.birthAnchor);effect.sourcePosedAnchor=structuredClone(effect.birthAnchor);
}

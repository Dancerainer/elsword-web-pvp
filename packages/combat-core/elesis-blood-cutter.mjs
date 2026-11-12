/** Target2016 Elesis_BloodCutter.lua, NPC1641: .01 trace set, .1 passive
 * speed2000, two-second walk lifetime. This bounded effect carrier executes
 * that script path after the original caster .01 callback requests NPC1641
 * with a .3-second game-frame delay. Request identity is frozen at creation.
 * It is not a full original NPC engine or an original-client measurement. */
import {lineMotionBasis} from './map-mechanics.mjs';
import {createSkillTraitPolicy} from './skill-traits.mjs';
const setName='EffectSet_SI_SA_SCA_BLOOD_CUTTER_Projectile',name='DamageEffect_SI_SA_SCA_BLOOD_CUTTER';
export const BLOOD_CUTTER_REQUEST_DELAY=Math.fround(.3);
const npcEffectTime=Math.fround(.01);
const requestFields=['phase','remaining','npcElapsed','origin','direction','facing','lineId','sourceStateSerial','skillId','skillScale','branchId','level'];
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const validDirection=v=>vector(v)&&v[1]===0&&Math.hypot(...v)>0&&Math.hypot(...v)<=1.000001;
export function validateBloodCutterRequests(a,profile,map){
 const queue=a.sourceElesisBloodCutterRequests;if(queue===undefined)return true;
 if(!Array.isArray(queue)||queue.length<1||queue.length>4||profile&&profile.target?.unitClass!==125)
  throw new TypeError('invalid-elesis-blood-cutter-request');
 const seen=new Set();
 for(const r of queue){
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==requestFields.length||Object.keys(r).some(k=>!requestFields.includes(k))||
    !['request','npc'].includes(r.phase)||!Number.isFinite(r.remaining)||r.remaining<=0||r.remaining>(r.phase==='request'?BLOOD_CUTTER_REQUEST_DELAY:npcEffectTime)||
    !Number.isFinite(r.npcElapsed)||r.npcElapsed<0||r.phase==='request'&&r.npcElapsed!==0||r.phase==='npc'&&r.npcElapsed>=npcEffectTime||
    !vector(r.origin)||r.origin.some(v=>Math.abs(v)>1e7)||
    !validDirection(r.direction)||![1,-1].includes(r.facing)||r.lineId!==null&&!Number.isSafeInteger(r.lineId)||
    !Number.isSafeInteger(r.sourceStateSerial)||r.sourceStateSerial<1||seen.has(r.sourceStateSerial)||r.skillId!==28023||
    !Number.isFinite(r.skillScale)||r.skillScale<=0||r.skillScale>100||typeof r.branchId!=='string'||r.branchId.length>64||
    !Number.isSafeInteger(r.level)||r.level<1)
   throw new TypeError('invalid-elesis-blood-cutter-request');
  seen.add(r.sourceStateSerial);
  if(profile){const skill=profile.skillCatalog?.find(s=>s.skillId===28023);
   if(!skill||r.level>skill.maxLevel||r.branchId!=='none'&&!skill.branches?.some(b=>b.id===r.branchId&&b.selectable))
    throw new TypeError('invalid-elesis-blood-cutter-request-skill');}
  if(map){
   if(r.lineId!==null&&!map.lines?.some(l=>l.lineId===r.lineId))throw new TypeError('invalid-elesis-blood-cutter-request-line');
   const expected=lineMotionBasis({lineId:r.lineId},map).direction.map((v,i)=>i===1?0:v*r.facing);
   if(expected.some((v,i)=>Math.abs(v-r.direction[i])>1e-6))throw new TypeError('invalid-elesis-blood-cutter-request-direction');
  }
 }
 return true;
}
export function requestBloodCutterCarrier(sim,a){
 const profile=sim.profileFor(a),row=sim.skill(28023,a),lineId=a.lineId??a.lastTouchLineId??null;
 const request={phase:'request',remaining:BLOOD_CUTTER_REQUEST_DELAY,npcElapsed:0,origin:[a.x,a.y,a.z],
  direction:lineMotionBasis({lineId},sim.map).direction.map((v,i)=>i===1?0:v*a.facing),facing:a.facing,lineId,
  sourceStateSerial:a.stateSerial,skillId:28023,skillScale:a.skillScale,
  branchId:a.skillContext?.traitPolicy?.branchId??a.skillContext?.branchId??'none',level:a.skillContext?.level??row.maxLevel};
 const queue=a.sourceElesisBloodCutterRequests??=[];
 if(queue.length>=4)throw new TypeError('blood-cutter-request-capacity');
 queue.push(request);validateBloodCutterRequests(a,profile,sim.map);
 // Original327fc051 creates a temporary DUMMY to resolve cast attributes;
 // 327fc207 removes it in the same callback. It never becomes a stationary
 // persistent damage carrier while the real NPC request is waiting.
 const dummy=sim.createEffect(a,{NAME:'DamageEffect_SI_SA_SCA_BLOOD_CUTTER_DUMMY'});
 if(dummy){dummy.dead=true;dummy.endEmitted=true;dummy.endReason='blood-cutter-request-dummy-consumed';}
 sim.emit('bloodCutterNpcRequested',a.id,{sourceNpcId:1641,delay:BLOOD_CUTTER_REQUEST_DELAY,origin:[...request.origin],facing:request.facing});
}
/** Original PvP FrameMove calls the NPC-delay queue after unit processing,
 * using its frame elapsed independently of character animation and STOP.
 * Clearing an unissued request on death/disconnect is an explicit Web policy;
 * no matching original request-owner death consumer has been established. */
export function tickBloodCutterRequests(sim,a,dt){
 if(!(dt>0))return;
 // NPC age is independent of the visible effect mesh age. Newly emitted
 // sets below do not receive another NPC update in the same frame.
 for(const e of sim.state.effects)if(e.ownerId===a.id&&!e.dead&&e.sourceElesisBloodCutter?.npcAge!==undefined)
  e.sourceElesisBloodCutter.npcAge=Math.fround(e.sourceElesisBloodCutter.npcAge+Math.fround(dt));
 // Only the current owner may consume a request and create its carrier. A
 // receiver keeps the transmitted pending queue until the next owner report;
 // prediction must not issue a second NPC beside that reported live carrier.
 if(sim.networkOwnerId!=null&&sim.networkOwnerId!==a.id)return;
 if(a.sourceElesisBloodCutterRequests===undefined)return;
 validateBloodCutterRequests(a,sim.profileFor(a),sim.map);
 if(a.hp<=0||a.death||a.pvpDead||a.pvpDisconnected){delete a.sourceElesisBloodCutterRequests;return;}
 const pending=[];
 for(const r of a.sourceElesisBloodCutterRequests){
  if(r.phase==='request'){
   r.remaining=Math.max(0,Math.fround(r.remaining-Math.fround(dt)));
   if(r.remaining===0){r.phase='npc';r.remaining=npcEffectTime;}
   pending.push(r);
  }else{
   r.npcElapsed=Math.fround(r.npcElapsed+Math.fround(dt));r.remaining=Math.max(0,Math.fround(npcEffectTime-r.npcElapsed));
   if(r.remaining>0)pending.push(r);else spawnBloodCutterCarrier(sim,a,r);
  }
 }
 if(pending.length)a.sourceElesisBloodCutterRequests=pending;else delete a.sourceElesisBloodCutterRequests;
}
export function validateBloodCutterCarrier(e,profile){
 const c=e.sourceElesisBloodCutter;if(c===undefined)return;
 if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['origin','direction','branchId','npcAge'].includes(k))||!vector(c.origin)||!vector(c.direction)||
   c.direction[1]!==0||Math.hypot(...c.direction)<=0||Math.hypot(...c.direction)>1.000001||
   c.branchId!==undefined&&(typeof c.branchId!=='string'||c.branchId.length>64)||
   c.npcAge!==undefined&&(!Number.isFinite(c.npcAge)||c.npcAge<0||c.npcAge>120)||
   e.name!==name||e.setName!==setName||e.skillId!==28023||profile&&profile.target?.unitClass!==125)
   throw new TypeError('invalid-elesis-blood-cutter-carrier');
 if(profile&&c.branchId!==undefined&&c.branchId!=='none'&&!profile.skillCatalog.find(s=>s.skillId===28023)?.branches?.some(b=>b.id===c.branchId&&b.selectable))
  throw new TypeError('invalid-elesis-blood-cutter-carrier-branch');
}
export function spawnBloodCutterCarrier(sim,a,request=null){
 const profile=sim.profileFor(a),caster=request?{...a,x:request.origin[0],y:request.origin[1],z:request.origin[2],
  facing:request.facing,lineId:request.lineId,lastTouchLineId:request.lineId,stateSerial:request.sourceStateSerial,
  skillId:28023,skillScale:request.skillScale,skillContext:{level:request.level,branchId:request.branchId,
   traitPolicy:createSkillTraitPolicy(sim.skill(28023,a),request.branchId)}}:a;
 const first=sim.state.nextEffectId;sim.spawnSet(caster,setName,profile.enums.EFFECT_SET_TIMER_TYPE.ESTT_CUSTOM);
 const e=sim.state.effects.find(e=>e.id>=first&&e.name===name);if(!e)throw new TypeError('Target Blood Cutter carrier is unavailable');
 const direction=request?.direction??lineMotionBasis(a,sim.map).direction.map((v,i)=>i===1?0:v*a.facing);
 e.sourceElesisBloodCutter={origin:request?[...request.origin]:[a.x,a.y,a.z],direction:[...direction],
  branchId:request?.branchId??a.skillContext?.traitPolicy?.branchId??'none',...(request?{npcAge:request.npcElapsed}:{})};e.sourceSkillMeshControl=true;
 updateBloodCutterAnchor(sim,e,a);sim.emit('bloodCutterCarrierStarted',a.id,{effectId:e.id,sourceNpcId:1641,speed:2000,speedAfter:.1});
}
export function restoreBloodCutterControls(profile,e){
 if(e.sourceElesisBloodCutter?.branchId!==undefined)e.traitPolicy=createSkillTraitPolicy(profile.skillCatalog.find(s=>s.skillId===28023),e.sourceElesisBloodCutter.branchId);
}
export function updateBloodCutterAnchor(sim,e,a){
 if(e.sourceElesisBloodCutter===undefined)return false;
 validateBloodCutterCarrier(e,sim.profileFor(a));
 const c=e.sourceElesisBloodCutter,age=c.npcAge??e.elapsed;
 // The source NPC cannot pass units. This bounded carrier has no actor body;
 // after an accepted collision keep its actual impact anchor for the rest
 // of the original two-second NPC life instead of tunnelling through it.
 if(age>Math.fround(2)){e.dead=true;e.endReason='blood-cutter-npc-walk-end';return true;}
 if(e.hitCount>0&&e.currentAnchor){e.sourcePosedAnchor=structuredClone(e.currentAnchor);return true;}
 const travel=2000*Math.max(0,age-.1),root=c.origin.map((v,i)=>v+c.direction[i]*travel);
 const yaw=Math.atan2(-c.direction[2],c.direction[0])*180/Math.PI;
 // The NPC's requested EM_Stone_Wall_Wait is absent in its actual weapon
 // model. Keep the native failed-ChangeAnim bind frame for its hidden body.
 // The separate visible attack mesh still plays its own Normal LOOP.
 const proxy={...e,definition:{},damage:{MAIN_EFFECT_NAME:'BLOOD_CUTTER_Weapon'},sourcePosedAnchor:null,
   birthAnchor:{position:root,rotation:[0,yaw,0],facing:e.facing},currentAnchor:{position:root,rotation:[0,yaw,0],facing:e.facing}};
 const bone=sim.effectBoneSampler?.(proxy,a,'Dummy01',{bindPose:true});
 if(!bone){sim.note('blood-cutter-npc-bone','Original NPC model Dummy01 bind frame required',a);e.dead=true;e.endReason='missing-blood-cutter-npc-bone';return true;}
 const d=e.definition,position=bone.map((v,i)=>v+(d[['POSITION_OFFSET_X','POSITION_OFFSET_Y','POSITION_OFFSET_Z'][i]]??0));
 const rotation=[d.ROTATE_X??0,d.ROTATE_Y??0,d.ROTATE_Z??0];
 const anchor={position,rotation,facing:e.facing,evidence:'target2016 NPC bind Dummy01 + original trace offset and speed2000'};
 e.birthAnchor??=structuredClone(anchor);e.currentAnchor=anchor;e.sourcePosedAnchor=structuredClone(anchor);[e.x,e.y,e.z]=position;
 if(age>Math.fround(2)){e.dead=true;e.endReason='blood-cutter-npc-walk-end';}
 return true;
}

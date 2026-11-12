/** Target2016 SI_HA_APOCALYPSE tables + its ten statically decoded Lua
 * callbacks. Native NPC arbitration is a qualified Web adapter; no caster
 * skeleton or radius substitute can stand in for the original NPC pose. */
import {authoredLineBasis} from '../combat-assets/line-basis.mjs';
import {addSummonCombatActor} from './add-summon-damage.mjs';
export const ADD_SUMMON_VERSION='add-apocalypse-target2016-v1';
const f=Math.fround,clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const states=new Set(['APOCALYPSE_START','APOCALYPSE_WAIT','APOCALYPSE_ATTACK_A','APOCALYPSE_ATTACK_B',
 'APOCALYPSE_ATTACK_C','APOCALYPSE_ATTACK_A_EMERGENCY','APOCALYPSE_FINISH_ATTACK','APOCALYPSE_DIE_ATTACK']);
const attacks=['APOCALYPSE_ATTACK_A','APOCALYPSE_ATTACK_B','APOCALYPSE_ATTACK_C'];
const finishStates=new Set(['APOCALYPSE_FINISH_ATTACK','APOCALYPSE_DIE_ATTACK']);
const fields=['version','kind','serial','skillId','skillScale','hyperMode','position','facing','yaw','aimZ','state','stateSerial',
 'animationTime','stateTime','remaining','hp','hpMax','targetId','cooldowns','waitInterval'];
const finite=(v,min=0,max=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(x=>finite(x,-Infinity));
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const owned=(sim,a)=>sim.networkOwnerId==null||sim.networkOwnerId===a.id;
// A negotiated recipient plays a remote NPC through the same positive-dt
// scheduler as its remote character. This grants NPC presentation/combat
// playback, never ownership of the source's resources or summon HP receipts.
// Disposable speculative hit actors must not start/finish the real remote NPC.
const playable=(sim,a)=>owned(sim,a)||sim.networkCombatPlaybackVersion===1&&sim.networkOwnerId!=null&&
  sim.state.actors.find(actor=>actor.id===a?.id)===a&&!a.pvpDisconnected;
const globals=(sim,a)=>sim.profileFor(a).summonDeclarations?.apocalypse?.globals;
const live=(sim,a,id)=>sim.state.actors.find(b=>b.id===id&&b.team!==a.team&&b.hp>0&&!b.pvpDead&&!b.pvpDisconnected);
function basis(sim,a){try{return authoredLineBasis(a,sim.map);}catch{sim.note?.('add-apocalypse-line','Original owner map-line basis unavailable',a);return null;}}
function event(sim,a,type,details={}){sim.emit?.(type,a.id,{...details,evidence:'target2016 Apocalypse declarations/Lua; Web NPC adapter; client unmeasured'});}
export function validateAddSummonState(s,{owner,profile,actors}={}){
 if(s==null)return true;
 if(!plain(s)||Object.keys(s).some(k=>!fields.includes(k))||fields.some(k=>!Object.hasOwn(s,k))||
   s.version!==ADD_SUMMON_VERSION||s.kind!=='apocalypse'||!integer(s.serial,1)||![29601,29604].includes(s.skillId)||
   !finite(s.skillScale,0,100)||typeof s.hyperMode!=='boolean'||!vector(s.position)||![1,-1].includes(s.facing)||
   !finite(s.yaw,-360,360)||!finite(s.aimZ,-10800,10800)||!states.has(s.state)||!integer(s.stateSerial,1)||
   !finite(s.animationTime,0,120)||!finite(s.stateTime,0,120)||!finite(s.remaining,0,60)||!finite(s.hp)||
   !finite(s.hpMax,1)||s.hp>s.hpMax||!(s.targetId===null||typeof s.targetId==='string'&&s.targetId.length>0&&s.targetId.length<=128)||
   !plain(s.cooldowns)||Object.keys(s.cooldowns).some(k=>!attacks.includes(k))||attacks.some(k=>!finite(s.cooldowns[k],0,12))||
   !finite(s.waitInterval,0,.5))throw new TypeError('invalid-owner-add-summon');
 if(profile&&(profile.target?.unitClass!==123||!profile.summonDeclarations?.apocalypse||
   !profile.skillCatalog.some(sk=>sk.skillId===s.skillId)))throw new TypeError('invalid-owner-add-summon-profession');
 if(profile){const sk=profile.skillCatalog.find(sk=>sk.skillId===s.skillId),power=sk.raw?.SA_ULTIMATE_STRENGTHENED_SKILL_POWERRATE?.[String(sk.maxLevel)]??1;
  if(Math.abs(s.skillScale-power)>1e-6)throw new TypeError('invalid-owner-add-summon-power');}
 if(owner&&(s.hpMax!==owner.hpMax||!owner.loadout?.some(sk=>sk?.skillId===s.skillId)))throw new TypeError('invalid-owner-add-summon-source');
 if(actors&&owner&&s.targetId!==null&&!actors.some(b=>b.id===s.targetId&&b.team!==owner.team))throw new TypeError('invalid-owner-add-summon-target');
 return true;
}
export function inheritAddSummonEffectState(parent,child){
 if(parent?.sourceAddSummonSerial===undefined)return child;
 child.sourceAddSummonSerial=parent.sourceAddSummonSerial;child.sourceAddSummonStateSerial=parent.sourceAddSummonStateSerial;return child;
}
export function validateAddSummonEffectState(e,profile){
 const has=Object.hasOwn(e,'sourceAddSummonSerial')||Object.hasOwn(e,'sourceAddSummonStateSerial');if(!has)return true;
 if(!integer(e.sourceAddSummonSerial,1)||!integer(e.sourceAddSummonStateSerial,1)||![29601,29604].includes(e.skillId))
  throw new TypeError('invalid-owner-add-summon-effect');
 for(const key of ['birthAnchor','currentAnchor','sourcePosedAnchor'])if(e[key]!=null){
  const a=e[key];if(!plain(a)||!vector(a.position)||a.rotation!==undefined&&!vector(a.rotation)||a.facing!==undefined&&![1,-1].includes(a.facing)||
   a.matrix!==undefined&&(!Array.isArray(a.matrix)||a.matrix.length!==16||!a.matrix.every(v=>finite(v,-Infinity))))throw new TypeError('invalid-owner-add-summon-anchor');
 }
 if(profile){
  if(profile.target?.unitClass!==123||!profile.summonDeclarations?.apocalypse)throw new TypeError('invalid-owner-add-summon-profession');
  const names=new Set();const walk=v=>{if(typeof v==='string'&&v.startsWith('EffectSet_'))names.add(v);else if(v&&typeof v==='object')Object.values(v).forEach(walk);};
  walk(profile.summonDeclarations.apocalypse);
  walk(profile.buffTemplates?.[414]?.raw?.DISPLAYER);
  const sk=profile.skillCatalog.find(sk=>sk.skillId===e.skillId),power=sk?.raw?.SA_ULTIMATE_STRENGTHENED_SKILL_POWERRATE?.[String(sk.maxLevel)]??1;
  if(!names.has(e.setName)||!sk||!finite(e.powerMultiplier)||Math.abs(e.powerMultiplier-power)>1e-6)
   throw new TypeError('invalid-owner-add-summon-effect-source');
 }
 return true;
}
/** Proxy only carries an NPC pose into source EffectSet creation. Actual
 * damage still uses the owner's frozen skill/stats attribution. */
export function addSummonPoseActor(owner,npc=owner.sourceAddSummon){
 if(!npc)return null;return {...owner,...addSummonCombatActor(owner),x:npc.position[0],y:npc.position[1],z:npc.position[2],facing:npc.facing,
  state:npc.state,stateSerial:npc.stateSerial,stateTime:npc.stateTime,animationTime:npc.animationTime,
  animationName:npc.state==='APOCALYPSE_START'?'Start':npc.state==='APOCALYPSE_WAIT'?'Wait':
   finishStates.has(npc.state)?'Attack_F':npc.state.includes('_B')?'Attack_B':npc.state.includes('_C')?'Attack_C':'Attack_A',
  animationLoop:npc.state==='APOCALYPSE_WAIT',skillId:npc.skillId,skillScale:npc.skillScale,skillContext:null,
  hp:npc.hp,hpMax:npc.hpMax,hitStop:0,worldStop:0};
}
function stateChange(sim,a,npc,state){
 const previous=npc.state;npc.state=state;npc.stateSerial++;npc.animationTime=npc.stateTime=0;npc.aimZ=0;npc.waitInterval=0;
 if(attacks.includes(state))npc.cooldowns[state]=Object.values(globals(sim,a).INIT_STATE).find(r=>r?.STATE_NAME===state)?.STATE_COOL_TIME??0;
 const target=live(sim,a,npc.targetId),line=basis(sim,a);
 if(target&&line&&globals(sim,a)[state]?.VIEW_TARGET===1){
  const along=[target.x-npc.position[0],target.y-npc.position[1],target.z-npc.position[2]].reduce((sum,v,i)=>sum+v*line.dirVector[i],0);
  npc.facing=along<0?-1:1;let yaw=line.yRotationDegrees+(npc.facing===a.facing?0:180);
  while(yaw>180)yaw-=360;while(yaw< -180)yaw+=360;npc.yaw=yaw;
 }
 for(const e of sim.state.effects)if(e.ownerId===a.id&&e.sourceAddSummonSerial===npc.serial&&e.deleteConditions?.includes(2)&&!e.dead){e.dead=true;e.endReason='summon-state-end';}
 event(sim,a,'addSummonStateChanged',{serial:npc.serial,previous,state});
}
export function startAddApocalypse(sim,a){
 if(a.professionId!=='MM'||!playable(sim,a)||!owned(sim,a)&&(a.hp<=0||a.pvpDead))return false;
 if(a.sourceAddSummon)return finishAddApocalypse(sim,a,'recast');
 const p=sim.profileFor(a),sk=p.skillCatalog.find(s=>s.skillId===a.skillId),g=globals(sim,a),line=basis(sim,a);
 if(!g||!sk||![29601,29604].includes(sk.skillId)||!line||typeof sim.summonPoseSampler!=='function'||typeof sim.summonAnimationDuration!=='function'){
  sim.note?.('add-apocalypse-pose-required','Original independent NPC pose, source declarations and animation durations required',a);return false;
 }
 const duration=sk.raw?.SA_EFFECTIVE_TIME?.[String(sk.maxLevel)];if(!finite(duration,0,60))return false;
 // Spawn offset 300 is explicitly qualified fixed-Add reference, while later
 // follow (-333) and manual finish (+150) offsets are original target Lua.
 const position=[a.x,a.y,a.z].map((v,i)=>f(v+line.dirVector[i]*300*a.facing));
 const npc=a.sourceAddSummon={version:ADD_SUMMON_VERSION,kind:'apocalypse',serial:a.stateSerial,skillId:sk.skillId,
  skillScale:a.skillScale??1,hyperMode:a.sourceAdd?.formation===true,position,facing:a.facing,yaw:line.yRotationDegrees,aimZ:0,
  state:'APOCALYPSE_START',stateSerial:1,animationTime:0,stateTime:0,remaining:duration,hp:a.hpMax,hpMax:a.hpMax,targetId:null,
  cooldowns:Object.fromEntries(attacks.map(n=>[n,0])),waitInterval:0};
 // Original START callback grants empty factor443/template414 to the NPC.
 // Its only behavior is the Always displayer, bound to 38 original NPC bones.
 const factor=p.buffFactors?.[443]?.raw,visual=p.buffTemplates?.[414]?.raw?.DISPLAYER?.BDT_EFFECT_SET;
 if(factor?.BUFF_TEMPLET_ID===414&&visual)for(const name of Object.values(visual))spawnSet(sim,a,npc,name,[3]);
 else sim.note?.('add-apocalypse-always-source','Original NPC factor443/template414 displayer unavailable',a);
 event(sim,a,'addSummonCreated',{serial:npc.serial,skillId:sk.skillId,position:[...position]});return true;
}
export function finishAddApocalypse(sim,a,reason='explicit'){
 const npc=a.sourceAddSummon;if(!npc||finishStates.has(npc.state)||!playable(sim,a))return false;
 const line=basis(sim,a);if(!line)return false;
 // Original APOCALYPSE_DIE_ATTACK_STATE_START is bound to FINISH_ATTACK.
 const state=reason==='hp-empty'?'APOCALYPSE_DIE_ATTACK':'APOCALYPSE_FINISH_ATTACK';
 if(state==='APOCALYPSE_FINISH_ATTACK'){
  npc.position=[a.x+line.dirVector[0]*150*a.facing,a.y,a.z].map(f);npc.facing=a.facing;npc.yaw=line.yRotationDegrees;
 }
 stateChange(sim,a,npc,state);event(sim,a,'addSummonFinishing',{serial:npc.serial,reason});return true;
}
/** Original common Lua consumes owner.ResponseEmergency and changes directly
 * to A_EMERGENCY. The owner's DamageReact flag producer is a qualified fixed
 * Add reference; callers must invoke only for an accepted owner DamageReact. */
export function triggerAddApocalypseEmergency(sim,a){
 const npc=a.sourceAddSummon;if(!npc||finishStates.has(npc.state)||!owned(sim,a))return false;
 const line=basis(sim,a);if(!line)return false;
 npc.position=[a.x,a.y,a.z].map((v,i)=>f(v+20*line.dirVector[i]));
 stateChange(sim,a,npc,'APOCALYPSE_ATTACK_A_EMERGENCY');return true;
}
function findTarget(sim,a,npc){
 const rows=sim.state.actors.map((b,i)=>({b,i,d:Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)}))
  .filter(({b,d})=>live(sim,a,b.id)&&d<=700).sort((x,y)=>x.d-y.d||x.i-y.i);
 npc.targetId=rows[0]?.b.id??null;return rows[0]?.b??null;
}
function aim(npc,target){
 const d=[target.x-npc.position[0],target.y-npc.position[1],target.z-npc.position[2]],length=Math.hypot(...d);if(!length)return;
 const desired=Math.asin(clamp(d[1]/length,-1,1))*180/Math.PI;
 let delta=desired-npc.aimZ;while(delta>180)delta-=360;while(delta< -180)delta+=360;
 npc.aimZ=f(npc.aimZ+clamp(delta,-3,3));
}
function spawnSet(sim,a,npc,name,deleteConditions=[]){
 const set=sim.profileFor(a).effectSets?.[name]?.raw;
 if(!set){sim.note?.('add-apocalypse-effect:'+name,'Original NPC EffectSet missing from frozen profile',a);return;}
 const proxy=addSummonPoseActor(a,npc);
 for(const [member,definition]of Object.entries(set))if(/^EFFECT\d+$/.test(member)){
  const e=sim.createEffect(proxy,definition,{setName:name,clock:'custom',start:definition.START_TIME??0,deleteConditions,hyperMode:npc.hyperMode});
  if(!e)continue;e.definitionMember=member;e.sourceAddSummonSerial=npc.serial;e.sourceAddSummonStateSerial=npc.stateSerial;
  updateAddSummonEffectAnchor(sim,e,a);
 }
}
/** Invoke before each effect's birth/trace sampling. Never falls through to
 * caster bones: orphaned NPC traces freeze their last original anchor. */
export function updateAddSummonEffectAnchor(sim,e,owner){
 if(e.sourceAddSummonSerial===undefined)return false;
 const npc=owner.sourceAddSummon,trace=e.definition?.TRACE===1||e.definition?.TRACE_MORE===1||e.definition?.TRACE_MATRIX===1;
 // Secondary projectiles keep their original parent-mesh birth transform;
 // identity inheritance does not make them follow the NPC skeleton.
 if(e.parentEffectId!=null&&!e.definition?.BONE_NAME&&!trace)return true;
 if(e.active&&!trace)return true;
 if(!npc||npc.serial!==e.sourceAddSummonSerial)return true;
 const anchor=sim.summonPoseSampler?.(npc,e.definition,owner);
 if(!anchor){sim.note?.('add-apocalypse-bone:'+e.definition?.BONE_NAME,'Original summon attachment bone unavailable',owner);return true;}
 // Each retained destination owns its clone. Cloning the temporary source as
 // well only copied the same original NPC bone three/four times per trace.
 const value={...anchor,customPosition:true};
 if(!e.active||!e.birthAnchor)e.birthAnchor=structuredClone(value);
 e.currentAnchor=structuredClone(value);if(trace)e.sourcePosedAnchor=structuredClone(value);[e.x,e.y,e.z]=value.position;
 e.facing=npc.facing;return true;
}
export function tickAddSummons(sim,a,dt){
 const npc=a.sourceAddSummon;if(!npc||!playable(sim,a))return;
 const g=globals(sim,a),raw=g?.[npc.state];if(!raw)return;
 if(!finishStates.has(npc.state)){
  npc.remaining=Math.max(0,f(npc.remaining-dt));
  if(npc.remaining<=0||npc.hp<=0||a.hp<=0){finishAddApocalypse(sim,a,npc.hp<=0?'hp-empty':a.hp<=0?'owner-dead':'expired');return;}
 }
 for(const name of attacks)npc.cooldowns[name]=Math.max(0,f(npc.cooldowns[name]-dt));
 const before=npc.animationTime,first=npc.stateTime===0;
 npc.stateTime=f(npc.stateTime+dt);npc.animationTime=f(npc.animationTime+dt*(raw.ANIM_SPEED??1));
 const reached=t=>(first&&t===0||before<t&&npc.animationTime>=t);
 for(const [key,value]of Object.entries(raw))if(/^SOUND_PLAY\d+$/.test(key)&&reached(value['1']))
  sim.emit?.('sound',a.id,{name:value['2'],field:key,position:[...npc.position],sourceSummonSerial:npc.serial});
 if(npc.state==='APOCALYPSE_WAIT'){
  const line=basis(sim,a);if(line){const goal=[a.x,a.y,a.z].map((v,i)=>v-333*line.dirVector[i]*a.facing);goal[1]+=a.facing===1?100:50;
   npc.position=npc.position.map((v,i)=>f(goal[i]*.1+v*.9));npc.facing=a.facing;npc.yaw=line.yRotationDegrees;}
  npc.waitInterval=Math.max(0,f(npc.waitInterval-dt));
  if(npc.waitInterval<=0){npc.waitInterval=raw.EVENT_INTERVAL_TIME0;const target=findTarget(sim,a,npc);
   if(target)for(const row of Object.values(raw.EVENT_PROCESS??{})){
    const state=row['2'],condition=raw[row['3']];
    if(attacks.includes(state)&&npc.cooldowns[state]<=0&&condition&&Math.hypot(target.x-npc.position[0],target.y-npc.position[1],target.z-npc.position[2])<=condition.DISTANCE_TO_TARGET_NEAR){stateChange(sim,a,npc,state);break;}
   }
  }
  return;
 }
 const target=live(sim,a,npc.targetId)??findTarget(sim,a,npc);
 // Original callbacks preserve B-before-fire and A/C-after-fire aiming order.
 if(npc.state==='APOCALYPSE_ATTACK_B'&&target)aim(npc,target);
 for(const row of Object.values(raw.EFFECT_SET_LIST_EX??{}))if(reached(row['2']))spawnSet(sim,a,npc,row['1'],row['3']?[row['3']]:[]);
 const callback=npc.state==='APOCALYPSE_ATTACK_A'||npc.state==='APOCALYPSE_ATTACK_A_EMERGENCY'?
  [1.4,'EffectSet_SI_HA_AMM_Apocalypse_Attack_A_Projectile_PVP']:npc.state==='APOCALYPSE_ATTACK_B'?
   [.4,'EffectSet_SI_HA_AMM_Apocalypse_Attack_B_Projectile_PVP']:npc.state==='APOCALYPSE_ATTACK_C'?
    [1.8,'EffectSet_SI_HA_AMM_Apocalypse_Attack_C_PVP']:null;
 if(callback&&reached(callback[0]))spawnSet(sim,a,npc,callback[1]);
 if(callback&&npc.state!=='APOCALYPSE_ATTACK_B'&&target)aim(npc,target);
 const duration=sim.summonAnimationDuration?.(npc,npc.state,a);
 if(!finite(duration,0,120)){sim.note?.('add-apocalypse-animation:'+npc.state,'Original NPC duration unavailable',a);return;}
 if(npc.animationTime>=duration){
  if(finishStates.has(npc.state)){
   for(const e of sim.state.effects)if(e.ownerId===a.id&&e.sourceAddSummonSerial===npc.serial&&e.deleteConditions?.includes(3)){
    e.dead=true;e.endReason='summon-ended';
   }
   event(sim,a,'addSummonEnded',{serial:npc.serial});a.sourceAddSummon=null;
  }
  else stateChange(sim,a,npc,'APOCALYPSE_WAIT');
 }
}
export function npcHitTargets(sim){
 return sim.state.actors.flatMap(owner=>{
  if(owner.pvpDisconnected)return [];
  const s=owner.sourceAddSummon;if(!s||s.hp<=0||finishStates.has(s.state))return [];
  const raw=globals(sim,owner)?.[s.state],window=raw?.INVINCIBLE;
  const invincible=window&&s.animationTime>=window['1']&&s.animationTime<=window['2'];
  const actor={...addSummonPoseActor(owner,s),id:owner.id+':apocalypse:'+s.serial,sourceSummonOwnerId:owner.id,
   sourceSummonSerial:s.serial,invincible:!!invincible,superArmor:true,superArmorNotRed:true};
  return [{owner,npc:s,actor,spheres:sim.summonDefenderSampler?.(s,owner)??[]}];
 });
}
export function applyAddSummonDamage(sim,target,amount){
 const a=sim.state.actors.find(a=>a.id===target.sourceSummonOwnerId),s=a?.sourceAddSummon;
 if(!s||a.pvpDisconnected||s.serial!==target.sourceSummonSerial||!owned(sim,a)||target.invincible||finishStates.has(s.state)||!finite(amount))return false;
 const before=s.hp;s.hp=Math.max(0,f(s.hp-amount));
 event(sim,a,'addSummonDamaged',{serial:s.serial,before,hp:s.hp,amount:before-s.hp});
 if(s.hp<=0)finishAddApocalypse(sim,a,'hp-empty');return true;
}

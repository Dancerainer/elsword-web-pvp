/** Replaceable movement only. This domain cannot acknowledge controls, create
 * an attack, or change either player's combat resources/protection. */
export const OWNED_MOTION_PROTOCOL='owner-motion-v1';
export const OWNED_MOTION_FIELDS=Object.freeze(['x','y','z','vx','vy','vz','facing','grounded','lineId','landPosition']);
// Only non-attacking victim-owned phases may bypass the ordered action lane.
// A checkpoint cannot carry damage, protection, buffs, resources or effects.
export const PASSIVE_REACTION_STATES=Object.freeze(['RSI_DAMAGE_SMALL_FRONT','RSI_DAMAGE_SMALL_BACK','RSI_DAMAGE_BIG_FRONT','RSI_DAMAGE_BIG_BACK',
  'RSI_DAMAGE_AIR_SMALL','RSI_DAMAGE_AIR_UP','RSI_DAMAGE_AIR_FALL','RSI_DAMAGE_AIR_DOWN',
  'RSI_DAMAGE_AIR_DOWN_INVINCIBLE','RSI_DAMAGE_AIR_FLY_FRONT','RSI_DAMAGE_AIR_FLY_BACK',
  'RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_DOWN_LANDING',
  'RSI_DAMAGE_STANDUP_FRONT','RSI_DAMAGE_STANDUP_BACK']);
export const PASSIVE_LOCOMOTION_STATES=Object.freeze(['RSI_WAIT','ESSI_SWORD_WAIT','RSI_WALK','RSI_DASH','RSI_DASH_END']);
const reactionFields=['state','stateSerial','stateTime','animationName','animationTime','animationPlaybackSpeed',
  'animationStopped','hitStop','worldStop','downForce','flyCount','lastAttackerFront'];
function validReaction(value,states=PASSIVE_REACTION_STATES){
  return plain(value)&&Object.keys(value).length===reactionFields.length&&Object.keys(value).every(key=>reactionFields.includes(key))
    &&states.includes(value.state)&&safe(value.stateSerial)&&typeof value.animationName==='string'&&value.animationName.length<=128
    &&['stateTime','animationTime','animationPlaybackSpeed','hitStop','worldStop'].every(key=>Number.isFinite(value[key])&&value[key]>=0&&value[key]<=3600)
    &&['animationStopped','downForce','lastAttackerFront'].every(key=>typeof value[key]==='boolean')&&safe(value.flyCount);
}
const safe=value=>Number.isSafeInteger(value)&&value>=0;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
export function validateOwnedMotion(value,map){
  if(!plain(value)||Object.keys(value).some(key=>!['protocol','epoch','frameSeq','actor','movementHeld','reaction','locomotion'].includes(key))||
    value.protocol!==OWNED_MOTION_PROTOCOL||!safe(value.epoch)||!safe(value.frameSeq)||!plain(value.actor))throw new TypeError('invalid-owner-motion');
  if(value.movementHeld!==undefined&&(!Array.isArray(value.movementHeld)||value.movementHeld.length>4||new Set(value.movementHeld).size!==value.movementHeld.length||
    value.movementHeld.some(key=>!['LEFT','RIGHT','UP','DOWN'].includes(key))))throw new TypeError('invalid-owner-motion-held');
  const actor=value.actor;
  if(Object.keys(actor).length!==OWNED_MOTION_FIELDS.length||Object.keys(actor).some(key=>!OWNED_MOTION_FIELDS.includes(key))||
    !['x','y','z','vx','vy','vz'].every(key=>Number.isFinite(actor[key]))||![1,-1].includes(actor.facing)||typeof actor.grounded!=='boolean'||
    !(actor.lineId===null||safe(actor.lineId))||!Array.isArray(actor.landPosition)||actor.landPosition.length!==3||!actor.landPosition.every(Number.isFinite))
    throw new TypeError('invalid-owner-motion-actor');
  if(value.reaction!==undefined&&!validReaction(value.reaction))throw new TypeError('invalid-owner-motion-reaction');
  if(value.locomotion!==undefined&&(!validReaction(value.locomotion,PASSIVE_LOCOMOTION_STATES)||!actor.grounded||value.reaction!==undefined))throw new TypeError('invalid-owner-motion-locomotion');
  if(actor.lineId!==null&&map?.lines&&!map.lines.some(line=>line.lineId===actor.lineId))throw new TypeError('unknown-owner-motion-line');
  return {...value,...(value.reaction?{reaction:{...value.reaction}}:{}),...(value.locomotion?{locomotion:{...value.locomotion}}:{}),...(value.movementHeld?{movementHeld:[...value.movementHeld]}:{}),actor:{...actor,landPosition:[...actor.landPosition]}};
}
export function encodeOwnedMotion(report,{held,includeReaction=false}={}){
  const reaction=includeReaction&&PASSIVE_REACTION_STATES.includes(report.actor.state)?Object.fromEntries(reactionFields.map(key=>[key,report.actor[key]])):null;
  const locomotion=includeReaction&&report.actor.grounded&&PASSIVE_LOCOMOTION_STATES.includes(report.actor.state)?Object.fromEntries(reactionFields.map(key=>[key,report.actor[key]])):null;
  return validateOwnedMotion({protocol:OWNED_MOTION_PROTOCOL,epoch:report.epoch,frameSeq:report.frameSeq,
    ...(reaction&&validReaction(reaction)?{reaction}:{}),
    ...(locomotion&&validReaction(locomotion,PASSIVE_LOCOMOTION_STATES)?{locomotion}:{}),
    ...(held?{movementHeld:held.filter(key=>['LEFT','RIGHT','UP','DOWN'].includes(key))}:{}),
    actor:Object.fromEntries(OWNED_MOTION_FIELDS.map(key=>[key,key==='lineId'?report.actor[key]??null:key==='vz'?report.actor[key]??0:report.actor[key]]))});
}

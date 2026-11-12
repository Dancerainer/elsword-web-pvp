import {isElswordProfession} from '../professions/identity.mjs';
/** Elsword (not Elesis) consumers from fixed a8438f3 SwordMan/DamageManager.
 * Target2016 supplies WOS types, thresholds and rage cost. The hardcoded
 * factors below remain explicitly qualified V5 consumer references. */
import {wayOfSwordFields} from './lord-knight.mjs';
export const LK_WOS_CONSUMER='target2016-fields+fixedV5-Elsword-WOS-consumer-v2';
const f=Math.fround;
const isLk=a=>isElswordProfession(a.professionId)&&a.wayOfSword;
const sustainedBodyParticles=new Set(['vitality','demolition'].flatMap(kind=>
  [1,2,3,4].map(i=>`elswrod_${kind}_0${i}`)));
/** Target Start-set EFFECT0..3 have TriggerTime 1e8/1e9 and are stopped by
 * SwordMan's stored set handle on mode exit. The finite *_wake_* members keep
 * their existing particle-runtime lifetime; retaining a set is not permission
 * to restart or hold its entry flashes in later owner snapshots. */
export function ownsWayOfSwordBodyEffect(actor,effect){
  return sustainedBodyParticles.has(effect.name)&&
    actor.sourceWayOfSwordEffectGroup?.some(entry=>entry.id===effect.id)===true;
}
export function lordKnightWaitDefinition(profile,actor,definition){
  if(definition?.sourceState!=='ESSI_SWORD_WAIT')return definition;
  const animationName=actor.hp<=actor.hpMax*.25?'Fatal':actor.wayOfSword?.state===2?'Wait_W0':actor.wayOfSword?.state===-2?'Wait_W1':'Wait';
  const clip=profile.clips[animationName];if(!clip)throw new TypeError('Missing target2016 sword wait clip '+animationName);
  return {...definition,animationName,clip};
}
export function wayOfSwordMpCostMultiplier(actor,skill){
  // Target2016 renamed m_iWOSType to m_usWOSType; its 2 remains vitality.
  return isLk(actor)&&actor.wayOfSword.state===2&&skill.raw?.m_usWOSType===2?f(.7):1;
}
export function wayOfSwordMpCost(actor,skill,cost){
  const multiplier=wayOfSwordMpCostMultiplier(actor,skill);return multiplier===1?cost:f(f(cost)*multiplier);
}
export function wayOfSwordHitPolicy(actor,data){
  const state=isLk(actor)?actor.wayOfSword.state:0,type=data.WAY_OF_SWORD_TYPE;
  return {damage:state===-2?(type===4?2:[5,6].includes(type)?1.5:1):1,
    mp:state===2?(type===1?3:[2,3].includes(type)?4:1):1};
}
export function wayOfSwordReceivedMpMultiplier(actor){return isLk(actor)&&actor.wayOfSword.state===2?2:1;}
export function wayOfSwordRageEligible(actor,data){
  return Boolean(isLk(actor)&&actor.wayOfSword.state===-2&&!actor.superArmor&&!(actor.destructionRageRemaining>0)
    &&![0,7,10].includes(data.REACT_TYPE??0)&&!actor.invincible&&actor.hp>0&&actor.grounded);
}
export function wayOfSwordRageCost(profile,{pvp=true}={}){
  const v=wayOfSwordFields(profile),cost=v?.Const_DestRageWSPGain,mode=v?.[pvp?'GameModeConst_PVP_Hit':'GameModeConst_NPC_Hit'];
  if(!Number.isFinite(cost)||!Number.isFinite(mode))throw new TypeError('Missing target2016 destruction rage cost');
  return f(f(cost)*f(mode));
}
export function advanceDestructionRage(actor,elapsed){
  if(!isLk(actor)||!Number.isFinite(actor.destructionRageRemaining))return;
  // SwordMan7556: an independently armored state pauses this timer. This
  // runs after the raw protection has been recomputed, not on last-frame SA.
  if(actor.superArmor)return;
  actor.destructionRageRemaining=f(actor.destructionRageRemaining-f(elapsed));
  if(actor.destructionRageRemaining<0)actor.destructionRageRemaining=0;
  else {actor.superArmor=true;actor.superArmorNotRed=false;}
}
export function preserveDestructionArmor(actor){
  if(isLk(actor)&&actor.destructionRageRemaining>0){actor.superArmor=true;actor.superArmorNotRed=false;}
}
export function synchronizeWayOfSwordPresentation(sim,actor,change,{updateWait=true}={}){
  if(change.before.state===change.after.state)return;
  const mode=s=>s===2?'Vigor':s===-2?'Destruction':null,before=mode(change.before.state),after=mode(change.after.state);
  if(before){
    sim.stopSkillEffectGroup(actor,'sourceWayOfSwordEffectGroup','way-of-sword-ended');
    sim.spawnSet(actor,'EffectSet_'+before+'End');
    sim.emit('sound',actor.id,{name:before==='Vigor'?'elsword_vitality_end.ogg':'elsword_demolition_end.ogg',field:LK_WOS_CONSUMER});
  }
  if(after){
    const first=sim.state.nextEffectId;sim.spawnSet(actor,'EffectSet_'+after+'Start');
    actor.sourceWayOfSwordEffectGroup=sim.state.effects.filter(e=>e.id>=first&&e.ownerId===actor.id).map(e=>({id:e.id,name:e.name,setName:e.setName}));
    sim.emit('sound',actor.id,{name:after==='Vigor'?'elsword_vitality_use_VOX.ogg':'elsword_demolition_use_VOX.ogg',field:LK_WOS_CONSUMER});
  }
  if((before||after)&&updateWait&&['RSI_WAIT','ESSI_SWORD_WAIT'].includes(actor.state))sim.enter(actor,'RSI_WAIT','way-of-sword-wait-changed');
}
export function startDestructionRage(sim,actor){
  actor.destructionRageRemaining=6;actor.vx=0;actor.vy=0;
  // Existing extra-damage host only has registered stun identities. Clear
  // those without deleting unrelated buffs; other source cures stay absent.
  for(const buff of actor.buffs)for(const row of buff.behaviors)if(row.kind==='stun')row.identityCleared=true;
  if(actor.buffControls){actor.buffControls.inputBlock=false;actor.buffControls.stun=false;}
  actor.inputLock=0;
  sim.applyWayOfSwordDelta(actor,wayOfSwordRageCost(sim.profileFor(actor),{pvp:sim.presetFor(actor).gameMode!=='NPC'}),'destruction-rage');
  sim.enter(actor,'ESSI_DESTRUCTION_RAGE','way-of-sword-destruction-rage');
  preserveDestructionArmor(actor);
  const position=[actor.x,actor.y+80,actor.z],name='ELSWORD_ANGRY_WIND';
  if(sim.profileFor(actor).damageEffects[name])sim.createEffect(actor,{NAME:name},{birthAnchor:{position,facing:actor.facing},sourceLandY:actor.landPosition?.[1]??actor.y});
  sim.emit('destructionRageStarted',actor.id,{ownerStateSerial:actor.stateSerial,remaining:6,position,cost:wayOfSwordRageCost(sim.profileFor(actor),{pvp:sim.presetFor(actor).gameMode!=='NPC'}),
    particles:['MonsterAngryWind','Counter_Particle01'],evidenceClass:LK_WOS_CONSUMER});
}

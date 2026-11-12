/** Elesis Chivalry: target2016 declarations + bounded fixed EL/GageData
 * consumer reference. No Elsword destruction immunity/6s rage is inherited. */
import {isElesisProfession} from '../professions/identity.mjs';
import {wayOfSwordFields,wayOfSwordHitDelta,wayOfSwordReceivedDelta} from './lord-knight.mjs';
import {synchronizeBuffStats} from './passive-attributes-v20.mjs';
import {resolveElesisState} from './elesis-commands.mjs';
import {isDamagedReaction} from './reaction-policy.mjs';
const f=Math.fround,enabled=a=>isElesisProfession(a.professionId)&&a.wayOfSword;
export const ELESIS_SWORD_RULE='target2016+qualified-EL-GageData-chivalry-v1';
export function elesisSwordCost(a,skill,value,{gameMode='PVP'}={}){return enabled(a)&&a.wayOfSword.state===2&&skill.raw?.m_usWOSType===2?f(f(value)*f(gameMode==='NPC'?.6:.8)):value;}
export function elesisSwordCooldown(a,skill,value,{gameMode='PVP'}={}){return enabled(a)&&a.wayOfSword.state===2&&skill.raw?.m_usWOSType===2?f(f(value)*f(gameMode==='NPC'?.2:.6)):value;}
export function elesisSwordHitPolicy(a,data,{gameMode='PVP'}={}){
 const active=enabled(a),destruction=active&&a.wayOfSword.state===-2&&[4,5,6].includes(data.WAY_OF_SWORD_TYPE);
 return {damage:destruction&&data.WAY_OF_SWORD_TYPE===4?(gameMode==='NPC'?1.5:1.25):1,mp:1,forceCritical:!!destruction};
}
export function elesisSwordDamage(a,data,{gameMode='PVP',skillId}={}){
 if(!enabled(a))return data;
 // Target28403 explicitly adds50% only to these two skills in Annihilation.
 if(a.wayOfSword.state===-2&&a.passivePolicy?.skillLevels?.[28403]&&[28217,28219].includes(skillId))data={...data,DAMAGE:Object.fromEntries(Object.entries(data.DAMAGE??{}).map(([k,v])=>[k,typeof v==='number'?f(v*1.5):v]))};
 if(a.wayOfSword.state===2&&data.WAY_OF_SWORD_TYPE===1&&Number.isFinite(data.FORCE_DOWN))return {...data,FORCE_DOWN:f(f(data.FORCE_DOWN)*f(gameMode==='NPC'?.6:.8))};
 if(a.wayOfSword.state===-2&&[4,5,6].includes(data.WAY_OF_SWORD_TYPE))return {...data,IGNORE_STATE_DEFENCE:1};
 return data;
}
const darkForcePointRate=a=>a.passivePolicy?.elesis?.rawValues?.[28410]?.SA_WAY_OF_SWORD_POINT_MULTIPLIER??1;
export function elesisSwordReceivedDelta(profile,a,data){return a.wayOfSword?.state===2?0:f(wayOfSwordReceivedDelta(profile,a.wayOfSword,data)*darkForcePointRate(a));}
export function elesisSwordAttackDelta(profile,a,data,power){return f(wayOfSwordHitDelta(profile,a.wayOfSword,data,power)*darkForcePointRate(a));}
function removeBuffs(sim,a,ids,reason){const old=a.buffs.filter(b=>ids.includes(b.templateId));a.buffs=a.buffs.filter(b=>!ids.includes(b.templateId));
 for(const buff of old){for(const e of sim.state.effects)if(e.ownerId===a.id&&e.buffTemplateId===buff.templateId){e.dead=true;e.endReason=reason;}sim.emit('buffFinished',a.id,{templateId:buff.templateId,reason});}synchronizeBuffStats(a);}
export function synchronizeElesisSword(sim,a,change,{updateWait=true}={}){
 if(!enabled(a)||change.before.state===change.after.state)return;
 const before=change.before.state,after=change.after.state,ca=a.professionId==='CA';
 if(Math.abs(before)===2){removeBuffs(sim,a,[240,247,434,435],'elesis-chivalry-ended');
  sim.spawnSet(a,ca?(before===2?'EffectSet_P_SDK_DARK_FORCE_J_End':'EffectSet_P_SDK_DARK_FORCE_S_End'):(before===2?'EffectSet_VigorEnd':'EffectSet_DestructionEnd'));
  sim.emit('sound',a.id,{name:before===2?'elsword_vitality_end.ogg':'elsword_demolition_end.ogg'});
 }
 if(Math.abs(after)===2){const pvp=sim.presetFor(a).gameMode!=='NPC';sim.grantBuff(a,a,after===2?(ca?473:237):(ca?(pvp?472:471):(pvp?247:246)),1);
  sim.emit('sound',a.id,{name:after===2?'elsword_vitality_use_VOX.ogg':'elsword_demolition_use_VOX.ogg'});
 }
 if(after!==-2){a.sourceElesisBreakCharge=0;a.manaBreak.charge=0;}
 if(updateWait&&['RSI_WAIT','ESI_SWORD_WAIT'].includes(a.state))sim.enter(a,'RSI_WAIT','elesis-chivalry-wait');
}
export function elesisWaitDefinition(profile,a,d){if(!enabled(a)||d?.sourceState!=='ESI_SWORD_WAIT')return d;const animationName=a.hp<=a.hpMax*.25?'Fatal':a.wayOfSword.state===2?'Wait_W0':a.wayOfSword.state===-2?'Wait_W1':'Wait';return profile.clips[animationName]?{...d,animationName,clip:profile.clips[animationName]}:d;}
/** GageData967: destruction charges independently of available MP. The
 * network keeps the 0..2000 source value separate from the shared 0..300 bar. */
export function advanceElesisBreakCharge(a,dt){
 if(isElesisProfession(a.professionId)){
  // GameUnit252 constructs ComboManager(1.3f). Reset the bounded local
  // counter when its source interval expires; leaving Gale does not reset it.
  if((a.sourceElesisComboRemaining??0)<=0)a.sourceElesisGaleHits=0;
  a.sourceElesisComboRemaining=Math.max(0,f((a.sourceElesisComboRemaining??0)-f(dt)));
 }
 if(!enabled(a)||a.wayOfSword.state!==-2){if(isElesisProfession(a.professionId))a.sourceElesisBreakCharge=0;return false;}
 const m=a.manaBreak,can=m.canCharge&&!m.noDetonation;
 a.sourceElesisBreakCharge=can?Math.min(2000,f(f(a.sourceElesisBreakCharge??0)+f(3000*f(dt)))):0;
 m.charge=f(a.sourceElesisBreakCharge*.05);m.maxCharge=100;m.availableMax=100;m.minimumCharge=100;m.canCharge=false;
 return true;
}
export function elesisBreakEligible(a,data){return !!(enabled(a)&&a.wayOfSword.state===-2&&(a.sourceElesisBreakCharge??0)>=2000&&!data.NO_DETONATION&&!data.NO_DAMAGE&&!a.invincible&&a.hp>0&&isDamagedReaction(data));}
export function elesisEnduranceEligible(a,data){return !!(enabled(a)&&a.buffs.some(b=>b.templateId===238)&&!a.superArmor&&!a.invincible&&a.hp>0&&![0,7,10].includes(data.REACT_TYPE??0));}
export function elesisEnduranceCast(sim,a,skill,{priorSkill}){
 if(!enabled(a)||![28201,28218].includes(skill.skillId))return false;
 for(const factor of Object.values(skill.raw.BUFF_FACTOR??{}))sim.grantBuff(a,a,factor,a.skillContext?.level??skill.maxLevel);
 if(!Object.keys(skill.raw.BUFF_FACTOR??{}).length)sim.grantBuff(a,a,sim.presetFor(a).gameMode==='NPC'?232:423,a.skillContext?.level??skill.maxLevel);
 a.sourceElesisEndurance={upgraded:skill.skillId===28218,skillId:skill.skillId,level:a.skillContext?.level??skill.maxLevel};
 sim.spawnSet(a,'EffectSet_ELSWORD_ENDURANCE');sim.emit('sound',a.id,{name:'Elsword_Endurance.ogg'});
 Object.assign(a,priorSkill);return true;
}
/** The target shock is a real NO_DAMAGE/FORCE_FLY carrier. It is spawned via
 * its original mesh helper, never a distance shortcut or an invented HP hit.
 * Pinned source's new RAGE state is absent in 2016: map to the original ACTIVE
 * state explicitly and suppress its ordinary Endurance buff for WOS bursts. */
export function startElesisBurst(sim,a,{chivalry=false}={}){
 const p=sim.profileFor(a),endurance=a.sourceElesisEndurance;
 if(chivalry){const fields=wayOfSwordFields(p),cost=f(f(fields.Const_DestRageWSPGain_Elesis)*f(fields[sim.presetFor(a).gameMode==='NPC'?'GameModeConst_NPC_Hit':'GameModeConst_PVP_Hit']));
  const delta=Math.min(cost,-a.wayOfSword.point);sim.applyWayOfSwordDelta(a,delta,'elesis-annihilation-break');a.sourceElesisBreakCharge=0;a.manaBreak.charge=0;
 }else removeBuffs(sim,a,[238],'elesis-endurance-triggered');
 const state=resolveElesisState(p,endurance?.upgraded&&!chivalry?'ESI_SA_A_EL_ENDURANCE_POWER_ACTIVE_MEMO':'ESI_SA_A_EL_ENDURANCE_POWER_ACTIVE');
 a.sourceElesisBurst={chivalry};a.skillId=null;a.skillContext=null;a.skillScale=1;a.vx=0;a.vy=0;a.inputLock=0;
 sim.enter(a,state,'elesis-counter-burst',{directChange:true});
 const punish=!chivalry&&(a.passivePolicy?.elesis?.rawValues?.[28413]?.SA_ATK_REL??0)>0;
 sim.spawnSet(a,punish?'EffectSet_EL_ENDURANCE_POWER_PUNISH':'EffectSet_EL_ENDURANCE_POWER');
 if(chivalry)sim.grantBuff(a,a,248,1);
 sim.emit('elesisBurstStarted',a.id,{chivalry,mpCost:0,effectSet:punish?'EffectSet_EL_ENDURANCE_POWER_PUNISH':'EffectSet_EL_ENDURANCE_POWER',source:ELESIS_SWORD_RULE});
}
export function elesisSwordEvent(sim,a){
 if(!enabled(a))return false;const p=sim.profileFor(a),d=p.states[a.state],n=d.sourceState??a.state;
 if(n==='ESI_CAN_NOT_ATTACK_JUMP_DOWN'){
  if(a.grounded)sim.enter(a,'RSI_JUMP_LANDING','elesis-burst-landing');return true;
 }
 if(!/^ESI_SA_A_EL_ENDURANCE_POWER_ACTIVE(?:_MEMO)?$/.test(n))return false;
 if(!a.grounded){a.y-=p.referenceSemantics.lineRadius*1.5;sim.enter(a,'ESI_CAN_NOT_ATTACK_JUMP_DOWN','elesis-burst-air');}
 else if(a.animationStopped||f(a.animationTime)>f(d.clip.durationSeconds-Math.max(d.clip.durationSeconds/10,.03)))sim.enter(a,'RSI_WAIT','elesis-burst-end');
 return true;
}
export function elesisSwordOnHit(sim,a,data){if(!enabled(a)||data.NO_DAMAGE||[0,7,10].includes(data.REACT_TYPE??0))return;
 a.sourceElesisGaleHits=(a.sourceElesisGaleHits??0)+1;a.sourceElesisComboRemaining=f(1.3);
 if(a.wayOfSword.state===2&&a.sourceElesisGaleHits%5===0)sim.grantBuff(a,a,245,1);
}
export function createElesisResourcePools(){const retain=(balance,{scoreDifference})=>scoreDifference>0?0:balance;return [{id:'elesis-gale',read:a=>enabled(a)?Math.max(0,a.wayOfSword.point):null,retain,write:(a,v)=>restore(a,v,1)},{id:'elesis-annihilation',read:a=>enabled(a)?Math.max(0,-a.wayOfSword.point):null,retain,write:(a,v)=>restore(a,v,-1)}];}
// EL ReInit4042–4080 preserves a nonleading gauge while ending its active mode.
function restore(a,v,side){if(v>0||Math.sign(a.wayOfSword.point)===side||a.wayOfSword.point===0)a.wayOfSword.point=v===0?0:f(side*v);a.wayOfSword.state=Math.sign(a.wayOfSword.point);}

import {isDamagedReaction} from './reaction-policy.mjs';

/** Fixed V5 consumer candidate, not a measured target2016 result. The target
 * RF/LK declarations supply MP_CHANGE_RATE=1; contracts/pvp-resource-source-v1.json
 * freezes the independent source equations and the web frame/ownership adapter.
 */
export const PVP_RESOURCE_FORMULA_VERSION='pvp-resource-reference-v1';
const f=Math.fround;
const finite=(value,label)=>{
  if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`${label} must be finite`);
  return value;
};
const nonnegative=(value,label)=>{
  finite(value,label);if(value<0)throw new RangeError(`${label} must be nonnegative`);return value;
};
const resourceKind=kind=>{
  if(kind!=='hit'&&kind!=='received')throw new TypeError('resource kind must be hit/received');
};
const rosterDeficit=value=>{
  if(!Number.isInteger(value)||value<0)throw new RangeError('outnumbered must be a nonnegative integer');
  return value;
};

/** GUUser AttackResult/DamageReact and DamageEffect AttackResult share ONE
 * m_bUpMPThisFrame. MP and soul live inside the same gate, even when MP is full
 * or HIT_ADD_MP is zero. The local simulation step replaces CommonFrameMove's
 * reset; keep this field on the owner actor and never import it from a peer.
 *
 * DUMMY_DAMAGE is a damaged reaction in the source and can recover resources.
 * NO_DAMAGE blocks the receiver's DamageReact branch; it is not an extra
 * attack-result gate. DT_BUFF is explicitly excluded in the attack callback.
 * The receiver relies on its reaction/NO_DAMAGE routing (GUUser:8940), not an
 * invented extra DT_BUFF condition. Ordinary buff ticks bypass this hit route.
 */
export function consumePvpResourceFrame(actor,data,step,{kind,originKind='character'}={}){
  resourceKind(kind);
  if(!Number.isInteger(step)||step<0)throw new RangeError('resource step must be a nonnegative integer');
  if(!actor||!data)throw new TypeError('resource actor and damage data required');
  const reaction=data.REACT_TYPE??0;
  const eligible=kind==='received'
    ? isDamagedReaction(data)&&!data.NO_DAMAGE
    : data.DAMAGE_TYPE!==6&&reaction!==0&&!(reaction===10&&originKind!=='effect');
  if(!eligible||actor.lastCombatResourceStep===step)return false;
  actor.lastCombatResourceStep=step;
  return true;
}

/** Equipment MP gain is a final option percentage, not a rating. For attacks,
 * SetDamageExceptionProcess applies it to HIT_ADD_MP before roster +3*n. For
 * received hits, AdditionalChargeMpHitted applies it after (3+2*n)*guild/WoS.
 * Traits/passives/guild/WoS/final buff factors must be supplied once in
 * gainMultiplier; absent equipment is a neutral factor, not a known raw stat.
 */
export function pvpMpGain({kind,hitAddMp=0,outnumbered=0,equipmentMpGainBonus=0,gainMultiplier=1}){
  resourceKind(kind);rosterDeficit(outnumbered);
  const option=f(1+nonnegative(equipmentMpGainBonus,'equipment MP gain bonus'));
  const multiplier=f(nonnegative(gainMultiplier,'MP gain multiplier'));
  const base=kind==='hit'
    ? f(f(f(nonnegative(hitAddMp,'HIT_ADD_MP'))*option)+f(3*outnumbered))
    : f(3+2*outnumbered);
  return kind==='hit'?f(base*multiplier):f(f(base*multiplier)*option);
}

/** Base*(1+equipment)+2*n is formed before the additive guild/passive increases.
 * The target RF24404 +9% binding remains the existing target-description
 * adaptation, separately qualified in its original passive contract.
 */
export function pvpAwakeningGain(actor,kind,base,guildGains={},pvpGains={}){
  resourceKind(kind);
  const missing=rosterDeficit(pvpGains.outnumbered??0);
  const policy=actor.passivePolicy;
  let addition=f(finite((kind==='hit'?policy?.soul?.onHitAdd:policy?.soul?.receivedAdd)??0,'passive soul addition'));
  if(kind==='received'&&policy?.skillLevels?.[24404])
    addition=f(addition+finite(policy.received.unresolvedSoulField,'24404 SA_SOUL_ABS'));
  addition=f(addition+finite((kind==='hit'?guildGains.onHitSoulAdd:guildGains.receivedSoulAdd)??0,'guild soul addition'));
  const equipment=f(nonnegative(actor.stats?.awakeningChargeBonus??0,'equipment awakening charge bonus'));
  return f(f(f(f(nonnegative(base,'awakening base'))*f(1+equipment))+f(2*missing))*f(1+addition));
}

/** The MP gate can be consumed while healing data suppresses soul separately.
 * The caller also caps at three orbs. Unlike attack, the received soul branch
 * only checks positive HP restoration (GUUser:9824 and 12542-12618).
 */
export function pvpAwakeningEligible(data,kind){
  resourceKind(kind);
  return (data.HP_PERCENT_UP??0)<=0 && (kind==='received'||((data.MP_PERCENT_UP??0)<=0&&(data.INCREASE_MP??0)<=0));
}

/** GageData:67 uses (characterRate+itemRate)*elapsed; socket MP_CHANGE_VALUE
 * is a separate flat rate. Only an explicitly selected PCC_PLAY channel scales
 * character rate by 7. The simulation must pass its unfrozen elapsed time and
 * update owned actors only. Missing source MP_CHANGE_RATE stays unsupported.
 */
export function naturalMpGain({baseRate,elapsed,equipmentRate=0,equipmentElapsed=elapsed,itemRate=0,channel='normal'}){
  nonnegative(elapsed,'natural MP elapsed');
  nonnegative(equipmentElapsed,'equipment MP elapsed');
  if(baseRate===undefined||baseRate===null)return null;
  finite(baseRate,'source MP_CHANGE_RATE');finite(equipmentRate,'equipment MP recovery rate');finite(itemRate,'item MP recovery rate');
  if(channel!=='normal'&&channel!=='play')throw new TypeError('natural MP channel must be normal/play');
  const gauge=f(f(f(f(baseRate)*f(channel==='play'?7:1))+f(itemRate))*f(elapsed));
  return f(gauge+f(f(equipmentRate)*f(equipmentElapsed)));
}

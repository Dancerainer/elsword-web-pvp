/** Target2016 numeric declarations with explicitly qualified host composition.
 * Proc->SELF factor437 is user-confirmed target behavior; the acquired fixed
 * V5 source predates that registration. No native modules or RNG are replaced.
 */
import {usesPvpEquipmentFormulas} from './equipment-attributes.mjs';
import {composeEquipmentSpeedAttributes} from './equipment-speed-formulas.mjs';
import {actorSourceAccuracy2016} from './source-miss-host-v53.mjs';
const f=Math.fround;
const number=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(label+' must be finite');return value;};
const bonus=(value,label)=>{value=number(value??0,label);if(value<0||value>1)throw new RangeError(label+' must be in [0,1]');return value;};

/** Called exactly once, after the separately executed Focus Strength +1000.
 * buffBaseStats must be captured AFTER this operation, never from equipment.
 */
export function applyTargetPassiveAttributes(stats,policy,{equipmentPercent=false}={}){
  if(policy?.professionId==='RS'){
    // GSUserFunction CalculateSkillUnitStat snapshots the complete ranked
    // equipment + guild stats. RuneMastery adds trunc(baseMagic*(ratio-1));
    // MagicResistance assigns trunc(baseDefence*ratio). 21405 did not exist
    // in V5: its explicit target physical-to-magic description is a qualified
    // adapter on that same snapshot, kept separate from the6% magic channel.
    const magic=number(stats.magicAttack,'magicAttack'),physical=number(stats.physicalAttack,'physicalAttack');
    const increase=(base,ratio)=>Math.trunc(f(f(base)*f(f(number(ratio,'RS stat ratio'))-1)));
    const defence=stats.magicDefence===undefined?{}:{magicDefence:Math.trunc(f(f(stats.magicDefence)*f(policy.stats.magicDefenceMultiplier)))};
    return {...stats,...defence,magicAttack:f(magic+increase(magic,policy.stats.magicAttackMultiplier)+increase(physical,policy.stats.physicalToMagicMultiplier)),
      damageReduction:bonus(stats.damageReduction,'equipment damageReduction'),
      awakeningChargeBonus:bonus(stats.awakeningChargeBonus,'equipment awakeningChargeBonus')};
  }
  const magic=policy?.skillLevels?.[24405]?number(policy.awakening.unresolvedMagicAttackMultiplier,'24405 SA_ATK_MAGIC_REL'):1;
  const magicBase=f(number(stats.magicAttack,'magicAttack'));
  return {...stats,magicAttack:policy?.skillLevels?.[24405]?f(magicBase+magicBase*f(f(magic)-1+4.999999873689376e-5)):magicBase,
    ...(policy?.bladeMaster?{criticalRate:f((stats.criticalRate??0)+policy.bladeMaster.criticalRateAdd*(equipmentPercent?100:1)),
      animationSpeedMultiplier:f(stats.animationSpeedMultiplier*policy.bladeMaster.animationSpeedMultiplier)}:{}),
    damageReduction:bonus(stats.damageReduction,'equipment damageReduction'),
    awakeningChargeBonus:bonus(stats.awakeningChargeBonus,'equipment awakeningChargeBonus')};
}

/** Equipment reduction remains distinct from Refined Physique's sourced .76;
 * callers apply this ONCE, then the existing passive receive multiplier ONCE.
 * Base-defense/PvP formula still belongs to the separately open damage route.
 */
export function applyEquipmentDamageReduction(amount,stats){
  return number(amount,'amount')*f(1-bonus(stats.damageReduction,'equipment damageReduction'));
}

/** Fixed source charge shape: base*(1+equipment option)*sum(passive increases).
 * RF24404 +9% mapping comes from target description/SA_SOUL_ABS; its matching
 * original consumer is unavailable. 24405's EPS-qualified value is precomputed
 * by the unchanged native increasingRate getter.
 */
export function awakeningChargeMultiplier(actor,kind,guildGains={}){
  if(!['hit','received'].includes(kind))throw new TypeError('charge kind must be hit/received');
  const policy=actor.passivePolicy;
  let addition=kind==='hit'?policy?.soul?.onHitAdd??0:policy?.soul?.receivedAdd??0;
  addition=f(addition+number((kind==='hit'?guildGains.onHitSoulAdd:guildGains.receivedSoulAdd)??0,'guild soul addition'));
  const received=kind==='received'&&policy?.skillLevels?.[24404]?f(1+number(policy.received.unresolvedSoulField,'24404 SA_SOUL_ABS')):1;
  return f(f(f(1+bonus(actor.stats.awakeningChargeBonus,'equipment awakeningChargeBonus'))*f(1+addition))*received);
}

/** The original PvP receive MP base is3 and guards m_bUpMPThisFrame. This host
 * has a fixed simulation packet, so step is the retained per-packet identity.
 * RF +10% binding is a target descriptor adaptation, not a guessed .1 multiplier.
 * Online roster compensation changes that base before RF/guild gain rates;
 * revenge's target receive-MP multiplier is applied once after those gains.
 */
export function receivedMpGain(actor,data,step,guildGains={},pvpGains={}){
  if(!Number.isInteger(step)||step<0)throw new TypeError('nonnegative step required');
  if(actor.lastReceivedMpStep===step||data.DAMAGE_TYPE===6||data.REACT_TYPE===7||data.NO_DAMAGE)return 0;
  actor.lastReceivedMpStep=step;
  const increase=actor.passivePolicy?.skillLevels?.[24404]?number(actor.passivePolicy.received.unresolvedMpGainField,'24404 SA_MP_GAIN_GET_HIT_REL'):0;
  const base=f(3+number(pvpGains.receivedMpBonus??0,'PvP received MP base bonus'));
  const gained=f(f(base*f(1+increase))*number(guildGains.receivedMpMultiplier??1,'guild received MP multiplier'));
  return f(gained*number(pvpGains.receivedMpMultiplier??1,'PvP received MP multiplier')*number(actor.stats.receivedMpMultiplier??1,'buff received MP multiplier'));
}

/** No second proc roll, and raw CREATE_DAMAGE_EFFECT_RATE never grants RF's
 * passive buff. The ordinary triggering hit has already consumed old buffs;
 * the new seven-hit counter starts after it. Dummy explosion hits do not use
 * the original GetHitCount and must not consume this count.
 */
export function explodingHandSelfBuff(policy,extra){
  const request=extra?.additionalDamageEffect;
  if(!policy?.explosive?.enabled||request?.trigger!=='passive24402'||request.skillId!==24402)return null;
  return {factorId:policy.explosive.buffFactorId,skillLevel:policy.skillLevels[24402],
    target:'self',evidenceClass:'target2016 BF437 + user-confirmed proc trigger; matching native registration unavailable'};
}

/** Source GetHitCount excludes RT_DUMMY_DAMAGE. Existing callers without a
 * damage packet retain their own historical counter semantics.
 */
export function passiveBuffHitCount(data){return data?.REACT_TYPE===7?0:1;}

const buffStatKeys=['mpMax','physicalAttack','magicAttack','criticalRate','criticalAttack','finalDefenceMultiplier','finalDamageMultiplierMelee','finalDamageMultiplierRange','physicalDefence','magicDefence',
'moveSpeedMultiplier','jumpSpeedMultiplier','animationSpeedMultiplier','accuracy','avoidance','enchantAttackRate','everyAttributeDefence','hitMeleeMpMultiplier','hitRangeMpMultiplier','receivedMpMultiplier','additionalAttackPercent','forceDownMultiplierMelee','forceDownMultiplierRange'];

/** Native InsertAdditionalStat applies before the next hit; do not wait for
 * OnFrameMove or advance timers by a fabricated dt. Recompose from stored
 * already-passive base on grant, reapply and expiration to avoid compounding.
 */
export function synchronizeBuffStats(actor){
  const previousMpMax=actor.stats.mpMax;
  let modifiers,byStat;
  for(const stat of buffStatKeys){
    if(actor.buffBaseStats[stat]!==undefined)actor.stats[stat]=actor.buffBaseStats[stat];else delete actor.stats[stat];
    if(!modifiers){
      // Build only for this call: grants, replacement and removal must affect
      // the very next hit. Preserve insertion order within each attribute and
      // retain the complete ordered list for the equipment speed composer.
      // As before, the first base reset precedes traversal/validation errors.
      modifiers=actor.buffs.flatMap(buff=>buff.behaviors).filter(row=>row.kind==='stat');
      byStat=new Map();
      for(const row of modifiers){let rows=byStat.get(row.stat);if(!rows)byStat.set(row.stat,rows=[]);rows.push(row);}
    }
    const rows=byStat.get(stat);
    if(!rows)continue;
    for(const row of rows){
      if(row.changeType===0)actor.stats[stat]=row.value;
      else if(row.changeType===1)actor.stats[stat]=f((actor.stats[stat]??0)+row.value);
      else if(actor.stats[stat]!==undefined)actor.stats[stat]=f(actor.stats[stat]*row.value);
      else if(['physicalDefence','magicDefence'].includes(stat))actor.stats[stat]=0;
      else if(['finalDefenceMultiplier','finalDamageMultiplierMelee','finalDamageMultiplierRange','accuracy','avoidance','enchantAttackRate','hitMeleeMpMultiplier','hitRangeMpMultiplier','receivedMpMultiplier','forceDownMultiplierMelee','forceDownMultiplierRange'].includes(stat))actor.stats[stat]=row.value;
      else throw new TypeError('No explicit base attribute for original buff '+stat);
    }
  }
  for(const [type,stat] of [[14,'accuracy'],[15,'avoidance']]){
    const property=actorSourceAccuracy2016(actor,type);if(property.supported)actor.stats[stat]=property.value;
  }
  if(usesPvpEquipmentFormulas(actor))Object.assign(actor.stats,composeEquipmentSpeedAttributes(actor.equipmentAttributes,{
    passives:actor.passivePolicy?.bladeMaster?{animationSpeedMultiplier:{multiple:actor.passivePolicy.bladeMaster.animationSpeedMultiplier}}:actor.passivePolicy?.speedPassives??{},
    modifiers}));
  if(Number.isFinite(actor.stats.mpMax)&&actor.stats.mpMax!==previousMpMax){actor.mpMax=actor.stats.mpMax;if(Number.isFinite(actor.mp))actor.mp=Math.min(actor.mp,actor.mpMax);}
  return actor.stats;
}

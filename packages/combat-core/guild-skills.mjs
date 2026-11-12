import catalog from './guild-catalog.json' with {type:'json'};

const f=Math.fround;
const copy=value=>structuredClone(value);
export const GUILD_CATALOG=catalog;
export const GUILD_DEFAULT_PASSIVES=Object.freeze(catalog.skills.map(row=>row.skillId));
const rows=new Map(catalog.skills.map(row=>[row.skillId,row]));
const enabled=(actor,id)=>actor.guild?.levels?.[id]===rows.get(id)?.maxLevel;
const ability=(id,name)=>f(rows.get(id).abilities[name]);
const stable=value=>JSON.stringify(value&&typeof value==='object'?
  Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stable(value[k]))])):value);
const dead=a=>a.hp<=0||a.death===true||a.deathComplete===true||/^RSI_DIE_(FRONT|BACK)$/.test(a.state??'');

/** Actor-owned, JSON-safe state; all twelve highest target nodes by default.
 * An empty explicit list is reserved for source/replay fixtures. Public UI has
 * no editing surface. No guild skill is added to the RF equipment catalog.
 * Granting Lv5 does not prove every consumer is implemented. Target2016 509
 * is requested after an accepted contact as well as a Miss. */
export function initializeGuildSkills(actor,{passiveIds=GUILD_DEFAULT_PASSIVES}={}){
  if(!Array.isArray(passiveIds)||new Set(passiveIds).size!==passiveIds.length||passiveIds.some(id=>!GUILD_DEFAULT_PASSIVES.includes(id)))
    throw new TypeError('Verified unique guild passive IDs required');
  actor.guild={levels:Object.fromEntries(passiveIds.map(id=>[id,rows.get(id).maxLevel])),
    heroSacrificeFired:false,recovery:{pulses:0,elapsed:0,amount:0,effectRemaining:0},
    evidence:'target2016 declarations and 509 contact consumer; other consumers retain qualified fixed-V5 boundaries; original-client unmeasured'};
  return actor.guild;
}

/** Install the exact independent target Buff54/Template57 closure. */
export function installGuildBuffs(profile){
  const next={...profile,buffFactors:{...profile.buffFactors},buffTemplates:{...profile.buffTemplates}};
  for(const group of ['buffFactors','buffTemplates'])for(const [id,row] of Object.entries(catalog[group])){
    if(next[group][id]&&stable(next[group][id].raw)!==stable(row.raw))throw new Error(`Conflicting original guild ${group}[${id}]`);
    if(!next[group][id])next[group][id]=copy(row);
  }
  return next;
}

/** Source GetSkillStat/AddStat additions, once at actor stat initialization. */
export function applyGuildStatPassives(base,actor){
  const next={...base},mapping={m_AtkPhysic:'physicalAttack',m_AtkMagic:'magicAttack',m_DefPhysic:'physicalDefence',m_DefMagic:'magicDefence'};
  for(const id of [500,501])if(enabled(actor,id))for(const [key,amount] of Object.entries(rows.get(id).stats)){
    const target=mapping[key];next[target]=(next[target]??0)+f(amount);
  }
  return next;
}

/** Source User MP multiplication, soul IncreasingRate additions. The host
 * supplies confirmed MP bases and sums RF / equipment soul additions once. */
export function guildGainModifiers(actor){
  return {onHitMpMultiplier:enabled(actor,505)?ability(505,'SA_MP_GAIN_ON_HIT_REL'):1,
    receivedMpMultiplier:enabled(actor,504)?ability(504,'SA_MP_GAIN_GET_HIT_REL'):1,
    onHitSoulAdd:enabled(actor,507)?f(ability(507,'SA_SOUL_GAIN_ON_HIT_REL')-1):0,
    receivedSoulAdd:enabled(actor,506)?f(ability(506,'SA_SOUL_GAIN_GET_HIT_REL')-1):0};
}

/** The three granted non-combat skills keep their source scope: dungeon EXP,
 * dungeon ED and recovery items. No PvP combat bonus is substituted for them. */
export function guildNonCombatModifiers(actor,{guildPartyMembers=0,dungeon=false,recoveryItem=false}={}){
  return {experienceMultiplier:dungeon&&guildPartyMembers>=2&&enabled(actor,502)?1+ability(502,'SA_EXP_GAIN_REL'):1,
    edMultiplier:dungeon&&enabled(actor,511)?1+ability(511,'SA_ED_GAIN_REL'):1,
    itemRecoveryMultiplier:recoveryItem&&enabled(actor,503)?ability(503,'SA_ITEM_SPECIAL_ABILITY_REL'):1};
}

/** Target2016 User+234=31f66ec0. Both participants are eligible after the
 * reaction code survives; no outer Miss-only gate. The real Buff54 pipeline
 * owns its 3% roll and finalizers. Keep the existing active-buff merge policy. */
export function guildCriticalCounterRequest(actor){
  if(!enabled(actor,509)||dead(actor)||actor.buffs?.some(buff=>buff.templateId===57))return null;
  return {factorId:54,skillLevel:5,skillId:509,evidence:'target2016 31f66ec0 and four ordinary contact selectors; Buff54/Template57'};
}

/** User8940/9959 + GuildSkillProcess: the host checks IsDamagedReaction and
 * !NO_DAMAGE with an attacker; RT_DUMMY_DAMAGE7 is not excluded by that source
 * predicate. Source RNG is called only when eligible.
 * Keep the active BALANCE_PATCH_20120329 conditional cap, including its
 * documented mismatch with the target description near 30% damage. */
export function startGuildRecovery(actor,{damage,attackerPresent=true,noDamage=false,random}={}){
  const recovery=actor.guild?.recovery;
  if(!enabled(actor,508)||!recovery||dead(actor)||!attackerPresent||noDamage||!Number.isFinite(damage)||damage<0)return null;
  let triggered=false;
  if(recovery.pulses===0&&recovery.effectRemaining<=0){
    if(typeof random!=='function')throw new TypeError('Deterministic combat RNG required');
    if(random()<ability(508,'SA_EFFECTIVE_RATE')){recovery.pulses=3;triggered=true;}
  }
  if(recovery.pulses<=0)return null;
  recovery.amount=f(damage>f(actor.hpMax*f(.3))?f(f(actor.hpMax*f(.3))/recovery.pulses):f(f(damage)*f(.4)));
  recovery.effectRemaining=3;
  return {skillId:508,triggered,pulses:recovery.pulses,amount:recovery.amount,
    particleName:'InfiniteStrengthLight',sourceEffectLifetime:3};
}

/** Source MP>0 gate, double elapsed accumulator, strict >float32(.8), one
 * pulse per frame and reset-to-zero rather than carrying overflow forward. */
export function stepGuildRecovery(actor,dt){
  if(!Number.isFinite(dt)||dt<0)throw new TypeError('Nonnegative guild elapsed time required');
  const recovery=actor.guild?.recovery;if(!recovery)return null;
  recovery.effectRemaining=Math.max(0,recovery.effectRemaining-dt);
  if(dead(actor)||actor.mp<=0||recovery.pulses<=0)return null;
  recovery.elapsed+=f(dt);
  if(recovery.elapsed<=f(.8))return null;
  recovery.elapsed=0;recovery.pulses--;
  const before=actor.hp;actor.hp=Math.min(actor.hpMax,actor.hp+recovery.amount);
  return {skillId:508,hpBefore:before,hp:actor.hp,restoredHp:actor.hp-before,requestedHp:recovery.amount,
    remainingPulses:recovery.pulses,position:[actor.x,actor.y+50,actor.z],
    soundName:recovery.pulses===0?'GS_Infinite_Strength.ogg':null};
}

/** Called only on first entry into a new fatal death presentation. */
export function guildOnDeath(actor){
  if(!actor.guild)return;
  actor.guild.heroSacrificeFired=false;
  actor.guild.recovery={pulses:0,elapsed:0,amount:0,effectRemaining:0};
}

/** RF death animation EventTimer(1.12), NOT 1.12 seconds of wall time. Death
 * animation speed is 0.5 upstream. This never revives or targets the corpse. */
export function processGuildHeroSacrifice(actor,actors,{previousAnimationTime,animationTime,pvp=true,isPartyMember=()=>false}={}){
  if(!enabled(actor,510)||!/^RSI_DIE_(FRONT|BACK)$/.test(actor.state??'')||actor.guild.heroSacrificeFired)return null;
  const threshold=f(catalog.referenceRules.heroAnimationTime);
  if(!Number.isFinite(previousAnimationTime)||!Number.isFinite(animationTime)||previousAnimationTime>=threshold||animationTime<threshold)return null;
  actor.guild.heroSacrificeFired=true;
  const percent=f(ability(510,'SA_HP_GAIN_REL_MAX_HP')*(pvp?f(.5):1)),heals=[];
  for(const target of actors){
    if(target===actor||target.id===actor.id||target.team!==actor.team||dead(target)||(!pvp&&!isPartyMember(target)))continue;
    if(Math.hypot(target.x-actor.x,target.y-actor.y,target.z-actor.z)>=1500)continue;
    const amount=f(f(target.hpMax)*percent),before=target.hp;
    target.hp=Math.min(target.hpMax,target.hp+amount);
    heals.push({targetId:target.id,hpBefore:before,hp:target.hp,restoredHp:target.hp-before,requestedHp:amount,position:[target.x,target.y+50,target.z]});
  }
  return {skillId:510,actorId:actor.id,heals,percent,rangeExclusive:1500,effectSetName:'EffectSet_SacrificeOfHero',
    soundName:'GS_Sacrifice_of_Hero.ogg',presentation:'RT_CARTOON_FADE_NONTEX',
    evidence:'target2016 510 Lv5 + fixed-V5 RF death animation EventTimer1.12 / User ProcessSacrificeOfHero'};
}

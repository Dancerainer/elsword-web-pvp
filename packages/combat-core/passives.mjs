/** Profession passive hooks driven by target fields. Original numeric getters run in
 * WASM; target descriptions/reference consumers remain clearly qualified.
 * This policy does not own RNG, actors, buffs, clocks or damage rounding.
 */
import {initializeElesisPassives} from './elesis-passives.mjs';
export const RF_DEFAULT_PASSIVES=Object.freeze([24400,24401,24402,24403,24404,24405]);
import {initializeAddPassives} from './add-passives.mjs';
import {ravenForceDownValue} from './profession-source-v53.mjs';
const f=Math.fround;
const has=(policy,id)=>policy.skillLevels[id]>0;
const finite=(n,label)=>{if(typeof n!=='number'||!Number.isFinite(n))throw new TypeError(`${label} must be finite`);return n;};

export function initializeActorPassives(profile,{nativeValues,passiveIds=profile.defaultPassiveSkillIds??RF_DEFAULT_PASSIVES}={}){
  if(!nativeValues || typeof nativeValues.abilityValue!=='function' || typeof nativeValues.increasingRate!=='function')
    throw new TypeError('Original C++ native skill-values bridge required');
  if([120,121,125].includes(profile.target?.unitClass))return initializeElesisPassives(profile,{nativeValues,passiveIds});
  if(profile.target?.unitType===9)return initializeAddPassives(profile,{nativeValues,passiveIds});
  if(profile.target?.unitClass===100)return initializeLordKnightPassives(profile,{nativeValues,passiveIds});
  if(profile.target?.unitClass===112)return initializeInfinitySwordPassives(profile,{nativeValues,passiveIds});
  if(profile.target?.unitClass===101)return initializeRuneSlayerPassives(profile,{nativeValues,passiveIds});
  if(profile.target?.unitClass===115)return initializeVeteranCommanderPassives(profile,{nativeValues,passiveIds});
  if(profile.target?.unitClass===106)return initializeBladeMasterPassives(profile,{nativeValues,passiveIds});
  if(!Array.isArray(passiveIds) || new Set(passiveIds).size!==passiveIds.length || passiveIds.some(id=>!RF_DEFAULT_PASSIVES.includes(id)))
    throw new TypeError('RF passive IDs must be unique verified highest passive skills');
  const skills=new Map((profile.skillCatalog??[]).map(row=>[row.skillId,row]));
  const levels={};
  function row(id){const skill=skills.get(id);if(!skill?.passive || !skill.topTier || !Number.isInteger(skill.maxLevel) || skill.maxLevel<1)
    throw new TypeError(`Target highest passive ${id} missing`);return skill;}
  for(const id of passiveIds)levels[id]=row(id).maxLevel;
  function value(id,key){
    if(!levels[id])return null;
    let raw=row(id).raw;
    for(const part of key.split('.'))raw=raw?.[part];
    if(!raw || typeof raw!=='object' || typeof raw[String(levels[id])]!=='number')throw new TypeError(`Target ${id}.${key} at max level missing`);
    return nativeValues.abilityValue(raw,levels[id]);
  }
  const policy={schemaVersion:1,evidenceClass:'target-2016-data + fixed-V5-consumer/description-candidates',
    targetClientMeasured:false,skillLevels:levels,
    stats:{physicalAttackAdd:value(24400,'m_Stat.m_AtkPhysic')??0,magicAttackAdd:value(24400,'m_Stat.m_AtkMagic')??0},
    burning:{enabled:!!levels[24401],multiplier:value(24401,'SA_DAMAGE_REL')??1,
      nativeChangeType:value(24401,'SA_DAMAGE_TYPE_CHANGE'),eligibleField:'BURNING_NASOD_HAND_POSSIBLE',
      physicalType:profile.enums?.DAMAGE_TYPE?.DT_PHYSIC??0,magicType:profile.enums?.DAMAGE_TYPE?.DT_MAGIC??1,
      attackTypeGate:2,evidence:'target2016 328b0a20 state entry +31f3d2f0 DD owner hook'},
    explosive:{enabled:!!levels[24402],chance:value(24402,'SA_EFFECTIVE_RATE')??0,
      buffFactorId:levels[24402]?row(24402).raw.BUFF_FACTOR?.['1']:null,
      buffActivationSupported:true,buffActivationEvidence:'target2016 328bc880 registration ->328932b0 ->321fc790 BF437; owner3929 byte threshold',
      evidence:'X2GURaven.cpp:2328-2342; GUUser.cpp:12812-12822; DamageEffect.cpp:3976-3986'},
    victory:{enabled:!!levels[24403],attackMultiplier:value(24403,'SA_ATK_REL')??1,
      forceDownMultiplier:value(24403,'SA_FORCE_DOWN_REL')??1,hpThreshold:.3,
      // Target2016 Enum.lua ATTACK_TYPE.AT_SPECIAL=1 (profile older builds
      // omitted this enum). The reference loading multiplier excludes it.
      specialAttackType:profile.enums?.ATTACK_TYPE?.AT_SPECIAL??1,
      conditionEvidence:'target2016 321f4bcc ordered HP/max <= float32(.3)',
      boundaryEvidence:'RAVEN_PASSIVE_CONSUMERS_2016: equality included; unordered excluded',
      knockdownEvidence:'target2016 328bc880 additive forceDown channel with original epsilon'},
    received:{enabled:!!levels[24404],damageMultiplier:value(24404,'SA_DAMAGED_REL')??1,
      unresolvedMpGainField:value(24404,'SA_MP_GAIN_GET_HIT_REL'),unresolvedSoulField:value(24404,'SA_SOUL_ABS'),
      evidence:'target2016 328bc880 producers,32893300/330 getters and31fabbe0 ordered resource consumers'},
    soul:{onHitAdd:levels[24405]?nativeValues.increasingRate(value(24405,'SA_SOUL_GAIN_ON_HIT_REL')):0,
      receivedAdd:levels[24405]?nativeValues.increasingRate(value(24405,'SA_SOUL_GAIN_GET_HIT_REL')):0,
      evidence:'GUUser.cpp:9741-9755 / 12376-12390 + original CalculateIncreasingRate EPS=.00005'},
    awakening:{enabled:!!levels[24405],canReawaken:!!levels[24405],reawakenBeads:1,reawakenCoreLevelsAdded:2,
      unresolvedMagicAttackMultiplier:value(24405,'SA_ATK_MAGIC_REL'),unresolvedDurationField:value(24405,'SA_EFFECTIVE_TIME'),
      durationMultiplier:value(24405,'SA_EFFECTIVE_TIME')??1,
      durationSupported:true,durationTargetConsumerVerified:false,evidence:'target2016 duration ratio + fixed-V5 normal GetHyperModeTime/additive Buff candidate; reawakening one-bead duration and +2 core levels explicitly confirmed by user; matching target consumer unavailable'},
    reactTypes:{createDamageEffect:profile.enums?.REACT_TYPE?.RT_CREATE_DAMAGE_EFFECT??11,
      createEffectSet:profile.enums?.REACT_TYPE?.RT_CREATE_EFFECT_SET??12},
    implementedAdapters:['24402 BF437 initializes owner byte threshold before current feedback increments; expiry occurs in Buff poll',
      '24404 received MP and awakening multiply their independent original final resource stages',
      '24405 post-Focus magic delta retains original epsilon; reawakening one-bead duration is a user rule'],
    unresolved:['24402 source-table RNG and full owner callback creation-failure asymmetry remain outside this adapter',
      '24405 one-bead reawakening/+2 core levels retain the explicit user rule'],
  };
  if(policy.explosive.enabled && (!Number.isInteger(policy.explosive.buffFactorId)||!profile.buffFactors?.[policy.explosive.buffFactorId]))
    throw new TypeError('Target Exploding Hand factor definition missing');
  return policy;
}

export function initializeBladeMasterPassives(profile,{nativeValues,passiveIds=profile.defaultPassiveSkillIds??[]}={}){
  const rows=new Map(profile.skillCatalog.filter(s=>s.passive&&s.topTier&&s.unitClass===106).map(s=>[s.skillId,s]));
  if(!Array.isArray(passiveIds)||new Set(passiveIds).size!==passiveIds.length||passiveIds.some(id=>!rows.has(id)))throw new TypeError('Invalid BM passive IDs');
  const skillLevels=Object.fromEntries(passiveIds.map(id=>[id,rows.get(id).maxLevel]));
  const value=(id,key,neutral)=>{
    if(!skillLevels[id])return neutral;
    const table=key.split('.').reduce((v,k)=>v?.[k],rows.get(id).raw);
    if(!Number.isFinite(table?.[skillLevels[id]]))throw new TypeError(`Missing target BM ${id}.${key}`);
    return finite(nativeValues.abilityValue(table,skillLevels[id]),`BM ${id}.${key}`);
  };
  return {schemaVersion:1,professionId:'BM',targetClientMeasured:false,
    evidenceClass:'target2016 BM values + fixedV5 Raven consumers and explicit target description adapters',skillLevels,
    stats:{physicalAttackAdd:value(24400,'m_Stat.m_AtkPhysic',0),magicAttackAdd:value(24400,'m_Stat.m_AtkMagic',0)},
    burning:{enabled:false},explosive:{enabled:false,buffActivationSupported:false,buffFactorId:null},
    victory:{enabled:false,forceDownMultiplier:1},received:{enabled:false,damageMultiplier:1},
    soul:{onHitAdd:0,receivedAdd:0},awakening:{enabled:false,canReawaken:false,durationMultiplier:1},
    bladeMaster:{animationSpeedMultiplier:value(24406,'SA_ANI_SPEED',1),criticalRateAdd:value(24407,'SA_ATK_CRITICAL_RATE_ABS',0),
      ownHpThreshold:value(24408,'SA_MAX_HP_REL',1),highHpDamageMultiplier:value(24408,'SA_ATK_REL',1),
      forceDownMultiplier:value(24408,'SA_FORCE_DOWN_REL',1),winningFactor:skillLevels[24409]?635:null,
      winningCooldown:value(24409,'SA_COOLTIME_1',0),escapeChance:value(24410,'SA_EFFECTIVE_RATE',0),
      escapeMp:value(24410,'m_MPConsumption',0),escapeCooldown:value(24410,'SA_COOLTIME_1',0)},
    reactTypes:{createDamageEffect:profile.enums?.REACT_TYPE?.RT_CREATE_DAMAGE_EFFECT??11,createEffectSet:profile.enums?.REACT_TYPE?.RT_CREATE_EFFECT_SET??12},
    unresolved:['24409 original a64 component guard projected through accepted local owner feedback; full component producer not represented'],
  };
}

export function initializeVeteranCommanderPassives(profile,{nativeValues,passiveIds=profile.defaultPassiveSkillIds??[]}={}){
  const rows=new Map(profile.skillCatalog.filter(s=>s.passive&&s.topTier&&s.unitClass===115).map(s=>[s.skillId,s]));
  if(!Array.isArray(passiveIds)||new Set(passiveIds).size!==passiveIds.length||passiveIds.some(id=>!rows.has(id)))throw new TypeError('Invalid VC passive IDs');
  const skillLevels=Object.fromEntries(passiveIds.map(id=>[id,rows.get(id).maxLevel]));
  const value=(id,key,neutral)=>{
    if(!skillLevels[id])return neutral;
    const table=key.split('.').reduce((v,k)=>v?.[k],rows.get(id).raw);
    if(!Number.isFinite(table?.[skillLevels[id]]))throw new TypeError(`Missing target VC ${id}.${key}`);
    return finite(nativeValues.abilityValue(table,skillLevels[id]),`VC ${id}.${key}`);
  };
  return {schemaVersion:1,professionId:'VC',targetClientMeasured:false,
    evidenceClass:'target2016 VC values + qualified fixedV5 Raven consumers',skillLevels,
    stats:{physicalAttackAdd:value(24400,'m_Stat.m_AtkPhysic',0),magicAttackAdd:value(24400,'m_Stat.m_AtkMagic',0)},
    burning:{enabled:false},explosive:{enabled:false,buffActivationSupported:false,buffFactorId:null},
    victory:{enabled:false,forceDownMultiplier:1},received:{enabled:false,damageMultiplier:1},
    soul:{onHitAdd:0,receivedAdd:0},awakening:{enabled:false,canReawaken:false,durationMultiplier:1},
    veteran:{hpLimit:f(.25*value(24412,'SA_OVERHEAT_HP',1)),noDamageBelow:value(24412,'SA_DAMAGED_REL',0),
      hpCostMultiplier:value(24411,'SA_OVERHEAT_HP_PVP',1),debuffDurationMultiplier:value(24411,'SA_REDUCE_EDT_TIME_REL',1),
      surviveOverheat:!!skillLevels[24414],airSkillMultiplier:skillLevels[24412]?1.5:1,
      forceDownMultiplier:value(24413,'SA_FORCE_DOWN_REL',1),awakeningMp:value(24413,'SA_MP_RETAKE_ABS',0),
      overheatFactor:skillLevels[24415]?217:84,overheatLevel:skillLevels[24415]??1},
    reactTypes:{createDamageEffect:profile.enums?.REACT_TYPE?.RT_CREATE_DAMAGE_EFFECT??11,createEffectSet:profile.enums?.REACT_TYPE?.RT_CREATE_EFFECT_SET??12},
    unresolved:['24414 all-attribute defence points retained; target normalized resistance composition unverified'],
  };
}

/** Lord Knight uses its own target skill rows. Common GetSkillStat additions,
 * sourced GetManaUp and StrongBone consumers are applied; descriptions do not authorize
 * RF's proc, mana-return, KD, awakening or Nasod hooks. Other target fields are
 * retained as unresolved until an appropriate source consumer is traced. */
export function initializeLordKnightPassives(profile,{nativeValues,passiveIds=profile.defaultPassiveSkillIds??[]}={}){
  const rows=new Map((profile.skillCatalog??[]).filter(row=>row.passive&&row.topTier&&row.unitClass===100).map(row=>[row.skillId,row]));
  if(!Array.isArray(passiveIds)||new Set(passiveIds).size!==passiveIds.length||passiveIds.some(id=>!rows.has(id)))throw new TypeError('LK passive IDs must be unique verified highest passive skills');
  const skillLevels={},unresolved=[];let physicalAttackAdd=0,magicAttackAdd=0;
  for(const id of passiveIds){
    const row=rows.get(id);if(!Number.isInteger(row.maxLevel)||row.maxLevel<1)throw new TypeError(`Target LK highest passive ${id} level missing`);
    skillLevels[id]=row.maxLevel;
    for(const [field,raw]of Object.entries(row.raw??{})){
      if(field==='m_Stat'){
        if(raw.m_AtkPhysic)physicalAttackAdd+=nativeValues.abilityValue(raw.m_AtkPhysic,row.maxLevel);
        if(raw.m_AtkMagic)magicAttackAdd+=nativeValues.abilityValue(raw.m_AtkMagic,row.maxLevel);
        for(const name of Object.keys(raw))if(!['m_AtkPhysic','m_AtkMagic'].includes(name))unresolved.push(id+'.m_Stat.'+name);
      }else if(/^SA_|^BUFF_|^SKILL_/.test(field)&&!({
        21400:['SA_MP_GAIN_ON_HIT_REL'],21401:['SA_EFFECTIVE_RATE','SA_COOLTIME_1'],
        21402:['SA_EFFECTIVE_RATE'],21403:['SA_DAMAGED_REL','SA_MAX_HP_REL'],21404:['BUFF_FACTOR'],
      }[id]??[]).includes(field))unresolved.push(id+'.'+field);
    }
  }
  const targetValue=(id,key)=>{const level=skillLevels[id],table=rows.get(id).raw[key];
    if(!table||!Number.isFinite(table[String(level)]))throw new TypeError(`Target LK ${id}.${key} at max level missing`);
    return finite(nativeValues.abilityValue(table,level),`Native LK ${id}.${key}`);};
  return {schemaVersion:1,evidenceClass:'target2016 LK fields + fixed-V5 GetManaUp/StrongBone/GetSkillStat consumer candidates',targetClientMeasured:false,professionId:'LK',skillLevels,
    stats:{physicalAttackAdd,magicAttackAdd,hpMultiplier:skillLevels[21403]?targetValue(21403,'SA_MAX_HP_REL'):1},burning:{enabled:false},explosive:{enabled:false,buffActivationSupported:false,buffFactorId:null},
    victory:{enabled:false,forceDownMultiplier:1},received:{enabled:!!skillLevels[21403],skillId:21403,
      damageMultiplier:skillLevels[21403]?targetValue(21403,'SA_DAMAGED_REL'):1,
      evidence:'target2016 21403 SA_DAMAGED_REL + fixed-V5 SwordMan2674..2690 StrongBone final-defense multiplier'},
    vitality:{enabled:!!skillLevels[21400],skillId:21400,specialAttackType:finite(profile.enums?.ATTACK_TYPE?.AT_SPECIAL,'Target LK AT_SPECIAL'),
      multiplier:skillLevels[21400]?targetValue(21400,'SA_MP_GAIN_ON_HIT_REL'):1,
      evidence:'target2016 21400 + fixed-V5 GUUser12428..12455 / DamageEffect4158..4190; excludes AT_SPECIAL'},soul:{onHitAdd:0,receivedAdd:0},
    awakening:{enabled:false,canReawaken:false,durationMultiplier:1},reactTypes:{createDamageEffect:profile.enums?.REACT_TYPE?.RT_CREATE_DAMAGE_EFFECT??11,createEffectSet:profile.enums?.REACT_TYPE?.RT_CREATE_EFFECT_SET??12},unresolved};
}

export function initializeInfinitySwordPassives(profile,{nativeValues,passiveIds=profile.defaultPassiveSkillIds??[]}={}){
  const rows=new Map(profile.skillCatalog.filter(s=>s.passive&&s.topTier&&s.unitClass===112).map(s=>[s.skillId,s]));
  if(!Array.isArray(passiveIds)||new Set(passiveIds).size!==passiveIds.length||passiveIds.some(id=>!rows.has(id)))throw new TypeError('Invalid IS passive IDs');
  const skillLevels=Object.fromEntries(passiveIds.map(id=>[id,rows.get(id).maxLevel]));
  const value=(id,key,neutral)=>skillLevels[id]?nativeValues.abilityValue(rows.get(id).raw[key],skillLevels[id]):neutral;
  return {schemaVersion:1,professionId:'IS',targetClientMeasured:false,
    evidenceClass:'target2016 fields + qualified SwordMan reference/target-description adapters',skillLevels,
    stats:{physicalAttackAdd:0,magicAttackAdd:0},burning:{enabled:false},explosive:{enabled:false,buffActivationSupported:false,buffFactorId:null},
    victory:{enabled:false,forceDownMultiplier:1},received:{enabled:false,damageMultiplier:1},soul:{onHitAdd:0,receivedAdd:0},
    awakening:{enabled:false,canReawaken:false,durationMultiplier:1},
    speedPassives:{moveSpeedMultiplier:{multiple:value(21414,'SA_MOVE_SPEED',1)},animationSpeedMultiplier:{multiple:value(21414,'SA_ANI_SPEED',1)}},
    infinity:{cruelCooldown:value(21410,'SA_COOLTIME_1',0),suddenChance:value(21411,'SA_EFFECTIVE_RATE',0),
      suddenCooldown:value(21411,'SA_COOLTIME_1',0),brutalChance:value(21412,'SA_EFFECTIVE_RATE',0),brutalCooldown:value(21412,'SA_COOLTIME_1',0)},
    reactTypes:{createDamageEffect:profile.enums.REACT_TYPE.RT_CREATE_DAMAGE_EFFECT,createEffectSet:profile.enums.REACT_TYPE.RT_CREATE_EFFECT_SET},
    unresolved:['21414 SA_DAMAGE_REL old extra-damage field retained; target description has no corresponding damage bonus',
      '21414 attack-speed field uses explicit target description adapter; pinned old source only applies movement speed']};
}

/** RS owns its five target passive nodes. 21407 has a ground-use enum but
 * m_eType=8 and an activation chance: the target grant is passive, never an
 * invented zero-cost active skill. Numeric fields keep their target values;
 * the matching 2016 executable is unavailable. See rs-attributes-source-v1. */
export function initializeRuneSlayerPassives(profile,{nativeValues,passiveIds=profile.defaultPassiveSkillIds??[]}={}){
  const allowed=new Set([21405,21406,21407,21408,21409]);
  const rows=new Map((profile.skillCatalog??[]).filter(row=>row.passive&&row.topTier&&row.unitClass===101&&allowed.has(row.skillId)).map(row=>[row.skillId,row]));
  if(!Array.isArray(passiveIds)||new Set(passiveIds).size!==passiveIds.length||passiveIds.some(id=>!rows.has(id)))throw new TypeError('RS passive IDs must be unique verified highest passive skills');
  const skillLevels=Object.fromEntries(passiveIds.map(id=>{
    const level=rows.get(id).maxLevel;
    if(!Number.isInteger(level)||level<1)throw new TypeError(`Target RS highest passive ${id} level missing`);
    return [id,level];
  }));
  const value=(id,key,neutral)=>{
    if(!skillLevels[id])return neutral;
    const table=rows.get(id).raw?.[key],level=skillLevels[id];
    if(!Number.isFinite(table?.[level]))throw new TypeError(`Target RS ${id}.${key} at max level missing`);
    return finite(nativeValues.abilityValue(table,level),`Native RS ${id}.${key}`);
  };
  const magicChainFactorId=skillLevels[21406]?rows.get(21406).raw.BUFF_FACTOR?.['1']:null;
  if(skillLevels[21406]&&(!Number.isInteger(magicChainFactorId)||!profile.buffFactors?.[magicChainFactorId]))throw new TypeError('Target RS Magic Chain factor definition missing');
  return {schemaVersion:1,professionId:'RS',targetClientMeasured:false,
    evidenceClass:'target2016 RS fields + fixed-V5 server/SwordMan candidates; 21405 target-description adapter',skillLevels,
    stats:{physicalAttackAdd:0,magicAttackAdd:0,
      magicAttackMultiplier:value(21408,'SA_ATK_MAGIC_REL',1),
      magicDefenceMultiplier:value(21409,'SA_DEF_MAGIC_REL',1),
      physicalToMagicMultiplier:value(21405,'SA_ATK_MAGIC_REL',1)},
    burning:{enabled:false},explosive:{enabled:false,buffActivationSupported:false,buffFactorId:null},
    victory:{enabled:false,forceDownMultiplier:1},received:{enabled:false,damageMultiplier:1},
    soul:{onHitAdd:0,receivedAdd:0},awakening:{enabled:false,canReawaken:false,durationMultiplier:1},
    runeSlayer:{runeDamageMultiplier:value(21408,'SA_DAMAGE_REL',1),
      runeSizeMultiplier:value(21408,'SA_PROJECTILE_SIZE',1),runeRangeMultiplier:value(21408,'SA_PROJECTILE_RANGE_REL',1),
      magicChainChance:value(21406,'SA_EFFECTIVE_RATE',0),magicChainFactorId,
      magicReflectChance:value(21409,'SA_REFLECT_REL',0),
      swordEnchantChance:value(21407,'SA_EFFECTIVE_RATE',0),swordEnchantCooldown:value(21407,'SA_COOLTIME_1',0),
      swordEnchantFactorIds:skillLevels[21407]?Object.values(rows.get(21407).raw.BUFF_FACTOR??{}):[]},
    reactTypes:{createDamageEffect:profile.enums?.REACT_TYPE?.RT_CREATE_DAMAGE_EFFECT??11,
      createEffectSet:profile.enums?.REACT_TYPE?.RT_CREATE_EFFECT_SET??12},
    unresolved:['21405 physical-to-magic composition uses target description plus independent final-stat channels; matching 2016 consumer/order unverified',
      '21409 raw magic defence ratio1.1 disagrees with level3 description12%; raw numeric value retained']};
}

export function applyStatPassives(base,policy){
  // GetSkillStat/AddStat adds these values. Unknown magic-stat composition is
  // not folded into this stage based only on its name/description.
  return {...base,...(policy.stats.hpMultiplier?{hpMax:f(base.hpMax*policy.stats.hpMultiplier)}:{}),physicalAttack:finite(base.physicalAttack,'physicalAttack')+policy.stats.physicalAttackAdd,
    magicAttack:finite(base.magicAttack,'magicAttack')+policy.stats.magicAttackAdd};
}

export function modifyOutgoingHit(policy,{damageData,stateRaw={},targetHp,targetMaxHp,actorHp,actorMaxHp}={}){
  if(!damageData || typeof damageData!=='object')throw new TypeError('Original DAMAGE_DATA required');
  const damage={...damageData,DAMAGE:{...damageData.DAMAGE}};
  const applied=[];
  if(policy.burning.enabled && damage.ATTACK_TYPE===2 && (stateRaw.BURNING_NASOD_HAND_POSSIBLE===1||stateRaw.BURNING_NASOD_HAND_POSSIBLE===true)){
    const type=damage.DAMAGE_TYPE??policy.burning.physicalType;
    const before=type===policy.burning.physicalType?damage.DAMAGE.PHYSIC:type===policy.burning.magicType?damage.DAMAGE.MAGIC:1;
    if(typeof before==='number' && policy.burning.nativeChangeType===2){
      damage.DAMAGE_TYPE=policy.burning.magicType;
      damage.DAMAGE.MAGIC=f(f(before)*policy.burning.multiplier);
      applied.push(24401);
    }
  }
  const lowHp=policy.victory.enabled && Number.isFinite(targetHp)&&Number.isFinite(targetMaxHp)&&targetMaxHp>0&&targetHp>0&&f(targetHp/targetMaxHp)<=f(policy.victory.hpThreshold);
  if(policy.victory.enabled)applied.push(24403);
  // GUUser SetDamageData:31489–31494 and DamageEffect:1456–1465 modify
  // FORCE_DOWN at damage load, BEFORE DamageReact subtracts skill-note values.
  // Keep the existing target24403 mapping qualified as a candidate; do not
  // multiply the victim's already-subtracted/penetration contribution again.
  if(policy.victory.enabled && damage.ATTACK_TYPE!==policy.victory.specialAttackType && typeof damage.FORCE_DOWN==='number')
    damage.FORCE_DOWN=ravenForceDownValue(damage.FORCE_DOWN,policy.victory.forceDownMultiplier);
  if(policy.veteran&&typeof damage.FORCE_DOWN==='number')damage.FORCE_DOWN=f(f(damage.FORCE_DOWN)*policy.veteran.forceDownMultiplier);
  if(policy.bladeMaster&&typeof damage.FORCE_DOWN==='number')damage.FORCE_DOWN=ravenForceDownValue(damage.FORCE_DOWN,policy.bladeMaster.forceDownMultiplier);
  const highHp=policy.bladeMaster&&actorMaxHp>0&&f(actorHp/actorMaxHp)>=policy.bladeMaster.ownHpThreshold;
  return {damageData:damage,attackMultiplier:lowHp?policy.victory.attackMultiplier:highHp?policy.bladeMaster.highHpDamageMultiplier:1,
    forceDownMultiplier:policy.victory.forceDownMultiplier,applied,
    evidenceClass:'target-value/source-consumer-candidate; target-client-unmeasured'};
}

export function modifyReceivedHit(policy,{damage}={}){
  return {damage:finite(damage,'damage')*policy.received.damageMultiplier,
    damageMultiplier:policy.received.damageMultiplier,mpMultiplier:1,soulMultiplier:f(1+policy.soul.receivedAdd),
    applied:policy.received.enabled?[policy.received.skillId??24404]:[],unresolved:policy.received.enabled&&policy.professionId!=='LK'?['received MP/soul target adapters execute in passive-attributes-v20; matching target2016 consumers unverified']:[]};
}
export function modifyHitMpGain(policy,{base,attackType}={}){
  finite(base,'hit MP base');
  return policy?.vitality?.enabled&&attackType!==policy.vitality.specialAttackType?f(f(base)*f(policy.vitality.multiplier)):base;
}

export function onHit(policy,{damageData,roll,damageRoll,random,hitKind='melee',accepted=true,impactPoint}={}){
  if(!damageData || typeof damageData!=='object')throw new TypeError('Original DAMAGE_DATA required');
  const result={soulMultiplier:f(1+policy.soul.onHitAdd),additionalDamageEffect:null,buffRequests:[],
    unsupportedBuffFactor:policy.explosive.buffActivationSupported?null:policy.explosive.buffFactorId};
  const name=damageData.CREATE_DAMAGE_EFFECT_NAME;
  const excluded=hitKind==='melee' && [policy.reactTypes.createDamageEffect,policy.reactTypes.createEffectSet].includes(damageData.REACT_TYPE);
  if(!accepted || damageData.NO_DAMAGE===1 || damageData.NO_DAMAGE===true || excluded || typeof name!=='string'||!name)return result;
  function sample(value){const n=typeof random==='function'?random():value;finite(n,'deterministic roll');if(n<0||n>1)throw new RangeError('Roll must be in [0,1]');return f(n);}
  const chance=policy.explosive.enabled?policy.explosive.chance:0;
  // Literal short-circuit OR in GUUser12814/DamageEffect3977: a raw effect
  // rate has its own second draw, and can run even without passive24402.
  // No RNG draw occurs when the relevant probability is zero.
  const ownerTrigger=chance>0 && sample(roll)<=chance;
  const dataChance=f(damageData.CREATE_DAMAGE_EFFECT_RATE??0);
  const dataTrigger=!ownerTrigger && dataChance>0 && sample(damageRoll)<=dataChance;
  if(ownerTrigger||dataTrigger){
    result.additionalDamageEffect={name,powerRate:1,positionMode:'impactPoint',impactPoint:impactPoint?[...impactPoint]:null,
      skillId:ownerTrigger?24402:null,skillLevel:ownerTrigger?policy.skillLevels[24402]:null,
      trigger:ownerTrigger?'passive24402':'damage-data-rate',
      evidenceClass:'target named effect + fixed-V5 hit-create callback candidate'};
  }
  return result;
}

export function onReceivedHit(policy,{accepted=true}={}){
  return {soulMultiplier:accepted?f(1+policy.soul.receivedAdd):1,mpMultiplier:1,
    unsupportedFields:[],delegatedFields:has(policy,24404)?['SA_MP_GAIN_GET_HIT_REL','SA_SOUL_ABS']:[]};
}

export function onAwakening(policy,{alreadyAwakened=false,orbs=0,coreGauge=0,coreGaugeMax=100,coreGaugePerLevel=20,baseSeconds=30}={}){
  if(!Number.isInteger(orbs)||orbs<0||orbs>3)throw new TypeError('Original awakening orb count required');
  for(const [label,value]of Object.entries({coreGauge,coreGaugeMax,coreGaugePerLevel}))finite(value,label);
  if(coreGaugeMax<=0||coreGaugePerLevel<=0||coreGauge<0||coreGauge>coreGaugeMax)throw new RangeError('Valid core gauge and positive level scale required');
  if(!alreadyAwakened)return {kind:'normal',allowed:orbs>0,orbsConsumed:null,coreGauge:null,durationOverride:null,
    durationMultiplier:policy.awakening.durationMultiplier,unsupported:['24405 initial duration uses target descriptor; matching target native consumer unavailable']};
  const allowed=policy.awakening.canReawaken&&orbs>=policy.awakening.reawakenBeads;
  return {kind:'reawaken',allowed,orbsConsumed:allowed?policy.awakening.reawakenBeads:0,
    coreGauge:allowed?Math.min(coreGaugeMax,coreGauge+coreGaugePerLevel*policy.awakening.reawakenCoreLevelsAdded):null,durationOverride:null,
    addedSeconds:allowed?awakeningDurationPlan(policy,{alreadyAwakened:true,orbs:1,availableOrbs:orbs,baseSeconds}).addedSeconds:0,
    unsupported:['Reawakening one-bead-duration/+2-level user adaptation; matching target2016 consumer unavailable']};
}

/** Target .7 is a duration ratio, not the old skill4409's added seconds.
 * User corrects reawakening to one bead of time, regardless of available beads.
 * Saved available count still controls electric-field upgrade; the Buff adds
 * the separate one-bead duration at animation .83.
 */
export function awakeningDurationPlan(policy,{alreadyAwakened=false,orbs,availableOrbs=orbs,baseSeconds,equipmentDurationBonus=0}={}){
  if(!Number.isInteger(orbs)||orbs<1||orbs>3)throw new TypeError('Awakening consumed orb count required');
  if(!Number.isInteger(availableOrbs)||availableOrbs<1||availableOrbs>3||availableOrbs<orbs)throw new TypeError('Awakening available orb count required');
  finite(baseSeconds,'baseSeconds');if(baseSeconds<=0)throw new RangeError('Positive base awakening seconds required');
  finite(equipmentDurationBonus,'equipmentDurationBonus');if(equipmentDurationBonus<0)throw new RangeError('Nonnegative equipment duration required');
  const duration=baseSeconds*(1+equipmentDurationBonus)*(alreadyAwakened?1:orbs)*(policy?.awakening.enabled?policy.awakening.durationMultiplier:1);
  return {addedSeconds:alreadyAwakened&&!policy?.awakening.enabled?0:duration,
    evidenceClass:alreadyAwakened?'target ratio + fixed-V5 additive-time candidate; one-bead duration explicitly user-confirmed; target2016 consumer unmeasured':
      'target2016 descriptor -30% duration adaptation; target-native-consumer unmeasured'};
}

/** Fixed Raven::HyperModeBuffEffectEnd + Gage::Increase float32 operations.
 * Raw gauge is returned, including a partial level; matching 2016 binding is unknown.
 */
export function awakeningCoreReturnPlan({gauge,hp,mp,hpMax,mpMax,own=true}={}){
  for(const [label,value]of Object.entries({gauge,hp,mp,hpMax,mpMax}))finite(value,label);
  const allowed=own&&hp>0&&gauge>0;
  const requestedHp=allowed?f(f(hpMax)*f(f(gauge)*f(.0005))):0,requestedMp=allowed?f(gauge):0;
  const afterHp=allowed?Math.max(0,Math.min(f(hpMax),f(f(hp)+requestedHp))):hp;
  const afterMp=allowed?Math.max(0,Math.min(f(mpMax),f(f(mp)+requestedMp))):mp;
  return {requestedHp,requestedMp,hp:afterHp,mp:afterMp,restoredHp:afterHp-hp,restoredMp:afterMp-mp,
    evidenceClass:'fixed-V5 Raven21835/GageIncrease candidate; matching target2016 consumer unmeasured'};
}

/** Target2016 Elesis passive values. No Raven/Elsword passive is inherited. */
const classes={120:'GM',121:'BH',125:'CA'};
export function initializeElesisPassives(profile,{nativeValues,passiveIds=profile.defaultPassiveSkillIds??[]}={}){
  const professionId=classes[profile.target?.unitClass];if(!professionId)throw new TypeError('Elesis target required');
  const rows=new Map(profile.skillCatalog.filter(r=>r.passive&&r.topTier&&r.unitClass===profile.target.unitClass).map(r=>[r.skillId,r]));
  if(!Array.isArray(passiveIds)||new Set(passiveIds).size!==passiveIds.length||passiveIds.some(id=>!rows.has(id)))throw new TypeError('Invalid '+professionId+' passive IDs');
  const skillLevels=Object.fromEntries(passiveIds.map(id=>[id,rows.get(id).maxLevel]));
  const rawValues={},unresolved=[];let physicalAttackAdd=0,magicAttackAdd=0;
  for(const id of passiveIds){const r=rows.get(id),level=skillLevels[id];rawValues[id]={};
    for(const [key,table]of Object.entries(r.raw))if(key.startsWith('SA_')){
      if(!Number.isFinite(table?.[level]))throw new TypeError('Missing target '+id+'.'+key);
      rawValues[id][key]=nativeValues.abilityValue(table,level);
    }
    if(r.raw.m_Stat?.m_AtkPhysic)physicalAttackAdd+=nativeValues.abilityValue(r.raw.m_Stat.m_AtkPhysic,level);
    if(r.raw.m_Stat?.m_AtkMagic)magicAttackAdd+=nativeValues.abilityValue(r.raw.m_Stat.m_AtkMagic,level);
  }
  const v=(id,key,neutral)=>rawValues[id]?.[key]??neutral;
  if(skillLevels[28406])unresolved.push('28406 Blooming Flame seed creation/party cleanse consumer unavailable');
  
  
  
  return {schemaVersion:1,professionId,skillLevels,targetClientMeasured:false,
    evidenceClass:'target2016 fields; qualified fixedV5/2026 consumers and explicit target-description adapters',
    stats:{physicalAttackAdd,magicAttackAdd},burning:{enabled:false},explosive:{enabled:false,buffActivationSupported:false,buffFactorId:null},
    victory:{enabled:false,forceDownMultiplier:1},received:{enabled:false,damageMultiplier:1},soul:{onHitAdd:0,receivedAdd:0},
    awakening:{enabled:false,canReawaken:false,durationMultiplier:1},
    speedPassives:{moveSpeedMultiplier:{sum:v(28402,'SA_MOVE_SPEED',0)},animationSpeedMultiplier:{sum:v(28402,'SA_ANI_SPEED',0)}},
    elesis:{rawValues,commandKnockdownMultiplier:v(28404,'SA_FORCE_DOWN_REL',1),magicalCriticalRateAdd:v(28407,'SA_ATK_CRITICAL_RATE_ABS',0),
      magicalCriticalDamageAdd:v(28407,'SA_ATK_CRITICAL_DAM_ABS',0),fireResistancePoints:v(28405,'SA_FIRE_DEFENCE_ABS',0),
      commandFireDamageMultiplier:v(28405,'SA_DAMAGE_REL',1)},
    reactTypes:{createDamageEffect:profile.enums.REACT_TYPE.RT_CREATE_DAMAGE_EFFECT,createEffectSet:profile.enums.REACT_TYPE.RT_CREATE_EFFECT_SET},unresolved};
}


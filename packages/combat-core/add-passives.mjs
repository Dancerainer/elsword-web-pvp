import {addPassiveSample2016} from './add-passive-sample-2016.mjs';
/** Add passive ownership and numeric target fields. Systems consume their own
 * fields; unknown values remain listed instead of borrowing Raven behavior. */
export function initializeAddPassives(profile,{nativeValues,passiveIds=profile.defaultPassiveSkillIds??[]}={}){
 if(profile.target?.unitType!==9)throw new TypeError('Add profile required');
 const rows=new Map(profile.skillCatalog.filter(s=>s.passive&&s.topTier).map(s=>[s.skillId,s]));
 if(!Array.isArray(passiveIds)||new Set(passiveIds).size!==passiveIds.length||passiveIds.some(id=>!rows.has(id)))throw new TypeError('Invalid Add passive IDs');
 const skillLevels=Object.fromEntries(passiveIds.map(id=>[id,rows.get(id).maxLevel]));
 const value=(id,key,neutral)=>{if(!skillLevels[id])return neutral;const table=rows.get(id).raw[key];if(!Number.isFinite(table?.[skillLevels[id]]))throw new TypeError(`Missing Add passive ${id}.${key}`);return nativeValues.abilityValue(table,skillLevels[id]);};
 return {schemaVersion:1,professionId:profile.professionId.toUpperCase(),targetClientMeasured:false,
  evidenceClass:'target2016 declarations with qualified fixedV5 Add reference',skillLevels,
  stats:{physicalAttackAdd:0,magicAttackAdd:0,mpMaxAdd:value(29406,'SA_MAX_MP_ABS',0)},
  burning:{enabled:false},explosive:{enabled:false,buffActivationSupported:false,buffFactorId:null},
  victory:{enabled:false,forceDownMultiplier:1},received:{enabled:false,damageMultiplier:1},
  soul:{onHitAdd:0,receivedAdd:0},awakening:{enabled:false,canReawaken:false,durationMultiplier:1},
  speedPassives:{animationSpeedMultiplier:{multiple:value(29411,'SA_ANI_SPEED',1)}},
  add:{installationDamageMultiplier:value(29409,'SA_DAMAGE_REL',1),nasodArmorDamageMultiplier:value(29400,'SA_DAMAGE_REL',value(29405,'SA_DAMAGE_REL',value(29410,'SA_DAMAGE_REL',1))),
   forceDownMultiplier:value(29401,'SA_FORCE_DOWN_REL',value(29406,'SA_FORCE_DOWN_REL',value(29411,'SA_FORCE_DOWN_REL',1))),
   animationSpeedMultiplier:value(29411,'SA_ANI_SPEED',1),dynamoDurationMultiplier:value(29406,'SA_EFFECTIVE_TIME',1),
   mindControlDebuffTemplateIds:[52,53,61,161,172,184,223,291],mindControlDebuffDurationMultiplier:value(29412,'SA_REDUCE_EDT_TIME_REL',1)},
  reactTypes:{createDamageEffect:profile.enums.REACT_TYPE.RT_CREATE_DAMAGE_EFFECT,createEffectSet:profile.enums.REACT_TYPE.RT_CREATE_EFFECT_SET},
  unresolved:profile.professionId==='lp'?[]:
   profile.professionId==='mm'?['Hidden Records applies to emitted carrier lifetimes; inheritance by later split projectiles is unconfirmed']:
   ['Overlimit ordinary armor callbacks beyond recovered native129 remain unbound']};
}

/** Target BFI356/357 carry the values and mutual exclusion. The pinned native
 * ProcessPowerExchanger changes the buff only when DP crosses half capacity;
 * retaining that selector avoids recreating a dispelled buff every frame. */
export function tickAddPassiveBuffs(sim,actor){
 if(actor.professionId!=='LP'||!actor.sourceAdd)return;
 const level=actor.passivePolicy?.skillLevels?.[29403];if(!level)return;
 const factor=actor.sourceAdd.dp>=4000?356:357;
 const state=actor.sourceAddCombat??={pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1};
 if(state.outputExchangeFactor===factor)return;
 state.outputExchangeFactor=factor;
 sim.grantBuff(actor,actor,factor,level,null);
}

/** StateChangeSpecialAttack invokes this after actual costs, before skill MP
 * conversion and cooldown procs. Free second activations do not repeat it. */
export function applyAddMindControlRefund(sim,actor,skill,plan,{changeDp}={}){
 if(actor.professionId!=='DE'||plan.mode!=='cast')return 0;
 const level=actor.passivePolicy?.skillLevels?.[29412];if(!level)return 0;
 const profile=sim.profileFor(actor),raw=profile.skillCatalog.find(s=>s.skillId===29412).raw;
 const chance=Math.fround(raw.SA_EFFECTIVE_RATE[level]),fraction=Math.fround(raw.SA_RECOVERY_VALUE_REL[level]);
 if(!(chance>0))return 0;
 const sample=addPassiveSample2016(sim,actor);if(!sample.supported||!(sample.value<=chance))return 0;
 const amount=Math.fround((plan.formation?plan.dpCost:plan.mpCost)*fraction);if(!(amount>0))return 0;
 if(plan.formation){
  if(!changeDp){sim.note('add-mind-control-refund-hook','Original option-aware DP recovery consumer unavailable',actor);return 0;}
  const restored=changeDp(actor,amount,{profile,emit:(...args)=>sim.emit(...args),reason:'mind-control-refund'});
  if(restored>0)sim.emit('addMindControlRefund',actor.id,{skillId:skill.skillId,amount:restored/20,rawAmount:restored,resource:'DP',position:[actor.x,actor.y+50,actor.z]});
  return restored;
 }
 const before=actor.mp;actor.mp=Math.min(actor.mpMax,Math.fround(actor.mp+amount));
 if(actor.mp>before)sim.emit('addMindControlRefund',actor.id,{skillId:skill.skillId,amount:actor.mp-before,resource:'MP',position:[actor.x,actor.y+50,actor.z]});return actor.mp-before;
}

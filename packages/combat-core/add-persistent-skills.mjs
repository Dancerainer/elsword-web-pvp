import {changeAddDp} from './add-systems.mjs';

/** Original2016 327449f0/32741130: release checks after1s, maximum5s,
 * MP25*delta (equality accepted) or formed rawDP500*delta (strict >).
 * Resource admission precedes release/maximum checks in this callback. */
export function tickAddVoidHold(sim,a,dt){
 for(const e of sim.state.effects)if(e.ownerId===a.id&&!e.dead&&e.sourceAddVoidCollapse){
  const c=e.sourceAddVoidCollapse;c.scale=Math.fround(c.scale*.9800000190734863);c.alpha=Math.max(0,Math.fround(c.alpha+Math.fround(-.03)));
  for(const axis of ['X','Y','Z'])e.definition['SCALE_'+axis]=Math.fround((e.definition['SCALE_'+axis]??1)*.9800000190734863);
  if(c.scale<=.0010000000474974513){e.dead=true;e.endReason='original-void-field-collapse-ended';}
 }
 if(a.professionId!=='DE'||sim.profileFor(a).states[a.state]?.sourceState!=='ANSI_SA_ATT_VOID_FIELD_LOOP'||
  a.stateTime<1||!(dt>0)||sim.networkOwnerId!=null&&sim.networkOwnerId!==a.id)return;
 const elapsed=dt;a.sourceAddCombat.voidMaintenanceFailed=false;
 if(a.sourceAdd?.formation){
  const amount=500*elapsed;
  // Native admission compares unmodified rawDP strictly greater than cost;
  // the option-aware change applies only after admission succeeds.
  if(a.sourceAdd.dp<=amount){a.sourceAddCombat.voidMaintenanceFailed=true;return;}
  changeAddDp(a,-amount,{profile:sim.profileFor(a),emit:(...args)=>sim.emit(...args),reason:'void-field-maintenance',skillUse:true});
 }else {const cost=25*elapsed;if(a.mp<cost){a.sourceAddCombat.voidMaintenanceFailed=true;return;}a.mp=Math.fround(a.mp-cost);}
}

/** Original END separates the actor739c visual group from the7398 main
 * carrier. The independently timed recipient Buff survives source cleanup. */
export function isAddPersistentEffect(a,e){
 if(a.professionId==='LP'&&['EffectSet_SA_APT_STASIS_FIELD_Loop','EffectSet_SA_APT_STASIS_FIELD_Count_Down'].includes(e.setName))return true;
 return ['LP','DE'].includes(a.professionId)&&['EffectSet_SI_SA_ALP_Psychic_Storm_Loop','EffectSet_ATT_Void_Field'].includes(e.setName);
}
export function clearAddPersistentSkill(sim,a,kind){
 const sets=kind==='storm'?['EffectSet_SI_SA_ALP_Psychic_Storm_Loop']:['EffectSet_ATT_Void_Field'];
 const names=kind==='storm'?['DamageEffect_ALP_Psychic_Storm_Start_BlackHole']:['DamageEffect_ATT_Void_Field'];
 for(const e of sim.state.effects)if(e.ownerId===a.id&&!e.dead&&(sets.includes(e.setName)||names.includes(e.name))){
  if(kind==='void'&&e.name==='DamageEffect_ATT_Void_Field'){e.sourceAddVoidCollapse??={scale:1,alpha:1};continue;}
  e.dead=true;e.endReason='add-'+kind+'-handle-stop';e.suppressSecondaryDamage=true;
 }
}
export function endAddPersistentSkill(sim,a,next){
 const before=sim.profileFor(a).states[a.state]?.sourceState??a.state,after=sim.profileFor(a).states[next]?.sourceState??next;
 for(const [prefix,kind]of [['ANSI_SA_ALP_PSYCHIC_STORM','storm'],['ANSI_SA_ATT_VOID_FIELD','void']])
  if(before.startsWith(prefix)&&!after.startsWith(prefix))clearAddPersistentSkill(sim,a,kind);
}

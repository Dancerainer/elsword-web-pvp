import {changeAddDp} from './add-systems.mjs';
/** Writable source global33269ae8 was60 in the sealed2016 capture. This is
 * the frozen Web rule input, not a claim it is invariant in all original runs. */
export const ADD_SPACE_CRACK_DP_COST=60;
const f=Math.fround;
function clearGroup(sim,a){for(const e of sim.state.effects)if(e.ownerId===a.id&&e.setName==='EffectSet_ATT_Space_Crack'&&!e.dead){e.dead=true;e.endReason='space-crack-maintenance-ended';}}
export function startAddSpaceCrack(sim,a){
 const p=sim.profileFor(a),skill=p.skillCatalog.find(s=>s.skillId===a.skillId),interval=skill?.raw.SA_READY_TIME_REL?.[skill.maxLevel];if(!Number.isFinite(interval))return false;
 a.sourceAddCombat.spaceCrack={active:true,holdEnabled:true,timer:0,interval,count:0,group:a.stateSerial,skillId:a.skillId,power:a.skillScale};
 sim.spawnSet(a,'EffectSet_ATT_Space_Crack');return fire(sim,a,false);
}
function fire(sim,a,extra){
 const s=a.sourceAddCombat?.spaceCrack;if(!s)return false;
 s.timer=s.interval;s.count++;
 if(extra){if(a.sourceAdd?.formation){if(a.sourceAdd.dp>ADD_SPACE_CRACK_DP_COST)changeAddDp(a,-ADD_SPACE_CRACK_DP_COST,{profile:sim.profileFor(a),emit:(...args)=>sim.emit(...args),reason:'space-crack-extra',skillUse:true});}
  else a.mp=f(Math.max(0,a.mp-3));}
 sim.spawnSet({...a,skillId:s.skillId,skillScale:s.power},'EffectSet_ATT_Space_Crack_Performing');
 const bone=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},a,{profile:sim.profileFor(a)});
 if(!bone?.position){sim.note('space-crack-source-bone','Original Bip01 required; attempt/cost still consumed before factory',a);return false;}
 sim.createEffect({...a,skillId:s.skillId,skillScale:s.power},{NAME:'DamageEffect_ATT_Space_Crack_Rupture_'+(extra?'Sub':'Main')+'_Projectile'},{birthAnchor:structuredClone(bone)});return true;
}
export function tickAddSpaceCrack(sim,a,dt){
 const s=a.sourceAddCombat?.spaceCrack;if(!s)return;
 if(s.active&&s.timer>0){s.timer=f(Math.max(0,s.timer-dt));if(s.timer<=0)fire(sim,a,true);if(s.count>5){s.active=s.holdEnabled=false;}}
 if(!s.active)clearGroup(sim,a);
}
export function endAddSpaceCrack(sim,a,next){
 const s=a.sourceAddCombat?.spaceCrack;if(!s)return;
 const state=sim.profileFor(a).states[next]?.sourceState??next;
 if(state==='ANSI_A_ATT_SPACE_CRACK_END'){s.active=s.holdEnabled=false;clearGroup(sim,a);}
 else if(!state.startsWith('ANSI_A_ATT_SPACE_CRACK_'))s.holdEnabled=false;
}
export function validateAddSpaceCrack(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==8||typeof value.active!=='boolean'||typeof value.holdEnabled!=='boolean'||![29212,29220].includes(value.skillId)||!Number.isInteger(value.count)||value.count<1||value.count>6||!Number.isSafeInteger(value.group)||value.group<0||!Number.isFinite(value.power)||value.power<0||value.power>100||value.interval!==.2||!Number.isFinite(value.timer)||value.timer<0||value.timer>value.interval)throw new TypeError('Invalid Space Crack controller');return true;
}

/** Target2016 state eligibility and DP charge. The reaction/100-percent
 * reduction order is a bounded fixed-V5 Add consumer, not a client trace. */
import {changeAddDp,isAddActor} from './add-systems.mjs';

export const ADD_BARRIER_STATE='ANSI_DP_BARRIER_ACTIVE';
export const ADD_BARRIER_EVIDENCE='target2016 POSSIBLE_NASOD_BARRIER(_BY_UNIT_CLASS), USE_DP_BY_NASOD_BARRIER + fixed-a8438f3 Add DamageReact';

/** Eligibility reads the current original state, without modifying resources.
 * Ordinary LP-only command rows must not enable a barrier for MM or DE. */
export function addBarrierEligible(actor,profile,data){
  if(!isAddActor(actor)||!actor.sourceAdd?.formation||!(actor.sourceAdd.dp>0))return false;
  if(data?.REACT_TYPE===profile.enums.REACT_TYPE.RT_DUMMY_DAMAGE)return false;
  if(!profile.states[ADD_BARRIER_STATE])return false;
  const raw=profile.states[actor.state]?.raw;
  if(!raw)return false;
  return raw.POSSIBLE_NASOD_BARRIER===1||raw.POSSIBLE_NASOD_BARRIER===true||
    Object.values(raw.POSSIBLE_NASOD_BARRIER_BY_UNIT_CLASS??{}).includes(profile.target.unitClass);
}

/** StateStart owns the charge, including normal source option conversion.
 * Network restoration assigns actor state without calling StateStart. */
export function addBarrierStateStart(sim,actor){
  if(!isAddActor(actor)||actor.state!==ADD_BARRIER_STATE)return false;
  const profile=sim.profileFor(actor),charge=profile.components.USE_DP_BY_NASOD_BARRIER;
  if(!Number.isFinite(charge)||charge<0)throw new TypeError('Missing target2016 Nasod barrier DP charge');
  const spent=-changeAddDp(actor,-charge,{profile,reason:'nasod-barrier',emit:(...args)=>sim.emit(...args)});
  sim.emit('addBarrierStarted',actor.id,{spent,dp:actor.sourceAdd.dp,evidence:ADD_BARRIER_EVIDENCE});
  return true;
}

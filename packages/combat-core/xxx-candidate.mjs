/** Bounded target-resource candidate explicitly authorized for the missing XXX
 * blast. The 2016 owner callback is unavailable. Entry supplies the proposed
 * set epoch; its original .25 delay, damage data, helper and .4 mesh lifetime
 * are untouched. The old compiled .16/7MP callback supplies only payment/fail;
 * its incompatible smoke/manual sphere is not presented or used for damage.
 */
export const XXX_CANDIDATE=Object.freeze({state:'RSI_COMBO_XXX',setName:'EffectSet_A_RF_XXX',
  damageName:'DamageEffect_RF_XXX',evidenceClass:'target2016-resource-owner-candidate-unverified',
  contract:'contracts/rf-xxx-candidate-v15.json'});

export function beginXxxCandidate(s,a){
  // BM reuse is an explicit project rule. The original target
  // owner remains unverified; share RF's bounded adapter and its MP gate.
  if(a.state!==XXX_CANDIDATE.state||s.hasNasod?.(a)===false||![106,107].includes((s.profileFor?.(a)??s.profile)?.target?.unitClass)||!(s.commandsFor?.(a)??s.nativeCommands)?.runNow)return;
  const first=s.state.nextEffectId;
  s.spawnSet(a,XXX_CANDIDATE.setName);
  const effects=s.state.effects.filter(e=>e.id>=first);
  for(const e of effects){e.xxxCandidatePendingPayment=true;e.sourceCandidate={...XXX_CANDIDATE};}
  a.xxxCandidate={stateSerial:a.stateSerial,effectIds:effects.map(e=>e.id),
    effects:effects.map(e=>({id:e.id,name:e.name,damage:!!e.damage})),paymentResolved:false};
  s.note('xxx-target-owner-candidate','2016 XXX set queued at proposed state-entry epoch; owner callback and MP cost equivalence remain unverified',a);
  s.emit('xxxCandidateQueued',a.id,{...XXX_CANDIDATE,setEpochAnimation:a.animationTime,
    damageStartSetRelative:(s.profileFor?.(a)??s.profile).effectSets[XXX_CANDIDATE.setName].raw.EFFECT1.START_TIME});
}

export function resolveXxxCandidate(s,a,result){
  const candidate=a.xxxCandidate;
  if(!candidate||candidate.paymentResolved||candidate.stateSerial!==a.stateSerial)return;
  const success=result.unsupportedManualDamageCalls>0,failed=result.magicFailCalls>0;
  if(!success&&!failed)return;
  candidate.paymentResolved=true;candidate.paymentAccepted=success;
  for(const prior of candidate.effects){
    const e=s.state.effects.find(e=>e.id===prior.id);
    if(!e)continue;
    if(success)e.xxxCandidatePendingPayment=false;
    else {e.dead=true;e.endReason='xxx-reference-mp-failed';}
  }
  s.emit('xxxCandidatePayment',a.id,{accepted:success,mp:a.mp,
    evidenceClass:'fixed-V5-compiled-.16-7MP-payment-not-target2016-owner',contract:XXX_CANDIDATE.contract});
}

export function endXxxCandidate(s,a){
  const candidate=a.xxxCandidate;if(!candidate)return;
  for(const prior of candidate.effects){
    const e=s.state.effects.find(e=>e.id===prior.id);
    // The pending request belongs to this candidate action. A spawned world
    // blast has its own original finite mesh lifetime and may outlive cancel.
    if(e?.active&&e.damage&&!e.xxxCandidatePendingPayment)continue;
    if(e){e.dead=true;e.endReason='xxx-candidate-owner-exit';}
    // Particle-only combat records retire after birth; their presentation
    // identity remains in this owner record until explicit action cleanup.
    if(!prior.damage&&!e?.endEmitted){if(e)e.endEmitted=true;s.emit('effectEnded',a.id,
      {effectId:prior.id,name:prior.name,setName:XXX_CANDIDATE.setName,reason:'xxx-candidate-owner-exit'});}
  }
  delete a.xxxCandidate;
}

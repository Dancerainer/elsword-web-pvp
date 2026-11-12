// Frozen web baseline, not an original-client trace.
/** Cosmetic remote-vs-remote contact uses the same frozen hit consumer in an
 * isolated state. Neither authority, gameplay RNG nor owner reports are changed. */
export function observeRemoteDamage(simulation,attacker,defender,data,origin){
  const shadow=Object.create(simulation);
  shadow.state=structuredClone(simulation.state);shadow.state.events=[];
  for(const actor of [attacker,defender]){
    const index=shadow.state.actors.findIndex(a=>a.id===actor.id);
    if(index>=0)shadow.state.actors[index]=structuredClone(actor);
  }
  shadow.networkOwnerId=null;shadow.receiverHitMemory=null;shadow.observationOnly=true;
  // Separate deterministic presentation draws from the combat random stream.
  let seed=2166136261;
  for(const c of `${simulation.state.step}:${attacker.id}:${defender.id}:${origin.kind}:${origin.id??''}`)
    seed=Math.imul(seed^c.charCodeAt(0),16777619);
  shadow.state.seed=seed>>>0||1;
  const a=shadow.actor(attacker.id),b=shadow.actor(defender.id);
  const result=shadow.applyParticipantHit(a,b,structuredClone(data),structuredClone(origin));
  // An observer has no resource authority. As with observedHit above, run
  // Luna's accepted-contact factor in this isolated copy for its original red
  // MP text. Do not replay unrelated pre-existing interval buffs or use an
  // already-arrived owner receipt to erase a cosmetic contact indication.
  if(result.accepted&&origin.kind==='effect'&&origin.skillId===21017){
    b.buffs=[];b.sourceRuneSlayerHitReceipts={};
    shadow.acceptedSkillHit(a,b,structuredClone(data),structuredClone(origin));
    shadow.advanceActorBuffs(b,1/60);
    for(const event of shadow.state.events)if(event.type==='buffMpChanged'&&event.templateId===98&&event.resourceNumber)
      simulation.emit('observedBuffMpChanged',b.id,{delta:event.delta,drawText:event.drawText,templateId:event.templateId,
        resourceNumber:event.resourceNumber,presentationOnly:true,inference:'client-contact-estimate'});
  }
  for(const event of shadow.state.events)if(event.type==='observedHit'&&event.amount>0&&event.damageNumber)
    simulation.emit('observedHit',event.actorId,{targetId:event.targetId,amount:event.amount,critical:event.critical,
      damageNumber:event.damageNumber,presentationOnly:true,inference:'client-contact-estimate'});
  return {...result,observationOnly:true,effectTrigger:true};
}

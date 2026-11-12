import {copyObservationState} from './observation-state-copy.mjs';

/** Cosmetic remote-vs-remote contact uses the same frozen hit consumer in an
 * isolated state. Neither authority, gameplay RNG nor owner reports are changed. */
export function observeRemoteDamage(simulation,attacker,defender,data,origin){
  const shadow=Object.create(simulation);
  // Previous contacts can already have accumulated many events in this frame;
  // the isolated consumer discards them immediately. Do not clone that discarded
  // history, or clone the two participant actors a second time after the state.
  // All other state/effect fields still receive the complete independent copy.
  const participants=new Map([[attacker.id,attacker],[defender.id,defender]]);
  shadow.state=copyObservationState({...simulation.state,events:[],
    actors:simulation.state.actors.map(actor=>participants.get(actor.id)??actor)});
  shadow.networkOwnerId=null;shadow.receiverHitMemory=null;shadow.observationOnly=true;
  // Separate deterministic presentation draws from the combat random stream.
  let seed=2166136261;
  for(const c of `${simulation.state.step}:${attacker.id}:${defender.id}:${origin.kind}:${origin.id??''}`)
    seed=Math.imul(seed^c.charCodeAt(0),16777619);
  shadow.state.seed=seed>>>0||1;
  const a=shadow.actor(attacker.id),b=shadow.actor(defender.id);
  const result=shadow.applyParticipantHit(a,b,structuredClone(data),structuredClone(origin));
  // An observer has no resource authority. V62 permits the first eligible
  // blade or explosion to consume the local cosmetic quota. Run original117
  // in this isolated copy for red MP text, without ticking unrelated buffs
  // or using an arrived owner receipt to erase the cosmetic indication.
  if(result.accepted&&result.lunaMpApplied===true){
    b.buffs=[];b.sourceRuneSlayerHitReceipts={};
    shadow.grantBuff(a,b,117,shadow.skill(21017,a).maxLevel,null);
    shadow.advanceActorBuffs(b,1/60);
    for(const event of shadow.state.events)if(event.type==='buffMpChanged'&&event.templateId===98&&event.resourceNumber)
      simulation.emit('observedBuffMpChanged',b.id,{delta:event.delta,drawText:event.drawText,templateId:event.templateId,
        resourceNumber:event.resourceNumber,presentationOnly:true,inference:'client-contact-estimate'});
  }
  // Presentation-only quotas survive the next isolated third-party contact;
  // no remote actor, resource, gameplay RNG or owner report is changed.
  if(result.accepted&&shadow.state.localRuneLunaHitReceipts)
    simulation.state.localRuneLunaHitReceipts=structuredClone(shadow.state.localRuneLunaHitReceipts);
  for(const event of shadow.state.events)if(event.type==='observedHit'&&event.amount>0&&event.damageNumber)
    simulation.emit('observedHit',event.actorId,{targetId:event.targetId,amount:event.amount,critical:event.critical,
      damageNumber:event.damageNumber,presentationOnly:true,inference:'client-contact-estimate'});
  return {...result,observationOnly:true,effectTrigger:true};
}

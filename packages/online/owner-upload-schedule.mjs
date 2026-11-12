/** Web transport scheduling, not a recovered 2016 packet frequency. Events
 * remain in their canonical inbox until exact acceptance; this module never
 * removes or rewrites an event, pose, resource or protection value. */
export const OWNER_CHECKPOINT_INTERVAL_MS=100;

export function ownerUploadCheckpointKey(report){
  const a=report.actor;
  return JSON.stringify([report.epoch,report.actionFrontierComplete!==false,
    a.hp,a.mp,a.awakening?.gauge,a.awakening?.orbs,a.awakening?.full,(a.awakening?.remaining??0)>0,
    a.sourceAdd?.dp,a.sourceAdd?.mutation,a.sourceAdd?.formation,a.sourceAdd?.formationPending,
    a.sourceAdd?.generator?.skillId,a.sourceAdd?.generator?.phase,a.sourceAdd?.generator?.generation,
    a.state,a.stateSerial,a.facing,a.grounded,a.lineId,a.animationName,a.animationTransitionSerial,
    a.invincible,a.forceInvincible,a.superArmor,a.superArmorNotRed,a.skillSuperArmorNotRed,a.fired,a.pvpDead,
    a.sourceStatusClock?.revision,
    (a.buffs??[]).map(b=>[b.id,b.name,b.level,b.stacks,b.sourceId]),
    report.effects.map(e=>[e.id,e.name,e.setName,e.active,e.dead,e.combatRetired])]);
}

export function hasUnsentOwnerEvents(report,inFlight=[]){
  const actions=new Set(),hits=new Set();
  for(const prior of inFlight)if(prior?.epoch===report.epoch){
    for(const action of prior.actions??[])actions.add(action.id);
    for(const hit of prior.hits??[])hits.add(hit.id);
  }
  return (report.actions??[]).some(action=>!actions.has(action.id))||(report.hits??[]).some(hit=>!hits.has(hit.id));
}

export function ownerUploadDeferral({report,key,lastKey,lastAt,now,inFlight=[],maximumCredits=8,healthyDirect=false,reliable=false}){
  if(!report)return null;
  const urgent=key!==lastKey||hasUnsentOwnerEvents(report,inFlight);
  // Leave two of the normal eight upload credits available for a new action,
  // victim hit or state/protection boundary. Small compatibility windows keep
  // at least one ordinary credit. ACK-driven flush still sends the newest pose.
  const ordinaryCredits=Math.max(1,maximumCredits-Math.min(2,maximumCredits-1));
  if(reliable&&!urgent&&inFlight.length>=ordinaryCredits)return 'reserved-credit';
  // An event covered by an in-flight reliable report must not disable the
  // existing healthy-direct 10 Hz checkpoint limit. A new ID always bypasses.
  if(!urgent&&healthyDirect&&now-lastAt<OWNER_CHECKPOINT_INTERVAL_MS)return 'direct-checkpoint';
  return null;
}

export function deferPeerOwnerPose({report,key,last,now,motion,control,packet,buffSyncSupported=false}){
  // Only a successfully transmitted v2 locomotion/victim checkpoint can stand
  // in for this periodic full pose. Attacks, legacy peers and unhealthy paths
  // retain the original cadence. Input edges and changed resources/terminal
  // state never wait for the next periodic checkpoint.
  return !!last&&last.epoch===report.epoch&&last.key===key&&now>last.at&&now-last.at<OWNER_CHECKPOINT_INTERVAL_MS
    &&report.frameSeq-last.frameSeq<6&&report.frameSeq>last.frameSeq
    &&!!(motion?.locomotion||motion?.reaction)&&buffSyncSupported
    &&control.negotiated&&!control.failed&&!control.degraded&&control.acknowledgedPoseEpoch===report.epoch
    &&control.poseAckAgeMs!==null&&control.poseAckAgeMs<250&&report.frameSeq-control.acknowledgedPoseFrame<=18
    &&!(packet.pressed?.length||packet.released?.length);
}

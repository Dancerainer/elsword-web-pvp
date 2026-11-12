/** Read-only acceptance adapters for the public MM workbench evidence.
 * The fixture records current Web behavior; it is not original-client proof. */
export function findGeneratorMarkEvidence(events,{actorId,targetId,skillId}){
 const fire=events.findLast(e=>e.type==='addGeneratorFired'&&e.actorId===actorId&&e.skillId===skillId);
 if(!fire)return null;
 const mark=events.find(e=>e.type==='addDroneMarkAcquired'&&e.actorId===actorId&&e.targetId===targetId&&e.skillId===skillId&&
  e.eventId>fire.eventId&&e.time>=fire.time);
 const hit=events.find(e=>e.type==='hit'&&e.actorId===actorId&&e.targetId===targetId&&e.origin?.skillId===skillId&&e.amount>0&&
  e.eventId>fire.eventId&&e.time>=fire.time);
 return mark&&hit?{fire,mark,hit}:null;
}

/** The current public schema only supplies effectParentId for the main mesh.
 * Passive/timed sequences instead expose their stable emitter id and source
 * name. Association to the one selected factory is corroborated by its own
 * main-model parent id, source declarations and matching movement; never
 * invent a missing passive effectParentId. */
export function followerTraceSequences(sequences,entries){
 const names=new Set(entries.filter(e=>e.TRACE===1||e.TRACE_MORE===1).map(e=>e.PARTICLE_NAME));
 return sequences.filter(s=>names.has(s.name)&&Number.isSafeInteger(s.id)&&Array.isArray(s.position)&&s.position.length===3&&s.position.every(Number.isFinite));
}
export function findFollowerTraceMovement(before,after,{deltaX,minMovement=20}){
 if(!Number.isFinite(deltaX)||Math.abs(deltaX)<=minMovement)return null;
 for(const a of before)for(const b of after){
  const shift=b.position[0]-a.position[0];
  if(a.id===b.id&&a.name===b.name&&Math.sign(shift)===Math.sign(deltaX)&&Math.abs(shift)>minMovement)
   return {sequenceId:a.id,name:a.name,before:a.position,after:b.position,deltaX:shift};
 }
 return null;
}

/** Most native Buffs merge by template. Immediate MP templates 97/98 instead
 * keep each application (ACCUMULATION_LIMIT=0) until the next actor step.
 * Preserve that short ordered list verbatim when it contains duplicates. */
export function needsFullOwnedBuffList(buffs){
 if(!Array.isArray(buffs)||buffs.length>512)throw Error('invalid-owned-relay-buffs');
 const seen=new Map();let duplicate=false;
 const immediate=buff=>[97,98].includes(buff.templateId)&&buff.accumulationLimit===0
  &&Array.isArray(buff.finalizers)&&buff.finalizers.some(row=>row.kind==='immediate');
 for(const buff of buffs){
  if(!buff||!Number.isSafeInteger(buff.templateId)||buff.templateId<0)throw Error('invalid-owned-relay-buff-identity');
  const previous=seen.get(buff.templateId);
  if(previous){
   if(!immediate(previous)||!immediate(buff))throw Error('invalid-owned-relay-buff-identity');
   duplicate=true;
  }
  seen.set(buff.templateId,buff);
 }
 return duplicate;
}

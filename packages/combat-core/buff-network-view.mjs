/** Web owner projection. Resource-only Buff behavior runs on its affected
 * player's simulation. Remote observers keep exact identities, lifetime and
 * all damage/defence/control behavior; typed empty rows keep index semantics.
 * Normalize both sides before remote reapplication so the original Buff
 * merge executor continues to compare matching behavior kinds. */
const resourceStats=new Set(['hitMeleeMpMultiplier','hitRangeMpMultiplier','receivedMpMultiplier']);
export function projectRemoteBuffResources(buff){
 const result={...buff,behaviors:buff.behaviors.map(row=>{
  // Native accumulation consumes the incoming relation/percentage value for
  // every behavior, including resource-only rows (BM99 bleed and BM546 MP).
  // Keep all rows for a stackable identity so observed reapplication uses the
  // same native merge. Remote intervals still never execute resource changes.
  const accumulated=buff.accumulationLimit>1;
  if(!accumulated&&(row.kind==='hpInterval'||row.kind==='mpInterval'||row.kind==='stat'&&resourceStats.has(row.stat)))return {type:row.type,kind:'empty'};
  const value={...row};delete value.evidence;delete value.evidenceClass;delete value.targetClientMeasured;return value;
 })};
 delete result.evidence;delete result.evidenceClass;delete result.targetClientMeasured;return result;
}

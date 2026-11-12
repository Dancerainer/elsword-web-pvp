/** A missing DPR enum leaves that resource consumer unsupported. It must not
 * reject independent original scalar damage and reaction fields. Raw profiles
 * retain the original misspelling; no resource rate is invented or substituted.
 */
export function addKnownDamageData(profile,data){
 if(profile?.target?.unitClass===123&&data?.APPLIED_SKILL_ID===29015&&
  data.HIT_TYPE?.$symbol==='HIT_TYPE.HT_SLASH'&&data.HIT_TYPE.$unsupported==='target enum member absent'){
  // HIT_TYPE chooses the unresolved contact presentation. It is independent
  // of the explicitly numeric damage/reaction/MP declaration; do not reject
  // Phantom Seeker's whole hit, or guess a replacement slash enum value.
  const known={...data};delete known.HIT_TYPE;
  return {data:known,gap:'HIT_TYPE.HT_SLASH'};
 }
 const rate=data?.DYNAMO_PARTICLE_RATE_TYPE;
 if(profile?.target?.unitType!==9||rate?.$symbol!=='DYNAMO_PARTICLE_RATE_TYPE.DPRT_SPEICAL_ACITVE'||rate.$unsupported!=='target enum member absent')return {data,gap:null};
 const known={...data};delete known.DYNAMO_PARTICLE_RATE_TYPE;
 return {data:known,gap:'DYNAMO_PARTICLE_RATE_TYPE.DPRT_SPEICAL_ACITVE'};
}

/** V61 project rule: the finishing impact must catch a victim held against an
 * authored closed endpoint. The original2016 factory uses Bip01+250/100; its
 * uncorrected point can lie beyond that endpoint. Preserve its height, payload
 * and every open edge. This is not an original-client trajectory claim. */
export function addQuicksilverWallImpactPosition(sim,actor,position){
 if(actor.professionId!=='LP'||actor.skillId!==29011||!actor.grounded)return position;
 const line=sim.map.lines.find(row=>row.lineId===actor.lineId);
 if(!line||line.nativeFields?.ENABLE===false||line.nativeFields?.ENABLE===0||line.enabled===false)return position;
 const raw=line.type??line.nativeFields?.LINE_TYPE,symbol=raw?.symbol??raw?.$symbol??raw;
 if(![0,'LT_NORMAL','LINE_TYPE.LT_NORMAL'].includes(symbol))return position;
 const delta=[line.end[0]-line.start[0],line.end[2]-line.start[2]],lengthSq=delta[0]**2+delta[1]**2;
 if(!(lengthSq>0))return position;
 const along=((position[0]-line.start[0])*delta[0]+(position[2]-line.start[2])*delta[1])/lengthSq;
 const endpoint=along<0&&(line.beforeLine??line.nativeFields?.BEFORE_LINE)===-2?line.start:
  along>1&&(line.nextLine??line.nativeFields?.NEXT_LINE)===-2?line.end:null;
 return endpoint?[endpoint[0],position[1],endpoint[2]]:position;
}

/** Native HitUnit.fRemainGap is assigned at the accepted hit, then retained
 * through SetDamageDataNext. New damage-stage HIT_GAP must not rewrite it.
 * The host stores its equivalent absolute clock + birth gap independently.
 */
export function canRepeatHit(hits,gaps,id,time,data){
  const last=hits[id];
  return last==null||!!data.RE_ATTACK&&time-last>=(gaps[id]??data.HIT_GAP??0)-1e-9;
}
export function rememberHit(hits,gaps,id,time,data){
  hits[id]=time;gaps[id]=data.HIT_GAP??0;
}
/** Source 31f07df0 / 31f07d10 record operations. The explicit rows use the
 * carrier's actual received/effect delta. They do not infer elapsed wall time.
 * Control invalidation and cached valid bytes do not erase native records. */
const sourceF32=Math.fround;
export function appendSourceHitMemory2016(rows,targetId,gap){
 if(!Array.isArray(rows)||typeof gap!=='number')throw TypeError('Invalid original hit-memory input');
 const row={targetId,remaining:sourceF32(gap)};rows.push(row);return row;
}
export function sourceHitMemoryContains2016(rows,targetId,{resolveTarget=row=>row.targetId}={}){
 if(!Array.isArray(rows))throw TypeError('Original hit-memory rows required');
 return targetId!=null&&rows.some(row=>resolveTarget(row)===targetId);
}
/** Own 12-byte vector: expired item swaps with last and rechecks that slot.
 * NaN is unordered and survives. Repeat=false leaves every TTL untouched. */
export function tickSourceHitMemory2016(rows,delta,{repeat}={}){
 if(!Array.isArray(rows)||!Number.isFinite(delta)||delta<0)throw TypeError('Invalid original hit-memory delta');
 if(repeat!==1&&repeat!==true)return rows;
 const dt=sourceF32(delta);
 for(let i=0;i<rows.length;){
  const row=rows[i];if(!row||typeof row.remaining!=='number')throw TypeError('Invalid original hit-memory record');
  row.remaining=sourceF32(sourceF32(row.remaining)-dt);
  if(row.remaining<=0){const last=rows.pop();if(i<rows.length)rows[i]=last;}
  else i++;
 }
 return rows;
}

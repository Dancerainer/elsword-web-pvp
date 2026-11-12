/** Recovered 2016 conditional Miss and attribute consumers. This module never
 * invents a per-frame seed or consumes the Web combat RNG. Callers must supply
 * the source seed, resolved properties and current mode/window inputs.
 * Finite ordered paths preserve documented binary32 stores; JS does not claim
 * an exact emulation of every x87 precision/control-word environment. */
import {sourceOriginalRandomWord2016} from './source-random-table-v53.mjs';
const f=Math.fround,finite=Number.isFinite;
const unsupported=(reason,fields=[])=>({supported:false,reason,missing:fields});
function sourceIndex(seed,offset){
 if(!Number.isInteger(seed)||seed<0||seed>65535)return unsupported('original-seed-required',['seed:u16']);
 if(!Number.isInteger(offset)||offset< -2147483648||offset>2147483647)return unsupported('original-offset-required',['offset:i32']);
 const signed=(seed+offset)|0,index=((signed%32000)+32000)%32000;
 return {supported:true,index,seed,offset,tableValue:sourceOriginalRandomWord2016(index)};
}
/** 31fcb9e0 / 32577d00 -> 32e32ef0; getter does not advance the seed. */
export function sourceRandomFloat2016(seed,offset=2){
 const row=sourceIndex(seed,offset);return row.supported?{...row,value:f(row.tableValue/32000)}:row;
}
/** 32e32f50 used by NPC's correlated special-offset lookup. */
export function sourceRandomInteger2016(seed,offset=0){
 const row=sourceIndex(seed,offset);return row.supported?{...row,value:Math.trunc(row.tableValue/32000*100)}:row;
}
/** 321dca70: protected2418>0 ? protected2490 :1. */
export function sourceAccuracyMultiplier2016(gate,value){
 if(!finite(gate)||gate>0&&!finite(value))return unsupported('original-owner-accuracy-multiplier-required');
 return {supported:true,value:gate>0?f(value):1};
}
/** Actual 31fc43f0 merger for the two original socket curves. Both source
 * Lua prototypes return zero; flat/socket points therefore do not acquire an
 * invented old-version curve. Relation arrays retain native insertion order.
 * Inputs map to base0, temporaryPercent0c, temporaryMultiplier18, temporaryAdd24
 * and native relation vectors0/1/2/3. Defaults are explicit caller input. */
export function sourceAccuracyProperty2016(input){
 if(!input||!input.groups||!['swap','add1','add2','multiply'].every(k=>Array.isArray(input.groups[k])&&input.groups[k].every(finite)))
  return unsupported('original-property-relations-required',['groups.swap/add1/add2/multiply']);
 const g=input.groups;
 if(g.swap.length)return {supported:true,value:f(g.swap.at(-1)),curveResult:0,path:'last-swap'};
 const keys=['base','temporaryPercent','temporaryMultiplier','temporaryAdd'];
 const missing=keys.filter(k=>!finite(input[k]));if(missing.length)return unsupported('original-property-inputs-required',missing);
 const sum=v=>v.reduce((a,n)=>f(a+f(n)),0),product=g.multiply.reduce((a,n)=>f(a*f(n)),1);
 const curveArgument=f(f(sum(g.add1)+f(input.temporaryAdd))+sum(g.add2));
 const b=f(input.base),shifted=b<=0;let x=shifted?f(b+1):b;
 let m=f((1*(f(input.temporaryPercent)+1))*f(input.temporaryMultiplier)*product);
 if(m>0){if(product>=1)m=f(f(m-1)+1);x=f(x*m);}
 if(shifted)x=f(x-1);
 return {supported:true,value:x<=0?0:x,curveResult:0,curveArgument,factor:m,path:'native-zero-socket-curve'};
}

function sourceWindowActive(target){
 if(!Array.isArray(target.windows))return unsupported('original-window-state-required',['target.windows']);
 if(target.windows.length&&(!finite(target.modelClock)||!Number.isInteger(target.directionByte)))
  return unsupported('original-window-clock-required',['target.modelClock','target.directionByte']);
 for(const w of target.windows){
  if(!['REVENGE','REFLEX_MAGIC'].includes(w?.kind)||!finite(w.begin)||!finite(w.end))return unsupported('unsupported-original-evasion-window');
  if(target.directionByte===1&&f(w.begin)<f(target.modelClock)&&f(target.modelClock)<f(w.end))return {supported:true,active:true};
 }
 return {supported:true,active:false};
}
/** 324dae50 priority for finite ordered operands. owner.skills is an explicit
 * resolved map, so {} means neither conditional skill was learned. */
export function sourceMissThreshold2016({owner,target}={}){
 if(owner===null||target===null)return {supported:true,threshold:1,path:'null-participant'};
 if(!owner||!target)return unsupported('original-participants-required',['owner','target']);
 if(!['player','npc'].includes(owner.kind)||!['player','npc'].includes(target.kind))return unsupported('original-unit-kind-required');
 if(target.kind==='player'){
  if(typeof target.modelPresent!=='boolean')return unsupported('original-target-model-required',['target.modelPresent']);
  if(!target.modelPresent)return {supported:true,threshold:1,path:'missing-player-model'};
  const w=sourceWindowActive(target);if(!w.supported)return w;if(w.active)return {supported:true,threshold:1,path:'revenge-reflex-window'};
 }
 if(!Number.isInteger(target.evasionRecords)||target.evasionRecords<0)return unsupported('original-target-evasion-records-required',['target.evasionRecords']);
 if(target.evasionRecords>0)return {supported:true,threshold:1,path:'target-evasion-records'};
 const missing=[];if(!finite(owner.accuracy))missing.push('owner.accuracy');if(!finite(owner.accuracyMultiplier))missing.push('owner.accuracyMultiplier');
 if(!finite(target.avoidance))missing.push('target.avoidance');if(owner.kind==='npc'&&!finite(target.npcAccuracyPenalty))missing.push('target.npcAccuracyPenalty');
 if(typeof target.invincible!=='boolean')missing.push('target.invincible');
 if(missing.length)return unsupported('original-threshold-properties-required',missing);
 const n=owner.kind==='npc'?f(target.npcAccuracyPenalty):0;
 let threshold=f(f(f(owner.accuracyMultiplier)*f(owner.accuracy))-f(f(target.avoidance)+n-1));
 if(owner.kind==='player'){
  if(!Number.isInteger(owner.classId)||!owner.skills||typeof owner.skills!=='object'||!finite(owner.accuracyBonus))
   return unsupported('original-player-accuracy-additions-required',['owner.classId','owner.skills','owner.accuracyBonus']);
  for(const id of [24406,104]){
   const skill=owner.skills[id];if(!skill||id===24406&&owner.classId!==106)continue;
   if(!Number.isInteger(skill.level)||skill.level<1||!finite(skill.accuracyPercent))return unsupported('original-learned-skill-accuracy-required',[String(id)]);
   threshold=f(threshold+f(skill.accuracyPercent));
  }
  const bonus=Math.min(1,f(owner.accuracyBonus));if(bonus>0)threshold=f(threshold+bonus);
 }
 if(target.invincible)threshold=1;
 return {supported:true,threshold,path:target.invincible?'target-invincible-override':'ordinary-accuracy'};
}
/** Ordinary DD0/1/2/3 only. Input npcSpecialOffset is explicit for NPC targets;
 * a positive branch requires the resolved owner's original seed. */
export function evaluateSourceMiss2016({selector,owner,target,damage,npcSpecialOffset}={}){
 if(![0,1,2,3].includes(selector))return unsupported('special-damage-dispatch-unported',['selector:0|1|2|3']);
 if(!damage||!['HP_PERCENT_UP','MP_PERCENT_UP','INCREASE_MP'].every(k=>finite(damage[k])))
  return unsupported('original-recovery-fields-required',['damage.HP_PERCENT_UP','damage.MP_PERCENT_UP','damage.INCREASE_MP']);
 if(['HP_PERCENT_UP','MP_PERCENT_UP','INCREASE_MP'].some(k=>damage[k]>0))return {supported:true,miss:false,threshold:null,sample:null,path:'positive-recovery-bypass'};
 if(typeof damage.NO_MISS!=='boolean'&&damage.NO_MISS!==0&&damage.NO_MISS!==1)return unsupported('original-no-miss-field-required',['damage.NO_MISS']);
 const result=damage.NO_MISS?{supported:true,threshold:1,path:'no-miss-override'}:sourceMissThreshold2016({owner,target});
 if(!result.supported)return result;
 const context={npcSideEffect:target?.kind==='npc'?{field:'target6db8',required:true,boundary:'324edec0 map-specific value requires caller state'}:null,order:selector===3?'target60-before-miss':'miss-before-target60',guild509:'after-nonzero-reaction-gate-before-final-miss-branch; actual grant still uses native factor/rate pipeline'};
 if(result.threshold>=1||result.threshold<0)return {...result,...context,miss:result.threshold<0,sample:null,seedIndependent:true,proof:'Original table sample range is [0,0.9999687671661377]'};
 if(!target||!['player','npc'].includes(target.kind))return unsupported('original-sampling-target-required');
 let offset=2,npcSideEffect=null;
 if(target.kind==='npc'){
  if(typeof npcSpecialOffset?.enabled!=='boolean')return unsupported('original-npc-offset-mode-required',['npcSpecialOffset.enabled']);
  npcSideEffect={field:'target6db8',required:true,boundary:'324edec0 map-specific value requires caller state'};
  if(npcSpecialOffset.enabled&&npcSpecialOffset.sourcePresent!==false){
   if(npcSpecialOffset.sourcePresent!==true)return unsupported('original-npc-owner-wrapper-required',['npcSpecialOffset.sourcePresent']);
   const integer=sourceRandomInteger2016(npcSpecialOffset.ownerSeed,0);if(!integer.supported)return integer;offset=integer.value+2;
  }
 }
 const random=sourceRandomFloat2016(target.seed,offset);if(!random.supported)return random;
 return {...result,miss:result.threshold<random.value,sample:random.value,random,npcSideEffect,
  order:selector===3?'target60-before-miss':'miss-before-target60',
  guild509:'after-nonzero-reaction-gate-before-final-miss-branch; actual grant still uses native factor/rate pipeline'};
}
/** Adapt only already decoded BBT14/15 stat records. The caller still supplies
 * all base/temporary fields to the merger. Other Buff consumers stay external. */
export function sourceAccuracyBuffGroups2016(behaviors,behaviorType){
 if(!Array.isArray(behaviors)||![14,15].includes(behaviorType))return unsupported('original-accuracy-buff-records-required');
 const stat=behaviorType===14?'accuracy':'avoidance',groups={swap:[],add1:[],add2:[],multiply:[]};
 for(const row of behaviors){
  if(row?.type!==behaviorType&&row?.stat!==stat)continue;
  if(row.kind!=='stat'||!Number.isInteger(row.changeType)||row.changeType<0||row.changeType>3||!finite(row.value))
   return unsupported('undecoded-original-accuracy-buff',[stat]);
  groups[['swap','add1','add2','multiply'][row.changeType]].push(f(row.value));
 }
 return {supported:true,groups};
}

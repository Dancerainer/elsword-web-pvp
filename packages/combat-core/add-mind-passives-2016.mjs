import {addPassiveSample2016} from './add-passive-sample-2016.mjs';
const f=Math.fround;
const passive=(actor,profile,id,key)=>{const level=actor.passivePolicy?.skillLevels?.[id];
 if(!level)return 0;const value=profile.skillCatalog.find(s=>s.skillId===id)?.raw?.[key]?.[level];
 if(!Number.isFinite(value))throw new TypeError('Missing original Add mind passive '+id+'.'+key);return f(value);};
/**32742ad0 receives the original negative request before component108 stores
 * the clamped result. Both MP and DP producer fields must be positive. */
export function recoverAddMindCircle2016(actor,request,{profile,changeDp,emit}={}){
 const mp=passive(actor,profile,29413,'SA_ADD_MP_VALUE_ABS'),dp=passive(actor,profile,29413,'SA_ADD_DP_VALUE_ABS');
 if(!(mp>0&&dp>0)||!(request<0))return 0;
 const sign=request>>31,magnitude=((request^sign)-sign)|0;
 let amount;
 if(actor.sourceAdd.formation){const before=actor.mp;actor.mp=Math.max(0,Math.min(actor.mpMax,f(actor.mp+f(magnitude*mp))));amount=actor.mp-before;}
 else{if(typeof changeDp!=='function')throw new TypeError('Original Mind Circle DP consumer required');
  amount=changeDp(actor,f(magnitude*dp*20),{profile,emit,reason:'mind-circle'});}
 emit?.('addMindCircleRecovered',actor.id,{request,magnitude,amount,resource:actor.sourceAdd.formation?'mp':'dp',mutationBeforeWrite:actor.sourceAdd.mutation});
 return amount;
}
/**3272eae0 is the RECEIVING Add's+250 final-damage multiplier. Ordered
 * sample<=chance succeeds; an unlearned passive does not query the table. */
export function addEspDamageMultiplier2016(sim,target){
 if(target.professionId!=='DE')return 1;
 const profile=sim.profileFor(target),chance=passive(target,profile,29414,'SA_EFFECTIVE_RATE');
 if(!(chance>0))return 1;
 const sample=addPassiveSample2016(sim,target);if(!sample.supported||!(sample.value<=chance))return 1;
 return passive(target,profile,29414,'SA_DAMAGED_REL');
}

/** Target2016 local pending/apply phases, scoped by the calling post adapter.
 * Requests replace the pending record; applying claims the byte BEFORE exit,
 * then reads the record again after exit. No apply is added after a post. */
import {createSkillTraitPolicy} from './skill-traits.mjs';
const skillState=a=>({skillId:a.skillId,skillContext:structuredClone(a.skillContext??null),skillScale:a.skillScale});
export function withSourcePostRequests(sim,a,run,{profile=null}={}){
 const previous=sim.sourcePostContext,context={actor:a,skill:skillState(a),skillDispatched:false,mode:null,profile};
 sim.sourcePostContext=context;
 try{return run(context);}finally{Object.assign(a,context.skill);sim.sourcePostContext=previous;}
}
export function requestSourceState(sim,a,state,reason,{clearSkill=false,awakePlan=null,productPressed=[]}={}){
 if(!sim.profileFor(a).states[state]){sim.note?.('source-pending-state:'+state,'Original state is absent from the current supported profile',a);return false;}
 const serial=((a.sourceStateRequestByte??0)+1)&255;
 a.sourceStateRequestByte=serial;
 const skill=clearSkill?{skillId:null,skillContext:null,skillScale:1}:skillState(a);
 if(skill.skillContext)skill.skillContext.traitPolicy=null;
 a.sourcePendingState={state,reason,requestByte:serial,force:0,slot:sim.sourcePostContext?.slot??null,skill,
  ...(awakePlan?{awakePlan}:{}),...(productPressed.length?{productPressed:[...productPressed]}:{}),requestedAtStateSerial:a.stateSerial};
 if(sim.sourcePostContext?.actor===a)Object.assign(a,sim.sourcePostContext.skill);
 sim.emit?.('sourceStateRequested',a.id,{state,reason,requestByte:serial});return true;
}
export function applySourceStateRequest(sim,a){
 if(!a.sourcePendingState||a.sourceStateRequestByte===a.sourceAppliedStateByte)return false;
 a.sourceAppliedStateByte=a.sourceStateRequestByte;
 const previous=sim.sourceApplyingActor;sim.sourceApplyingActor=a;
 try{sim.enter(a,a.sourcePendingState.state,a.sourcePendingState.reason,{sourceApply:true});}
 finally{sim.sourceApplyingActor=previous;}
 if(a.sourceStateRequestByte===a.sourceAppliedStateByte)delete a.sourcePendingState;
 return true;
}
export function applyRequestedSkillContext(actor,pending,profile){
 if(!pending)return;
 Object.assign(actor,structuredClone(pending.skill));
 if(actor.skillContext){const row=profile?.skillCatalog.find(s=>s.skillId===actor.skillId);
  if(!row)throw new TypeError('Missing source pending skill template');
  actor.skillContext.traitPolicy=createSkillTraitPolicy(row,actor.skillContext.branchId);}
 if(pending.awakePlan){const plan=pending.awakePlan;
  actor.awakening.pendingAvailableOrbs=plan.availableOrbs;actor.awakening.pendingOrbs=plan.consumed;
  actor.awakening.reawakening=plan.reawakening;actor.awakening.orbs=Math.max(0,actor.awakening.orbs-plan.consumed);
 }
 if(pending.productPressed)actor.pendingPressed=[...new Set([...(actor.pendingPressed??[]),...pending.productPressed])];
}
export function validateSourcePendingState(value){
 const allowed=['state','reason','requestByte','force','slot','skill','requestedAtStateSerial',...(value?.awakePlan?['awakePlan']:[]),...(value?.productPressed?['productPressed']:[])];
 const integer=Number.isSafeInteger,finite=Number.isFinite;
 if(!value||typeof value!=='object'||Object.keys(value).length!==allowed.length||Object.keys(value).some(k=>!allowed.includes(k))||
  typeof value.state!=='string'||typeof value.reason!=='string'||value.state.length>128||value.reason.length>160||
  !integer(value.requestByte)||value.requestByte<0||value.requestByte>255||!integer(value.requestedAtStateSerial)||value.requestedAtStateSerial<0||
  value.force!==0||value.slot!==null&&(!integer(value.slot)||value.slot<0||value.slot>7)||
  !value.skill||Object.keys(value.skill).length!==3||!Object.hasOwn(value.skill,'skillId')||!Object.hasOwn(value.skill,'skillContext')||
  value.skill.skillId!==null&&(!integer(value.skill.skillId)||value.skill.skillId<1)||!finite(value.skill.skillScale)||value.skill.skillScale<=0||
  value.skill.skillContext!==null&&typeof value.skill.skillContext!=='object')throw new TypeError('Invalid original pending-state record');
 const c=value.skill.skillContext;if(c&&(Object.keys(c).length!==6||!['key','level','branchId','castStep','traitPolicy','hyperState'].every(k=>Object.hasOwn(c,k))||
  typeof c.key!=='string'||!['A','S','D','C','Q','W','E','R'].includes(c.key)||!integer(c.level)||c.level<1||typeof c.branchId!=='string'||
  !integer(c.castStep)||c.castStep<0||c.traitPolicy!==null||typeof c.hyperState!=='boolean'))throw new TypeError('Invalid pending skill context');
 const p=value.awakePlan;if(p&&(Object.keys(p).length!==3||!integer(p.availableOrbs)||p.availableOrbs<1||p.availableOrbs>3||!integer(p.consumed)||p.consumed<1||p.consumed>p.availableOrbs||typeof p.reawakening!=='boolean'))throw new TypeError('Invalid pending awakening plan');
 if(value.productPressed&&(!Array.isArray(value.productPressed)||value.productPressed.length<1||value.productPressed.length>2||new Set(value.productPressed).size!==value.productPressed.length||value.productPressed.some(k=>!['Z','X'].includes(k))))throw new TypeError('Invalid source product pressed input');
 return true;
}

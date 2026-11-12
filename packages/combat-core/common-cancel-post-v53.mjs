/** Nine original typed Raven post consumers. Source contracts and corrected
 * x87 finite comparisons are frozen in common-cancel-terminal-2016 and
 * rf-command-producers-2016; this module consumes current Web actor inputs. */
import {withSourcePostRequests,requestSourceState} from './source-state-requests-v53.mjs';
export const COMMON_CANCEL_SOURCE_STATES=new Set(['RSI_COMBO_XXX','RSI_SI3_SEVEN_BURST','RSI_A_RWT_MENTAL_BREAK',
 'RSI_WEAPON_TAKER_COMBO_ZZZXX','RSI_WEAPON_TAKER_COMBO_ZZZdownX','RSI_WEAPON_TAKER_COMBO_ZZZdownXX',
 'RVC_SI_SA_IGNITION_CROW_INCINERATION_OVERHEAT_END','RVC_SI_SA_IGNITION_CROW_OVERHEAT_END','RWT_COMBO_ZZZX']);
const slots=['A','S','D','C','Q','W','E','R'],f=Math.fround;
export function originalCancelLimit(raw,key){
 const value=key==='ATTACK_CANCEL_AFTER'?(raw[key]??raw.WALK_CANCEL_AFTER??9999):(raw[key]??9999);
 return Number.isFinite(value)?f(Math.max(f(value),.10000000149011612)):NaN;
}
export function usesSourceCommonPost(sim,a){
 const p=sim.profileFor(a),def=p.states[a.state];
 return [106,107,115].includes(p.target.unitClass)&&COMMON_CANCEL_SOURCE_STATES.has(def?.sourceState??a.state);
}
export function sourcePostSkillDispatch(sim,a,input,mode){
 const context=sim.sourcePostContext;if(!context||context.actor!==a||context.skillDispatched)return false;
 const slot=slots.findIndex(key=>input.pressed.has(key));if(slot<0)return false;
 const query=sim.skillAvailability(a.id,slot,{sourceMode:mode});if(!query.available)return false;
 context.mode=mode;context.slot=slot;
 try{sim.processInput(a,{pressed:new Set([slots[slot]]),held:new Set([slots[slot]]),released:new Set(),edges:[]},{sourceDispatch:true});}
 finally{context.mode=null;context.slot=null;}
 // Successful dispatch consumes MP/CD and may still have its request
 // overwritten. This latch prevents another slot dispatch in the same post.
 return context.skillDispatched;
}
export function sourceAwakening(sim,a,input){
 if(!input.pressed.has('AWAKEN')||a.awakening.orbs<=0||a.awakening.remaining>0&&!a.passivePolicy?.awakening?.canReawaken)return false;
 const reawakening=a.awakening.remaining>0,availableOrbs=a.awakening.orbs;
 return requestSourceState(sim,a,'RSI_HYPER_MODE','target2016-post-awakening',
  {clearSkill:true,awakePlan:{availableOrbs,consumed:reawakening?1:availableOrbs,reawakening}});
}
export function runSourceCommonPost(sim,a,input){
 if(!usesSourceCommonPost(sim,a))return false;
 return withSourcePostRequests(sim,a,()=>{
  const def=sim.profileFor(a).states[a.state],raw=def.raw,n=def.sourceState??a.state,time=f(a.animationTime),
   duration=def.clip.durationSeconds,ended=a.animationStopped||time>f(duration-Math.max(duration/10,.03));
  const request=(state,reason)=>requestSourceState(sim,a,state,reason,{clearSkill:true,
    productPressed:a.professionId==='VC'&&['RSI_WAIT','RSI_DASH','RSI_DASH_JUMP'].includes(state)&&(input.pureDoubleLeft||input.pureDoubleRight||input.pressed.has('DASH'))?['Z','X'].filter(key=>input.pressed.has(key)):[]}),
   airborne=(reason,clear=false)=>{request('RSI_JUMP_DOWN',reason);a.y=f(a.y-45);if(clear){a.vx=0;a.passiveSpeed.x=-1;}},
   gate=key=>{const limit=originalCancelLimit(raw,key);return Number.isFinite(limit)&&limit>=0&&time>limit;};
  function cascade(order='SABWDT',groundForDirection=true){
   for(const kind of order){
    if(kind==='S'&&a.grounded&&gate('SKILL_CANCEL_AFTER')&&sourcePostSkillDispatch(sim,a,input,1))return true;
    if(kind==='A'&&gate('SKILL_CANCEL_AFTER')&&sourceAwakening(sim,a,input))return true;
    if(groundForDirection&&!a.grounded&&'BWDT'.includes(kind))continue;
    if(kind==='B'&&gate('BWALK_CANCEL_AFTER')&&input.held.has(a.facing>0?'LEFT':'RIGHT')){request('RSI_WAIT','target2016-post-backwalk');return true;}
    if(kind==='W'&&gate('WALK_CANCEL_AFTER')&&(input.held.has('LEFT')||input.held.has('RIGHT'))){request('RSI_WAIT','target2016-post-walk');return true;}
    if(kind==='D'&&gate('DASH_CANCEL_AFTER')&&!a.buffControls?.dashBlock&&(input.pureDoubleRight||input.pureDoubleLeft||input.pressed.has('DASH'))){request(a.grounded?'RSI_DASH':'RSI_DASH_JUMP','target2016-post-dash');return true;}
    if(kind==='T'&&gate('ATTACK_CANCEL_AFTER')){if(input.held.has('Z')){request('RSI_COMBO_Z','target2016-post-z');return true;}
     if(input.held.has('X')){request('RSI_COMBO_X','target2016-post-x');return true;}}
   }return false;
  }
  if(n==='RSI_COMBO_XXX'){if(ended)request('RSI_WAIT','target2016-own-end');else cascade();}
  else if(['RSI_SI3_SEVEN_BURST','RSI_A_RWT_MENTAL_BREAK'].includes(n)){if(ended)request('RSI_WAIT','target2016-own-end');}
  else if(n==='RSI_WEAPON_TAKER_COMBO_ZZZXX'){
   if(!a.grounded)airborne('target2016-own-lost-contact',true);
   else{cascade();if(ended)request('RSI_WAIT','target2016-own-end-overwrite');}
  }else if(n==='RSI_WEAPON_TAKER_COMBO_ZZZdownX'){
   if(time>.5329999923706055&&input.pressed.has('X'))a.sourceCommandFlags=(a.sourceCommandFlags??0)|1;
   if(time>.7390000224113464){if((a.sourceCommandFlags&1)&&a.grounded)request('RSI_WEAPON_TAKER_COMBO_ZZZdownXX','target2016-own-down-latch');}
   else{const selected=cascade('SABWDT',false);if(!selected||(a.sourcePendingState?.reason!=='skill-input'&&a.sourcePendingState?.state!=='RSI_HYPER_MODE'))a.sourceCommandFlags=(a.sourceCommandFlags??0)&~1;}
   if(ended){if(!a.grounded)airborne('target2016-own-end-air');else request('RSI_WAIT','target2016-own-end');}
  }else if(n==='RSI_WEAPON_TAKER_COMBO_ZZZdownXX'){
   cascade();if(ended)request(a.grounded?'RSI_WAIT':'RSI_JUMP_DOWN','target2016-own-end-overwrite');
  }else if(n.includes('IGNITION_CROW_')){
   if(ended)request(a.grounded?'RSI_WAIT':'RSI_JUMP_DOWN','target2016-own-end');else cascade('DWSA',false);
  }else if(n==='RWT_COMBO_ZZZX'){
   if(time>.5329999923706055&&input.pressed.has('X'))a.sourceCommandFlags=(a.sourceCommandFlags??0)|1;
   if(time>.5669999718666077&&(a.sourceCommandFlags&1)&&a.grounded)request('RSI_WEAPON_TAKER_COMBO_ZZZXX','target2016-own-x-latch');
   if(ended){if(!a.grounded)airborne('target2016-own-end-air');else request('RSI_WAIT','target2016-own-end');}else cascade();
  }
  // This typed common stage executes even after an own-post match.
  if(raw.USE_COMMON_CANCEL_AFTER===1||raw.USE_COMMON_CANCEL_AFTER===true){
   if(!a.grounded)airborne('target2016-common-lost-contact');
   else if(!cascade()&&ended)request('RSI_WAIT','target2016-common-end');
  }
  // Original base31f66400's independent mode3 entrance remains last.
  sourcePostSkillDispatch(sim,a,input,3);
  return true;
 });
}

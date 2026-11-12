/** Original Raven132 post32896b70. The ordered82 buffer remains an explicit
 * product adapter and is not silently reclassified as this native consumer. */
import {withSourcePostRequests,requestSourceState} from './source-state-requests-v53.mjs';
import {originalCancelLimit,sourcePostSkillDispatch,sourceAwakening} from './common-cancel-post-v53.mjs';
const f=Math.fround;
export function ravenLocalUpDownRequest({grounded,time,limit,held}){
 return grounded&&Number.isFinite(limit)&&limit>=0&&Number.isFinite(time)&&f(time)>f(limit)&&
  (held.has('UP')||held.has('DOWN'));
}
export function runRavenLocalCommandPost(sim,a,input){
 const p=sim.profileFor(a),def=p.states[a.state];
 if(![106,107,115].includes(p.target.unitClass)||(def.sourceState??a.state)!=='RSI_COMBO_ZZXX'||a.cancelInput)return false;
 return withSourcePostRequests(sim,a,()=>{
  const raw=def.raw,time=f(a.animationTime),request=(state,reason)=>requestSourceState(sim,a,state,reason,{clearSkill:true});
  const gate=key=>{const limit=originalCancelLimit(raw,key);return Number.isFinite(limit)&&limit>=0&&time>limit;};
  if(!a.grounded){request('RSI_JUMP_DOWN','target2016-raven132-lost-contact');a.y=f(a.y-45);}
  else if(ravenLocalUpDownRequest({grounded:a.grounded,time,limit:originalCancelLimit(raw,'UPDOWN_CANCEL_AFTER'),held:input.held}))
   request('RSI_WAIT','target2016-raven132-updown-wait');
  else if(gate('SKILL_CANCEL_AFTER')&&sourcePostSkillDispatch(sim,a,input,1)){}
  else if(gate('SKILL_CANCEL_AFTER')&&sourceAwakening(sim,a,input)){}
  else if(gate('BWALK_CANCEL_AFTER')&&input.held.has(a.facing>0?'LEFT':'RIGHT'))request('RSI_WAIT','target2016-raven132-backwalk');
  else if(gate('WALK_CANCEL_AFTER')&&(input.held.has('LEFT')||input.held.has('RIGHT')))request('RSI_WAIT','target2016-raven132-walk');
  else if(gate('DASH_CANCEL_AFTER')&&!a.buffControls?.dashBlock&&(input.pureDoubleLeft||input.pureDoubleRight||input.pressed.has('DASH')))
   request('RSI_DASH','target2016-raven132-dash');
  else if(gate('ATTACK_CANCEL_AFTER')&&input.held.has('Z'))request('RSI_COMBO_Z','target2016-raven132-z');
  else if(gate('ATTACK_CANCEL_AFTER')&&input.held.has('X'))request('RSI_COMBO_X','target2016-raven132-x');
  const duration=def.clip?.durationSeconds;
  if(a.animationStopped||Number.isFinite(duration)&&time>f(duration-Math.max(duration/10,.03)))request('RSI_WAIT','target2016-raven132-end-overwrite');
  // The selected raw132 has no USE_COMMON flag. Its typed624 still gives the
  // ordinary base skill mode3 a final opportunity to replace the pending slot.
  sourcePostSkillDispatch(sim,a,input,3);return true;
 });
}

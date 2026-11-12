/** Shared RF/LK/VC/RS/BM/IS down input adapter.
 * Original standup pose/hit windows are reused. X always uses the non-down
 * branch requested by the user; target-client probabilities are not claimed.
 */
import {REACTION_REFERENCE} from './reaction-policy.mjs';
import {ELSWORD_NO_DOWN_STANDUP_STATES} from './elsword-standup-source-v2.mjs';
import rollingSource from '../../contracts/standup-rolling-source-v30.json' with {type:'json'};
export const STANDUP_ATTACK_RULE='shared-twelve-profession-four-way-standup-v30';
export const STANDUP_ATTACK_STATES=new Set(['RSI_STANDUP_ATTACK_FRONT','RSI_STANDUP_ATTACK_BACK',
  'ESSI_STANDUP_ATTACK_FRONT','ESSI_STANDUP_ATTACK_BACK','RSI_STANDUP_ATTACK_FRONT_NO_DOWN','RSI_STANDUP_ATTACK_BACK_NO_DOWN',
  'ESSI_STANDUP_ATTACK_FRONT_NO_DOWN','ESSI_STANDUP_ATTACK_BACK_NO_DOWN']);
STANDUP_ATTACK_STATES.add('ESI_QUICK_STANDUP_ATTACK_FRONT_ADVANCED');
STANDUP_ATTACK_STATES.add('ESI_QUICK_STANDUP_ATTACK_BACK_ADVANCED');
export const STANDUP_INPUT_STATES=new Set(['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_DOWN_LANDING']);
export const isStandupRolling=actor=>/^(?:RSI|ESSI|ESI|ANSI)_STANDUP_ROLLING_(?:FRONT|BACK)_(?:FRONT|BACK)$/.test(actor.state);
export const validStandupAttackChoice=value=>value===null||value==='X'||value==='Z';
export const validStandupAttackNoDown=value=>typeof value==='boolean';
export const ELESIS_NO_DOWN_STANDUP_SOURCE_STATES=Object.freeze({
  RSI_STANDUP_ATTACK_FRONT_NO_DOWN:'ESI_QUICK_STANDUP_ATTACK_FRONT',
  RSI_STANDUP_ATTACK_BACK_NO_DOWN:'ESI_QUICK_STANDUP_ATTACK_BACK',
});

/** Extend the executor's private profile copy with independently sourced
 * common roles. Frozen profession JSON and already shipped clips stay intact. */
export function installStandupStates(profile){
  for(const [kind,classes]of Object.entries(rollingSource.classes))if(classes.includes(profile.target?.unitClass))
    for(const [name,state]of Object.entries(rollingSource.states[kind]))profile.states[name]??=structuredClone(state);
  if([122,123,126].includes(profile.target?.unitClass))for(const side of ['FRONT','BACK']){
    const state=profile.states['ANSI_STANDUP_ATTACK_'+side];
    if(state)profile.states['RSI_STANDUP_ATTACK_'+side+'_NO_DOWN']??={...structuredClone(state),
      validation:'target2016 ordinary Add rise reused for X; distinct fast-rise source unavailable'};
  }
  if([120,121,125].includes(profile.target?.unitClass))for(const [role,source]of Object.entries(ELESIS_NO_DOWN_STANDUP_SOURCE_STATES)){
    const state=profile.states[source];
    if(state)profile.states[role]??=structuredClone(state);
  }
  if([100,101,112].includes(profile.target?.unitClass))for(const [name,state]of Object.entries(ELSWORD_NO_DOWN_STANDUP_STATES)){
    profile.states[name]??=structuredClone(state);
    profile.states[name.replace(/^ESSI_/,'RSI_')]??=structuredClone(state);
  }
  return profile;
}

export function queueStandupAttack(actor,key){
  if(!STANDUP_INPUT_STATES.has(actor.state)||!['X','Z'].includes(key)||
    !(actor.animationTime>REACTION_REFERENCE.downInputAfterAnimationSeconds))return false;
  actor.downAttackChoice=key;
  const state=actor.state.endsWith('_BACK')?'RSI_STANDUP_ATTACK_BACK':'RSI_STANDUP_ATTACK_FRONT';
  actor.downSuccessor=key==='X'?state+'_NO_DOWN':state;
  return true;
}

/** All four target unit scripts declare both roll directions and both down poses. */
export function queueStandupRolling(actor,direction,profile){
  if(!STANDUP_INPUT_STATES.has(actor.state)||![1,-1].includes(direction)||
    !(actor.animationTime>REACTION_REFERENCE.downInputAfterAnimationSeconds))return false;
  const side=actor.state.endsWith('_BACK')?'BACK':'FRONT',relative=direction===actor.facing?'FRONT':'BACK';
  const state=Object.keys(profile.states).find(name=>name.endsWith('_STANDUP_ROLLING_'+side+'_'+relative));
  if(!state)return false;
  actor.downAttackChoice=null;actor.downSuccessor=state;return true;
}

/** Future foot support precedes animation completion. Falling cancels the rise protection immediately. */
export function standupRollingEvent(sim,actor,input){
  if(!isStandupRolling(actor))return false;
  const p=sim.profileFor(actor),duration=p.states[actor.state].clip.durationSeconds;
  if(!actor.grounded){
    const backPose=actor.state.includes('_ROLLING_BACK_');
    sim.enter(actor,'RSI_JUMP_DOWN','standup-roll-lost-support');
    actor.y-=p.referenceSemantics.lineRadius*(backPose?1.5:1);return true;
  }
  if(actor.animationStopped||Math.fround(actor.animationTime)>Math.fround(duration-Math.max(duration/10,.03))){
    sim.enter(actor,input.held.has('LEFT')||input.held.has('RIGHT')?'RSI_DASH':'RSI_WAIT','standup-roll-completed');
  }
  return true;
}

/** Called once after a new state is installed, before first attack events. */
export function standupStateStart(actor){
  actor.standupAttackNoDown=STANDUP_ATTACK_STATES.has(actor.state)&&actor.downAttackChoice==='X';
  actor.downAttackChoice=null;
}

/** The target non-down back pose turns over at completion; its raw declaration
 * supplies the direction change. Limit the new consumer to the sourced pose. */
export function standupStateEnd(actor,raw={}){
  if(isStandupRolling(actor)){
    if(actor.grounded){actor.forceInvincible=Math.max(actor.forceInvincible,.3);if(actor.showInvincible)actor.showInvincible.remaining=Math.max(actor.showInvincible.remaining,.3);}
    else{actor.forceInvincible=0;if(actor.showInvincible)actor.showInvincible.remaining=0;}
  }
  if(STANDUP_ATTACK_STATES.has(actor.state)&&actor.state.endsWith('_BACK_NO_DOWN')&&raw.FLIP_DIR_END===1)actor.facing*=-1;
}

/** Character-origin scope prevents a late projectile inheriting the rise rule.
 * The original full knockdown gauge requires a separate threshold exclusion in
 * the accepted-hit pipeline; FORCE_DOWN=0 alone cannot provide that guarantee.
 */
export function standupHitPolicy(actor,data,origin={}){
  const sourceRiseEffect=origin.kind==='effect'&&origin.name==='DamageEffect_AN_StandUp_Attack'
    &&origin.ownerStateSerial===actor.stateSerial&&['LP','MM','DE'].includes(actor.professionId);
  const noDown=actor.standupAttackNoDown===true&&STANDUP_ATTACK_STATES.has(actor.state)
    &&(origin.kind==='character'||sourceRiseEffect);
  return noDown?{noDown:true,data:{...data,REACT_TYPE:2,FORCE_DOWN:0,DECREASE_FORCE_DOWN:0}}
    :{noDown:false,data};
}

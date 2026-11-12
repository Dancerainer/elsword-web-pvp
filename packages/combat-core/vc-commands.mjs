/** Shared Raven WASM for unchanged commands; VC-only branching stays explicit.
 * RF class107 branches must never run against class115 by name coincidence.
 */
import {canVeteranOverheat,veteranState} from './vc-skills.mjs';
const f=Math.fround;
const custom=new Set(['RSI_COMBO_ZZZ','RSI_COMBO_ZZX','RSI_COMBO_X','RSI_COMBO_XX','RSI_COMBO_XXX',
  'RSI_DASH_COMBO_Z','RSI_DASH_COMBO_ZZ','RSI_DASH_JUMP_COMBO_X','RWT_COMBO_X','RWT_COMBO_ZZZX',
  'RSI_WEAPON_TAKER_COMBO_XX','RSI_WEAPON_TAKER_COMBO_XXX','RSI_WEAPON_TAKER_COMBO_XXX_LOOP','RSI_WEAPON_TAKER_COMBO_XXX_FINISH',
  'RSI_WEAPON_TAKER_COMBO_ZZZXX','RSI_WEAPON_TAKER_COMBO_ZZZdownX','RSI_WEAPON_TAKER_COMBO_ZZZdownXX',
  'RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX','RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX',
  'RVC_DASH_COMBO_ZZ','RVC_DASH_COMBO_ZZZ','RVC_DASH_COMBO_ZZZPushZ_READY','RVC_DASH_COMBO_ZZZPushZ','RVC_DASH_COMBO_ZZZZ_FINISH',
  'RVC_DASH_JUMP_COMBO_X','RVC_DASH_JUMP_COMBO_XX_START','RVC_DASH_JUMP_COMBO_XX_LOOP','RVC_DASH_JUMP_COMBO_XX_FINISH']);
const air=n=>n.includes('DASH_JUMP');
function baseResult(a){return {handled:false,vx:a.vx,vy:a.vy,y:a.y,passiveSpeed:{...a.passiveSpeed},flags:a.sourceCommandFlags??0,
  canNotJumpTime:a.canNotJumpTime??0,animationBeforeTime:a.animationTime,animationOneshotTimer:Math.max(a.animationOneshotTimer??0,a.animationTime),
  boundaryCalls:{future:0,event:0,start:0,down:0},state:null};}
const ended=(a,p)=>{const d=p.states[a.state].clip.durationSeconds;return a.animationStopped||f(a.animationTime)>f(d-Math.max(d/10,.03));};
const airCancelStates=new Set(['RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX','RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX',
  'RVC_DASH_JUMP_COMBO_X','RVC_DASH_JUMP_COMBO_XX_START','RVC_DASH_JUMP_COMBO_XX_LOOP','RVC_DASH_JUMP_COMBO_XX_FINISH']);
/** Raven18000/18049 and19519..19843 own their EventProcess branch order.
 * A Lua-only gate silently lost the hard-coded ZX/ZXX windows. A same-packet
 * X edge and an end/landing branch precede SKILL_CANCEL_AFTER_FLY, so they
 * cannot be preempted by the shared skill dispatcher. No input is retained.
 * The target X table has SKILL_CANCEL_AFTER=.433 instead of the older
 * callback's FLY field: retain that explicit target-declaration binding.
 */
export function vcReferenceCommandSkillCancelAllowed(a,def,input=null){
  const n=def?.sourceState??a.state;if(!airCancelStates.has(n))return null;
  const t=f(a.animationTime),duration=def.clip.durationSeconds;
  const done=a.animationStopped||t>f(duration-Math.max(duration/10,.03));
  if(n==='RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX')return t>f(.420)&&t<=f(.635);
  if(n==='RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX')return !done&&t>f(.240);
  if(n==='RVC_DASH_JUMP_COMBO_XX_START'||done)return false;
  if(n!=='RVC_DASH_JUMP_COMBO_XX_FINISH'&&input?.pressed.has('X'))return false;
  const limit=def.raw.SKILL_CANCEL_AFTER_FLY??(n==='RVC_DASH_JUMP_COMBO_X'?def.raw.SKILL_CANCEL_AFTER:undefined);
  return Number.isFinite(limit)&&limit>=0&&t>f(limit);
}
function airCancelThreshold(n,def){
  if(n==='RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX')return .420;
  if(n==='RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX')return .240;
  if(n==='RVC_DASH_JUMP_COMBO_XX_START')return Infinity;
  return def.raw.SKILL_CANCEL_AFTER_FLY??(n==='RVC_DASH_JUMP_COMBO_X'?def.raw.SKILL_CANCEL_AFTER:Infinity);
}
/** User-confirmed target behavior: these commands can resume airborne 66ZXX,
 * 66X~X and skills. Fixed-V5 only declares earlier skill windows and then
 * waits for landing; it does not prove this target2016 follow-up consumer.
 * Reuse those existing thresholds, keep the window open through a stopped
 * end pose, and never create a jump impulse or refresh height on cancellation.
 */
export function vcCommandSkillCancelAllowed(a,def,input=null){
  const n=def?.sourceState??a.state;if(!airCancelStates.has(n))return null;
  if(a.grounded)return vcReferenceCommandSkillCancelAllowed(a,def,input);
  const threshold=airCancelThreshold(n,def);
  if(!Number.isFinite(threshold)||threshold<0||f(a.animationTime)<=f(threshold))return false;
  const duration=def.clip.durationSeconds,done=a.animationStopped||f(a.animationTime)>f(duration-Math.max(duration/10,.03));
  // Keep the current X chain's fresh edge ahead of a simultaneous skill.
  if(!done&&['RVC_DASH_JUMP_COMBO_X','RVC_DASH_JUMP_COMBO_XX_LOOP'].includes(n)&&input?.pressed.has('X'))return false;
  return true;
}
export function vcCommandAirDashCancelDirection(a,def,input){
  if(a.grounded||!vcCommandSkillCancelAllowed(a,def))return 0;
  if(input.pureDoubleRight)return 1;
  if(input.pureDoubleLeft)return -1;
  if(input.pressed.has('DASH'))return input.held.has('RIGHT')?1:input.held.has('LEFT')?-1:0;
  return 0;
}
/** User-required earlyZX follow-up, independent of the older callback's
 * skill-only window. Keep its height behavior explicit: another airborne
 * 66Z→ZX does not accumulate the fresh command's positiveY lifts. This does
 * not alter the complete firstZX/ZXX, a genuine ground jump or the X chain.
 */
export function vcRememberAirFollowup(a,def){
  if((def?.sourceState??a.state)!=='RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX')return;
  veteranState(a).airFollowupNoLift=true;
  a.vy=Math.min(a.vy,0);
}
const noLiftFollowupStates=new Set(['RSI_DASH_JUMP','RSI_DASH_JUMP_COMBO_Z','RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX']);
export function vcCommandAirFollowupFuture(a,def){
  const s=a.sourceVeteranCommander;
  if(!s?.airFollowupNoLift)return;
  if(a.grounded||!noLiftFollowupStates.has(def?.sourceState??a.state)){
    delete s.airFollowupNoLift;return;
  }
  // Called after source SPEED_TIME consumption, before physics. Keep every
  // genuine negative velocity and the normal gravity integration unchanged.
  a.vy=Math.min(a.vy,0);
  if(a.passiveSpeed.y!==-1)a.passiveSpeed.y=Math.min(a.passiveSpeed.y,0);
}
export function createVeteranCommands(sim,native){
  const shared=a=>!custom.has(a.state);
  const from=(a,p)=>p.states[a.state].sourceState??a.state;
  function event(a,input,p){
    if(shared(a)){
      const r=native?.runEvent(a,input,p)??baseResult(a);
      if(r.state==='RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX')r.state='RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX';
      return r;
    }
    const r=baseResult(a),n=from(a,p),t=f(a.animationTime),s=veteranState(a),done=ended(a,p),raw=p.states[a.state].raw;
    r.handled=true;r.boundaryCalls.event=1;
    const go=state=>{r.state=state;return r;},held=input.held,pressed=input.pressed;
    const direction=held.has('RIGHT')?1:held.has('LEFT')?-1:0;
    const chain=(key,lower,upper,after,next,bit=1)=>{
      if((r.flags&bit)&&t>f(after)){r.flags&=~bit;r.state=next;return true;}
      if(pressed.has(key)&&t>=f(lower)&&t<=f(upper)){r.flags|=bit;return true;}return false;
    };
    if(!air(n)&&!a.grounded){r.y-=p.referenceSemantics.lineRadius*1.5;return go('RSI_JUMP_DOWN');}
    if(n==='RSI_COMBO_ZZZ'){
      r.reAttackZ1Time=f(.2);r.reAttackZ1Right=a.facing>0;
      if(direction&&direction!==a.facing)r.flags=0;
      if(input.pureDoubleLeft||input.pureDoubleRight||pressed.has('DASH'))return go('DASH_REQUEST');
      if((r.flags&1)&&t>f(.59))return go('RSI_COMBO_ZZZZ');
      if((r.flags&2)&&t>f(.3))return go(direction===a.facing||t>f(.59)?'RWT_COMBO_ZZZX':'RSI_WEAPON_TAKER_COMBO_ZZZdownX');
      if(t<f(.59)){if(pressed.has('Z'))r.flags=1;else if(pressed.has('X'))r.flags=2;}
    }else if(n==='RWT_COMBO_X')chain('X',.1,.702,.702,'RSI_COMBO_XX');
    else if(n==='RSI_WEAPON_TAKER_COMBO_XX')chain('X',0,.737,.737,'RSI_COMBO_XXX');
    else if(n==='RSI_WEAPON_TAKER_COMBO_XXX'){
      if(t>=f(.660))return go('RSI_WEAPON_TAKER_COMBO_XXX_LOOP');
      if(pressed.has('X')&&canVeteranOverheat(a))s.maxLoop=Math.min(11,s.maxLoop+1);
    }else if(n==='RSI_WEAPON_TAKER_COMBO_XXX_LOOP'){
      if(pressed.has('X')&&canVeteranOverheat(a))s.maxLoop=Math.min(11,s.maxLoop+1);
      if(done)return go(s.loop>=s.maxLoop?'RSI_WEAPON_TAKER_COMBO_XXX_FINISH':n);
    }else if(n==='RWT_COMBO_ZZZX')chain('X',.533,100,.567,'RSI_WEAPON_TAKER_COMBO_ZZZXX');
    else if(n==='RSI_WEAPON_TAKER_COMBO_ZZZdownX')chain('X',.533,100,.739,'RSI_WEAPON_TAKER_COMBO_ZZZdownXX');
    else if(n==='RSI_COMBO_ZZX'){
      if(direction&&direction!==a.facing)r.flags=0;
      if(input.pureDoubleLeft||input.pureDoubleRight||pressed.has('DASH'))return go('DASH_REQUEST');
      chain('X',0,.6,.6,'RSI_COMBO_ZZXX');
    }
    else if(n==='RSI_DASH_COMBO_Z')chain('Z',0,.397,.397,'RSI_DASH_COMBO_ZZ');
    else if(n==='RVC_DASH_COMBO_ZZ')chain('Z',0,100,.43,'RVC_DASH_COMBO_ZZZ');
    else if(n==='RVC_DASH_COMBO_ZZZ'&&t>=f(.501)&&held.has('Z'))return go('RVC_DASH_COMBO_ZZZPushZ_READY');
    else if(n==='RVC_DASH_COMBO_ZZZPushZ_READY'&&done)return go('RVC_DASH_COMBO_ZZZPushZ');
    else if(n==='RVC_DASH_COMBO_ZZZPushZ'){
      if(!canVeteranOverheat(a)||!s.overheated||s.loop>20||t>.3&&!held.has('Z')||done)return go('RVC_DASH_COMBO_ZZZZ_FINISH');
    }else if(n==='RVC_DASH_JUMP_COMBO_X'){
      if(done){if(r.flags&1)return go('RVC_DASH_JUMP_COMBO_XX_START');if(a.grounded)return go('RSI_JUMP_LANDING');}
      else if(pressed.has('X'))r.flags|=1;
    }else if(n==='RVC_DASH_JUMP_COMBO_XX_START'||n==='RVC_DASH_JUMP_COMBO_XX_LOOP'){
      if(done){
        const heat=!!(r.flags&1)&&canVeteranOverheat(a);
        if(heat&&n==='RVC_DASH_JUMP_COMBO_XX_LOOP')r.flags&=~1;
        return go(heat&&(n==='RVC_DASH_JUMP_COMBO_XX_START'||s.loop<9)?'RVC_DASH_JUMP_COMBO_XX_LOOP':'RVC_DASH_JUMP_COMBO_XX_FINISH');
      }
      if(pressed.has('X'))r.flags|=1;
    }else if(n==='RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX'){
      if(t>f(.635)){if(a.grounded)return go('RSI_JUMP_LANDING');if(r.flags&1)return go('RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX');a.skillDisableGravity=false;}
      else if(t<=f(.420)&&pressed.has('X'))r.flags|=1;
      // This callback is governed by .635, not IsAnimationEnd. Its early
      // branch must not fall through to a generic landing/end adapter.
      return r;
    }
    if(r.state)return r;
    // Raven17298-17312: this callback has no named target cancel fields;
    // its reviewed .466 literal opens dash and ASDC input, clearing the X flag.
    if(n==='RSI_WEAPON_TAKER_COMBO_XX'&&t>f(.466)&&(input.pureDoubleLeft||input.pureDoubleRight||pressed.has('DASH'))){r.flags&=~1;return go('DASH_REQUEST');}
    if(n==='RSI_COMBO_ZZZ'&&t>f(.6)&&['UP','DOWN','LEFT','RIGHT','A','S','D','C','Q','W','E','R'].some(k=>held.has(k)))return go('RSI_WAIT');
    if(t>f(raw.DASH_CANCEL_AFTER??Infinity)&&(pressed.has('DASH')||input.pureDoubleLeft||input.pureDoubleRight))return go('DASH_REQUEST');
    if(direction&&t>f(direction===a.facing?raw.WALK_CANCEL_AFTER??Infinity:raw.BWALK_CANCEL_AFTER??Infinity))return go('RSI_WAIT');
    if(!air(n)&&t>f(raw.SKILL_CANCEL_AFTER??Infinity)&&pressed.has('AWAKEN'))return go('AWAKEN_REQUEST');
    if(done&&(!air(n)||a.grounded))return go(a.grounded?(air(n)?'RSI_JUMP_LANDING':'RSI_WAIT'):'RSI_JUMP_DOWN');
    return r;
  }
  return {ruleVersion:'vc-target2016-user-confirmed-air-followup-v8',
    handlesEvent:a=>custom.has(a.state)||!!native?.handlesEvent(a),
    handlesFuture:a=>custom.has(a.state)||!!native?.handlesFuture(a),
    ownsAnimationEnd:a=>custom.has(a.state),isAirState:a=>custom.has(a.state)&&air(a.state),
    runEvent:event,
    runStart:(a,p)=>shared(a)?native?.runStart(a,p)??baseResult(a):baseResult(a),
    runEnd:(a,p)=>shared(a)?native?.runEnd(a,p)??baseResult(a):baseResult(a),
    runNow:(a,p)=>shared(a)?native?.runNow(a,p)??baseResult(a):baseResult(a),
    runFuture(a,input,p,dt){
      if(shared(a))return native?.runFuture(a,input,p,dt)??baseResult(a);
      const r=baseResult(a),n=from(a,p),t=a.animationTime;
      if(n==='RVC_DASH_JUMP_COMBO_XX_FINISH'&&f(a.animationOneshotTimer??0)<f(.03)&&f(a.animationBeforeTime??0)<f(.03)&&f(t)>=f(.03)){
        r.handled=true;r.vx=-800*a.facing;r.vy=1200;
      }
      // Original Future tests IsAnimationEnd before the lift window. XAP_ONE
      // can stop inside .21..7; repeating the lift after end traps the unit.
      if(n==='RVC_DASH_JUMP_COMBO_X'&&!ended(a,p)&&f(t)>f(.21)&&f(t)<f(.7)){r.handled=true;r.vy=f(t)>=f(.26)&&f(t)<f(.29)?700:Math.max(0,r.vy);}
      if(n==='RVC_DASH_JUMP_COMBO_XX_START'){r.handled=true;r.vy=Math.max(0,r.vy);}
      if(['RVC_DASH_JUMP_COMBO_X','RVC_DASH_JUMP_COMBO_XX_FINISH'].includes(n)&&ended(a,p)){
        // These VC callbacks call PhysicParam::GetWalkSpeed (raw fWalkSpeed),
        // unlike Raven's ordinary jump callbacks, which call the unit getter
        // with equipment/passive modifiers (GameUnit.h1105 versus2612).
        r.handled=true;if(input.held.has(a.facing>0?'RIGHT':'LEFT'))r.vx=p.physics.WALK_SPEED*a.facing;
        if(input.held.has('DOWN')){r.vy=f(f(r.vy)-f(f(p.physics.G_ACCEL)*f(dt)));if(n==='RVC_DASH_JUMP_COMBO_XX_FINISH')r.flags|=1;}
      }
      return r;
    },
  };
}

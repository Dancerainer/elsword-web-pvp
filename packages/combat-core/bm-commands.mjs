/** BM uses Raven's shared movement/reaction bridge and LK's original macro
 * buffer evaluator. Class branches belong to BM and never execute RF branches.
 * Target2016 numeric declarations take precedence over fixed-V5 callbacks. */
import {lkBufferedWindow} from './lk-commands.mjs';
const f=Math.fround;
const custom=new Set(['RSI_COMBO_ZZZ','RSI_COMBO_ZZX','RSI_COMBO_X','RSI_COMBO_XX',
  'RSI_DASH_COMBO_Z','RSI_DASH_COMBO_ZZ','RSI_DASH_JUMP_COMBO_Z','RSI_DASH_JUMP_COMBO_ZZ','RSI_DASH_JUMP_COMBO_X',
  'RBM_COMBO_XZ','RBM_COMBO_XZZ','RBM_COMBO_XZZZ','RSI_RBM_COMBO_ZZZupZ',
  'RSI_SOUL_TAKER_COMBO_XXZ','RSI_SOUL_TAKER_COMBO_XXZZ8','RSI_SOUL_TAKER_COMBO_XXZZ8Z',
  'RSI_SOUL_TAKER_DASH_COMBO_ZZ','RSI_SOUL_TAKER_DASH_COMBO_ZZZ',
  'RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZ','RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ',
  'RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ_Landing','RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZZ',
  'RBM_COMBO_ZZZX','RBM_COMBO_ZZZXZ','RBM_COMBO_ZZZX_EXPLOSION',
  'RBM_DASH_JUMP_COMBO_X','RBM_DASH_JUMP_COMBO_XZ','RBM_DASH_JUMP_COMBO_XZ_Landing']);
const source=(a,p)=>p.states[a.state].sourceState??a.state;
const air=n=>n.includes('DASH_JUMP')&&!n.endsWith('_Landing')&&n!=='RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZZ';
const ended=(a,p)=>{const d=p.states[a.state].clip.durationSeconds,n=source(a,p);
  const complete=['RSI_RBM_COMBO_ZZZupZ','RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ_Landing'].includes(n);
  return a.animationStopped||f(a.animationTime)>f(complete?d:d-Math.max(d/10,.03));};
export const bladeMasterState=a=>(a.sourceBladeMaster??={loops:0,commandPresses:0,blackHoleCount:0,blackHoleRemaining:0,winHits:0,winCooldown:0,escapeCooldown:0,extremeElapsed:0,extremeLifted:false,extremeHidden:false,missRefunded:false});
const base=a=>({handled:false,vx:a.vx,vy:a.vy,y:a.y,passiveSpeed:{...a.passiveSpeed},flags:a.sourceCommandFlags??0,
  canNotJumpTime:a.canNotJumpTime??0,canNotAttackTime:a.canNotAttackTime??0,
  reAttackZ1Time:a.reAttackZ1Time??0,reAttackZ1Right:a.reAttackZ1Right,
  animationBeforeTime:a.animationTime,animationOneshotTimer:Math.max(a.animationOneshotTimer??0,a.animationTime),
  boundaryCalls:{future:0,event:0,start:0,down:0},state:null});
/** User-observed target recovery, absent from the older Raven callbacks.
 * Anchor the requested free cancels to the target's attack/dive/recovery
 * boundaries; never turn an airborne cancel into another jump impulse. */
function feedbackCancelAfter(n,raw){
  if(n==='RSI_RBM_COMBO_ZZZupZ')return raw.ATTACK_TIME0['2'];
  if(n==='RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ')return raw.SPEED_TIME0['3'];
  if(n==='RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ_Landing')return raw.DASH_CANCEL_AFTER;
  if(n==='RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZZ')return raw.SPEED_TIME2['3'];
  if(n==='RBM_COMBO_ZZZX'||n==='RBM_COMBO_ZZZXZ')return raw.WALK_CANCEL_AFTER;
  return Infinity;
}
export function bmCommandSkillCancelAllowed(a,def){
  if(!custom.has(a.state))return null;
  const n=def.sourceState??a.state;
  if(f(a.animationTime)>f(feedbackCancelAfter(n,def.raw)))return true;
  if(air(n))return f(a.animationTime)>f(def.raw.SKILL_CANCEL_AFTER_FLY??def.raw.SKILL_CANCEL_AFTER??Infinity);
  return f(a.animationTime)>f(def.raw.SKILL_CANCEL_AFTER??Infinity);
}
export function createBladeMasterCommands(sim,native){
  const shared=a=>!custom.has(a.state);
  function event(a,input,p,{canDown=false}={}){
    if(shared(a))return native?.runEvent(a,input,p)??base(a);
    const r=base(a),n=source(a,p),s=bladeMasterState(a),t=f(a.animationTime),raw=p.states[a.state].raw,done=ended(a,p);
    r.handled=true;r.boundaryCalls.event=1;
    const go=state=>{r.state=state;return r;},pressed=input.pressed,held=input.held;
    const direction=held.has('RIGHT')?1:held.has('LEFT')?-1:0;
    if(!air(n)&&!['RBM_COMBO_XZZZ','RSI_RBM_COMBO_ZZZupZ'].includes(n)&&!a.grounded){
      // Raven16134..16139 / 16177..16183 clear the persistent set's timer
      // when either black-hole command loses its original floor support.
      if(n==='RBM_COMBO_ZZZX'||n==='RBM_COMBO_ZZZXZ'){s.blackHoleCount=0;s.blackHoleRemaining=0;}
      r.y-=p.referenceSemantics.lineRadius*1.5;return go('RSI_JUMP_DOWN');}
    if(['RSI_COMBO_ZZZ','RSI_COMBO_X','RSI_COMBO_XX','RBM_COMBO_XZZ'].includes(n)&&direction===-a.facing)r.flags=0;
    const window=(key,index,next,until,after=until,from=0)=>{
      const w=lkBufferedWindow(r.flags,index,t,pressed.has(key),{'1':from,'2':until,'3':after});r.flags=w.flags;
      if(w.changed){r.flags=0;r.state=next;}return w.consumed;
    };
    if(n==='RSI_COMBO_ZZZ'){
      r.reAttackZ1Right=a.facing===1;r.reAttackZ1Time=f(.2);
      if(input.pureDoubleLeft||input.pureDoubleRight||pressed.has('DASH'))return go('DASH_REQUEST');
      if((r.flags&7)&&t>f(.59))return go(r.flags&4?'RSI_RBM_COMBO_ZZZupZ':r.flags&2?'RBM_COMBO_ZZZX':'RSI_COMBO_ZZZZ');
      if(t<f(.59)){if(pressed.has('Z'))r.flags=held.has('UP')?4:1;else if(pressed.has('X'))r.flags=2;}
    }else if(n==='RSI_COMBO_ZZX'){
      // Shared Raven8311: backward input clears the buffer, pure66 precedes
      // the inclusive .6 X latch, and only RF may choose ZZXFRONTX.
      if(direction===-a.facing)r.flags=0;
      if(input.pureDoubleLeft||input.pureDoubleRight||pressed.has('DASH'))return go('DASH_REQUEST');
      if((r.flags&1)&&t>f(.6)){r.flags=0;return go('RSI_COMBO_ZZXX');}
      if(pressed.has('X')&&t<=f(.6))r.flags|=1;
    }else if(n==='RSI_COMBO_X'){
      if(!window('X',0,'RSI_COMBO_XX',.530001,.53))window('Z',1,'RBM_COMBO_XZ',.48);
    }else if(n==='RSI_COMBO_XX'){
      if((r.flags&3)&&t>f(.55))return go(r.flags&2?'RSI_SOUL_TAKER_COMBO_XXZ':'RSI_COMBO_XXX');
      if(t<=f(.55)){if(pressed.has('X'))r.flags=1;else if(pressed.has('Z'))r.flags=2;}
    }else if(n==='RBM_COMBO_XZ')window('Z',0,'RBM_COMBO_XZZ',.63);
    else if(n==='RBM_COMBO_XZZ'){
      if(input.pureDoubleLeft||input.pureDoubleRight||pressed.has('DASH'))return go('DASH_REQUEST');
      window('Z',0,'RBM_COMBO_XZZZ',.66);
    }else if(n==='RSI_SOUL_TAKER_COMBO_XXZ'){
      if(s.commandPresses>=2&&t>f(.87))return go('RSI_SOUL_TAKER_COMBO_XXZZ8');
      if(pressed.has('Z')&&t<f(.87))s.commandPresses++;
    }else if(n==='RSI_SOUL_TAKER_COMBO_XXZZ8'){
      if(a.animationTime>=p.states[a.state].clip.durationSeconds){s.loops++;if(s.loops>=5)return go('RSI_SOUL_TAKER_COMBO_XXZZ8Z');return go(n);}
    }else if(n==='RSI_DASH_COMBO_Z'){
      const w=raw.EVENT_PROCESS_TIME0;window('Z',0,'RSI_DASH_COMBO_ZZ',w['2'],w['3'],w['1']);
    }
    else if(n==='RSI_SOUL_TAKER_DASH_COMBO_ZZ')window('Z',0,'RSI_SOUL_TAKER_DASH_COMBO_ZZZ',.5);
    else if(n==='RSI_DASH_JUMP_COMBO_Z'){
      if(a.grounded)return go('RSI_DASH_JUMP_LANDING');
      const w=raw.EVENT_PROCESS_TIME0;window('Z',0,'RSI_DASH_JUMP_COMBO_ZZ',w?.['2']??.35,w?.['3']??.3,w?.['1']??0);
    }else if(n==='RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZ'){
      if(a.grounded)return go('RSI_DASH_JUMP_LANDING');
      const w=raw.EVENT_PROCESS_TIME0;window('Z',0,'RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ',w['2'],w['3'],w['1']);
    }else if(n==='RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ'){
      if(a.grounded)return go('RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ_Landing');
      // .3 starts the dive; it is not a held-direction recovery boundary.
      // Keep the dive until collision reaches the floor. Explicit air66,
      // awakening and the separately evaluated skill cancels remain available.
      if(t>f(feedbackCancelAfter(n,raw))){
        if(pressed.has('DASH')||input.pureDoubleLeft||input.pureDoubleRight)return go('DASH_REQUEST');
        if(pressed.has('AWAKEN'))return go('AWAKEN_REQUEST');
        if(pressed.has('X')&&!(a.canNotAttackTime>0))return go('RSI_JUMP_COMBO_X');
      }
      if(pressed.has('Z'))s.commandPresses=1;
      if(done)a.animationStopped=true;
      return r;
    }else if(n==='RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ_Landing'){
      if(s.commandPresses&&t>f(raw.EVENT_PROCESS_TIME0['3'])){
        s.commandPresses=0;return go('RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZZ');
      }
      const w=raw.EVENT_PROCESS_TIME0;window('Z',0,'RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZZ',w['2'],w['3'],w['1']);
      // A down edge sampled before the final pose can advance across the
      // period in this same packet. Consume its queued Z before idle recovery.
      if(done&&(r.flags&1))return go('RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZZ');
    }else if(n==='RBM_DASH_JUMP_COMBO_X'){
      if(a.grounded)return go('RSI_DASH_JUMP_LANDING');
      // The target calls the second state XZ. Both the requested XX input and
      // its existing Z input enter that same original slash, with one buffer.
      const w=raw.EVENT_PROCESS_TIME0,key=pressed.has('X')?'X':'Z';
      window(key,0,'RBM_DASH_JUMP_COMBO_XZ',w['2'],w['3'],w['1']);
    }else if(n==='RBM_DASH_JUMP_COMBO_XZ'){
      // Original native261 never binds the historical *_Landing table.
      // It waits for main animation end AND contact, then requests native18.
      if(done&&a.grounded)return go('RSI_JUMP_LANDING');
      return r;
    }else if(n==='RBM_COMBO_ZZZX'){
      if(s.blackHoleCount>0&&s.blackHoleRemaining<=.9)return go('RBM_COMBO_ZZZX_EXPLOSION');
      window('Z',0,'RBM_COMBO_ZZZXZ',.94);
    }else if(n==='RBM_COMBO_ZZZXZ'){
      // The original count limit is gated by the recovery timer. Testing it
      // alone cut off the fourth slash before its first damage window.
      if(s.blackHoleCount>0&&s.blackHoleRemaining<=.4&&(s.blackHoleCount>=5||!(r.flags&1)))return go('RBM_COMBO_ZZZX_EXPLOSION');
      // The requested target follow-up also accepts a fresh Z during the
      // remaining recovery window, instead of silently dropping it at .69.
      if(pressed.has('Z')&&s.blackHoleCount<5)r.flags|=1;
      if((r.flags&1)&&t>=f(.69))return go(n);
    }
    if(r.state)return r;
    const skip=n==='RSI_COMBO_ZZZ'?.6:n==='RSI_SOUL_TAKER_DASH_COMBO_ZZ'?.9:n==='RSI_SOUL_TAKER_DASH_COMBO_ZZZ'?.84:null;
    if(skip!==null&&t>f(skip)&&['UP','DOWN','LEFT','RIGHT','A','S','D','C','Q','W','E','R'].some(k=>held.has(k)))return go('RSI_WAIT');
    if(t>f(feedbackCancelAfter(n,raw))){
      if(pressed.has('DASH')||input.pureDoubleLeft||input.pureDoubleRight)return go('DASH_REQUEST');
      if(!(a.canNotAttackTime>0)){
        if(pressed.has('Z')&&!(['RBM_COMBO_ZZZX','RBM_COMBO_ZZZXZ','RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ_Landing'].includes(n)&&(r.flags&1)))
          return go(a.grounded?'RSI_COMBO_Z':'RSI_JUMP_COMBO_Z');
        if(pressed.has('X'))return go(a.grounded?'RSI_COMBO_X':'RSI_JUMP_COMBO_X');
      }
      if(pressed.has('AWAKEN'))return go('AWAKEN_REQUEST');
      if(a.grounded&&held.has('UP')&&!(a.canNotJumpTime>0))return go('RSI_JUMP_READY');
      if(a.grounded&&pressed.has('DOWN')&&canDown){r.y-=p.referenceSemantics.lineRadius*1.5;r.vy=0;r.boundaryCalls.down=1;return go('RSI_JUMP_DOWN');}
      const freshOnly=n==='RSI_RBM_COMBO_ZZZupZ',movement=freshOnly?pressed:held;
      if(direction&&(!freshOnly||pressed.has('LEFT')||pressed.has('RIGHT'))||!a.grounded&&(movement.has('UP')||movement.has('DOWN')))
        return go(a.grounded?'RSI_WAIT':a.vy>0?'RSI_JUMP_UP':'RSI_JUMP_DOWN');
    }
    if(t>f(raw.DASH_CANCEL_AFTER??Infinity)&&(pressed.has('DASH')||input.pureDoubleLeft||input.pureDoubleRight))return go('DASH_REQUEST');
    const blackHole=n==='RBM_COMBO_ZZZX'||n==='RBM_COMBO_ZZZXZ';
    if(direction&&t>f(blackHole||direction===a.facing?raw.WALK_CANCEL_AFTER??Infinity:raw.BWALK_CANCEL_AFTER??Infinity))return go('RSI_WAIT');
    if(t>f(raw.SKILL_CANCEL_AFTER??Infinity)&&pressed.has('AWAKEN'))return go('AWAKEN_REQUEST');
    if(done&&!['RBM_COMBO_ZZZX','RBM_COMBO_ZZZXZ','RSI_SOUL_TAKER_COMBO_XXZZ8'].includes(n)){
      if(air(n)&&!a.grounded){a.animationStopped=true;return r;}
      return go(a.grounded?(['RBM_COMBO_XZZZ','RSI_RBM_COMBO_ZZZupZ'].includes(n)||air(n)?'RSI_JUMP_LANDING':'RSI_WAIT'):'RSI_JUMP_DOWN');
    }
    return r;
  }
  return {ruleVersion:'bm-target2016-user-feedback-commands-v3',handlesEvent:a=>custom.has(a.state)||!!native?.handlesEvent(a),
    handlesFuture:a=>custom.has(a.state)||!!native?.handlesFuture(a),ownsAnimationEnd:a=>custom.has(a.state),
    ownsAnimationLoop:a=>a.state==='RSI_SOUL_TAKER_COMBO_XXZZ8',isAirState:a=>custom.has(a.state)&&air(a.state),runEvent:event,
    animationEndAt:(a,def)=>['RSI_RBM_COMBO_ZZZupZ','RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ_Landing'].includes(def.sourceState??a.state)?def.clip.durationSeconds:null,
    runStart(a,p){if(shared(a))return native?.runStart(a,p)??base(a);const s=bladeMasterState(a),n=source(a,p);
      if(n==='RSI_SOUL_TAKER_COMBO_XXZ'){s.commandPresses=0;s.loops=0;}
      if(n==='RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ')s.commandPresses=0;
      if(n==='RBM_COMBO_ZZZX'){s.blackHoleCount=0;s.blackHoleRemaining=0;}
      if(n==='RBM_COMBO_ZZZXZ'){s.blackHoleCount++;s.blackHoleRemaining=1.24;}
      return base(a);},
    runEnd:(a,p)=>shared(a)?native?.runEnd(a,p)??base(a):base(a),
    runNow:(a,p)=>shared(a)?native?.runNow(a,p)??base(a):base(a),
    runFuture(a,input,p,dt){if(shared(a))return native?.runFuture(a,input,p,dt)??base(a);
      const r=base(a),n=source(a,p);
      if(n==='RSI_RBM_COMBO_ZZZupZ'&&f(a.animationTime)>=f(.5)&&f(a.animationBeforeTime??0)<f(.5)){
        r.handled=true;r.vy=1500;
        // This source callback assigns a launch directly rather than through
        // SPEED_TIME. Release the host's floor latch in the same packet, so
        // physics consumes it instead of retaining 1500 on a grounded actor.
        a.grounded=false;a.lineId=null;
      }
      if(n==='RBM_DASH_JUMP_COMBO_X'&&f(a.animationTime)>f(.21)&&f(a.animationTime)<f(.4)){r.handled=true;r.vy=Math.max(0,r.vy);}
      return r;},
  };
}

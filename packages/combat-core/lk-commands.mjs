/** LK command callback adapter.
 * Target2016 supplies every declared window/speed/animation. The pinned
 * SwordMan callbacks and GUUser macros supply the qualified buffer semantics.
 * New 2016 branches are explicit target-declaration bindings; see the source
 * contract. This JavaScript adapter is not labelled original C++ execution.
 */
import {sourceScaledSpeed} from './speed-attributes.mjs';

export const LK_COMMAND_RULE='lk-target2016-command-bindings-v3-dash-x-skip';
const aliases=Object.freeze({
  RSI_COMBO_Z:'ESSI_COMBO_Z1',RSI_COMBO_ZZ:'ESSI_COMBO_Z2',RSI_COMBO_ZZZ:'ESSI_COMBO_Z3',
  RSI_COMBO_ZZZZ:'ESSI_COMBO_Z4',RSI_COMBO_X:'ESSI_COMBO_X1',RSI_COMBO_XX:'ESSI_COMBO_X2',RSI_COMBO_XXX:'ESSI_ELK_XXX',
  RSI_DASH_COMBO_Z:'ESSI_DASH_COMBO_Z1',RSI_DASH_COMBO_ZZ:'ESSI_KNIGHT_DASH_COMBO_Z2',RSI_DASH_COMBO_X:'ESSI_DASH_ATTACK_X',
  RSI_JUMP_COMBO_Z:'ESSI_JUMP_ATTACK_Z',RSI_JUMP_COMBO_X:'ESSI_JUMP_ATTACK_X',
  RSI_DASH_JUMP_COMBO_Z:'ESSI_DASH_JUMP_COMBO_Z1',RSI_DASH_JUMP_COMBO_ZZ:'ESSI_DASH_JUMP_COMBO_Z2',
  RSI_DASH_JUMP_COMBO_X:'ESSI_DASH_JUMP_COMBO_X1',
});
const roleBySource=new Map(Object.entries(aliases).map(([role,source])=>[source,role]));
const source=a=>aliases[a.state]??a.state;
const ground=new Set(['ESSI_DESTRUCTION_RAGE','ESSI_COMBO_Z1','ESSI_COMBO_Z2','ESSI_COMBO_Z3','ESSI_COMBO_Z4','ESSI_COMBO_Z4a',
  'ESSI_COMBO_X1','ESSI_COMBO_X2','ESSI_COMBO_X3a','ESSI_ELK_XXX','ESSI_ELK_XXXX','ESSI_ELK_XXXXX','ESSI_ELK_ZZZfrontZ',
  'ESSI_DASH_COMBO_Z1','ESSI_KNIGHT_DASH_COMBO_Z2','ESSI_KNIGHT_DASH_COMBO_Z3','ESSI_KNIGHT_DASH_COMBO_Z3a',
  'ESSI_DASH_ATTACK_X','ESSI_ESK_DASH_COMBO_ZChargeX','ESSI_ESK_DASH_COMBO_ZX','ESSI_ESK_DASH_COMBO_ZXX',
  'ESSI_ELK_DASH_COMBO_XChargeX','ESSI_ELK_DASH_COMBO_XX','ESSI_ELK_DASH_COMBO_XXX',
  'ESSI_ESK_DASH_JUMP_ZZZ_LANDING','ESSI_DASH_JUMP_COMBO_Z3_LANDING','ESSI_DASH_JUMP_COMBO_X2_LANDING','ESSI_KNIGHT_DASH_JUMP_COMBO_X3']);
const air=new Set(['ESSI_JUMP_ATTACK_Z','ESSI_JUMP_ATTACK_X','ESSI_DASH_JUMP_COMBO_Z1','ESSI_DASH_JUMP_COMBO_Z2',
  'ESSI_DASH_JUMP_COMBO_Z3','ESSI_ESK_DASH_JUMP_ZZZ','ESSI_DASH_JUMP_COMBO_X1','ESSI_DASH_JUMP_COMBO_X2','ESSI_KNIGHT_DASH_JUMP_COMBO_X2']);
const all=new Set([...ground,...air]);
const charge=new Map([['ESSI_ESK_DASH_COMBO_ZChargeX','ESSI_ESK_DASH_COMBO_ZX'],['ESSI_ELK_DASH_COMBO_XChargeX','ESSI_ELK_DASH_COMBO_XX']]);
const chains={
  ESSI_COMBO_Z2:[['Z',0,'ESSI_COMBO_Z3']],
  ESSI_COMBO_Z3:[['Z',2,'ESSI_ELK_ZZZfrontZ','forward'],['Z',0,'ESSI_COMBO_Z4'],['X',1,'ESSI_COMBO_Z4a']],
  ESSI_COMBO_X1:[['X',0,'ESSI_COMBO_X2']],
  ESSI_COMBO_X2:[['Z',1,'ESSI_COMBO_X3a'],['X',2,'ESSI_ELK_XXX']],
  ESSI_ELK_XXX:[['X',0,'ESSI_ELK_XXXX']],
  ESSI_ELK_XXXX:[['X',0,'ESSI_ELK_XXXXX']],
  ESSI_DASH_COMBO_Z1:[['Z',0,'ESSI_KNIGHT_DASH_COMBO_Z2'],['X',2,'ESSI_ESK_DASH_COMBO_ZChargeX','charge']],
  ESSI_KNIGHT_DASH_COMBO_Z2:[['Z',0,'ESSI_KNIGHT_DASH_COMBO_Z3'],['X',1,'ESSI_KNIGHT_DASH_COMBO_Z3a']],
  ESSI_DASH_ATTACK_X:[['X',0,'ESSI_ELK_DASH_COMBO_XChargeX','charge']],
  ESSI_ESK_DASH_COMBO_ZX:[['X',0,'ESSI_ESK_DASH_COMBO_ZXX']],
  ESSI_ELK_DASH_COMBO_XX:[['X',0,'ESSI_ELK_DASH_COMBO_XXX']],
  ESSI_DASH_JUMP_COMBO_Z1:[['Z',0,'ESSI_DASH_JUMP_COMBO_Z2']],
};
const skip={
  ESSI_COMBO_Z4:[.7,true],ESSI_COMBO_Z4a:[.9,false],ESSI_COMBO_X1:[.6,false,.2],
  ESSI_COMBO_X3a:[.6,true],ESSI_ELK_ZZZfrontZ:[.867,false],
  ESSI_DASH_COMBO_Z1:[.9,false,.1],
  ESSI_KNIGHT_DASH_COMBO_Z3:[1,true],ESSI_KNIGHT_DASH_COMBO_Z3a:[.9,false],
  ESSI_KNIGHT_DASH_JUMP_COMBO_X3:[.68,true],ESSI_ELK_XXXX:[1.3,true],
};
const f=Math.fround;
const after=(time,limit)=>Number.isFinite(limit)&&limit>=0&&f(time)>f(limit);
const active=a=>all.has(source(a));
const forward=(a,held)=>held.has(a.facing===1?'RIGHT':'LEFT');
const backwards=(a,held)=>held.has(a.facing===1?'LEFT':'RIGHT');
const doubles=keys=>keys.pureDoubleRight||keys.pureDoubleLeft||keys.pressed.has('DASH');
const end=(a,def)=>a.animationStopped||f(a.animationTime)>f(def.clip.durationSeconds-Math.max(def.clip.durationSeconds/10,.03));
const resolve=(name,profile)=>{const role=roleBySource.get(name);const state=role&&profile.states[role]?role:name;if(!profile.states[state])throw new Error('Missing target LK command '+name);return state;};
function result(a){return {handled:active(a),vx:a.vx,vy:a.vy,passiveSpeed:{...a.passiveSpeed},flags:a.sourceCommandFlags??0,
  y:a.y,canNotJumpTime:a.canNotJumpTime??0,canNotAttackTime:a.canNotAttackTime??0,
  reAttackZ1Time:a.reAttackZ1Time??0,reAttackZ1Right:a.reAttackZ1Right,
  animationBeforeTime:a.animationTime,animationOneshotTimer:Math.max(a.animationOneshotTimer??0,a.animationTime),
  boundaryCalls:{future:0,event:0,start:0,down:0},state:null};}
function request(r,name,profile){r.state=name==='DASH_REQUEST'||name==='AWAKEN_REQUEST'?name:resolve(name,profile);return r;}
function window(raw,i){const w=raw['EVENT_PROCESS_TIME'+i];if(!w||![w['1'],w['2'],w['3']].every(Number.isFinite))throw new Error('Missing target LK EVENT_PROCESS_TIME'+i);return w;}
/** Literal GUUser.h 238–243 macro order: old flag changes before a fresh
 * press is latched. The upper input boundary and change threshold are strict. */
export function lkBufferedWindow(flags,index,time,pressed,w){
  const bit=1<<index,t=f(time);
  if((flags&bit)&&t>f(w['3']))return {flags:flags&~bit,changed:true,consumed:true};
  if(pressed&&t>=f(w['1'])&&t<f(w['2']))return {flags:flags|bit,changed:false,consumed:true};
  return {flags,changed:false,consumed:false};
}
function namedCancel(a,keys,profile,r,raw){
  // These are the actual 2016 fields, consumed with the existing source
  // macros. A walk cancel requests WAIT; it does not turn this attack's pose.
  if(after(a.animationTime,raw.DASH_CANCEL_AFTER)&&doubles(keys))return request(r,'DASH_REQUEST',profile);
  if(after(a.animationTime,raw.BWALK_CANCEL_AFTER)&&backwards(a,keys.held))return request(r,'RSI_WAIT',profile);
  if(after(a.animationTime,raw.WALK_CANCEL_AFTER)&&(keys.held.has('LEFT')||keys.held.has('RIGHT')))return request(r,'RSI_WAIT',profile);
  const attackTime=raw.ATTACK_CANCEL_AFTER??raw.WALK_CANCEL_AFTER;
  if(after(a.animationTime,attackTime)){
    if(keys.held.has('Z'))return request(r,'ESSI_COMBO_Z1',profile);
    if(keys.held.has('X'))return request(r,'ESSI_COMBO_X1',profile);
  }
  if(after(a.animationTime,raw.ATTACK_CANCEL_AFTER_EX)){
    if(keys.pressed.has('Z'))return request(r,'ESSI_COMBO_Z1',profile);
    if(keys.pressed.has('X'))return request(r,'ESSI_COMBO_X1',profile);
  }
  if(after(a.animationTime,raw.SKILL_CANCEL_AFTER)&&keys.pressed.has('AWAKEN')&&a.awakening.orbs>0&&a.awakening.remaining<=0)return request(r,'AWAKEN_REQUEST',profile);
  return null;
}
function runEvent(a,keys,profile,{canDown=false}={}){
  const r=result(a);if(!r.handled)return r;
  const name=source(a),def=profile.states[a.state],raw=def.raw,t=f(a.animationTime),ended=end(a,def),held=keys.held,pressed=keys.pressed;
  r.boundaryCalls.event=1;
  if(ground.has(name)&&!a.grounded){r.y-=profile.referenceSemantics.lineRadius*1.5;return request(r,'RSI_JUMP_DOWN',profile);}
  if(['ESSI_COMBO_Z1','ESSI_COMBO_Z2','ESSI_COMBO_Z3','ESSI_COMBO_X1','ESSI_ELK_XXX'].includes(name)&&backwards(a,held))r.flags=0;
  if(a.grounded&&['ESSI_DASH_JUMP_COMBO_Z1','ESSI_DASH_JUMP_COMBO_Z2','ESSI_DASH_JUMP_COMBO_X1'].includes(name))return request(r,'RSI_DASH_JUMP_LANDING',profile);
  if(name==='ESSI_COMBO_Z3'){
    r.reAttackZ1Right=a.facing===1;r.reAttackZ1Time=f(.2);
    if(after(t,raw.DASH_CANCEL_AFTER)&&doubles(keys))return request(r,'DASH_REQUEST',profile);
  }
  if(charge.has(name)){
    // New 2016 target charge state: maximum duration is the declaration's
    // explicit first event value. Release/timeout uses its own attack row.
    // No damage multiplier is invented for an unverified charge formula.
    const limit=window(raw,0)['1'];
    if(!held.has('X')||f(a.stateTime)>=f(limit))return request(r,charge.get(name),profile);
    return r;
  }
  if(name==='ESSI_COMBO_Z1'){
    // Z1 has no target event table; unchanged SwordMan7704–7717 is explicit.
    if((r.flags&1)&&t>f(.27)){r.flags&=~1;return request(r,'ESSI_COMBO_Z2',profile);}
    if(pressed.has('Z')&&t<=f(.27))r.flags|=1;
    else if(pressed.has('Z')&&t<=f(.4))return request(r,'ESSI_COMBO_Z2',profile);
  }
  const routes=chains[name];
  if(routes)for(const [key,index,next,condition]of routes){
    const consume=lkBufferedWindow(r.flags,index,t,pressed.has(key)&&(condition!=='forward'||forward(a,held)),window(raw,index));
    r.flags=consume.flags;
    if(consume.changed){
      const target=condition==='charge'&&!held.has('X')?charge.get(next):next;
      return request(r,target,profile);
    }
    if(consume.consumed)break;
  }
  if(name==='ESSI_KNIGHT_DASH_COMBO_Z2'&&
    (backwards(a,held)||['UP','DOWN','A','S','D','C','Q','W','E','R'].some(k=>held.has(k))))r.flags=0;
  if(name==='ESSI_JUMP_ATTACK_Z'||name==='ESSI_JUMP_ATTACK_X'){
    if(a.grounded){if(r.flags&1)r.canNotJumpTime=f(.2);return request(r,'RSI_JUMP_LANDING',profile);}
    return r;
  }
  if(name==='ESSI_DASH_JUMP_COMBO_Z1'){
    if(a.grounded)return request(r,'RSI_DASH_JUMP_LANDING',profile);
    return r;
  }
  if(name==='ESSI_DASH_JUMP_COMBO_Z2'){
    if(pressed.has('Z'))r.flags|=1;
    if(a.grounded)return request(r,'RSI_DASH_JUMP_LANDING',profile);
    if(ended&&(r.flags&1))return request(r,'ESSI_ESK_DASH_JUMP_ZZZ',profile);
    return r;
  }
  if(name==='ESSI_ESK_DASH_JUMP_ZZZ'){
    if(a.grounded)return request(r,'ESSI_ESK_DASH_JUMP_ZZZ_LANDING',profile);
    return r;
  }
  if(name==='ESSI_DASH_JUMP_COMBO_Z3'){
    if(a.grounded)return request(r,Object.keys(a.hits??{}).length?'ESSI_DASH_JUMP_COMBO_Z3_LANDING':'RSI_DASH_JUMP_LANDING',profile);
    return r;
  }
  if(name==='ESSI_DASH_JUMP_COMBO_X1'){
    if(pressed.has('X'))r.flags|=1;
    if(a.grounded)return request(r,'RSI_DASH_JUMP_LANDING',profile);
    if(ended&&(r.flags&1))return request(r,'ESSI_KNIGHT_DASH_JUMP_COMBO_X2',profile);
    return r;
  }
  if(name==='ESSI_KNIGHT_DASH_JUMP_COMBO_X2'||name==='ESSI_DASH_JUMP_COMBO_X2'){
    if(name==='ESSI_KNIGHT_DASH_JUMP_COMBO_X2'){
      if(pressed.has('X'))r.flags=1;if(pressed.has('Z'))r.flags=2;
    }
    if(a.grounded)return request(r,r.flags&2?'ESSI_COMBO_Z1':r.flags&1?'ESSI_KNIGHT_DASH_JUMP_COMBO_X3':'ESSI_DASH_JUMP_COMBO_X2_LANDING',profile);
    return r;
  }
  // DashAttackX's callback has a held-key skip path in addition to named
  // cancels. Target2016 supplies the separate EVENT_PROCESS_TIME1 threshold;
  // never substitute fixed-V5's hardcoded .6. X follow-up above keeps priority.
  if(name==='ESSI_DASH_ATTACK_X'&&elswordDashXSkipAllowed(a,keys,raw))
    return request(r,'RSI_WAIT',profile);
  const cancelled=namedCancel(a,keys,profile,r,raw);if(cancelled)return cancelled;
  const s=skip[name];
  if(s&&after(t,s[0])&&[...(s[1]?['Z','X']:[]),'UP','DOWN','LEFT','RIGHT','A','S','D','C','Q','W','E','R'].some(k=>held.has(k))){
    if(s[2])r.canNotAttackTime=f(s[2]);return request(r,'RSI_WAIT',profile);
  }
  if(ended){if(name==='ESSI_COMBO_Z1'||name==='ESSI_COMBO_Z2')r.canNotAttackTime=f(.1);return request(r,'RSI_WAIT',profile);}
  return r;
}
/** The common Elsword 66X skip is also used after RS's own Z continuation. */
export function elswordDashXSkipAllowed(a,keys,raw){
  return after(a.animationTime,window(raw,1)['3'])&&
    ['Z','X','UP','DOWN','LEFT','RIGHT','A','S','D','C','Q','W','E','R'].some(k=>keys.held.has(k));
}
function runFuture(a,keys,profile,elapsed){
  const r=result(a);if(!r.handled)return r;
  const name=source(a),t=a.animationTime,before=a.animationBeforeTime??0,timer=time=>(a.animationOneshotTimer??0)<time&&before<time&&t>=time;
  r.boundaryCalls.future=1;
  const walk=sourceScaledSpeed(profile.physics.WALK_SPEED,a.stats.moveSpeedMultiplier);
  const dash=sourceScaledSpeed(profile.physics.RUN_SPEED,a.stats.moveSpeedMultiplier);
  if(name==='ESSI_COMBO_Z1'){r.vx=0;r.vy=0;}
  if(name==='ESSI_COMBO_Z4'&&timer(.17))r.vx=f(walk*1.3)*a.facing;
  if(name==='ESSI_COMBO_X1'){r.vy=0;if(timer(.2))r.vx=dash*a.facing;}
  if(name==='ESSI_COMBO_X2'&&timer(.31))r.vx=f(walk*1.5)*a.facing;
  if(name==='ESSI_JUMP_ATTACK_Z'||name==='ESSI_JUMP_ATTACK_X'){
    if(forward(a,keys.held))r.vx=walk*a.facing;
    if(keys.held.has('DOWN')&&(name==='ESSI_JUMP_ATTACK_X'||!keys.held.has('UP'))){r.vy=f(r.vy-f(profile.physics.G_ACCEL*elapsed));r.flags|=1;}
  }
  if(['ESSI_DASH_JUMP_COMBO_X2','ESSI_KNIGHT_DASH_JUMP_COMBO_X2'].includes(name)&&timer(.23))r.vy=profile.physics.MAX_G_SPEED;
  return r;
}
function runStart(a,profile,keys){
  const r=result(a);if(!r.handled)return r;
  const name=source(a);r.boundaryCalls.start=1;
  if(['ESSI_DASH_JUMP_COMBO_Z3_LANDING','ESSI_DASH_JUMP_COMBO_X2_LANDING'].includes(name))r.vx=f(r.vx/2);
  if(['ESSI_KNIGHT_DASH_COMBO_Z2','ESSI_KNIGHT_DASH_COMBO_Z3a','ESSI_DASH_ATTACK_X'].includes(name)&&forward(a,keys?.held??new Set()))
    r.vx=sourceScaledSpeed(profile.physics.RUN_SPEED,a.stats.moveSpeedMultiplier)*a.facing;
  return r;
}
export const lordKnightCommands=Object.freeze({ruleVersion:LK_COMMAND_RULE,evidenceClass:'target2016-declarations+fixedV5-consumer-adapter',
  handlesEvent:active,handlesFuture:active,ownsAnimationEnd:active,
  isAirState:a=>air.has(source(a)),runEvent,runFuture,runStart,
  runNow:a=>({...result(a),handled:false}),runEnd:a=>({...result(a),handled:false})});
export function lkCommandSkillCancelAllowed(actor,definition){
  if(!active(actor))return null;
  if(ground.has(source(actor))&&!actor.grounded||air.has(source(actor))&&actor.grounded)return false;
  return after(actor.animationTime,definition.raw.SKILL_CANCEL_AFTER);
}

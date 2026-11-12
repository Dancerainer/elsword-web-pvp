/** RS command adapter. Common Elsword callbacks are reused from LK; rune
 * branches consume target2016 tables and the pinned SwordMan lifecycle.
 * Target-only charge/new rune-sword routes are explicit declaration adapters. */
import {lordKnightCommands,lkBufferedWindow,lkCommandSkillCancelAllowed,elswordDashXSkipAllowed} from './lk-commands.mjs';
const f=Math.fround;
const aliases={RSI_COMBO_Z:'ESSI_COMBO_Z1',RSI_COMBO_ZZ:'ESSI_COMBO_Z2',RSI_COMBO_ZZZ:'ESSI_ERS_COMBO_ZZZ',
  RSI_COMBO_ZZZZ:'ESSI_ERS_COMBO_ZZZZ',RSI_COMBO_X:'ESSI_COMBO_X1',RSI_COMBO_XX:'ESSI_COMBO_X2',RSI_COMBO_XXX:'ESSI_COMBO_X3',
  RSI_DASH_COMBO_Z:'ESSI_DASH_COMBO_Z1',RSI_DASH_COMBO_ZZ:'ESSI_KNIGHT_DASH_COMBO_Z2',RSI_DASH_COMBO_X:'ESSI_DASH_ATTACK_X',
  RSI_JUMP_COMBO_Z:'ESSI_JUMP_ATTACK_Z',RSI_JUMP_COMBO_X:'ESSI_JUMP_ATTACK_X',RSI_DASH_JUMP_COMBO_Z:'ESSI_DASH_JUMP_COMBO_Z1',
  RSI_DASH_JUMP_COMBO_ZZ:'ESSI_DASH_JUMP_COMBO_Z2',RSI_DASH_JUMP_COMBO_X:'ESSI_DASH_JUMP_COMBO_X1'};
const actual=(a,p)=>p?.states[a.state]?.sourceState??aliases[a.state]??a.state;
const alias=(name,p)=>Object.entries(p.stateAliases??{}).find(([,v])=>v===name)?.[0]??name;
const air=new Set(['ESSI_EMK_DASH_JUMP_ZX','ESSI_EMK_DASH_JUMP_ZXX','ESSI_ERS_DASH_JUMP_XZ','ESSI_ERS_DASH_JUMP_XZZ',
  'ESSI_MAGIC_KNIGHT_DASH_JUMP_COMBO_X2a','ESSI_DASH_JUMP_COMBO_Z1','ESSI_DASH_JUMP_COMBO_Z2','ESSI_DASH_JUMP_COMBO_Z3',
  'ESSI_DASH_JUMP_COMBO_X1','ESSI_DASH_JUMP_COMBO_X2','ESSI_JUMP_ATTACK_Z','ESSI_JUMP_ATTACK_X']);
const own=new Set(['ESSI_ERS_COMBO_ZZZ','ESSI_ERS_COMBO_ZZZZ','ESSI_COMBO_X1','ESSI_COMBO_X2','ESSI_COMBO_X3',
  'ESSI_DASH_COMBO_Z1','ESSI_KNIGHT_DASH_COMBO_Z2','ESSI_DASH_ATTACK_X','ESSI_MAGIC_KNIGHT_DASH_COMBO_Z3',
  'ESSI_MAGIC_KNIGHT_DASH_COMBO_Z3a','ESSI_ERS_XZ','ESSI_ERS_XZ_CHARGE','ESSI_ERS_XZZ','ESSI_ERS_FULL_CHARGE_XZZ',
  'ESSI_ERS_DASH_COMBO_XZ',...air]);
const routes={
  ESSI_ERS_COMBO_ZZZ:[['Z',0,'ESSI_ERS_COMBO_ZZZZ'],['X',1,'ESSI_ERS_COMBO_ZZZZ']],
  ESSI_COMBO_X1:[['X',0,'ESSI_COMBO_X2'],['Z',1,'ESSI_ERS_XZ']],
  ESSI_COMBO_X2:[['X',0,'ESSI_COMBO_X3'],['Z',1,'ESSI_COMBO_X3a']],
  ESSI_DASH_COMBO_Z1:[['Z',0,'ESSI_KNIGHT_DASH_COMBO_Z2']],
  ESSI_KNIGHT_DASH_COMBO_Z2:[['Z',0,'ESSI_MAGIC_KNIGHT_DASH_COMBO_Z3'],['X',1,'ESSI_MAGIC_KNIGHT_DASH_COMBO_Z3a']],
  ESSI_DASH_ATTACK_X:[['Z',1,'ESSI_ERS_XZ_CHARGE']],
  ESSI_ERS_XZ:[['Z',0,'ESSI_ERS_XZ_CHARGE']],
  // Target2016 declares the dash XZ event0 at .5. The target charge/release
  // states share the XZZ rune; pinned V5 only contains the older standing XZ.
  ESSI_ERS_DASH_COMBO_XZ:[['Z',0,'ESSI_ERS_XZ_CHARGE']],
  ESSI_DASH_JUMP_COMBO_Z1:[['Z',0,'ESSI_DASH_JUMP_COMBO_Z2'],['X',1,'ESSI_EMK_DASH_JUMP_ZX',0]],
  ESSI_EMK_DASH_JUMP_ZX:[['X',0,'ESSI_EMK_DASH_JUMP_ZXX']],
};
const after=(a,t)=>Number.isFinite(t)&&t>=0&&f(a.animationTime)>f(t);
const ended=(a,d)=>a.animationStopped||f(a.animationTime)>f(d.clip.durationSeconds-Math.max(d.clip.durationSeconds/10,.03));
const view=(a,p)=>({...a,state:actual(a,p)});
const basic=a=>({handled:true,vx:a.vx,vy:a.vy,y:a.y,passiveSpeed:{...a.passiveSpeed},flags:a.sourceCommandFlags??0,
  canNotJumpTime:a.canNotJumpTime??0,canNotAttackTime:a.canNotAttackTime??0,reAttackZ1Time:a.reAttackZ1Time??0,
  reAttackZ1Right:a.reAttackZ1Right,animationBeforeTime:a.animationTime,
  animationOneshotTimer:Math.max(a.animationOneshotTimer??0,a.animationTime),boundaryCalls:{future:0,event:0,start:0,down:0},state:null});
const recognized=(a,p)=>own.has(actual(a,p))||lordKnightCommands.handlesEvent(view(a,p));
function request(r,name,p){r.state=['DASH_REQUEST','AWAKEN_REQUEST'].includes(name)?name:alias(name,p);
  if(!r.state.endsWith('_REQUEST')&&!p.states[r.state])throw new Error('Missing RS command '+name);return r;}
function runEvent(a,keys,p,options){
  const name=actual(a,p);
  if(name==='ESSI_JUMP_ATTACK_Z'||name==='ESSI_JUMP_ATTACK_X')return lordKnightCommands.runEvent(view(a,p),keys,p,options);
  if(!own.has(name))return lordKnightCommands.runEvent(view(a,p),keys,p,options);
  const r=basic(a),d=p.states[a.state],raw=d.raw;r.boundaryCalls.event=1;
  if(name==='ESSI_ERS_XZ_CHARGE'&&!a.grounded)return request(r,'RSI_JUMP_DOWN',p);
  if(!air.has(name)&&!a.grounded){r.y-=p.referenceSemantics.lineRadius*1.5;return request(r,'RSI_JUMP_DOWN',p);}
  if(air.has(name)&&a.grounded)return request(r,name.includes('DASH')?'RSI_DASH_JUMP_LANDING':'RSI_JUMP_LANDING',p);
  if(name==='ESSI_ERS_XZ_CHARGE'){
    const w=raw.EVENT_PROCESS_TIME0,t=f(a.animationTime);
    if(t>=f(w['3'])){
      if(!keys.held.has('Z')||t>=f(w['1']))return request(r,t<f(w['2'])?'ESSI_ERS_XZZ':'ESSI_ERS_FULL_CHARGE_XZZ',p);
    }
    return r;
  }
  // The target2016 dash XZ includes the charge state and .5 gate. Carry the Z
  // held through the preceding X -> XZ edge into that gate, so a single hold
  // can charge; requiring another edge made the route look like XZZZ.
  // The matching V6 callback is unacquired, so this remains an explicit target
  // declaration/input adapter, separate from the older standing V5 callback.
  if(name==='ESSI_ERS_DASH_COMBO_XZ'&&keys.held.has('Z')&&after(a,raw.EVENT_PROCESS_TIME0['2']))
    return request(r,'ESSI_ERS_XZ_CHARGE',p);
  for(const [key,index,next,sourceIndex=index]of routes[name]??[]){
    const w=raw['EVENT_PROCESS_TIME'+sourceIndex];
    if(!w)throw new Error('Missing RS event window '+name+'/'+index);
    const out=lkBufferedWindow(r.flags,index,a.animationTime,keys.pressed.has(key),w);r.flags=out.flags;
    if(out.changed)return request(r,next,p);
    if(out.consumed)return r;
  }
  if(name==='ESSI_DASH_JUMP_COMBO_X1'){
    if(keys.pressed.has('Z'))r.flags|=2;if(keys.pressed.has('X'))r.flags|=1;
    if(ended(a,d)&&r.flags)return request(r,r.flags&2?'ESSI_ERS_DASH_JUMP_XZ':'ESSI_MAGIC_KNIGHT_DASH_JUMP_COMBO_X2a',p);
  }
  if(name==='ESSI_DASH_JUMP_COMBO_Z2'){
    if(keys.pressed.has('Z'))r.flags|=1;
    if(ended(a,d)&&r.flags&1)return request(r,'ESSI_DASH_JUMP_COMBO_Z3',p);
  }
  if(name==='ESSI_ERS_DASH_JUMP_XZ'){
    if(keys.pressed.has('Z'))r.flags|=1;
    if(ended(a,d))return request(r,r.flags&1?'ESSI_ERS_DASH_JUMP_XZZ':'RSI_JUMP_DOWN',p);
    return r;
  }
  if(name==='ESSI_ERS_DASH_JUMP_XZZ'&&after(a,raw.ATTACK_CANCEL_AFTER)){
    if(keys.pressed.has('Z'))return request(r,'ESSI_JUMP_ATTACK_Z',p);
    if(keys.pressed.has('X'))return request(r,'ESSI_JUMP_ATTACK_X',p);
  }
  if(name==='ESSI_ERS_COMBO_ZZZZ'&&after(a,raw.ATTACK_CANCEL_AFTER)){
    if(keys.held.has('Z'))return request(r,'ESSI_COMBO_Z1',p);
    if(keys.held.has('X'))return request(r,'ESSI_COMBO_X1',p);
  }
  if(name==='ESSI_MAGIC_KNIGHT_DASH_JUMP_COMBO_X2a'&&after(a,.59))return request(r,'RSI_JUMP_DOWN',p);
  if(name==='ESSI_DASH_ATTACK_X'&&elswordDashXSkipAllowed(a,keys,raw))return request(r,'RSI_WAIT',p);
  const skip=name==='ESSI_ERS_XZ'?[.8,true]:name==='ESSI_MAGIC_KNIGHT_DASH_COMBO_Z3'?[.9,false]:name==='ESSI_MAGIC_KNIGHT_DASH_COMBO_Z3a'?[1.2,true]:null;
  if(skip&&after(a,skip[0])&&[...(skip[1]?['Z','X']:[]),'UP','DOWN','LEFT','RIGHT','A','S','D','C','Q','W','E','R'].some(k=>keys.held.has(k)))return request(r,'RSI_WAIT',p);
  if(after(a,raw.DASH_CANCEL_AFTER)&&(keys.pureDoubleLeft||keys.pureDoubleRight||keys.pressed.has('DASH')))return request(r,'DASH_REQUEST',p);
  if(after(a,raw.BWALK_CANCEL_AFTER)&&keys.held.has(a.facing===1?'LEFT':'RIGHT'))return request(r,'RSI_WAIT',p);
  if(after(a,raw.WALK_CANCEL_AFTER)&&(keys.held.has('LEFT')||keys.held.has('RIGHT')))return request(r,'RSI_WAIT',p);
  if(after(a,raw.SKILL_CANCEL_AFTER)&&keys.pressed.has('AWAKEN')&&a.awakening.orbs>0&&!a.awakening.remaining)return request(r,'AWAKEN_REQUEST',p);
  if(ended(a,d)&&!['ESSI_JUMP_ATTACK_Z','ESSI_JUMP_ATTACK_X','ESSI_DASH_JUMP_COMBO_Z3','ESSI_ERS_DASH_JUMP_XZZ'].includes(name))
    return request(r,air.has(name)?'RSI_JUMP_DOWN':'RSI_WAIT',p);
  return r;
}
function runPhase(method,a,p,...args){
  const v=view(a,p),r=lordKnightCommands[method](v,p,...args);
  return r.handled?r:{...basic(a),handled:recognized(a,p)};
}
export const runeSlayerCommands=Object.freeze({ruleVersion:'rs-target2016-command-bindings-v2',
  evidenceClass:'target2016-declarations+fixedV5-consumer-adapter',
  handlesEvent:recognized,handlesFuture:recognized,ownsAnimationEnd:recognized,
  isAirState:a=>air.has(a.state)||/^RSI_(?:DASH_)?JUMP_COMBO/.test(a.state),runEvent,
  runFuture(a,keys,p,elapsed){const r=lordKnightCommands.runFuture(view(a,p),keys,p,elapsed);return r.handled?r:{...basic(a),handled:own.has(actual(a,p)),boundaryCalls:{future:1,event:0,start:0,down:0}};},
  runStart:(a,p,keys)=>runPhase('runStart',a,p,keys),runNow:a=>({...basic(a),handled:false}),runEnd:a=>({...basic(a),handled:false})});
export function rsCommandSkillCancelAllowed(a,d){
  const name=d?.sourceState??a.state;
  if(own.has(name))return !(air.has(name)?a.grounded:!a.grounded)&&after(a,d.raw.SKILL_CANCEL_AFTER);
  return lkCommandSkillCancelAllowed({...a,state:name},d);
}

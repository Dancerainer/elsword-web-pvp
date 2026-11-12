/** IS extensions of the shared Elsword command consumer. All windows use
 * target2016 fields plus explicit user cancellation policy; routing follows
 * the pinned SwordMan reference callbacks. */
import {lordKnightCommands,lkBufferedWindow,lkCommandSkillCancelAllowed,elswordDashXSkipAllowed} from './lk-commands.mjs';
import {IS_COMMAND_CANCEL,isCommandCancelAfter} from './is-feedback.mjs';
const f=Math.fround;
const custom=new Set(['ESSI_ETK_COMBO_ZZZ','ESSI_ETK_COMBO_ZZZZ','ESSI_ETK_COMBO_ZZZZZ',
  'ESSI_ETK_COMBO_XX','ESSI_ETK_COMBO_XXX_LOOP','ESSI_ETK_COMBO_XXX_END','ESSI_ETK_COMBO_XXXZ',
  'ESSI_ETK_DASH_COMBO_ZZ','ESSI_EIS_DASH_COMBO_XX','ESSI_EIS_DASH_COMBO_XXX',
  'ESSI_EIS_DASHJUMP_COMBO_XX','ESSI_EIS_DASHJUMP_COMBO_XXX','ESSI_ETK_DASH_JUMP_ZZZ']);
const aliases={RSI_COMBO_ZZ:'ESSI_COMBO_Z2',RSI_COMBO_ZZZ:'ESSI_ETK_COMBO_ZZZ',RSI_COMBO_ZZZZ:'ESSI_ETK_COMBO_ZZZZ',RSI_COMBO_XX:'ESSI_ETK_COMBO_XX',
  RSI_COMBO_XXX:'ESSI_ETK_COMBO_XXX_END',RSI_DASH_COMBO_ZZ:'ESSI_ETK_DASH_COMBO_ZZ'};
const source=a=>aliases[a.state]??a.state;
const overrides=new Set(['RSI_DASH_COMBO_Z','RSI_DASH_COMBO_X','RSI_DASH_JUMP_COMBO_ZZ','RSI_DASH_JUMP_COMBO_X',
  'ESSI_DASH_COMBO_Z1','ESSI_DASH_ATTACK_X','ESSI_DASH_JUMP_COMBO_Z2','ESSI_DASH_JUMP_COMBO_X1']);
const air=new Set(['RSI_DASH_JUMP_COMBO_ZZ','ESSI_DASH_JUMP_COMBO_Z2','ESSI_ETK_DASH_JUMP_ZZZ','ESSI_EIS_DASHJUMP_COMBO_XX']);
const special=a=>custom.has(source(a))||overrides.has(a.state);
const handled=a=>special(a)||lordKnightCommands.handlesEvent(a);
const after=(a,n)=>Number.isFinite(n)&&n>=0&&f(a.animationTime)>f(n);
// SwordMan15857–15888 supplies a literal window for ZZZ; its .2 raw dash
// field belongs to the sheath frame callback, not either cancel gate.
const skillCancelAfter=(a,raw)=>source(a)==='ESSI_ETK_COMBO_ZZZ'?.01:isCommandCancelAfter(source(a),raw,'skill');
function result(a){return {...lordKnightCommands.runNow(a),handled:true};}
function request(r,state){r.state=state;return r;}
const chains={ESSI_ETK_COMBO_ZZZ:[['Z',0,'RSI_COMBO_ZZZZ']],ESSI_ETK_COMBO_ZZZZ:[['Z',0,'ESSI_ETK_COMBO_ZZZZZ']],
  ESSI_ETK_COMBO_XX:[['XX',0,'ESSI_ETK_COMBO_XXX_LOOP'],['X',1,'RSI_COMBO_XXX']],
  ESSI_ETK_COMBO_XXX_LOOP:[['X',0,'ESSI_ETK_COMBO_XXX_LOOP'],['Z',1,'ESSI_ETK_COMBO_XXXZ']],
  ESSI_EIS_DASH_COMBO_XX:[['X',0,'ESSI_EIS_DASH_COMBO_XXX']]};
export function isCommandSkillCancelAllowed(a,def){
  if(IS_COMMAND_CANCEL[source(a)]&&!air.has(source(a)))return a.grounded&&after(a,skillCancelAfter(a,def.raw));
  if(!special(a))return lkCommandSkillCancelAllowed(a,def);
  if(['RSI_DASH_JUMP_COMBO_ZZ','ESSI_DASH_JUMP_COMBO_Z2','ESSI_ETK_DASH_JUMP_ZZZ'].includes(source(a)))return false;
  if(air.has(source(a))===a.grounded)return false;
  return after(a,skillCancelAfter(a,def.raw));
}
function runEvent(a,keys,profile,options){
  if(!special(a)){
    const raw=profile.states[a.state].raw;
    if(IS_COMMAND_CANCEL[source(a)]&&a.grounded){
      const r=result(a),p=keys.pressed,h=keys.held;
      if(after(a,isCommandCancelAfter(source(a),raw,'dash'))&&(keys.pureDoubleRight||keys.pureDoubleLeft||p.has('DASH')))return request(r,'DASH_REQUEST');
      if(after(a,isCommandCancelAfter(source(a),raw,'skill'))&&p.has('AWAKEN')&&a.awakening.orbs>0&&a.awakening.remaining<=0)return request(r,'AWAKEN_REQUEST');
      if(after(a,isCommandCancelAfter(source(a),raw,'walk'))&&(p.has('LEFT')||p.has('RIGHT'))&&(h.has('LEFT')||h.has('RIGHT')))return request(r,'RSI_WAIT');
    }
    return lordKnightCommands.runEvent(a,keys,profile,options);
  }
  const r=result(a),name=source(a),d=profile.states[a.state],raw=d.raw;
  // SwordMan checks IsAnimationEnd, not the shared recovery grace period.
  // A 10% early exit can skip the .433 loop route when attack speed crosses
  // that window and the grace threshold in the same simulation packet.
  const ended=a.animationStopped||f(a.animationTime)>f(d.clip.durationSeconds);
  const go=state=>request(r,state),p=keys.pressed,h=keys.held;
  r.boundaryCalls.event=1;
  if(['ESSI_ETK_COMBO_ZZZ','ESSI_ETK_COMBO_ZZZZ'].includes(name)&&h.has(a.facing===1?'LEFT':'RIGHT'))r.flags=0;
  if(name==='ESSI_EIS_DASHJUMP_COMBO_XX'){
    if(p.has('X'))r.flags|=1;else if(p.has('Z'))r.flags|=2;
    else if(a.grounded)return go(r.flags&1?'ESSI_EIS_DASHJUMP_COMBO_XXX':r.flags&2?'RSI_COMBO_Z':'ESSI_DASH_JUMP_COMBO_X2_LANDING');
    return r;
  }
  if(name==='ESSI_ETK_DASH_JUMP_ZZZ')return a.grounded?go('RSI_DASH_JUMP_LANDING'):r;
  if(['RSI_DASH_JUMP_COMBO_ZZ','ESSI_DASH_JUMP_COMBO_Z2','RSI_DASH_JUMP_COMBO_X','ESSI_DASH_JUMP_COMBO_X1'].includes(name)){
    const z=/Z2|ZZ/.test(name),key=z?'Z':'X';if(p.has(key))r.flags|=1;
    if(a.grounded)return go('RSI_DASH_JUMP_LANDING');
    if(ended&&(r.flags&1))return go(z?a.mp>=10?'ESSI_ETK_DASH_JUMP_ZZZ':'RSI_JUMP_DOWN':'ESSI_EIS_DASHJUMP_COMBO_XX');
    return r;
  }
  // The landing roll's authored SPEED_TIME lifts the feet briefly. It must
  // retain its attack/armor through that hop rather than exit at .166.
  const rising=['ESSI_EIS_DASH_COMBO_XX','ESSI_EIS_DASH_COMBO_XXX','ESSI_EIS_DASHJUMP_COMBO_XXX'].includes(name);
  if(!a.grounded&&!rising){r.y-=profile.referenceSemantics.lineRadius*1.5;return go('RSI_JUMP_DOWN');}
  if(ended||after(a,IS_COMMAND_CANCEL[name]?.recover))return go(!a.grounded?'RSI_JUMP_DOWN':name==='ESSI_ETK_COMBO_XXX_LOOP'?'RSI_COMBO_XXX':'RSI_WAIT');
  if(name==='ESSI_ETK_COMBO_ZZZ'){
    if(keys.pureDoubleRight||keys.pureDoubleLeft||p.has('DASH'))return go('DASH_REQUEST');
    if(after(a,.01)&&p.has('AWAKEN')&&a.awakening.orbs>0&&a.awakening.remaining<=0)return go('AWAKEN_REQUEST');
  }
  let routes=chains[name]??[];
  if(['RSI_DASH_COMBO_Z','ESSI_DASH_COMBO_Z1'].includes(name))routes=[['Z',0,'RSI_DASH_COMBO_ZZ']];
  if(['RSI_DASH_COMBO_X','ESSI_DASH_ATTACK_X'].includes(name))routes=[['X',0,'ESSI_EIS_DASH_COMBO_XX']];
  for(const [key,index,next]of routes){
    if(name==='ESSI_ETK_COMBO_XXX_LOOP'&&key==='X'&&(a.sourceInfinitySword?.comboLoops??0)>=3)continue;
    const w=raw['EVENT_PROCESS_TIME'+index];if(!w)continue;
    const pressed=key==='XX'?Boolean(keys.oneDoubleX||keys.doubleX||keys.pureDoubleX):p.has(key);
    const c=lkBufferedWindow(r.flags,index,a.animationTime,pressed,w);r.flags=c.flags;
    if(c.changed)return go(next);if(c.consumed)break;
  }
  if(['RSI_DASH_COMBO_X','ESSI_DASH_ATTACK_X'].includes(name)&&elswordDashXSkipAllowed(a,keys,raw))return go('RSI_WAIT');
  // XX and dash ZZ use DASH_CANCEL_AFTER solely to release the sheath
  // handle. Their EventProcess methods have only WALK_CANCEL_AFTER.
  if(!['ESSI_ETK_COMBO_XX','ESSI_ETK_DASH_COMBO_ZZ'].includes(name)&&after(a,isCommandCancelAfter(name,raw,'dash'))&&(keys.pureDoubleRight||keys.pureDoubleLeft||p.has('DASH')))return go('DASH_REQUEST');
  if(after(a,skillCancelAfter(a,raw))&&p.has('AWAKEN')&&a.awakening.orbs>0&&a.awakening.remaining<=0)return go('AWAKEN_REQUEST');
  // The added early movement window consumes a fresh direction edge. A
  // direction held from the prior command must not discard queued next-Z.
  const walkWindow=after(a,raw.WALK_CANCEL_AFTER)||after(a,IS_COMMAND_CANCEL[name]?.walk)&&(p.has('LEFT')||p.has('RIGHT'));
  if(walkWindow&&(h.has('LEFT')||h.has('RIGHT')))return go('RSI_WAIT');
  return r;
}
export const infinitySwordCommands=Object.freeze({ruleVersion:'is-target2016-command-bindings-v2-feedback',
  evidenceClass:'target2016 declarations + pinned V5 SwordMan callbacks; client-unmeasured',
  handlesEvent:handled,handlesFuture:handled,ownsAnimationEnd:handled,
  isAirState:a=>air.has(source(a))||(!special(a)&&lordKnightCommands.isAirState(a)),runEvent,
  runFuture(a,keys,profile,dt){
    if(!custom.has(source(a)))return lordKnightCommands.runFuture(a,keys,profile,dt);
    const r=result(a);r.boundaryCalls.future=1;
    if(source(a)==='ESSI_EIS_DASHJUMP_COMBO_XX'&&(a.animationBeforeTime??0)<.23&&a.animationTime>=.23)r.vy=profile.physics.MAX_G_SPEED;
    return r;
  },
  runStart(a,profile,keys){return custom.has(source(a))?result(a):lordKnightCommands.runStart(a,profile,keys);},
  runNow:a=>({...result(a),handled:false}),runEnd:a=>({...result(a),handled:false})});

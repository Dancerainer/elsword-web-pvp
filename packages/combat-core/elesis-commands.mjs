/** Target2016 Elesis command windows; qualified EL/GUUser callback adapter.
 * CA/renewal routes are explicit target-declaration adaptations: the pinned
 * source's 2026 additions are not original-client execution evidence. */
import {isElesisProfession} from '../professions/identity.mjs';
import {sourceScaledSpeed} from './speed-attributes.mjs';
import {lkBufferedWindow} from './lk-commands.mjs';
import {caDashWaveLifetime} from './profession-source-v53.mjs';
import {bhSourceOwnsFootSupport,BH_DASH_JUMP_XZ_REATTACK} from './bh-cancel-data-v35.mjs';
import {caSourceOwnsFootSupport,CA_BUFFERED_COMMAND_OVERRIDES,CA_SOURCE_END_WAIT_WITHOUT_FOOT_QUERY} from './ca-cancel-data-v35.mjs';
import {caOriginalCommandEvent,caOriginalCommandWaveEvents} from './ca-command-native-v58.mjs';
import {gmSourceOwnsFootSupport,ELESIS_SOURCE_AIR_COMMAND_END_LANDING} from './gm-cancel-data-v35.mjs';
const f=Math.fround;
const aliases={RSI_COMBO_Z:'ESI_COMBO_Z',RSI_COMBO_ZZ:'ESI_COMBO_ZZ',RSI_COMBO_ZZZ:'ESI_COMBO_ZZZ',RSI_COMBO_ZZZZ:'ESI_COMBO_ZZZZ',RSI_COMBO_X:'ESI_COMBO_X',RSI_COMBO_XX:'ESI_COMBO_XX',RSI_COMBO_XXX:'ESI_COMBO_XXX',RSI_DASH_COMBO_Z:'ESI_DASH_COMBO_Z',RSI_DASH_COMBO_ZZ:'ESI_DASH_COMBO_ZZ',RSI_DASH_COMBO_X:'ESI_DASH_COMBO_X',RSI_DASH_JUMP_COMBO_Z:'ESI_DASH_JUMP_COMBO_Z',RSI_DASH_JUMP_COMBO_ZZ:'ESI_DASH_JUMP_COMBO_ZZ',RSI_DASH_JUMP_COMBO_X:'ESI_DASH_JUMP_COMBO_X',RSI_JUMP_COMBO_Z:'ESI_JUMP_ATTACK_Z',RSI_JUMP_COMBO_X:'ESI_JUMP_ATTACK_X'};
const nameOf=a=>a.state===BH_DASH_JUMP_XZ_REATTACK.sourceRuntimeState?BH_DASH_JUMP_XZ_REATTACK.sourceState:a.state==='RSI_DASH_COMBO_X'&&a.professionId==='BH'?'ESI_DASH_COMBO_SBH_X':
 a.state==='RSI_DASH_COMBO_ZZ'?({GM:'ESI_DASH_COMBO_SSK_ZZ',BH:'ESI_DASH_COMBO_SPK_ZZ',CA:'ESI_DASH_COMBO_SCA_ZZ'}[a.professionId]??aliases[a.state]):
 a.professionId==='CA'&&['RSI_COMBO_XX','RSI_COMBO_XXX'].includes(a.state)?a.state.replace('RSI_COMBO_','ESI_COMBO_SDK_'):aliases[a.state]??a.state;
export const isElesisCommand=a=>isElesisProfession(a.professionId)&&(/^(?:ESI_(?:DASH_)?(?:JUMP_)?COMBO_|ESI_JUMP_ATTACK_|ESI_STANDUP_ROLLING_|ESI_QUICK_STANDUP_ATTACK_(?:FRONT|BACK)_ADVANCED)/.test(nameOf(a)));
const aerial=n=>n.includes('DASH_JUMP')&&!/(?:LANDING|_DOWN|SSK_XXX|SDK_XXX)$/.test(n)||n.startsWith('ESI_JUMP_ATTACK');
const after=(t,v)=>Number.isFinite(v)&&v>=0&&f(t)>f(v);
const ended=(a,d)=>a.animationStopped||f(a.animationTime)>f(d.clip.durationSeconds-Math.max(d.clip.durationSeconds/10,.03));
export function resolveElesisState(profile,name){
  if(profile.states[name])return name;
  return Object.keys(profile.states).find(k=>profile.states[k].sourceState===name)??Object.keys(aliases).find(k=>aliases[k]===name&&profile.states[k]);
}
const routes={
 ESI_COMBO_Z:[['Z',0,'ESI_COMBO_ZZ']],ESI_COMBO_ZZ:[['Z',0,'ESI_COMBO_ZZZ']],
 ESI_COMBO_ZZZ:[['Z',0,'ESI_COMBO_ZZZZ'],['X',2,'ESI_COMBO_SDK_ZZZX','CA'],['X',3,'ESI_COMBO_SGM_ZZZX','GM'],['X',4,'ESI_COMBO_SBH_ZZZX','BH'],['X',1,'ESI_COMBO_ZZZX']],
 ESI_COMBO_X:[['X',2,'ESI_COMBO_SDK_XX','CA'],['X',0,'ESI_COMBO_XX'],['Z',1,'ESI_COMBO_SBH_XZ','BH']],
 ESI_COMBO_XX:[['X',2,'ESI_COMBO_SGM_XX_DOWN_X_START','GM:DOWN'],['X',0,'ESI_COMBO_XXX'],['Z',1,'ESI_COMBO_XXZ']],
 ESI_DASH_COMBO_Z:[['Z',1,'ESI_DASH_COMBO_SSK_ZZ','GM'],['Z',2,'ESI_DASH_COMBO_SPK_ZZ','BH'],['Z',4,'ESI_DASH_COMBO_SCA_ZZ','CA'],['X',5,'ESI_DASH_COMBO_SCA_ZX_START','CA'],['X',3,'ESI_DASH_COMBO_SPK_ZX','BH']],
 ESI_DASH_COMBO_X:[['X',0,'ESI_DASH_COMBO_SGM_XX_ATTACK','GM'],['Z',1,'ESI_DASH_COMBO_SCA_XZ_CHARGE','CA']],
 ESI_DASH_COMBO_SSK_ZZ:[['Z',0,'ESI_DASH_COMBO_SSK_ZZZ'],['X',1,'ESI_DASH_COMBO_SSK_ZZX']],ESI_DASH_COMBO_SPK_ZZ:[['Z',0,'ESI_DASH_COMBO_SPK_ZZZ']],
 ESI_DASH_JUMP_COMBO_Z:[['X',1,'ESI_DASH_JUMP_COMBO_SPK_ZX_READY','BH'],['X',2,'ESI_DASH_JUMP_COMBO_SDK_ZX_CHARGE','CA'],['Z',0,'ESI_DASH_JUMP_COMBO_ZZ']],
 ESI_DASH_JUMP_COMBO_ZZ:[['X',1,'ESI_DASH_JUMP_COMBO_SSK_ZZX','GM'],['Z',0,'ESI_DASH_JUMP_COMBO_ZZZ']],
 ESI_DASH_JUMP_COMBO_X:[['X',1,'ESI_DASH_JUMP_COMBO_SSK_XX','GM'],['Z',3,'ESI_DASH_JUMP_COMBO_SGM_XZ','GM'],['Z',2,'ESI_DASH_JUMP_COMBO_SPK_XZ','BH'],['X',4,'ESI_DASH_JUMP_COMBO_SDK_XX','CA'],['X',0,'ESI_DASH_JUMP_COMBO_XX']],
 ESI_COMBO_SBH_XZ:[['Z',0,'ESI_COMBO_SBH_XZZ']],ESI_COMBO_SBH_XZZ:[['Z',0,'ESI_COMBO_SBH_XZZZ']],
 ESI_DASH_COMBO_SBH_X:[['X',0,'ESI_DASH_COMBO_SBH_XX'],['Z',1,'ESI_DASH_COMBO_SBH_XXXZ']],ESI_DASH_COMBO_SBH_XX:[['X',0,'ESI_DASH_COMBO_SBH_XXX'],['Z',1,'ESI_DASH_COMBO_SBH_XXXZ']],ESI_DASH_COMBO_SBH_XXX:[['Z',0,'ESI_DASH_COMBO_SBH_XXXZ']],
 ESI_COMBO_SDK_ZZZX:[['X',0,'ESI_COMBO_SDK_ZZZXX']],
 ESI_DASH_COMBO_SCA_ZZ:[['X',0,'ESI_DASH_COMBO_SCA_ZX_START',null,1],['Z',0,'ESI_DASH_COMBO_SCA_ZZZ_START']],
 ESI_DASH_COMBO_SCA_ZZZ_START:[['Z',0,'ESI_DASH_COMBO_SCA_ZZZ_LOOP_1']],ESI_DASH_COMBO_SCA_ZZZ_LOOP_1:[['Z',0,'ESI_DASH_COMBO_SCA_ZZZ_LOOP_2']],ESI_DASH_COMBO_SCA_ZZZ_LOOP_2:[['Z',0,'ESI_DASH_COMBO_SCA_ZZZ_LOOP_1']],
 ESI_DASH_COMBO_SCA_ZX_START:[['X',0,'ESI_DASH_COMBO_SCA_ZX_LOOP','held']],
};
for(let i=2;i<7;i++)routes['ESI_COMBO_SDK_'+'X'.repeat(i)]=[['X',0,'ESI_COMBO_SDK_'+'X'.repeat(i+1)]];
for(const [name,rows]of Object.entries(CA_BUFFERED_COMMAND_OVERRIDES))routes[name]=rows.map(r=>[r.key,r.window,r.next,'CA',r.flag]);
const commonEndWait=new Set(['ESI_DASH_COMBO_Z','ESI_DASH_COMBO_X','ESI_DASH_COMBO_ZZ']);
const airEndLanding=new Set(ELESIS_SOURCE_AIR_COMMAND_END_LANDING);
const ownsSourceFoot=(a,n)=>commonEndWait.has(n)||gmSourceOwnsFootSupport(a,n)||bhSourceOwnsFootSupport(a,n)||caSourceOwnsFootSupport(a,n)||a.professionId==='CA'&&n==='ESI_DASH_JUMP_COMBO_SDK_XX';
const caEndWait=new Set(CA_SOURCE_END_WAIT_WITHOUT_FOOT_QUERY);
function result(a){return {handled:isElesisCommand(a),vx:a.vx,vy:a.vy,passiveSpeed:{...a.passiveSpeed},flags:a.sourceCommandFlags??0,y:a.y,canNotJumpTime:a.canNotJumpTime??0,canNotAttackTime:a.canNotAttackTime??0,boundaryCalls:{future:0,event:0,start:0,down:0},state:null};}
function request(r,name,p){const resolved=['DASH_REQUEST','AWAKEN_REQUEST'].includes(name)?name:resolveElesisState(p,name);if(!resolved)throw new TypeError('Missing Elesis target state '+name);r.state=resolved;return r;}
/** Same strict named cancel macros as GUUser; walk cancels do not turn pose. */
export function elesisNamedCancel(a,keys,p,r,raw){
 raw=elesisRequestedCancelFields(a,p,raw);
 if(keys.elesisExternalSkillProbe&&after(a.animationTime,raw.SKILL_CANCEL_AFTER)){r.state='EXTERNAL_SKILL_REQUEST';return r;}
 if(after(a.animationTime,raw.SKILL_CANCEL_AFTER)&&keys.pressed.has('AWAKEN')&&a.awakening?.orbs>0&&!a.awakening.remaining)return request(r,'AWAKEN_REQUEST',p);
 if(after(a.animationTime,raw.WALK_CANCEL_AFTER)&&(keys.held.has('LEFT')||keys.held.has('RIGHT')))return request(r,'RSI_WAIT',p);
 if(after(a.animationTime,raw.BWALK_CANCEL_AFTER)&&keys.held.has(a.facing===1?'LEFT':'RIGHT'))return request(r,'RSI_WAIT',p);
 if(after(a.animationTime,raw.DASH_CANCEL_AFTER)&&(keys.pureDoubleLeft||keys.pureDoubleRight||keys.pressed.has('DASH')))return request(r,'DASH_REQUEST',p);
 if(after(a.animationTime,raw.ATTACK_CANCEL_AFTER)){if(keys.held.has('Z'))return request(r,'ESI_COMBO_Z',p);if(keys.held.has('X'))return request(r,'ESI_COMBO_X',p);}
 if(after(a.animationTime,raw.ATTACK_CANCEL_AFTER_EX)){if(keys.pressed.has('Z'))return request(r,'ESI_COMBO_Z',p);if(keys.pressed.has('X'))return request(r,'ESI_COMBO_X',p);}
 return null;
}
function runEvent(a,keys,p,{animationBeforeTime=a.animationBeforeTime}={}){
 const r=result(a);if(!r.handled)return r;r.boundaryCalls.event=1;
 const n=nameOf(a),d=p.states[a.state],raw=d.raw,end=ended(a,d),air=aerial(n),memo=a.sourceElesisCommand??={loops:0,requestedLoops:0};
 const go=n=>request(r,n,p);
 // The newly sealed original callbacks supersede the2026 reconstruction's
 // .5 airborne window and the four-loop-only END adaptation. Their actual
 // buffered/stopped/landing priorities run before the common adapter.
 const caNext=caOriginalCommandEvent(a,n,keys,raw,r);
 if(caNext!==undefined)return caNext===true?r:caNext?go(caNext):elesisNamedCancel(a,keys,p,r,raw)??r;
 if(n.startsWith('ESI_STANDUP_ROLLING_')){
  if(!a.grounded){r.y-=p.referenceSemantics.lineRadius*(n.includes('ROLLING_BACK_')?1.5:1);return go('RSI_JUMP_DOWN');}
  if(end)return go(keys.held.has('LEFT')||keys.held.has('RIGHT')?'DASH_REQUEST':'RSI_WAIT');
  if(a.passivePolicy?.skillLevels?.[28404]){
   const c=lkBufferedWindow(r.flags,0,a.animationTime,keys.pressed.has('X'),raw.EVENT_PROCESS_TIME0);r.flags=c.flags;
   if(c.changed){a.downAttackChoice='X';return go('ESI_QUICK_STANDUP_ATTACK_'+(n.endsWith('_FRONT')?'BACK':'FRONT')+'_ADVANCED');}
  }return r;
 }
 if(n.startsWith('ESI_JUMP_ATTACK')){if(a.grounded){if(r.flags&1)r.canNotJumpTime=f(.2);return go('RSI_JUMP_LANDING');}return r;}
 if(['ESI_DASH_JUMP_COMBO_SSK_XX','ESI_DASH_JUMP_COMBO_SSK_ZZX'].includes(n)){
  if(keys.pressed.has('X'))r.flags|=1;else if(keys.pressed.has('Z'))r.flags|=2;
  if(a.grounded)return go(r.flags&2?'ESI_COMBO_Z':r.flags&1?(a.professionId==='CA'?'ESI_DASH_JUMP_COMBO_SDK_XXX':'ESI_DASH_JUMP_COMBO_SSK_XXX'):'ESI_DASH_JUMP_COMBO_XX_LANDING');return r;
 }
 if(n==='ESI_DASH_JUMP_COMBO_SGM_XZ')return end?go('ESI_DASH_JUMP_COMBO_SGM_XZ_LOOP'):r;
 if(n==='ESI_DASH_JUMP_COMBO_SGM_XZ_LOOP')return a.grounded?go('ESI_DASH_JUMP_COMBO_SGM_XZ_DOWN'):r;
 if(n==='ESI_DASH_JUMP_COMBO_SPK_ZX_READY')return end?go('ESI_DASH_JUMP_COMBO_SPK_ZX_LOOP'):r;
 if(n==='ESI_DASH_JUMP_COMBO_SPK_ZX_LOOP'){
  const w=raw.EVENT_PROCESS_TIME0;
  if((r.flags&1)&&(after(a.animationTime,w?.['3'])||end)){r.flags&=~1;return go(n);}
  if(keys.pressed.has('X')&&memo.loops<5&&f(a.animationTime)>=f(w['1'])&&f(a.animationTime)<f(w['2'])){r.flags|=1;return r;}
  return end&&a.grounded?go('RSI_DASH_JUMP_LANDING'):r;
 }
 if(n==='ESI_DASH_JUMP_COMBO_SDK_ZX_CHARGE')return (!keys.held.has('X')||end)?go('ESI_DASH_JUMP_COMBO_SDK_ZX_FIRE'):r;
 if(n==='ESI_DASH_COMBO_SCA_XZ_CHARGE')return (!keys.held.has('Z')||f(a.stateTime)>f(3.0999999046325684))?go('ESI_DASH_COMBO_SCA_XZ_FIRE'):r;
 if(n==='ESI_DASH_COMBO_SCA_ZX_LOOP'){if(!keys.held.has('X'))return go('ESI_DASH_COMBO_SCA_ZX_ATTACK');return elesisNamedCancel(a,keys,p,r,raw)??r;}
 if(n==='ESI_DASH_COMBO_SCA_ZX_ATTACK'&&end)return go('ESI_DASH_COMBO_SCA_ZX_END');
 if(n==='ESI_DASH_COMBO_SGM_XX_ATTACK'&&end)return go('ESI_DASH_COMBO_SGM_XX_END');
 if(a.professionId==='BH'&&n===BH_DASH_JUMP_XZ_REATTACK.sourceState){
  if(a.grounded)return go('RSI_DASH_JUMP_LANDING');
  if(end)return go('RSI_JUMP_DOWN');
  if(memo.loops<2){const c=lkBufferedWindow(r.flags,0,a.animationTime,keys.pressed.has('Z'),raw.EVENT_PROCESS_TIME0);r.flags=c.flags;
   if(c.changed){memo.loops++;return go(BH_DASH_JUMP_XZ_REATTACK.sourceRuntimeState);}}
 }
 if(n==='ESI_COMBO_SGM_XX_DOWN_X_START'){
  if(keys.pressed.has('X'))memo.requestedLoops=Math.min(4,memo.requestedLoops+1);
  return end?go(memo.requestedLoops?'ESI_COMBO_SGM_XX_DOWN_X_LOOP':'ESI_COMBO_SGM_XX_DOWN_X_END'):r;
 }
 if(n==='ESI_COMBO_SGM_XX_DOWN_X_LOOP')return end?go(++memo.loops<memo.requestedLoops?n:'ESI_COMBO_SGM_XX_DOWN_X_END'):r;
 if(air&&a.grounded&&!ownsSourceFoot(a,n)&&(!airEndLanding.has(n)||end))return go(n==='ESI_DASH_JUMP_COMBO_XX'?'ESI_DASH_JUMP_COMBO_XX_LANDING':'RSI_DASH_JUMP_LANDING');
 if(!air&&!a.grounded&&!ownsSourceFoot(a,n)){r.y-=p.referenceSemantics.lineRadius*(n==='ESI_DASH_JUMP_COMBO_XX_LANDING'?1.5:1);return go('RSI_JUMP_DOWN');}
 if(end&&a.professionId==='GM'&&gmSourceOwnsFootSupport(a,n))return go(n==='ESI_DASH_JUMP_COMBO_SSK_XXX'&&!a.grounded?'RSI_JUMP_DOWN':'RSI_WAIT');
 if(end&&a.professionId==='CA'&&(caSourceOwnsFootSupport(a,n)||n==='ESI_DASH_JUMP_COMBO_SDK_XX')){
  if(!caEndWait.has(n)&&!a.grounded){r.y-=p.referenceSemantics.lineRadius*1.5;return go('RSI_JUMP_DOWN');}
  return go('RSI_WAIT');
 }
 if(/^ESI_DASH_COMBO_SBH_X{1,3}Z?$/.test(n)&&end){
  if(keys.held.has(a.facing===1?'RIGHT':'LEFT'))return go('DASH_REQUEST');
  if(n==='ESI_DASH_COMBO_SBH_XXXZ'&&!a.grounded){r.y-=p.referenceSemantics.lineRadius;return go('RSI_JUMP_DOWN');}
  return go(a.grounded?'RSI_DASH_JUMP_LANDING':'RSI_WAIT');
 }
 // Source EventProcess tests end before buffered branches on ground.
 if(end&&!air)return go('RSI_WAIT');
 for(const [key,i,next,condition,flag=i]of routes[n]??[]){
  if(condition&&!['held',a.professionId,a.professionId+':DOWN'].includes(condition))continue;
  const acceptsFresh=!condition?.endsWith(':DOWN')||keys.held.has('DOWN');
  const w=raw['EVENT_PROCESS_TIME'+i];if(!w)continue;
  const c=lkBufferedWindow(r.flags,flag,a.animationTime,acceptsFresh&&(keys.pressed.has(key)||condition==='held'&&keys.held.has(key)),w);r.flags=c.flags;
  if(c.changed)return go(next);if(c.consumed)return r;
 }
 const cancel=elesisNamedCancel(a,keys,p,r,raw);if(cancel)return cancel;
 if(air&&end&&!['ESI_DASH_JUMP_COMBO_Z','ESI_DASH_JUMP_COMBO_ZZ','ESI_DASH_JUMP_COMBO_ZZZ','ESI_DASH_JUMP_COMBO_X','ESI_DASH_JUMP_COMBO_XX'].includes(n))return go('RSI_JUMP_DOWN');
 return r;
}
function runFuture(a,keys,p,dt){const r=result(a);if(!r.handled)return r;r.boundaryCalls.future=1;
 if(nameOf(a).startsWith('ESI_JUMP_ATTACK')){if(keys.held.has(a.facing===1?'RIGHT':'LEFT'))r.vx=sourceScaledSpeed(p.physics.WALK_SPEED,a.stats.moveSpeedMultiplier)*a.facing;if(keys.held.has('DOWN')){r.vy=f(r.vy-f(p.physics.G_ACCEL*dt));r.flags|=1;}}
 if(/^ESI_DASH_COMBO_SBH_X{1,3}$/.test(nameOf(a)))r.passiveSpeed.x=sourceScaledSpeed(p.physics.RUN_SPEED,a.stats.moveSpeedMultiplier);
 return r;}
function runStart(a,p){const r=result(a);if(a.professionId==='BH'){if(nameOf(a)==='ESI_DASH_JUMP_COMBO_SPK_ZX_READY')a.sourceElesisCommand={loops:0,requestedLoops:0};if(nameOf(a)==='ESI_DASH_JUMP_COMBO_SPK_ZX_LOOP')(a.sourceElesisCommand??={loops:0,requestedLoops:0}).loops++;}if(a.professionId==='CA'){if(nameOf(a)==='ESI_DASH_COMBO_SCA_ZZZ_START')a.sourceElesisCommand={loops:0,requestedLoops:0};if(/^ESI_DASH_COMBO_SCA_ZZZ_LOOP_[12]$/.test(nameOf(a)))(a.sourceElesisCommand??={loops:0,requestedLoops:0}).loops++;}if(nameOf(a)==='ESI_COMBO_SGM_XX_DOWN_X_START'||a.professionId==='BH'&&a.state===BH_DASH_JUMP_XZ_REATTACK.sourceState)a.sourceElesisCommand={loops:0,requestedLoops:0};return r;}
export const elesisCommands=Object.freeze({ruleVersion:'elesis-target2016-command-v49',handlesEvent:isElesisCommand,handlesFuture:isElesisCommand,ownsAnimationEnd:isElesisCommand,isAirState:a=>isElesisCommand(a)&&aerial(nameOf(a)),runEvent,runFuture,runStart,runNow:a=>({...result(a),handled:false}),runEnd:a=>({...result(a),handled:false})});
export function elesisRequestedCancelFields(a,p,raw){
 // User feedback12 asks for free command/skill cancels during the GM spin.
 // Keep original999 declarations and bound this explicit Web exception to
 // its existing first-attack cue. No original2016cancel-window claim is made.
 if(a.professionId==='GM'&&nameOf(a)==='ESI_DASH_COMBO_SGM_XX_ATTACK'){
  const start=raw.EFFECT_SET_LIST_EX?.['1']?.['2'];
  if(!Number.isFinite(start))throw new TypeError('Missing original GM first-attack cue');
  return {...raw,SKILL_CANCEL_AFTER:start,WALK_CANCEL_AFTER:start,DASH_CANCEL_AFTER:start,ATTACK_CANCEL_AFTER_EX:start};
 }return raw;
}
export function elesisCommandSkillCancelAllowed(a,d){if(!isElesisCommand(a))return null;if(aerial(nameOf(a))===a.grounded&&!ownsSourceFoot(a,nameOf(a)))return false;return after(a.animationTime,elesisRequestedCancelFields(a,null,d?.raw??{}).SKILL_CANCEL_AFTER);}

/** Read-only priority query for the shared slot/awakening dispatcher. The
 * callback's support/end/buffered branches precede its named skill macro.
 * Probe a separate memo so loops and flags are committed only by runEvent.
 * CA renewal skill gates remain target-declaration adaptations. */
export function elesisCommandExternalSkillAllowed(a,keys,p,context){
 if(!isElesisCommand(a))return null;
 const probe={...a,sourceElesisCommand:{...(a.sourceElesisCommand??{loops:0,requestedLoops:0})}};
 return runEvent(probe,{...keys,elesisExternalSkillProbe:true},p,context).state==='EXTERNAL_SKILL_REQUEST';
}

/** EL5784/5916/6045: direction queues a rolling rise, while GM28404
 * opens the original early0 window. Retain the existing user X no-down rule.
 * Front callback's duplicated flag in the old reference is not copied: the
 * target has both rolling directions and the Back consumer distinguishes them.
 */
export function elesisDownInput(sim,a,keys){
 if(!isElesisProfession(a.professionId))return false;
 const p=sim.profileFor(a),raw=p.states[a.state].raw,side=a.state.endsWith('_BACK')?'BACK':'FRONT',quick=!!a.passivePolicy?.skillLevels?.[28404],w=raw.EVENT_PROCESS_TIME0;
 if(quick&&w){for(const [flag,next]of [[5,'ESI_STANDUP_ROLLING_'+side+'_FRONT'],[6,'ESI_STANDUP_ROLLING_'+side+'_BACK'],[7,'RSI_STANDUP_ATTACK_'+side]]){
   const c=lkBufferedWindow(a.sourceCommandFlags,flag,a.animationTime,a.downSuccessor===next,w);a.sourceCommandFlags=c.flags;
   if(c.changed){sim.enter(a,next,'elesis-quick-standup');return true;}
 }}
 if(!after(a.animationTime,quick?w?.['1']:.33))return true;
 if(keys.pressed.has('X')||keys.held.has('X')){a.downAttackChoice='X';a.downSuccessor='RSI_STANDUP_ATTACK_'+side+'_NO_DOWN';}
 else if(keys.pressed.has('Z')){a.downAttackChoice='Z';a.downSuccessor='RSI_STANDUP_ATTACK_'+side;}
 else if(keys.held.has('LEFT')||keys.held.has('RIGHT')){const forward=keys.held.has(a.facing===1?'RIGHT':'LEFT');a.downAttackChoice=null;a.downSuccessor='ESI_STANDUP_ROLLING_'+side+'_'+(forward?'FRONT':'BACK');}
 return true;
}

const commandEffects={
 ESI_DASH_COMBO_SPK_ZX:[.233,6,'EffectSet_A_EL_Dash_Combo_ZX','EffectSet_A_EL_Dash_Combo_ZX_FAIL'],
 ESI_COMBO_SBH_ZZZX:[.233,6,'EffectSet_A_EL_Dash_Combo_ZX','EffectSet_A_EL_Dash_Combo_ZX_FAIL'],
 ESI_DASH_COMBO_SPK_ZZZ:[.266,6,'EffectSet_A_EL_Dash_Combo_ZZZ','EffectSet_A_EL_Dash_Combo_ZZZ_FAIL'],
 ESI_DASH_JUMP_COMBO_SPK_XZ:[.2,4,'EffectSet_A_EL_DashJump_Combo_XZ','EffectSet_A_EL_DashJump_Combo_XZ_FAIL'],
 ESI_DASH_COMBO_SBH_X:[.135,4,'EffectSet_Elesis_SBH_Dash_Combo_X','EffectSet_Elesis_SBH_Combo_XZZ_FAIL'],
 ESI_DASH_COMBO_SBH_XX:[.363,4,'EffectSet_Elesis_SBH_Dash_Combo_XX','EffectSet_Elesis_SBH_Combo_XZZ_FAIL'],
 ESI_DASH_COMBO_SBH_XXX:[.492,4,'EffectSet_Elesis_SBH_Dash_Combo_XXX','EffectSet_Elesis_SBH_Combo_XZZ_FAIL'],
 ESI_DASH_COMBO_SBH_XXXZ:[.27,0,'EffectSet_Elesis_SBH_Combo_XXXZ'],
 ESI_COMBO_SBH_XZ:[.001,2,'EffectSet_SBH_Combo_XZZ_Fire_NEW'],
 ESI_COMBO_SBH_XZZ:[.001,2,'EffectSet_SBH_Combo_XZZZ_Fire_NEW'],
};
/** Only command callback resources; Chivalry, counter and skill roots are
 * separate consumers. Failed MP routes remain original visible commands. */
export function elesisCommandEffectRoots(profile){
 const unit=profile.target?.unitClass,roots=new Set();
 if(unit===120)roots.add('EffectSet_SGM_XXX_Start');
 if(unit===121){for(const row of Object.values(commandEffects))for(const name of row.slice(2))if(name)roots.add(name);
  roots.add('EffectSet_Elesis_SBH_Combo_XZZ');roots.add('EffectSet_A_SBH_DashJump_Combo_XZ');roots.add('DamageEffect_Elesis_SBH_DashJump_Combo_ZX');roots.add('DamageEffect_Elesis_SPK_DashJump_Combo_ZX');}
 if(unit===125){roots.add('EffectSet_SDK_Dash_Jump_Combo_ZX');roots.add('EffectSet_C_SCA_Dash_ZZZ_Uppercut');roots.add('EffectSet_C_SCA_Dash_ZZZ_Finish');roots.add('DamageEffect_SCA_Dash_Combo_XZ');}
 return [...roots].filter(name=>Object.hasOwn(profile.effectSets??{},name)||Object.hasOwn(profile.damageEffects??{},name));
}
export function elesisCommandEvents(sim,a,before,after){
 if(!isElesisCommand(a))return;const n=nameOf(a),row=commandEffects[n];
 caOriginalCommandWaveEvents(sim,a,n,before,after);
 // Target2016 has no raw EffectSet list on ZX_FIRE: its separately declared
 // projectile group owns the .3 release time and the original moving carrier.
 // Bind that group at the fire phase origin, not at .3 a second time. The
 // unavailable native charge/Front-variant selector is not guessed here.
 if(a.professionId==='CA'&&n==='ESI_DASH_JUMP_COMBO_SDK_ZX_FIRE')
  sim.fire(a,'elesis-command-sdk-zx-projectile',0,before,after,()=>sim.spawnSet(a,'EffectSet_SDK_Dash_Jump_Combo_ZX'));
 if(a.professionId==='CA'&&n==='ESI_DASH_JUMP_COMBO_SDK_XXX')sim.fire(a,'elesis-ca-air-xxx-wave',.01,before,after,()=>{if(a.mp>=3){a.mp=f(a.mp-3);sim.spawnSet(a,'EffectSet_C_SCA_Dash_ZZZ_Uppercut');}});
 if(a.professionId==='CA'&&n==='ESI_DASH_COMBO_SCA_XZ_FIRE')sim.fire(a,'elesis-ca-dash-xz-wave',.01,before,after,()=>{
  // Original327cc130 creates this projectile separately from the cast set.
  const charge=a.sourceElesisSkills?.charge??0,cost=5,size=f(1+charge*.13300000131130219);
  if(a.mp<cost)return;a.mp=f(a.mp-cost);
  const effect=sim.createEffect(a,{NAME:'DamageEffect_SCA_Dash_Combo_XZ',SCALE_X:size,SCALE_Y:size,SCALE_Z:size},
   {birthAnchor:{position:[a.x,a.y,a.z],rotation:[0,a.facing<0?180:0,0],facing:a.facing}});
  if(effect){effect.powerMultiplier=f(effect.powerMultiplier*f(1+charge*.5));effect.sourceElesisCommandCharge=charge;
   effect.lifeTimeSeconds=caDashWaveLifetime(charge);effect.templateFields={...effect.templateFields,LifeTime:effect.lifeTimeSeconds};}
 });
 if(a.professionId==='BH'&&n==='ESI_DASH_JUMP_COMBO_SPK_ZX_LOOP')sim.fire(a,'elesis-bh-zx-fireball',.1,before,after,()=>{
  if(a.mp<2)return;const anchor=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Dummy2_Lhand'}},a);
  if(!anchor){sim.note('elesis-bh-zx-hand','Original Dummy2_Lhand frame required',a);return;}
  a.mp=f(a.mp-2);const name=a.passivePolicy?.skillLevels?.[28406]?'DamageEffect_Elesis_SPK_DashJump_Combo_ZX':'DamageEffect_Elesis_SBH_DashJump_Combo_ZX';
  const effect=sim.createEffect(a,{NAME:name},{birthAnchor:{...anchor,rotation:[0,a.facing<0?180:0,-45],facing:a.facing}});
  if(effect)effect.powerMultiplier=f(effect.powerMultiplier*(a.passivePolicy?.elesis?.commandFireDamageMultiplier??1));
 });
 if(n==='ESI_COMBO_SGM_XX_DOWN_X_START')sim.fire(a,'elesis-command-spin',.01,before,after,()=>sim.spawnSet(a,'EffectSet_SGM_XXX_Start',undefined,[3,4],a.awakening.remaining>0));
 if(n==='ESI_COMBO_SBH_XZZ')sim.fire(a,'elesis-command-xzz',.001,before,after,()=>spawnFire(sim,a,'EffectSet_Elesis_SBH_Combo_XZZ'));
 if(!row)return;
 sim.fire(a,'elesis-command-carrier',row[0],before,after,()=>{const success=a.mp>=row[1];let name=row[success?2:3];if(success)a.mp=f(a.mp-row[1]);
  if(n==='ESI_DASH_JUMP_COMBO_SPK_XZ'&&success&&a.passivePolicy?.skillLevels?.[28406])name='EffectSet_A_SBH_DashJump_Combo_XZ';
  if(name)spawnFire(sim,a,name,n==='ESI_DASH_JUMP_COMBO_SPK_XZ'&&success?-55:0);
 });
}
function spawnFire(sim,a,name,roll=0){const first=sim.state.nextEffectId;sim.spawnSet(a,name,undefined,[],a.awakening.remaining>0);
 for(const e of sim.state.effects)if(e.ownerId===a.id&&e.id>=first){e.powerMultiplier=f(e.powerMultiplier*(a.passivePolicy?.elesis?.commandFireDamageMultiplier??1));if(roll)e.definition.ROTATE_Z=(e.definition.ROTATE_Z??0)+roll;}
}

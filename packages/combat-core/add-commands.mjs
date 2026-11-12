import {addNasodRequest} from './add-nasod.mjs';
import {ADD_BARRIER_STATE} from './add-barrier.mjs';
import {sourceScaledSpeed} from './speed-attributes.mjs';
/** Target Add command windows with qualified callback order. No render/network
 * dependency. Promotion branches absent from V5 are explicit 2016 adapters. */
const f=Math.fround;
const aliases={RSI_COMBO_Z:'ANSI_COMBO_Z',RSI_COMBO_ZZ:'ANSI_COMBO_ZZ',RSI_COMBO_ZZZ:'ANSI_COMBO_ZZZ',RSI_COMBO_ZZZZ:'ANSI_COMBO_ZZZZ',RSI_COMBO_X:'ANSI_COMBO_X',RSI_COMBO_XX:'ANSI_COMBO_XX',RSI_COMBO_XXX:'ANSI_COMBO_XXX',RSI_DASH_COMBO_Z:'ANSI_DASH_COMBO_Z',RSI_DASH_COMBO_ZZ:'ANSI_DASH_COMBO_ZZ',RSI_DASH_COMBO_X:'ANSI_DASH_COMBO_X',RSI_JUMP_COMBO_Z:'ANSI_JUMP_ATTACK_Z',RSI_JUMP_COMBO_X:'ANSI_JUMP_ATTACK_X',RSI_DASH_JUMP_COMBO_Z:'ANSI_DASH_JUMP_COMBO_Z',RSI_DASH_JUMP_COMBO_ZZ:'ANSI_DASH_JUMP_COMBO_ZZ',RSI_DASH_JUMP_COMBO_X:'ANSI_DASH_JUMP_COMBO_X'};
const source=a=>aliases[a.state]??a.state;
const active=a=>/^(?:LP|MM|DE)$/.test(a.professionId??'')&&(/COMBO|JUMP_ATTACK/.test(source(a))||source(a)===ADD_BARRIER_STATE);
const airName=n=>(n.includes('DASH_JUMP')||n.includes('JUMP_ATTACK')||n==='ANSI_ALP_COMBO_ZZXX')&&!n.endsWith('_LANDING');
const after=(t,n)=>Number.isFinite(n)&&n>=0&&f(t)>f(n);
const end=(a,p)=>{const d=p.states[a.state].clip.durationSeconds;return a.animationStopped||f(a.animationTime)>f(d-Math.max(d/10,.03));};
const result=a=>({handled:active(a),vx:a.vx,vy:a.vy,y:a.y,passiveSpeed:{...a.passiveSpeed},flags:a.sourceCommandFlags??0,canNotJumpTime:a.canNotJumpTime??0,canNotAttackTime:a.canNotAttackTime??0,animationBeforeTime:a.animationTime,animationOneshotTimer:Math.max(a.animationOneshotTimer??0,a.animationTime),boundaryCalls:{future:0,event:0,start:0,down:0},state:null});
const request=(r,n,p)=>{r.state=Object.entries(p.stateAliases??{}).find(([role,src])=>src===n)?.[0]??n;if(!['DASH_REQUEST','AWAKEN_REQUEST'].includes(r.state)&&!p.states[r.state])throw new TypeError('Missing Add command '+r.state);return r;};
export function addBufferedWindow(flags,index,time,pressed,w){
 if(!w||![w['1'],w['2'],w['3']].every(Number.isFinite))return {flags,changed:false,unsupported:true};
 const bit=1<<index,t=f(time);
 if((flags&bit)&&t>f(w['3']))return {flags:flags&~bit,changed:true};
 if(pressed&&t>=f(w['1'])&&t<f(w['2']))return {flags:flags|bit,changed:false};
 return {flags,changed:false};
}
function routes(a){const p=a.professionId,second={LP:'ALP',MM:'AMM',DE:'ADE'}[p],first={LP:'APT',MM:'AAT',DE:'ATT'}[p];const n=source(a);
 const table={
 ANSI_COMBO_Z:[['Z',0,'ANSI_COMBO_ZZ']],ANSI_COMBO_ZZ:[['Z',0,'ANSI_COMBO_ZZZ'],['X',p==='LP'?2:p==='MM'?3:4,`ANSI_${second}_COMBO_ZZX`]],
 ANSI_COMBO_ZZZ:[['Z',0,'ANSI_COMBO_ZZZZ'],['X',1,'ANSI_COMBO_ZZZX']],ANSI_COMBO_X:[['X',0,'ANSI_COMBO_XX']],
 ANSI_COMBO_XX:[...(p==='MM'?[['X',2,'ANSI_AMM_COMBO_XXDownX_START','down']]:[]),['Z',1,'ANSI_COMBO_XXZ'],['X',0,'ANSI_COMBO_XXX']],
 ANSI_COMBO_XXZ:[['Z',0,'ANSI_COMBO_XXZZ_START']],ANSI_COMBO_ZZX:[['X',0,'ANSI_COMBO_ZZXX']],
 [`ANSI_${second}_COMBO_ZZX`]:[['X',0,`ANSI_${second}_COMBO_ZZXX`]],
 ANSI_DASH_COMBO_Z:[['Z',0,'ANSI_DASH_COMBO_ZZ'],...(p==='MM'?[['X',2,'ANSI_AAT_DASH_COMBO_ZBackX','back']]:[]),['X',p==='LP'?3:p==='DE'?4:1,`ANSI_${first}_DASH_COMBO_ZX`]],
 ANSI_DASH_COMBO_ZZ:[['Z',0,'ANSI_DASH_COMBO_ZZZ']],ANSI_DASH_COMBO_X:[['X',p==='DE'?1:0,p==='DE'?'ANSI_ADE_DASH_COMBO_XX':'ANSI_DASH_COMBO_XX']],
 ANSI_DASH_COMBO_XX:[['X',p==='LP'?1:p==='MM'?2:0,`ANSI_${second}_DASH_COMBO_XXX`]],
 ANSI_ADE_DASH_COMBO_XX:[['X',0,'ANSI_ADE_DASH_COMBO_XXX']],ANSI_APT_DASH_COMBO_ZX:[['X',0,'ANSI_APT_DASH_COMBO_ZXX']],
 ANSI_AAT_DASH_COMBO_ZX:[['X',0,'ANSI_DASH_COMBO_XXX']],ANSI_AAT_DASH_COMBO_ZBackX:[['X',0,'ANSI_DASH_COMBO_XXX']],
 ANSI_DASH_JUMP_COMBO_Z:[['Z',0,'ANSI_DASH_JUMP_COMBO_ZZ'],['X',p==='LP'?1:p==='MM'?2:3,`ANSI_${first}_DASH_JUMP_COMBO_ZX`]],
 ANSI_DASH_JUMP_COMBO_ZZ:[['Z',0,'ANSI_DASH_JUMP_COMBO_ZZZ'],['X',p==='LP'?1:p==='MM'?2:3,`ANSI_${first}_DASH_JUMP_COMBO_ZX`]],ANSI_DASH_JUMP_COMBO_X:[['X',0,'ANSI_DASH_JUMP_COMBO_XX_START'],['Z',p==='MM'?1:p==='LP'?2:3,`ANSI_${second}_DASH_JUMP_COMBO_XZ`]],
 ANSI_AMM_DASH_JUMP_COMBO_XZ:[['Z',0,'ANSI_AMM_DASH_JUMP_COMBO_XZZ']],ANSI_ADE_DASH_JUMP_COMBO_XZ:[['Z',0,'ANSI_ADE_DASH_JUMP_COMBO_XZZ']],
 ANSI_COMBO_NASOD_ARMOR_LANDING:[['Z',p==='MM'?2:0,p==='MM'?'ANSI_AAT_COMBO_NASOD_ARMOR_Z':'ANSI_COMBO_NASOD_ARMOR_Z'],['X',p==='MM'?3:1,p==='MM'?'ANSI_AAT_COMBO_NASOD_ARMOR_X':'ANSI_COMBO_NASOD_ARMOR_X']],
 ANSI_ATT_COMBO_NASOD_ARMOR_LANDING:[['Z',0,'ANSI_ATT_COMBO_NASOD_ARMOR_Z'],['X',1,'ANSI_ATT_COMBO_NASOD_ARMOR_X']],
 ANSI_COMBO_NASOD_ARMOR_Z:[['Z',0,'ANSI_COMBO_NASOD_ARMOR_ZZ']],ANSI_COMBO_NASOD_ARMOR_ZZ:[['Z',0,'ANSI_COMBO_NASOD_ARMOR_ZZZ'],['X',1,'ANSI_COMBO_NASOD_ARMOR_ZZX']],ANSI_COMBO_NASOD_ARMOR_ZZX:[['X',0,'ANSI_COMBO_NASOD_ARMOR_ZZXX']],
 ANSI_COMBO_NASOD_ARMOR_X:[['X',0,'ANSI_COMBO_NASOD_ARMOR_XX']],ANSI_COMBO_NASOD_ARMOR_XX:[['X',0,'ANSI_COMBO_NASOD_ARMOR_XXX']],
 ANSI_AAT_COMBO_NASOD_ARMOR_Z:[['Z',0,'ANSI_AAT_COMBO_NASOD_ARMOR_ZZ']],ANSI_AAT_COMBO_NASOD_ARMOR_ZZ:[['Z',0,'ANSI_AAT_COMBO_NASOD_ARMOR_ZZZ']],ANSI_AAT_COMBO_NASOD_ARMOR_X:[['X',0,'ANSI_AAT_COMBO_NASOD_ARMOR_XX']],ANSI_AAT_COMBO_NASOD_ARMOR_XX:[['X',0,'ANSI_AAT_COMBO_NASOD_ARMOR_XXX']],
 ANSI_ATT_COMBO_NASOD_ARMOR_Z:[['Z',0,'ANSI_ATT_COMBO_NASOD_ARMOR_ZZ']],ANSI_ATT_COMBO_NASOD_ARMOR_ZZ:[['Z',0,'ANSI_ATT_COMBO_NASOD_ARMOR_ZZZ']],ANSI_ATT_COMBO_NASOD_ARMOR_ZZZ:[['Z',0,'ANSI_ATT_COMBO_NASOD_ARMOR_ZZZZ_START']],ANSI_ATT_COMBO_NASOD_ARMOR_X:[['X',0,'ANSI_ATT_COMBO_NASOD_ARMOR_XX']],ANSI_ATT_COMBO_NASOD_ARMOR_XX:[['X',0,'ANSI_ATT_COMBO_NASOD_ARMOR_XXX_START']],
 };
 if(n==='ANSI_COMBO_XXX'&&p==='DE'){const mode=a.sourceAdd?.formation?'FORMATION_MODE':'NO_FORMATION_MODE';return [['Z',1,'ANSI_ADE_COMBO_XXXZ_'+mode],['X',2,'ANSI_ADE_COMBO_XXXX_'+mode]];}
 return table[n]??[];
}
function runEvent(a,keys,p){const r=result(a);if(!r.handled)return r;r.boundaryCalls.event=1;const n=source(a),raw=p.states[a.state].raw,t=f(a.animationTime),air=airName(n),done=end(a,p),held=keys.held;
 if(n===ADD_BARRIER_STATE){
  if(done)return request(r,'RSI_WAIT',p);
  const nasod=addNasodRequest(a,p.states[a.state],p,keys);if(nasod)return request(r,nasod,p);
  if(after(t,raw.SKILL_CANCEL_AFTER)&&keys.pressed.has('AWAKEN'))return request(r,'AWAKEN_REQUEST',p);
  if(after(t,raw.WALK_CANCEL_AFTER)&&(held.has('LEFT')||held.has('RIGHT')))return request(r,'RSI_WAIT',p);
  if(after(t,raw.DASH_CANCEL_AFTER)&&(keys.pureDoubleRight||keys.pureDoubleLeft||keys.pressed.has('DASH')))return request(r,'DASH_REQUEST',p);
  return r;
 }
 if(n==='ANSI_COMBO_NASOD_ARMOR_READY')return done?request(r,'ANSI_COMBO_NASOD_ARMOR_ATTACK',p):r;
 if(n==='ANSI_COMBO_NASOD_ARMOR_ATTACK')return a.grounded?request(r,a.professionId==='DE'?'ANSI_ATT_COMBO_NASOD_ARMOR_LANDING':'ANSI_COMBO_NASOD_ARMOR_LANDING',p):r;
 // Original registered32739530 retains DE ZX on an early landing. Its
 // animation-end branch, rather than the common dash-jump landing state,
 // chooses WAIT when grounded or JUMP_DOWN with LINE_RADIUS when airborne.
 if(n==='ANSI_ATT_DASH_JUMP_COMBO_ZX'&&done){
  if(a.grounded)return request(r,'RSI_WAIT',p);
  r.y-=p.referenceSemantics.lineRadius;return request(r,'RSI_JUMP_DOWN',p);
 }
 if(air&&a.grounded&&n!=='ANSI_ATT_DASH_JUMP_COMBO_ZX'){const landing=['ANSI_JUMP_ATTACK_Z','ANSI_JUMP_ATTACK_X'].includes(n)?'RSI_JUMP_LANDING':n==='ANSI_ALP_COMBO_ZZXX'?'ANSI_ALP_COMBO_ZZXX_LANDING':n==='ANSI_APT_DASH_JUMP_COMBO_ZX'?'ANSI_APT_DASH_JUMP_COMBO_ZX_LANDING':'RSI_DASH_JUMP_LANDING';return request(r,landing,p);}
 if(!air&&!a.grounded){r.y-=p.referenceSemantics.lineRadius;
  // Original327308f0 resets the third-Z local velocity on walk-off. The
  // preceding raw SPEED_TIME3000 must not survive as free-air momentum.
  if(n==='ANSI_COMBO_ZZZ')r.vx=550*a.facing;
  return request(r,'RSI_JUMP_DOWN',p);}
 if(n==='ANSI_DASH_JUMP_COMBO_XX_CHARGE'){if(!held.has('X')||a.stateTime>=3)return request(r,'ANSI_DASH_JUMP_COMBO_XX_FINISH',p);return r;}
 if(n==='ANSI_AMM_COMBO_XXDownX_LOOP'){if(a.stateTime>=.3&&(!held.has('X')||a.stateTime>=3))return request(r,'ANSI_AMM_COMBO_XXDownX_END',p);if(a.stateTime>=.3)return r;}
 if(n==='ANSI_COMBO_XXZZ_START'&&after(t,.456))return request(r,'ANSI_COMBO_XXZZ_LOOP',p);
 if(n==='ANSI_COMBO_XXZZ_LOOP'){
  if(done){const s=a.sourceAddCombat,loops=(s.xxzzLoops??0)+1;s.xxzzLoops=loops;
   return request(r,loops<2||loops<=8&&(r.flags&1)!==0?'ANSI_COMBO_XXZZ_LOOP':'ANSI_COMBO_XXZZ_FINISH',p);}
  // Raw has no EVENT_PROCESS_TIME0: CommonStateStart defaults0..9999.
  // The original tests oneZ, rather than the held pureZ level.
  if(keys.pressed.has('Z'))r.flags|=1;
  return r;
 }
 if(done){const next={ANSI_DASH_JUMP_COMBO_XX_START:'ANSI_DASH_JUMP_COMBO_XX_CHARGE',ANSI_AMM_COMBO_XXDownX_START:'ANSI_AMM_COMBO_XXDownX_LOOP',ANSI_COMBO_XXZZ_LOOP:'ANSI_COMBO_XXZZ_FINISH',ANSI_ATT_COMBO_NASOD_ARMOR_XXX_START:'ANSI_ATT_COMBO_NASOD_ARMOR_XXX_LOOP',ANSI_ATT_COMBO_NASOD_ARMOR_XXX_LOOP:'ANSI_ATT_COMBO_NASOD_ARMOR_XXX_END',ANSI_ATT_COMBO_NASOD_ARMOR_ZZZZ_START:'ANSI_ATT_COMBO_NASOD_ARMOR_ZZZZ_LOOP',ANSI_ATT_COMBO_NASOD_ARMOR_ZZZZ_LOOP:'ANSI_ATT_COMBO_NASOD_ARMOR_ZZZZ_END'}[n];
  if(next)return request(r,next,p);if(!air)return request(r,'RSI_WAIT',p);
  // The target ADE landing branch ends its controller before the .75 gravity
  // boundary. Holding that controller forever prevents both gravity and any
  // landing callback. A bounded Web exit uses the original free-fall state;
  // no matching2016 ADE native callback has been obtained for this adapter.
  if(n==='ANSI_ADE_DASH_JUMP_COMBO_XZZ')return request(r,'RSI_JUMP_DOWN',p);
 }
 for(const [key,index,next,condition]of routes(a)){const pressed=keys.pressed.has(key)&&(!condition||(condition==='down'?held.has('DOWN'):held.has(a.facing===1?'LEFT':'RIGHT')))&&
  (n!=='ANSI_AMM_COMBO_ZZX'||!!a.sourceAddCombat?.commandTargetId);const w=addBufferedWindow(r.flags,index,t,pressed,raw['EVENT_PROCESS_TIME'+index]);r.flags=w.flags;if(w.changed)return request(r,next,p);}
 const nasod=addNasodRequest(a,p.states[a.state],p,keys);if(nasod)return request(r,nasod,p);
 if(after(t,raw.SKILL_CANCEL_AFTER)&&keys.pressed.has('AWAKEN'))return request(r,'AWAKEN_REQUEST',p);
 // Registered2016 DE ZX remains an aerial-named command after landing. Its
 // original3273961a/3273967f movement branches explicitly test grounded, then
 // WALK/DASH thresholds; the generic air-name exclusion must not hide them.
 const groundMovement=!air||n==='ANSI_ATT_DASH_JUMP_COMBO_ZX'&&a.grounded;
 if(groundMovement&&after(t,raw.WALK_CANCEL_AFTER)&&(held.has('LEFT')||held.has('RIGHT')))return request(r,'RSI_WAIT',p);
 if(groundMovement&&after(t,raw.DASH_CANCEL_AFTER)&&(keys.pureDoubleRight||keys.pureDoubleLeft||keys.pressed.has('DASH')))return request(r,'DASH_REQUEST',p);
 // Native Add VT+3e0/+3e4 both resolve to31fcb840 returning WAIT. This is
 // the recovered cancellation only; no unobserved dedicated ZXX is added.
 if(n==='ANSI_ATT_DASH_JUMP_COMBO_ZX'&&a.grounded&&after(t,raw.ATTACK_CANCEL_AFTER)&&
  (held.has('Z')||held.has('X')))return request(r,'RSI_WAIT',p);
 return r;
}
function runFuture(a,keys,p,dt){
 const r=result(a);if(!r.handled)return r;r.boundaryCalls.future=1;
 const name=source(a),held=keys.held;
 // Fixed Add JumpComboZEventMoveFuture:7088..7105. The shared executor
 // suppresses its generic jump-attack steering whenever this Future owns
 // the command, so returning an empty result silently removed this input.
 if(name==='ANSI_JUMP_ATTACK_Z'&&held.has(a.facing===1?'RIGHT':'LEFT'))
  r.vx=sourceScaledSpeed(p.physics.WALK_SPEED,a.stats.moveSpeedMultiplier)*a.facing;
 if(['ANSI_JUMP_ATTACK_Z','ANSI_JUMP_ATTACK_X'].includes(name)&&held.has('DOWN')&&!held.has('UP')){
  r.vy=f(r.vy-f(p.physics.G_ACCEL*dt));r.flags|=1;
 }
 return r;
}
function runEnd(a){
 const r={...result(a),handled:false};
 if(!active(a)||source(a)!=='ANSI_DASH_COMBO_X')return r;
 // Original2016 state0x90 EndFuture32774330->3272bf30: after the common
 // start-future callback, invert Future.bIsRight and add180 to its yaw.
 // Web vx is in world/lane coordinates; the native nowSpeed.x remains local
 // across this turn, so its world representation changes sign with facing.
 r.handled=true;r.facing=-a.facing;r.vx=-a.vx;return r;
}
function runStart(a){
 if(active(a)&&['ANSI_COMBO_XXZZ_START','ANSI_COMBO_XXZZ_FINISH'].includes(source(a)))a.sourceAddCombat.xxzzLoops=0;
 return result(a);
}
export const addCommands=Object.freeze({ruleVersion:'add-target2016-command-v61',evidenceClass:'target2016 windows + qualified reference and explicit promotion bindings; exact2016 first66X exit/ZZZ walk-off/XXZZ loop',handlesEvent:active,handlesFuture:active,ownsAnimationEnd:active,isAirState:a=>airName(source(a)),runEvent,runFuture,runStart,runNow:a=>({...result(a),handled:false}),runEnd});
export function addCommandSkillCancelAllowed(a,def){if(!active(a))return null;if(![ADD_BARRIER_STATE,'ANSI_ATT_DASH_JUMP_COMBO_ZX'].includes(source(a))&&airName(source(a))===!!a.grounded)return false;return after(a.animationTime,def.raw.SKILL_CANCEL_AFTER_FLY??def.raw.SKILL_CANCEL_AFTER);}

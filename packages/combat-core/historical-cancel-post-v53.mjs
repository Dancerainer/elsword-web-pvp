/** Explicit original2016 post branches. Frame/attack production remains in
 * the profession modules. Unknown actor component members are not invented. */
import {requestSourceState} from './source-state-requests-v53.mjs';
import {sourcePostSkillDispatch,sourceAwakening} from './common-cancel-post-v53.mjs';
import {isCommandSkillCancelAllowed} from './is-commands.mjs';
const f=Math.fround,dirs=['UP','DOWN','LEFT','RIGHT'],slots=['A','S','D','C','Q','W','E','R'];
export const HISTORICAL_EXPLICIT_POSTS=new Set(['RSI_DAMAGE_REVENGE','ESSI_DAMAGE_REVENGE','RSI_A_RRF_ENCHANT_HAND',
 'ESSI_SA_EMK_PHOENIX_TALON','RSI_SA_RWT_HELLFIRE_GATLING_OVER_END','RSI_SA_RWT_REVOLVER_CANNON_OVER_END',
 'RSI_A_RRF_HELL_DIVE_UPGRADE','ESSI_HA_ERS_SHINING_RUNE_BUSTER','ESSI_HA_EIS_BLADE_RAIN',
 'ESSI_A_ELK_ROLLING_SMASH_LANDING','ESSI_HA_ELK_GIGANTIC_SLASH','RSI_HA_RVC_BURNING_BUSTER',
 'ESSI_COMBO_Z4','ESSI_COMBO_Z4a','ESSI_COMBO_X3','ESSI_COMBO_X3a','ESSI_REVENGE_WAIT','ESSI_REVENGE_ATTACK',
 'ESSI_DASH_JUMP_COMBO_X2_LANDING','ESSI_SI_A_ETK_COMPACT_COUNTER_ATTACK','ESSI_SI_A_ETK_COMPACT_COUNTER_GUARD_ATTACK',
 'RVC_SI_A_BLEEDING_SLICER_FLY','ESSI_ERS_FULL_CHARGE_XZZ','ESSI_ERS_COUNTER_GUARD_END',
 'ESSI_SA_ERS_SPLASH_EXPLOSION','ESSI_SI1_ES_WIND_BLADE_ULTIMATE','RBM_DASH_JUMP_COMBO_XZ',
 'ESSI_ESK_DASH_COMBO_ZChargeX','ESSI_ELK_DASH_COMBO_XChargeX','ESSI_ERS_XZ_CHARGE',
 'ESSI_ERS_COUNTER_GUARD_READY','ESSI_ERS_COUNTER_GUARD',
 'ESSI_COMBO_Z1','ESSI_COMBO_Z2','ESSI_COMBO_Z3','ESSI_COMBO_X1','ESSI_COMBO_X2','ESSI_ERS_COMBO_ZZZ','ESSI_ERS_COMBO_ZZZZ',
 'ESSI_DASH_COMBO_Z1','ESSI_DASH_ATTACK_X','ESSI_ELK_DASH_COMBO_XX','ESSI_ELK_DASH_COMBO_XXX','ESSI_ELK_XXXXX',
 'ESSI_DASH_JUMP_COMBO_Z1','ESSI_DASH_JUMP_COMBO_Z2','ESSI_DASH_JUMP_COMBO_Z3','ESSI_DASH_JUMP_COMBO_X1',
 'ESSI_DASH_JUMP_COMBO_X2','ESSI_DASH_JUMP_COMBO_Z3_LANDING',
 'RSI_OVER_TAKER_DASH_COMBO_ZX','ESSI_DESTRUCTION_RAGE','ESSI_JUMP_ATTACK_X','ESSI_JUMP_ATTACK_Z',
 'ESSI_SI_P_ESK_AUTO_GUARD_END_SMALL','RVC_DASH_COMBO_ZZ','RBM_COMBO_XZ','RBM_COMBO_XZZ','RBM_COMBO_XZZZ',
 'RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZ','RSI_A_RWT_BARRAGE_ATTACK_STAND','RSI_A_RWT_BARRAGE_ATTACK_AIR']);
export function sourcePostEnded(a,def){const duration=def.clip?.durationSeconds;
 return a.animationStopped||Number.isFinite(duration)&&f(a.animationTime)>f(duration-Math.max(duration/10,.03));}
export function runHistoricalExplicitPost(sim,a,input){
 const p=sim.profileFor(a),d=p.states[a.state],n=d.sourceState??a.state;if(!HISTORICAL_EXPLICIT_POSTS.has(n))return false;
 // IS already has distinct derived consumers for these shared names. Preserve
 // their XX landing choice / MP-paid ZZZ route inside the same pending host.
 if(a.professionId==='IS'&&['ESSI_DASH_JUMP_COMBO_X1','ESSI_DASH_JUMP_COMBO_Z2'].includes(n))return false;
 const raw=d.raw,t=f(a.animationTime),ended=sourcePostEnded(a,d),ground=a.grounded;
 // Numeric144 is shared by three Elsword classes. The fixed SwordMan
 // registration switch binds LK's144 to the Knight table and callback;
 // the common143 post's request of144 does not select the base swordman's
 // declaration. Keep the class binding before the generic alias lookup.
 const resolve=name=>p.target.unitClass===100&&name==='ESSI_DASH_JUMP_COMBO_X2'?
  'ESSI_KNIGHT_DASH_JUMP_COMBO_X2':Object.entries(p.stateAliases??{}).find(([,source])=>source===name)?.[0]??name;
 const request=(state,why='target2016-historical-post')=>requestSourceState(sim,a,resolve(state),why,{clearSkill:true,
  productPressed:a.professionId==='VC'&&['RSI_WAIT','RSI_DASH','RSI_DASH_JUMP'].includes(state)&&(input.pureDoubleLeft||input.pureDoubleRight||input.pressed.has('DASH'))?['Z','X'].filter(key=>input.pressed.has(key)):[]});
 const finish=(landing='RSI_WAIT',offset=false)=>{if(ground)request(landing);else{request('RSI_JUMP_DOWN');if(offset)a.y=f(a.y-45);}};
 const gate=k=>Number.isFinite(raw[k])&&raw[k]>=0&&t>f(raw[k]);
 const any=group=>group.some(k=>input.held.has(k));
 const flag=(i,value)=>{a.sourceCommandFlags=value?(a.sourceCommandFlags??0)|(1<<i):(a.sourceCommandFlags??0)&~(1<<i);};
 const has=i=>!!((a.sourceCommandFlags??0)&(1<<i));
 function buffer(i,key,next,w=raw['EVENT_PROCESS_TIME'+i],{capture=true,endedTrigger=true}={}){
  if(!w)return false;
  if(has(i)&&(t>f(w['3'])||endedTrigger&&ended)){flag(i,false);request(next);return true;}
  if(capture&&input.pressed.has(key)&&t>=f(w['1'])&&t<f(w['2'])){flag(i,true);return true;}return false;
 }
 const back=input.held.has(a.facing>0?'LEFT':'RIGHT'),forward=input.held.has(a.facing>0?'RIGHT':'LEFT'),unit=p.target.unitClass;
 const offLine=()=>{request('RSI_JUMP_DOWN');a.y=f(a.y-45);};
 const dash=()=>{if(a.buffControls?.dashBlock||!(input.pureDoubleLeft||input.pureDoubleRight||input.pressed.has('DASH')))return false;
  request(ground?'RSI_DASH':'RSI_DASH_JUMP');return true;};
 function cascade(order,{directionGround=true,skillGround=true}={}){
  for(const kind of order){
   // IS keeps the shared ZZ callback's earlier EPT branches. Only its later
   // skill cascade uses the already declared IS cancellation window.
   const skillGate=unit===112&&n==='ESSI_COMBO_Z2'?isCommandSkillCancelAllowed(a,d):gate('SKILL_CANCEL_AFTER');
   if(kind==='S'&&(!skillGround||ground)&&skillGate&&sourcePostSkillDispatch(sim,a,input,1))return true;
   if(kind==='A'&&gate('SKILL_CANCEL_AFTER')&&sourceAwakening(sim,a,input))return true;
   if(kind==='F'&&gate('SKILL_CANCEL_AFTER_FLY')&&sourcePostSkillDispatch(sim,a,input,2))return true;
   if(directionGround&&!ground&&'BWDTU'.includes(kind))continue;
   if(kind==='U'&&gate('UPDOWN_CANCEL_AFTER')&&any(['UP','DOWN'])){request('RSI_WAIT');return true;}
   if(kind==='B'&&gate('BWALK_CANCEL_AFTER')&&input.held.has(a.facing>0?'LEFT':'RIGHT')){request('RSI_WAIT');return true;}
   if(kind==='W'&&gate('WALK_CANCEL_AFTER')&&any(['LEFT','RIGHT'])){request('RSI_WAIT');return true;}
   if(kind==='D'&&gate('DASH_CANCEL_AFTER')&&dash())return true;
   if(kind==='T'&&gate('ATTACK_CANCEL_AFTER')){
    if(input.held.has('Z')){request('RSI_COMBO_Z');return true;}if(input.held.has('X')){request('RSI_COMBO_X');return true;}}
  }return false;
 }
 if(['RSI_DAMAGE_REVENGE','ESSI_DAMAGE_REVENGE','RSI_A_RRF_ENCHANT_HAND','ESSI_SA_EMK_PHOENIX_TALON'].includes(n)){if(ended)finish();}
 else if(n==='RSI_SA_RWT_HELLFIRE_GATLING_OVER_END'){
  sim.sourcePostContext.skipBaseTail=true;if(ended)finish();
 }else if(['RSI_SA_RWT_REVOLVER_CANNON_OVER_END','RSI_A_RRF_HELL_DIVE_UPGRADE','ESSI_HA_ERS_SHINING_RUNE_BUSTER','ESSI_HA_EIS_BLADE_RAIN'].includes(n)){
  if(n==='RSI_SA_RWT_REVOLVER_CANNON_OVER_END')sim.sourcePostContext.skipBaseTail=true;
  if(ended)finish();else cascade(n.startsWith('ESSI_HA_')?'DWSA':'WDSA');
 }else if(['ESSI_A_ELK_ROLLING_SMASH_LANDING','ESSI_HA_ELK_GIGANTIC_SLASH','RSI_HA_RVC_BURNING_BUSTER'].includes(n)){
  if(ended)finish();else cascade('SAWD');
 }else if(['ESSI_COMBO_Z4','ESSI_COMBO_Z4a','ESSI_COMBO_X3','ESSI_COMBO_X3a','ESSI_REVENGE_WAIT'].includes(n)){
  if(!ground){request('RSI_JUMP_DOWN');a.y=f(a.y-45);}
  else{const time=n==='ESSI_COMBO_Z4a'?.8999999761581421:['ESSI_COMBO_X3a','ESSI_REVENGE_WAIT'].includes(n)?.6000000238418579:.699999988079071;
   const group=n==='ESSI_COMBO_Z4a'?dirs:['ESSI_COMBO_X3','ESSI_REVENGE_WAIT'].includes(n)?[...dirs,...slots]:[...dirs,...slots,'Z','X'];
   if(ended||t>time&&any(group))request('RSI_WAIT');}
  // Z4a has an independent main-end write after its contact branch.
  if(n==='ESSI_COMBO_Z4a'&&ended)request('RSI_WAIT');
 }else if(n==='ESSI_REVENGE_ATTACK'){if(ended)finish('RSI_WAIT',true);}
 else if(n==='ESSI_DASH_JUMP_COMBO_X2_LANDING'){
  if(!ground){request('RSI_JUMP_DOWN');a.y=f(a.y-45);}else if(ended)request('RSI_WAIT');
 }else if(['ESSI_SI_A_ETK_COMPACT_COUNTER_ATTACK','ESSI_SI_A_ETK_COMPACT_COUNTER_GUARD_ATTACK'].includes(n)){
  if(ended)finish('RSI_WAIT',true);else cascade('W');
 }else if(n==='RVC_SI_A_BLEEDING_SLICER_FLY'){
  sim.sourcePostContext.skipBaseTail=true;
  if(ended){if(ground)request('RSI_JUMP_LANDING');}
  else if(cascade('DW')){}
  else if(cascade('F'))sim.sourcePostContext.skipBaseTail=false;
 }else if(['ESSI_ERS_FULL_CHARGE_XZZ','ESSI_ERS_COUNTER_GUARD_END'].includes(n)){
  if(ended)finish('RSI_WAIT',true);else cascade('USABWDT');
 }else if(['ESSI_SA_ERS_SPLASH_EXPLOSION','ESSI_SI1_ES_WIND_BLADE_ULTIMATE'].includes(n)){
  const skip=raw.SKIP_TIME??-1,skipNow=Number.isFinite(skip)&&skip>=0&&t>f(skip)&&any([...dirs,...slots,'Z','X']);
  if(n==='ESSI_SI1_ES_WIND_BLADE_ULTIMATE'&&!ground){request('RSI_JUMP_DOWN');a.y=f(a.y-45);}
  else if(ended||skipNow)finish();else cascade('SAWD');
 }else if(n==='RBM_DASH_JUMP_COMBO_XZ'){
  if(ended&&ground)request('RSI_JUMP_LANDING');
 }else if(['ESSI_ESK_DASH_COMBO_ZChargeX','ESSI_ELK_DASH_COMBO_XChargeX'].includes(n)){
  if(!ground)request('RSI_JUMP_DOWN');
  else if(!input.held.has('X')||t>=f(raw.EVENT_PROCESS_TIME0['1']))request(n==='ESSI_ESK_DASH_COMBO_ZChargeX'?'ESSI_ESK_DASH_COMBO_ZX':'ESSI_ELK_DASH_COMBO_XX');
  else cascade('USABWDT');
 }else if(n==='ESSI_ERS_XZ_CHARGE'){
  const w=raw.EVENT_PROCESS_TIME0;
  if(!ground)request('RSI_JUMP_DOWN');
  else if(t>=f(w['3'])){if(!input.held.has('Z')||t>=f(w['1']))request(t<f(w['2'])?'ESSI_ERS_XZZ':'ESSI_ERS_FULL_CHARGE_XZZ');}
  else cascade('USABWDT');
 }else if(n==='ESSI_ERS_COUNTER_GUARD_READY'){
  if(ended)sim.enter(a,'ESSI_ERS_COUNTER_GUARD','target2016-guard-ready');
 }else if(n==='ESSI_ERS_COUNTER_GUARD'){
  // Web stateTime is the post's accumulated eligible delta, reset by enter.
  if(!input.held.has(a.skillContext?.key)||f(a.stateTime)>f(5))sim.enter(a,'ESSI_ERS_COUNTER_GUARD_END','target2016-guard-release');
 }else if(n==='ESSI_COMBO_Z1'){
  if(back)flag(0,false);
  if(!ground)offLine();
  else if(!cascade('SABWD')){
   if(has(0)&&t>.27000001072883606){flag(0,false);request('ESSI_COMBO_Z2');}
   else if(input.pressed.has('Z')){if(t<=.27000001072883606)flag(0,true);else if(t<.4000000059604645)request('ESSI_COMBO_Z2');}
  }
  if(ended){request('RSI_WAIT');a.canNotAttackTime=f(.1);}
 }else if(n==='ESSI_COMBO_Z2'){
  if(back)flag(0,false);
  if(!ground)offLine();
  else if(has(0)&&t>.3659999966621399&&![101,112].includes(unit)){flag(0,false);request('ESSI_COMBO_Z3');}
  else if(buffer(1,'Z','ESSI_ETK_COMBO_ZZZ',raw.EVENT_PROCESS_TIME0,{capture:unit===112})){}
  else if(buffer(2,'Z','ESSI_ERS_COMBO_ZZZ',raw.EVENT_PROCESS_TIME1,{capture:unit===101})){}
  else if(!cascade('SABWDT')){
   if(input.pressed.has('Z')&&t<=.3659999966621399)flag(0,true);else if(ended){request('RSI_WAIT');a.canNotAttackTime=f(.1);}
  }
 }else if(n==='ESSI_COMBO_Z3'){
  if(!ground)offLine();
  else if(!cascade('SABWD')){
   if(buffer(2,'Z','ESSI_ELK_ZZZfrontZ',{'1':0,'2':.3330000042915344,'3':.3330000042915344},{capture:unit===100&&forward})){}
   else if(buffer(0,'Z','ESSI_COMBO_Z4')){}
   else if(buffer(1,'X','ESSI_COMBO_Z4a')){}
   else if(ended)request('RSI_WAIT');
  }
 }else if(n==='ESSI_COMBO_X1'){
  if(back)a.sourceCommandFlags=(a.sourceCommandFlags??0)&~7;
  if(!ground)offLine();else if(ended)request('RSI_WAIT');
  else if(buffer(1,'Z','ESSI_ERS_XZ',{'1':0,'2':.4300000071525574,'3':.4300000071525574},{capture:unit===101})){}
  else if(buffer(2,'X','ESSI_ETK_COMBO_XX',raw.EVENT_PROCESS_TIME0,{capture:unit===112})){}
  else if(buffer(0,'X','ESSI_COMBO_X2',{'1':0,'2':.4300000071525574,'3':.4300000071525574},{capture:unit!==112})){}
  else if(t>.6000000238418579&&any([...dirs,...slots])){request('RSI_WAIT');a.canNotAttackTime=f(.2);}
 }else if(n==='ESSI_COMBO_X2'){
  if(!ground)offLine();
  else if(buffer(0,'X','ESSI_COMBO_X3',raw.EVENT_PROCESS_TIME0,{capture:unit!==100})){}
  else if(buffer(1,'Z','ESSI_COMBO_X3a')){}
  else if(buffer(2,'X','ESSI_ELK_XXX',raw.EVENT_PROCESS_TIME2,{capture:unit===100})){}
  else if(ended)request('RSI_WAIT');
 }else if(n==='ESSI_ERS_COMBO_ZZZ'){
  if(!ground)offLine();else if(ended)request('RSI_WAIT');
  else if(!buffer(0,'Z','ESSI_ERS_COMBO_ZZZZ'))cascade('SABWD');
 }else if(n==='ESSI_ERS_COMBO_ZZZZ'){
  if(!ground)offLine();else if(ended)request('RSI_WAIT');else cascade('SABWD');
 }else if(n==='ESSI_DASH_COMBO_Z1'){
  if(buffer(0,'Z','ESSI_KNIGHT_DASH_COMBO_Z2',raw.EVENT_PROCESS_TIME0,{capture:unit!==112})){}
  else if(buffer(1,'Z','ESSI_ETK_DASH_COMBO_ZZ',raw.EVENT_PROCESS_TIME1,{capture:unit===112})){}
  else if(buffer(2,'X','ESSI_ESK_DASH_COMBO_ZChargeX',raw.EVENT_PROCESS_TIME2,{capture:unit===100})){}
  else if(ended)finish('RSI_WAIT',true);
  else if(t>.8999999761581421&&any([...dirs,...slots])){request('RSI_WAIT');a.canNotAttackTime=f(.1);}
 }else if(n==='ESSI_DASH_ATTACK_X'){
  if(ended)finish('RSI_WAIT',true);
  else if(unit===112&&buffer(0,'X','ESSI_EIS_DASH_COMBO_XX',{'1':.2329999953508377,'2':.6299999952316284,'3':.6299999952316284})){}
  else if(unit===100&&buffer(0,'X','ESSI_ELK_DASH_COMBO_XChargeX')){}
  else if(unit===101&&buffer(1,'Z','ESSI_ERS_XZ_CHARGE')){}
  else if(t>.6666600108146667&&any([...dirs,...slots,...(unit===100?['Z']:unit===101?['X']:[])]))request('RSI_WAIT');
 }else if(['ESSI_ELK_DASH_COMBO_XX','ESSI_ELK_DASH_COMBO_XXX'].includes(n)){
  if(ended)finish('RSI_WAIT',true);
  else if(!cascade('USABWDT')&&n==='ESSI_ELK_DASH_COMBO_XX')buffer(0,'X','ESSI_ELK_DASH_COMBO_XXX');
 }else if(n==='ESSI_ELK_XXXXX'){
  if(ended)finish('RSI_WAIT',true);
  // This selected body requests207, but its registered state/template is
  // absent from the retained source/profile closure. Consume the branch and
  // retain an unsupported note, rather than inventing a sixth slash.
  else if(!buffer(0,'X','SOURCE_NATIVE_207_UNSUPPORTED'))cascade('USABWDT');
 }else if(n==='ESSI_DASH_JUMP_COMBO_Z1'){
  if(input.pressed.has('Z'))flag(0,true);
  if(ground)request('RSI_DASH_JUMP_LANDING');
  else if(buffer(1,'X','ESSI_EMK_DASH_JUMP_ZX',raw.EVENT_PROCESS_TIME0,{capture:unit===101})){}
  else if(ended&&has(0))request('ESSI_DASH_JUMP_COMBO_Z2');
 }else if(n==='ESSI_DASH_JUMP_COMBO_Z2'){
  if(input.pressed.has('Z'))flag(0,true);
  if(ground)request('RSI_DASH_JUMP_LANDING');
  else if(buffer(1,'Z','ESSI_ETK_DASH_JUMP_ZZZ',raw.EVENT_PROCESS_TIME0,{capture:unit===112})){}
  else if(ended&&has(0))request(unit===100?'ESSI_ESK_DASH_JUMP_ZZZ':'ESSI_DASH_JUMP_COMBO_Z3');
 }else if(n==='ESSI_DASH_JUMP_COMBO_Z3'){
  // Original5fd0 is projected through accepted contacts in this Web actor;
  // there is no original heap-instance producer in the retained evidence.
  if(ground)request(Object.keys(a.hits??{}).length?'ESSI_DASH_JUMP_COMBO_Z3_LANDING':'RSI_DASH_JUMP_LANDING');
 }else if(n==='ESSI_DASH_JUMP_COMBO_X1'){
  if(input.pressed.has('X'))a.sourceCommandFlags=((a.sourceCommandFlags??0)&~7)|1;
  else if(input.pressed.has('Z')&&unit===101)a.sourceCommandFlags=((a.sourceCommandFlags??0)&~7)|4;
  if(ground)request('RSI_DASH_JUMP_LANDING');
  else if(ended){if(has(0))request('ESSI_DASH_JUMP_COMBO_X2');else if(has(2))request('ESSI_ERS_DASH_JUMP_XZ');}
 }else if(n==='ESSI_DASH_JUMP_COMBO_X2'){
  if(ground)request('ESSI_DASH_JUMP_COMBO_X2_LANDING');
 }else if(n==='ESSI_DASH_JUMP_COMBO_Z3_LANDING'){
  if(!ground)offLine();else if(dash()){}
  else if(t>f((d.clip.durationSeconds-Math.max(d.clip.durationSeconds/10,.03))/6)){
   if(input.pressed.has('Z'))request('RSI_COMBO_Z');else if(input.pressed.has('X'))request('RSI_COMBO_X');
   else if(any(['LEFT','RIGHT']))request('RSI_WALK');else if(input.held.has('UP'))request('RSI_JUMP_READY');
   else if(input.pressed.has('DOWN')&&sim.dropPlatform(a)){}else if(ended)request('RSI_WAIT');
  }
 }else if(n==='RSI_OVER_TAKER_DASH_COMBO_ZX'){
  if(ended)finish('RSI_WAIT',true);else cascade('SABWDT');
 }else if(n==='ESSI_DESTRUCTION_RAGE'){
  // Supported PvP actors have no mounted entity, so typed1cc's riding branch
  // and its states71/74 are outside the actor types represented here.
  if(!ground)offLine();else if(ended)request('RSI_WAIT');
 }else if(['ESSI_JUMP_ATTACK_X','ESSI_JUMP_ATTACK_Z'].includes(n)){
  if(ground){if(has(0))a.canNotJumpTime=f(.2);request('RSI_JUMP_LANDING');}
 }else if(n==='ESSI_SI_P_ESK_AUTO_GUARD_END_SMALL'){
  if(ended||cascade('DBWS',{directionGround:false,skillGround:false})){if(ended)request('RSI_WAIT');a.canNotAttackTime=f(.1);}
 }else if(n==='RVC_DASH_COMBO_ZZ'){
  if(ended)request('RSI_WAIT');else if(!cascade('SABWDT')){
   if(!ground)offLine();else buffer(1,'Z','RVC_DASH_COMBO_ZZZ',{'1':0,'2':100,'3':.4300000071525574});
  }
 }else if(n==='RBM_COMBO_XZ'){
  if(ended)request('RSI_WAIT');else if(!cascade('SABWDT')){
   if(!ground)offLine();else buffer(0,'Z','RBM_COMBO_XZZ',{'1':0,'2':.6299999952316284,'3':.6299999952316284});
  }
 }else if(n==='RBM_COMBO_XZZ'){
  if(back)flag(0,false);
  if(ended)request('RSI_WAIT');else if(!cascade('SABWDT')&&!dash())buffer(0,'Z','RBM_COMBO_XZZZ',{'1':0,'2':.6600000262260437,'3':.6600000262260437});
 }else if(n==='RBM_COMBO_XZZZ'){
  if(ended)finish('RSI_JUMP_LANDING');
 }else if(n==='RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZ'){
  if(ground)request('RSI_DASH_JUMP_COMBO_ZZ_Landing');else buffer(0,'Z','RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ');
 }else if(n==='RSI_A_RWT_BARRAGE_ATTACK_STAND'){
  if(t>.9300000071525574&&any(['LEFT','RIGHT']))request('RSI_WALK');else cascade('SA');
  if(ended)finish();
 }else if(n==='RSI_A_RWT_BARRAGE_ATTACK_AIR'){
  if(ended){
   // Explicit existing user rule: Haze's finished airborne pose accepts air66,
   // fresh Z/X and airborne skills, and otherwise holds until landing. The
   // historical post owns this state, so it also owns the stopped pose flag.
   if(!ground)a.animationStopped=true;
   if(!ground&&sourcePostSkillDispatch(sim,a,input,null)){}
   else if(!ground&&dash()){}
   else if(!ground&&!(a.canNotAttackTime>0)&&input.pressed.has('Z'))request('RSI_JUMP_COMBO_Z');
   else if(!ground&&!(a.canNotAttackTime>0)&&input.pressed.has('X'))request('RSI_JUMP_COMBO_X');
   else if(ground)request('RSI_JUMP_LANDING');
  }
 }
 return true;
}

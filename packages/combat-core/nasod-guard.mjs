/** Original Nasod guard storage bridge. Target declarations and V5 consumers
 * are separately pinned; this is not an original-client measurement. */
export const NASOD_GUARD_SOURCE=Object.freeze({referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
  targetClientMeasured:false,gate:'GUUser:8487-8535',reaction:'GUUser:11396-11410',
  start:'GURaven:17058-17080',consume:'GURaven:14143-14193',timer:'GURaven:14500-14511',end:'GURaven:17109-17117'});
export const parryStates=new Set(['RSI_PARRYING','RSI_PARRYING_SMALL']);
const damageNames=['GROGGY','SMALL_FRONT','SMALL_BACK','BIG_FRONT','BIG_BACK','DOWN_FRONT','DOWN_BACK',
  'STANDUP_FRONT','STANDUP_BACK','AIR_SMALL','AIR_DOWN','AIR_DOWN_INVINCIBLE','AIR_DOWN_LANDING','AIR_FALL',
  'AIR_UP','AIR_FLY_FRONT','AIR_FLY_BACK','REVENGE','GRAPPLED_FRONT'];
const stateIds=new Map(damageNames.map((name,i)=>['RSI_DAMAGE_'+name,100+i]));
for(const [name,id]of Object.entries({RSI_JUMP_UP:1,RSI_JUMP_DOWN:2,RSI_DASH_JUMP:3,
  RSI_COMBO_ZZZX:200,RBM_COMBO_ZZZXZ:201,RBM_COMBO_ZZZX_EXPLOSION:202}))stateIds.set(name,id);
export function nasodSnapshot(actor,{footOnLineNow=false,attackerFrontFuture=false,damage={},elapsed=0,random=1}={}){
  const core=actor.core,extra=damage.BEHAVIOR?.EXTRA_DAMAGE?.EXTRA_DAMAGE_TYPE;
  // Original target2016 EXTRA_DAMAGE_TYPE enum. Only these four are excluded.
  const extraType=[16,26,34,47].indexOf(extra)+1;
  const damageFlags=(damage.NO_DAMAGE?1:0)|(damage.HP_PERCENT_UP>0?2:0)|(damage.INCREASE_MP>0?4:0)|
    (damage.REACT_TYPE===7?8:0)|(damage.REACT_TYPE===10?16:0)|(damage.HIT_TYPE===26||damage.GROUND_HIT?32:0);
  return {stateId:stateIds.get(actor.state)??0,footOnLineNow,attackerFrontFuture,hyperRemaining:actor.awakening.remaining,
    level:core.level,gauge:core.gauge,parrying:core.parrying===true,canParry:core.canParry===true,
    guardRemaining:core.guardRemaining,attacking:core.phase==='attack',superArmor:actor.superArmor===true,
    held:actor.held===true,grappled:actor.grappled===true,riding:actor.riding===true,
    elapsed,helperLive:core.helperLive===true,right:actor.facing>0,random,damageFlags,extraType};
}
export function evaluateNasod(native,kind,s){
  if(native)return native.evaluate(kind,s);
  // Compatibility for existing headless tools without the optional module.
  // The application must pass nativeNasod; this branch is explicitly a JS candidate.
  const stateEligible=s.footOnLineNow&&![1,2,3,200,201,202].includes(s.stateId)&&!(s.stateId>=100&&s.stateId<=118);
  const out={...s,stateEligible,guarded:false,helper:{scale:0,guardAnimation:false,offset:[0,0,0],outlineColor:[0,0,0,1]},
    delayedAttack:s.attacking,delayAttackTime:0,attackTime:0,smallCharacterAnimation:false,soundCalls:0,restored:false,
    evidenceClass:'js-reference-candidate'};
  if(kind==='guard')out.guarded=!s.extraType&&!s.damageFlags&&!s.held&&!s.grappled&&!s.riding&&!s.attacking&&
    (stateEligible||s.parrying)&&s.hyperRemaining>0&&(s.level>0||s.canParry)&&!s.superArmor&&s.attackerFrontFuture&&s.footOnLineNow;
  else if(kind==='start'){
    out.parrying=true;out.canParry=true;out.guardRemaining=Math.fround(.5);out.attacking=false;out.delayedAttack=false;
    out.smallCharacterAnimation=s.random%2===0;
    if(s.helperLive){out.gauge=Math.max(0,Math.fround(s.gauge-20));out.level=Math.max(0,s.level-1);
      out.helper={scale:Math.fround(1.3),guardAnimation:true,offset:[s.right?100:-100,170,0],outlineColor:[Math.fround(.968),Math.fround(.443),0,1]};out.soundCalls=1;}
  }else if(kind==='timer'&&s.guardRemaining>0){out.guardRemaining=Math.fround(Math.fround(s.guardRemaining)-Math.fround(s.elapsed));
    if(out.guardRemaining<0){out.guardRemaining=0;out.canParry=false;}}
  else if(kind==='end'){out.parrying=false;out.canParry=false;out.guardRemaining=0;out.restored=true;}
  return out;
}
export function applyNasodResult(actor,result){const c=actor.core;
  for(const key of ['parrying','canParry','guardRemaining','gauge','level'])c[key]=result[key];
  if(result.helper.guardAnimation){c.helper={scale:result.helper.scale,outlineColor:[...result.helper.outlineColor],
    attackTime:[0,0],source:NASOD_GUARD_SOURCE.consume};[c.x,c.y,c.z]=result.helper.offset.map((n,i)=>n+[actor.x,actor.y,actor.z][i]);}
}
export function restoreNasodHelper(actor){const c=actor.core;c.helperLive=c.level>0;
  c.helper={scale:Math.fround([0,1,1.3,1.6,1.9,2.2][c.level]),outlineColor:[1,Math.fround(.333),Math.fround(.0745),1],attackTime:[0,0],
    source:'GURaven:14195-14255'};c.phase=c.level?'idle':'absent';c.animationName='Wait';c.animationTime=0;c.phaseTime=0;}

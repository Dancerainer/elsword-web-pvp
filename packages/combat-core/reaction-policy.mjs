/** Literal fixed-V5 reaction policy candidates, separate from 2016 raw fields.
 * Sources and unresolved macro gates: contracts/rf-reaction-source.json.
 * These pure functions neither claim a measured 2016 baseline nor choose clocks.
 */
export const REACTION_REFERENCE = Object.freeze({
  commit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
  evidence:'reference-v5; target2016 runtime unmeasured',
  maxForceDown:100, decayWaitSeconds:2, decayPerSecond:10,
  deathAnimationSpeed:.5, deathAlphaPerSecond:1.5,
  standupInvincibleSeconds:.3, airSmallAddedYSpeed:700,
  airSmallWalkSpeedFactor:.33, downInputAfterAnimationSeconds:.66,
});

const finite=(x,name)=>{if(!Number.isFinite(x))throw new TypeError(`${name} must be finite`);return x;};
const nonnegative=(x,name)=>{finite(x,name);if(x<0)throw new RangeError(`${name} must be nonnegative`);return x;};
const gaugeClamp=(x,max)=>Math.min(max,Math.max(0,x));
const side=(front)=>front?'FRONT':'BACK';
const launchTypes=new Set([4,5,15,16]); // Target2016 Enum.lua, not inferred ordinal values.
const flushStates=new Set(['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_DOWN_INVINCIBLE']);

/** X2GameUnit.cpp:7214-7237 IsDamagedReaction, using target Enum.lua ordinals.
 * Reference macro branches stay explicit: NEW_SKILL_2010_11 excludes REFLECT;
 * SERV_ADD_CHUNG_SHELLING_GUARDIAN excludes CREATE_DAMAGE_EFFECT. This predicate
 * does not apply the separate !NO_DAMAGE reserve gate or Raven parry return.
 */
export function isDamagedReaction(data,{reflectExcluded=true,createDamageEffectExcluded=true}={}){
  if(data==null)return false;
  const type=data.REACT_TYPE??0;
  if(type===0||type===6||type===10||type===14)return false;
  if(reflectExcluded&&type===17)return false;
  if(createDamageEffectExcluded&&type===11)return false;
  return true;
}

/** GUUser:8923-8936 overwrites fStopTime and clears fStop2Time. Zero is
 * meaningful: a real hit releases StopOtherUnit's older skill freeze. The
 * CREATE_DAMAGE/EFFECT_SET early return (7930-7942) only writes positive stops.
 * These are fixed-V5 macro candidates, not target2016 runtime observations.
 */
export function defenderHitStopOverride(data,{superArmor=false,noDamageExcluded=true}={}){
  const type=data.REACT_TYPE??0,stopTime=data.STOP_TIME_DEF??0;
  if(superArmor||type===7||noDamageExcluded&&type===0)return null;
  if((type===11||type===12)&&stopTime<=0)return null;
  return {stopTime:nonnegative(stopTime,'STOP_TIME_DEF'),stop2Time:0};
}

/** GUUser AttackResult:12250,12621 and CEffect AttackResult:3672,4006-4427.
 * Limit the recovered owner path to ordinary supported hits. Core/manual
 * callbacks and recovery/buff effect early returns need separate consumers.
 */
export function attackerHitStopExcluded(data,{kind='character'}={}){
  const type=data.REACT_TYPE??0;
  return (kind==='character'||kind==='fixture')&&[0,10].includes(type)
    || kind==='effect'&&(type===0||(data.INCREASE_MP??0)>0||data.DAMAGE_TYPE===6);
}
export function attackerHitStopOverride(data,{kind='character'}={}){
  const type=data.REACT_TYPE??0;
  if(attackerHitStopExcluded(data,{kind}))return null;
  if(![1,2,3,4,5,7].includes(type)||!['character','fixture','effect'].includes(kind))return null;
  // Preserve the host's existing ATK alias fallback. The pinned loader's ATK
  // override is dated 2026-08-11 and cannot establish target2016 precedence.
  return {stopTime:nonnegative(data.STOP_TIME_ATT??data.STOP_TIME_ATK??0,'STOP_TIME_ATT')};
}

export function createKnockdownGauge(max=REACTION_REFERENCE.maxForceDown){
  nonnegative(max,'max');
  return {now:0,max,pending:null,addedThisState:false,lastDamageSeconds:0,activated:false};
}

/** SERV_SKILL_NOTE subtraction and ENCHANT_BALANCE_101014 penetrate branch.
 * Caller explicitly selects candidate macro behavior; RF does not apply Elesis's
 * AdvancedKnightMastery victim modifier. Attack passives modify raw value first.
 */
export function forceDownContribution(data,{skillNote=true,penetratePatch=true,penetrating=false}={}){
  let value=finite(data.FORCE_DOWN??0,'FORCE_DOWN');
  if(skillNote)value-=finite(data.DECREASE_FORCE_DOWN??0,'DECREASE_FORCE_DOWN');
  if(skillNote&&penetratePatch&&penetrating)value=value<0?value-10:-10;
  return value;
}

/** BALANCE_PATCH_20110303 AddForceDownDelay: reserve, never flush here.
 * Literal sentinel -9999 is represented by null. After commit the latch remains
 * set, but the next batch still accepts values via max(sentinel,value).
 */
export function reserveKnockdown(gauge,value,{pvp=true}={}){
  finite(value,'value');
  if(!pvp)return {...gauge};
  return {...gauge,pending:gauge.addedThisState?Math.max(gauge.pending??-9999,value):value,addedThisState:true};
}

/** CommonStateStartFuture resets the latch only while a reserve exists. */
export function knockdownStateStarted(gauge){
  return {...gauge,addedThisState:gauge.pending!==null?false:gauge.addedThisState};
}

/** OnFrameMove's frame-end accumulation. Check hit reactions before calling. */
export function commitKnockdown(gauge,{pvp=true}={}){
  const reserved=gauge.pending!==null&&gauge.pending>-9999;
  return {...gauge,now:pvp&&reserved?gaugeClamp(gauge.now+gauge.pending,gauge.max):gauge.now,
    lastDamageSeconds:pvp&&reserved?0:gauge.lastDamageSeconds,pending:null};
}

/** CommonFrameMoveFuture increments time first, then subtracts the full dt once
 * timer >=2. The threshold-crossing step is not fractionally prorated. */
export function advanceKnockdown(gauge,dt){
  nonnegative(dt,'dt');
  const lastDamageSeconds=gauge.lastDamageSeconds+dt;
  return {...gauge,lastDamageSeconds,now:lastDamageSeconds>=REACTION_REFERENCE.decayWaitSeconds
    ?gaugeClamp(gauge.now-REACTION_REFERENCE.decayPerSecond*dt,gauge.max):gauge.now};
}

/** FlushForceDown's FIX_FORCE_DOWN_AND_DETONATION_BUG option is explicit.
 * Caller must also apply IsDamagedReaction and detonation-before-KD precedence.
 */
export function requestKnockdown(gauge,{deferred=true}={}){
  if(gauge.now<gauge.max)return {gauge:{...gauge},triggered:false};
  return {gauge:{...gauge,now:deferred?gauge.now:0,activated:deferred},triggered:true};
}
export function consumeKnockdown(gauge,state){
  if(!gauge.activated||!flushStates.has(state))return {gauge:{...gauge},consumed:false};
  return {gauge:{...gauge,now:0,activated:false},consumed:true};
}
/** DamageToUser's successful attacker resets its own gauge, not the victim's. */
export function resetAttackerKnockdown(gauge){return {...gauge,now:0};}

export function nextFlyCount(previous,data,{invincible=false,superArmor=false}={}){
  nonnegative(previous,'previous');
  if(data.FORCE_FLY||invincible||superArmor)return 0;
  return previous+(launchTypes.has(data.REACT_TYPE??0)?1:0);
}

/** Back speed remains in the actor's native local axis. Convert to world using
 * the actor's facing and actual lane basis, rather than the owner's world x.
 */
export function reactionLocalBackSpeed(data,fromFront,{isRight=true,wallBackSpeed=false,forceDirectionFly=0}={}){
  const speed=finite(data.BACK_SPEED_X??0,'BACK_SPEED_X');
  if(wallBackSpeed)return isRight?-speed:speed;
  // Force direction is an opt-in reference extension: its Lua read was added
  // to the pinned repository in 2026; never infer support from a target field.
  if(forceDirectionFly===2)return speed;
  if(forceDirectionFly===1)return -speed;
  return fromFront?-speed:speed;
}

/** Unit/mesh/manual/effect hit origins differ in native DamageReact. Supply the
 * actual attacker mesh or collision-start position for effect/manual damage.
 * dirVector is native lane direction without the isRight flip.
 */
export function attackerIsFront(defenderPosition,attackerPosition,dirVector,isRight=true,{arrangedFly=false,damageDirectionRight}={}){
  // Fixed V5 GUUser:7839-7876/8050-8066 overrides the position test for
  // ARRANGED_FLY. AT_EFFECT uses the effect's saved FollowLineRight, rather
  // than the owner's current facing or the impact point after passing a body.
  if(arrangedFly){
    if(typeof damageDirectionRight!=='boolean')throw new TypeError('ARRANGED_FLY requires an explicit native damage direction');
    return damageDirectionRight!==isRight;
  }
  const dot=dirVector.reduce((sum,v,i)=>sum+v*(attackerPosition[i]-defenderPosition[i]),0);
  const front=dot>=0;
  return isRight?front:!front;
}

export function selectHitReaction(data,{
  grounded=false,fromFront=true,superArmor=false,flyCount=0,
  heightAboveLand=Infinity,attackerUnitHeightAboveLand=Infinity,
  lineRadius=30,walkSpeed=0,localVx=0,vy=0,
}={}){
  const type=data.REACT_TYPE??0;
  const result={supported:true,state:null,localVx,vy,grounded};
  if(superArmor||type===0||type===7)return result;
  result.localVx=reactionLocalBackSpeed(data,fromFront);
  const backY=finite(data.BACK_SPEED_Y??0,'BACK_SPEED_Y');
  if(type===1||type===2){
    if(heightAboveLand<lineRadius*5||attackerUnitHeightAboveLand<lineRadius*3){
      result.state=`RSI_DAMAGE_${type===1?'SMALL':'BIG'}_${side(fromFront)}`;
      result.vy=Math.min(0,vy); // Native does not assign BACK_SPEED_Y near ground.
    }else{
      result.state='RSI_DAMAGE_AIR_SMALL';result.vy=backY;
    }
  }else if(type===3){
    result.state=grounded?`RSI_DAMAGE_DOWN_${side(fromFront)}`:'RSI_DAMAGE_AIR_DOWN';
    result.vy=grounded?Math.min(0,vy):backY;
    result.holdState='RSI_DAMAGE_AIR_FALL';
  }else if(type===4||type===5){
    // Project V53 rule: keep the authored launch speed for every
    // UP/FLY hit. The source counter remains for identity/reset semantics;
    // its third-and-later height division is deliberately disabled.
    result.vy=backY;result.grounded=false;
    result.state=type===4?'RSI_DAMAGE_AIR_UP':`RSI_DAMAGE_AIR_FLY_${side(fromFront)}`;
  }else if(type===16){
    // GUUser11799–11830 RT_DRAG_UP explicitly uses AIR_FLY and the full
    // authored Y speed. Its accumulated fly count never divides that speed.
    result.vy=backY;result.grounded=false;result.state=`RSI_DAMAGE_AIR_FLY_${side(fromFront)}`;
  }else return {...result,supported:false,unsupportedType:type,state:null};
  return result;
}

/** Separate native StateStartFuture: it also runs when an ordinary Small/Big
 * reaction leaves its support. Applying it only inside DamageReact misses that
 * transition, while applying it in both places launches the victim twice.
 */
export function airSmallStartFuture({localVx,vy,fromFront=true,walkSpeed=0}){
  return {localVx:Math.fround(Math.fround(finite(localVx,'localVx'))+(fromFront?-1:1)*Math.fround(Math.fround(finite(walkSpeed,'walkSpeed'))*Math.fround(.33))),
    vy:Math.fround(Math.fround(finite(vy,'vy'))+REACTION_REFERENCE.airSmallAddedYSpeed)};
}

/** Four literal Raven EventProcess callbacks (6926..7049). The original uses
 * the saved landPosition, not any line having the same screen-space X.
 */
export function groundHitReactionNext(state,{heightAboveLand,grounded,animationEnded=false,animationTime=0,skipPressed=false}){
  if(!['RSI_DAMAGE_SMALL_FRONT','RSI_DAMAGE_SMALL_BACK','RSI_DAMAGE_BIG_FRONT','RSI_DAMAGE_BIG_BACK'].includes(state))return null;
  if(heightAboveLand>200)return {state:'RSI_DAMAGE_AIR_SMALL',offsetY:-45};
  if(state==='RSI_DAMAGE_BIG_FRONT'&&skipPressed)return animationTime>.93?{state:'RSI_WAIT',offsetY:0}:null;
  if(animationEnded)return grounded?{state:'RSI_WAIT',offsetY:0}:{state:'RSI_DAMAGE_AIR_SMALL',offsetY:-45};
  return null;
}

export function knockdownThresholdReaction({grounded,fromFront=true,vy=0}){
  return {state:grounded?`RSI_DAMAGE_DOWN_${side(fromFront)}`:'RSI_DAMAGE_AIR_DOWN_INVINCIBLE',
    vy:grounded?vy:0};
}

/** Native airborne state events, retaining the original UP/FALL zero boundary. */
export function airborneReactionNext(state,{grounded,vy,held=false,grappled=false}){
  if(state==='RSI_DAMAGE_AIR_SMALL')return grounded?'RSI_JUMP_LANDING':null;
  if(state==='RSI_DAMAGE_AIR_DOWN'||state==='RSI_DAMAGE_AIR_DOWN_INVINCIBLE')return grounded?'RSI_DAMAGE_AIR_DOWN_LANDING':null;
  if(state==='RSI_DAMAGE_AIR_UP')return vy<0?'RSI_DAMAGE_AIR_FALL':grounded?'RSI_DAMAGE_AIR_DOWN_LANDING':null;
  if(state==='RSI_DAMAGE_AIR_FALL')return vy>0?'RSI_DAMAGE_AIR_UP':grounded?'RSI_DAMAGE_AIR_DOWN_LANDING':null;
  if(state==='RSI_DAMAGE_AIR_FLY_FRONT'||state==='RSI_DAMAGE_AIR_FLY_BACK')return grounded&&!held&&!grappled?'RSI_DAMAGE_DOWN_FRONT':null;
  return null;
}

export function deathState({hp,grounded,fromFront=true}){
  return hp<=0&&grounded?`RSI_DIE_${side(fromFront)}`:null;
}
export function createDeathPresentation(){return {alpha:1,visible:true,phase:'animation'};}
/** Caller supplies native end decision; this does not guess clip end/blending.
 * Native tests the prior alpha before decrement, then hides on a later step. */
export function advanceDeathPresentation(current,dt,{animationEnded}){
  nonnegative(dt,'dt');
  if(!animationEnded)return {...current};
  if(current.alpha>0)return {...current,alpha:current.alpha-REACTION_REFERENCE.deathAlphaPerSecond*dt,phase:'fade'};
  return {...current,visible:false,phase:'complete'};
}

/** Source ProcessCanPushUnit's non-optimized geometry. Direction is native lane
 * basis; CAN_PASS/PUSH filtering and high-speed margin caps stay caller-owned.
 */
export function nativeBodyOverlap(a,b){
  const yOverlap=b.position[1]>=a.position[1]&&b.position[1]<=a.position[1]+a.height
    ||b.position[1]+b.height>=a.position[1]&&b.position[1]+b.height<=a.position[1]+a.height
    ||b.position[1]<=a.position[1]&&b.position[1]+b.height>=a.position[1]+a.height;
  const distance=Math.hypot(b.position[0]-a.position[0],b.position[2]-a.position[2]);
  const radius=(a.width+b.width)*.5;
  return {overlaps:yOverlap&&distance<radius,verticalOverlap:yOverlap,distance,radius,penetration:yOverlap?Math.max(0,radius-distance):0};
}
export function nativeBodyPushCandidate(a,b,{direction,position=a.position,marginMax=Infinity}={}){
  const overlap=nativeBodyOverlap({...a,position},b);
  if(!overlap.overlaps)return [...position];
  const toward=direction[0]*(b.position[0]-a.position[0])+direction[2]*(b.position[2]-a.position[2]);
  const margin=Math.min(overlap.penetration,marginMax)*(toward>=0?-1:1);
  return [position[0]+direction[0]*margin,position[1],position[2]+direction[2]*margin];
}

/** Literal CheckPassUnit horizontal side-crossing plus Y path test. The source
 * uses a full 3D normalized movement multiplied by a horizontal projected
 * distance; retain that expression, do not replace it with x-interpolation.
 * b.backupPosition is the other's frame backup, not its future position.
 */
export function nativeBodyPassBlocked(a,b,{position,backupPosition=b.position}={}){
  const original=a.position;
  if(position.every((v,i)=>v===original[i]))return false;
  const futureToOther=[b.position[0]-position[0],b.position[2]-position[2]];
  const oldToBackup=[backupPosition[0]-original[0],backupPosition[2]-original[2]];
  if(futureToOther[0]*oldToBackup[0]+futureToOther[1]*oldToBackup[1]>0)return false;
  const oldToOther=[b.position[0]-original[0],b.position[2]-original[2]];
  if(futureToOther[0]*oldToOther[0]+futureToOther[1]*oldToOther[1]>=0)return false;
  const objectDistanceSq=oldToOther[0]**2+oldToOther[1]**2;
  const move=position.map((v,i)=>v-original[i]);
  if(move[0]**2+move[2]**2<objectDistanceSq)return false;
  const length=Math.hypot(...move);
  if(length===0)return false;
  const collisionY=original[1]+move[1]/length*Math.sqrt(objectDistanceSq);
  const firstInside=collisionY>=b.position[1]&&collisionY<=b.position[1]+b.height;
  const secondInside=collisionY+a.height>=b.position[1]&&collisionY+a.height<=b.position[1]+b.height;
  return firstInside||secondInside;
}

/** Fixed-V5 black-hole USER consumer, JS host adaptation; no target-client gold.
 * Source: X2DamageEffect.cpp2608–2773/6657–6675, X2GUUser.cpp20366–20448,
 * GameUnit.h2711–2717. Enabled target2016 declarations are registered below.
 */
import {isAddBlackHole} from './add-black-hole-v45.mjs';
export const ION_BLACK_HOLE_NAME='DamageEffect_ROT_NUCLEAR_NEW_Missile_BLACK_HOLE';
const supported=effect=>effect.skillId===24007&&effect.name===ION_BLACK_HOLE_NAME
  ||effect.skillId===21010&&effect.name==='ELSWORD_WIND_MILL'
  ||effect.skillId===21024&&effect.name==='ELSWORD_MAELSTROM'
  ||effect.skillId===21021&&effect.name==='ELSWORD_FINALSTRIKE_BLACKHOLE'
  ||!effect.skillId&&effect.name==='RBM_BLACKHOLE'
  ||effect.skillId===28021&&effect.name==='DamageEffect_SA_SDK_BURNING_PHANTOM_LOOP'
  ||effect.skillId===24604&&effect.name==='DAMAGE_EFFECT_RSI_HA_RBM_EXTREM_BLADE_DAMAGE'
  ||isAddBlackHole(effect);
const downStates=new Set(['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_DOWN_LANDING']);
const f=Math.fround;
const flag=v=>v===true||v===1;
const zero=v=>v.every(n=>n===0);

export function hasEffectiveBlackHole(actor){return (actor.effectiveBlackHoleIds?.length??0)>0;}

/** Defaults are LoadBlackHoleData's defaults, not BlackHoleData's constructor. */
export function loadBlackHoleData(raw){
  if(!raw)return null;
  const speed=f(raw.DRAGGING_SPEED??1),range=f(raw.DRAGGING_RANGE??1);
  if(!Number.isFinite(speed)||!Number.isFinite(range)||range<=0)return null;
  return {speed,range,onlyHit:flag(raw.DRAG_ONLY_HITTED_UNIT??false),canPass:flag(raw.CAN_PASS_UNIT??false)};
}

export function updateIonBlackHole(effect,owner,actors,dt){
  if(!supported(effect)||!effect.active||effect.dead||!owner)return false;
  const data=loadBlackHoleData(effect.damage?.BLACKHOLE_DATA);
  const center=(effect.currentAnchor??effect.birthAnchor)?.position;
  if(!data||!center)return false; // No invented actor/bone fallback for GetPos.
  for(const actor of actors){
    if(actor.team===owner.team||actor.hp<=0)continue;
    if(data.onlyHit&&!actor.effectiveBlackHoleIds?.includes(effect.id)&&!Object.hasOwn(effect.hits??{},actor.id))continue;
    if(downStates.has(actor.state))continue;
    // D3DXVECTOR3 and scalar operations are float32. GetPos(true) is feet,
    // not the body hit-sphere centre; there is no invincible/armor exclusion.
    const delta=center.map((n,i)=>f(f(n)-f([actor.x,actor.y,actor.z][i])));
    const distance=f(Math.sqrt(f(f(f(delta[0]*delta[0])+f(delta[1]*delta[1]))+f(delta[2]*delta[2]))));
    if(distance>data.range){removeBlackHoleIdentity(actor,effect.id);continue;}
    const factor=f(Math.min(1,f(1.5-f(distance/data.range))));
    const speed=f(factor*data.speed),elapsed=f(dt);
    // SetDisplaceUnitPosition ASSIGNS; stopped users retain only the latest
    // effect update, and overlapping effects use their existing update order.
    actor.blackHoleDisplacement=delta.map(n=>distance===0?0:f(f(f(n/distance)*speed)*elapsed));
    if(data.canPass)actor.sourceBlackHoleCanPass=true;
    actor.effectiveBlackHoleIds??=[];
    if(!actor.effectiveBlackHoleIds.includes(effect.id))actor.effectiveBlackHoleIds.push(effect.id);
  }
  return true;
}

function removeBlackHoleIdentity(actor,id){
  if(actor.effectiveBlackHoleIds)actor.effectiveBlackHoleIds=actor.effectiveBlackHoleIds.filter(v=>v!==id);
}

/** Destructor revokes identities; it does NOT erase the queued last packet. */
export function retireIonBlackHole(effect,actors){
  if(!supported(effect))return;
  for(const actor of actors)removeBlackHoleIdentity(actor,effect.id);
}

/** Called only in a live actor physics packet, after unit push/pass. Future
 * support is reset before its line queries. Y translation stays with physics.
 */
export function consumeBlackHoleDisplacement(actor,raw){
  const vector=actor.blackHoleDisplacement??[0,0,0];
  const pending=!zero(vector);
  if(!pending)return {pending:false,apply:false,vector:[0,0,0]};
  actor.blackHoleDisplacement=[0,0,0];
  const apply=!actor.hidden&&actor.hp>0;
  if(apply){
    actor.grounded=false;actor.lineId=null;
    const distSq=f(f(f(vector[0]*vector[0])+f(vector[1]*vector[1]))+f(vector[2]*vector[2]));
    // ARA_CHARACTER_BASE + SKILL_BALANCE_PATCH + adaptive-frame macro enabled
    // (KTDX.h:342): restore m_bFutureCanPassUnit. The acquired V5 initializes
    // and resets this cache to false (780/1769), with no later writes found.
    // Do not substitute raw CAN_PASS_UNIT; a matching 2016 cache is unavailable.
    if(distSq<=81)actor.sourceBlackHoleCanPass=false;
  }
  return {pending,apply,vector:apply?[...vector]:[0,0,0]};
}

/** Literal CrossedWall loop uses existing compiled original LineToLine, radius
 * 1. No 2D wall, map envelope or guessed collision primitive is substituted.
 */
export function correctBlackHoleWall(actor,oldPosition,map,geometry){
  const walls=map.lines.filter(line=>{
    const declared=line.type??line.nativeFields?.LINE_TYPE?.symbol;
    const type=typeof declared==='string'?declared.split('.').pop():declared;
    const enabled=line.nativeFields?.ENABLE??line.ENABLE??true;
    return (type==='LT_WALL'||type===1)&&flag(enabled);
  });
  if(!walls.length)return {supported:true,blocked:false};
  if(!geometry?.lineCollision)return {supported:false,blocked:false};
  for(const line of walls)if(geometry.lineCollision({aStart:oldPosition,aEnd:[actor.x,actor.y,actor.z],
    bStart:line.start,bEnd:line.end,radius:1}).hit){
    actor.x=oldPosition[0];actor.z=oldPosition[2];
    return {supported:true,blocked:true};
  }
  return {supported:true,blocked:false};
}

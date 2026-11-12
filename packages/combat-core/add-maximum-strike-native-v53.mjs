/** Bounded 2016 static consumers, ported from the frozen static analysis instruction audit.
 * No client combat was measured. Target anchor lookup and renderer orientation
 * still use the host adapters documented in the source contract. */
import {orientLiteralMesh} from './shadow-mesh.mjs';
import {nearestLockOnPoint} from './archenemy-mesh.mjs';
import {rotateNative} from '../effect-runtime/index.mjs';
const SHOT='DamageEffect_ATT_Maximum_Strike_Bullet_Attack',f=Math.fround;
const RAD=f(0.01745329238474369),DEG=f(57.2957763671875);
const normalize=v=>{const n=Math.hypot(...v);return n>0?v.map(x=>f(x/n)):[0,0,0];};
export const isMaximumStrikeShot=e=>e?.name===SHOT&&e.skillId===29022;

/** 0x31eebdf0: normalize both inputs, interpolate without a final normalize.
 * C*delta is not clamped. The stored degree-vector is not Euler rotation. */
export function maximumStrikeVector({position,manualDirDegree,targetPosition,curveSpeed,dt}){
 const target=normalize(targetPosition.map((n,i)=>f(n-position[i])));
 const old=normalize(manualDirDegree.map(n=>f(n*RAD))),factor=f(curveSpeed*dt);
 return old.map((n,i)=>f(f(n+f(f(target[i]-n)*factor))*DEG));
}

/** LOT8 keeps a held target through invincibility. A rejected contact does not
 * increment the event counter or create an explosion. There is no circle or
 * collision-radius snap in the recovered consumer. Ordinary hit acceptance is
 * owned by checkHits; an accepted event clears steering and keeps flight. */
export function advanceMaximumStrikeLockOn(sim,e,a,dt){
 if(!isMaximumStrikeShot(e))return false;
 delete e.sourceAddMaximumStrikeOrbit; // Retire older Web-only circle packets.
 if(!(dt>0)||!e.sourceShadowMesh||!e.sourceAddLockOn)return true;
 const s=e.sourceAddLockOn,b=sim.state.actors.find(b=>b.id===s.targetId&&b.team!==a.team&&b.hp>0&&!b.pvpDead&&!b.pvpDisconnected);
 if(!b){delete e.sourceAddLockOn;return true;}
 const raw=e.damage.LOCK_ON_DATA;
 if(raw?.LOCK_ON_TYPE!==8||!Number.isFinite(raw.CURVE_SPEED))throw TypeError('Missing original Maximum Strike LOT8 declaration');
 const rotation=e.currentAnchor?.rotation??e.birthAnchor?.rotation??[0,a.facing<0?180:0,0];
 if(!s.useManualDir)s.manualDirDegree=rotateNative([1,0,0],rotation).map(n=>f(n*DEG));
 // Native +330 supports named-bone/position fallback; the exact target bone
 // caller remains unresolved. Keep the existing current-body host lookup and
 // identify that boundary instead of fabricating a recovered bone constant.
 const point=nearestLockOnPoint(sim.defenderSampler?.(b,{profile:sim.profileFor(b),role:'defender'}),[a.x,a.y,a.z],[b.x,b.y,b.z]);
 s.manualDirDegree=maximumStrikeVector({position:e.sourceShadowMesh.position,manualDirDegree:s.manualDirDegree,
  targetPosition:point,curveSpeed:raw.CURVE_SPEED,dt});s.useManualDir=true;
 orientLiteralMesh(e.sourceShadowMesh,s.manualDirDegree.map(n=>f(n*RAD)));
 return true;
}

/** 0x31c74350 plus 0x31f04350: attack first, then at most one NEXT table.
 * The extra large-delta clause is present in the original instruction audit. */
export function maximumStrikeNextStage(raw,stage,{beforeGlobal,afterGlobal,dt}){
 const next=stage+1,key=next===1?'DAMAGE_DATA_NEXT':`DAMAGE_DATA_NEXT${next}`;
 const threshold=raw?.DAMAGE_DATA_CHANGE_TIME_GLOBAL_TIME?.[next];
 if(!raw?.[key]||!Number.isFinite(threshold))return stage;
 const t=f(threshold),before=f(beforeGlobal),after=f(afterGlobal),delta=f(dt);
 return before<=t&&t<after||t>=0&&delta>t&&f(before-delta)<=t?next:stage;
}

/** Original LOT8 clears its target after an accepted event and applies a
 * 99999-second reselection delay, longer than this .94-second mesh lifetime.
 * With no steering producer left, the current movement basis carries the shot
 * straight through subsequent targets. V56 retires the V53 product termination. */
export function maximumStrikeHitCompleted(e){
 if(!isMaximumStrikeShot(e)||e.dead)return false;
 delete e.sourceAddLockOn;delete e.sourceAddMaximumStrikeOrbit;
 return true;
}

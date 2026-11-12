import {changeAddDp} from './add-systems.mjs';
export const ADD_PULSE_PROJECTILE='DamageEffect_SA_APT_Pulse_Cannon_Projectile';
/** Original32765b30 keeps the last remaining item until the last selection.
 * The host provides an actual CRT-sized sample; its seed remains Web policy. */
export function addPulseOrder2016(randomWord){
 const pool=[1,2,3,4,5,6],order=[];
 while(pool.length){const n=pool.length;if(n===1){order.push(pool.pop());break;}const value=randomWord();if(!Number.isInteger(value)||value<0||value>32767)throw new TypeError('Pulse requires a CRT-sized random input');order.push(pool.splice(value%(n-1),1)[0]);}
 return order;
}
/** 32741130: MP equality is accepted; formed DP is strictly greater than
 * the second stack float. The adjacent default500 is not that argument. */
export function payAddPulseMaintenance2016(sim,a){
 if(!a.sourceAdd?.formation){if(!(a.mp>=25))return false;a.mp=Math.fround(a.mp-25);return true;}
 const amount=sim.addPulseMaintenanceInput?.(a,{completedLoops:a.sourceAddCombat?.pulseCount})?.dpArgument;
 if(!Number.isFinite(amount)){sim.note('pulse-maintenance-dp-input','Original formed extra-loop payer needs the actual local10 float; no nearby500, Memo400 or25MP substitute is used.',a);return false;}
 if(!(a.sourceAdd.dp>amount))return false;
 changeAddDp(a,-amount,{profile:sim.profileFor(a),emit:(...args)=>sim.emit?.(...args),reason:'pulse-extra-loop',skillUse:true});return true;
}
export function bindAddPulseFront2016(e,a,map){
 if(!e)return;
 const lineIndex=map?.lines?.findIndex(line=>line.lineId===a.lineId)??-1;
 e.sourceAddPulseFront={position:[a.x,a.y,a.z],positive:a.facing===1,lineIndex};
}
export function addPulseSteeringAllowed2016(sim,e,a,point){
 const raw=e.damage.LOCK_ON_DATA,limit=raw.LOCK_ON_RANGE_FROM_OWNER?.AT_PVP??9999;
 if(Math.hypot(point[0]-a.x,point[1]-a.y,point[2]-a.z)>limit)return false;
 const snapshot=e.sourceAddPulseFront;
 if(raw.ONLY_FRONT!==1)return true;
 if(!snapshot)throw new TypeError('Pulse steering requires its original owner snapshot');
 const line=sim.map?.lines?.[snapshot.lineIndex];if(!line)return true;
 const delta=point.map((n,i)=>n-snapshot.position[i]),path=line.end.map((n,i)=>n-line.start[i]);
 const divisor=Math.hypot(...delta)*Math.hypot(...path),dot=divisor?delta.reduce((n,v,i)=>n+v*path[i],0)/divisor:0;
 return (dot>0)===snapshot.positive;
}
export function validateAddPulseFront2016(e){
 const s=e.sourceAddPulseFront;if(s===undefined){if(e.name===ADD_PULSE_PROJECTILE&&e.sourceAddLot6)throw new TypeError('Missing Pulse front snapshot');return true;}
 if(e.name!==ADD_PULSE_PROJECTILE||!s||typeof s!=='object'||Object.keys(s).length!==3||!Array.isArray(s.position)||s.position.length!==3||!s.position.every(Number.isFinite)||typeof s.positive!=='boolean'||!Number.isSafeInteger(s.lineIndex)||s.lineIndex< -1)throw new TypeError('Invalid Pulse front snapshot');return true;
}

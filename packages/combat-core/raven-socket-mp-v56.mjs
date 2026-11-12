/** Original Raven61c ->31fa1220 resource tail ->31f34650. Socket signed
 * m_iMpChangeValue is separate from the unfrozen Gage MP_CHANGE_RATE. */
import {usesPvpEquipmentFormulas} from './equipment-attributes.mjs';
const f=Math.fround;
export function ravenSocketMpValue({current,max,rate,delta}){
 if(!Number.isFinite(current)||!Number.isFinite(max)||!Number.isFinite(delta)||delta<0||
  !Number.isInteger(rate)||rate<-2147483648||rate>2147483647)throw new TypeError('Invalid original signed socket MP input');
 if(!(max>current))return current;
 // x87 FILD(intRate), multiply original float delta, add protected current;
 // one final float store precedes the absolute setter. Negative is retained.
 const value=f(f(current)+rate*f(delta));return value<0?value:Math.min(value,max);
}
export function advanceRavenSocketMp(sim,a,delta){
 if(![106,107,115].includes(sim.profileFor(a).target.unitClass)||!usesPvpEquipmentFormulas(a)||a.deathComplete||
  sim.networkOwnerId!==null&&a.id!==sim.networkOwnerId)return;
 const rate=a.equipmentAttributes.mpRecoveryPerSecond??0;
 if(rate===0)return;
 if(!Number.isInteger(rate)||rate>2147483647){sim.note('equipment-mp-source-integer','Original socket m_iMpChangeValue requires an integer rate',a);return;}
 a.mp=ravenSocketMpValue({current:a.mp,max:a.mpMax,rate,delta});
}

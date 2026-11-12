/** Offense Mode 29409 is a factory input, not a hit-time modifier.
 * The original Activator32740500, Starfall32761ac0, Fury32768200 and
 * Chaser32766960 explicitly multiply current v1d0 by actor70c8 and store
 * one float. Descendants inherit that stored scalar through normal factories.
 * Configuration drones, Magnetron and the selection follower pass v1d0
 * directly; they must not call this adapter (see source capsule).
 */
export function addInstallationFactoryActor2016(actor){
 if(actor.professionId!=='MM')return actor;
 const power=actor.skillScale,multiplier=actor.passivePolicy?.add?.installationDamageMultiplier;
 if(!Number.isFinite(power)||!Number.isFinite(multiplier)||multiplier<=0)return actor;
 return {...actor,skillScale:Math.fround(Math.fround(power)*Math.fround(multiplier))};
}

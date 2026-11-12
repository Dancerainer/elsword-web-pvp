/** V62 project input policy. This delay is not part of the recovered Gauge. */
export const MANA_BREAK_HOLD_INTENT_VERSION='project-mana-break-hold-intent-v62';
export const MANA_BREAK_HOLD_SECONDS=.5;
const attacks=['Z','X'];
/** Sample before Gauge consumes its previous Event latch. A release must
 * clear that latch even when the actor's animation is stopped this packet.
 * Only elapsed fixed packets count; DOM timestamps and repeat events do not.
 * Separate clocks prevent alternating/overlapping short Z/X taps adding up. */
export function sampleManaBreakIntent(actor,keys,dt){
 const m=actor.manaBreak,clock=m.holdIntent??={z:0,x:0};
 for(const key of attacks){
  const released=keys.released.has(key)||(keys.edges??[]).some(e=>String(e.key).toUpperCase()===key&&!e.down);
  const prior=released?0:clock[key.toLowerCase()];
  clock[key.toLowerCase()]=actor.hp>0&&keys.held.has(key)?Math.min(MANA_BREAK_HOLD_SECONDS,Math.fround(prior+dt)):0;
 }
 const ready=attacks.some(key=>keys.held.has(key)&&clock[key.toLowerCase()]>=MANA_BREAK_HOLD_SECONDS-1e-9);
 if(!ready){m.charge=0;m.canCharge=false;}
 return ready;
}
export function manaBreakIntentHeld(actor,{heldZ=false,heldX=false}={}){
 const c=actor.manaBreak.holdIntent;
 return {heldZ:heldZ&&(c?.z??0)>=MANA_BREAK_HOLD_SECONDS-1e-9,
  heldX:heldX&&(c?.x??0)>=MANA_BREAK_HOLD_SECONDS-1e-9};
}

/** Original compiled Gauge/User subset; host phases below are bounded adapters.
 * Target2016 component rate is supplied, never inferred from the V5 defaults. */
import {manaBreakIntentHeld} from './mana-break-intent-v62.mjs';
export const MANA_BREAK_SOURCE='fixed-V5 Gauge/User compiled subset; target2016 runtime unmeasured';
export const MANA_BREAK_DOWN_STATES=new Set(['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_DOWN_INVINCIBLE']);
const veteranHeldCommandStates=new Set(['RVC_DASH_COMBO_ZZZ','RVC_DASH_COMBO_ZZZPushZ_READY','RVC_DASH_COMBO_ZZZPushZ']);
const addHeldCommandStates=new Set(['ANSI_COMBO_XXZZ_LOOP','ANSI_DASH_JUMP_COMBO_XX_CHARGE','ANSI_AMM_COMBO_XXDownX_LOOP']);
export function createManaBreak(){return {charge:0,maxCharge:300,minimumCharge:100,availableMax:0,
  pendingCost:0,active:false,canCharge:false,noDetonation:false,damageReactPending:false};}
export function manaBreakInput(actor,extra={}){const m=actor.manaBreak;
  return {mp:actor.mp,mpMax:actor.mpMax,charge:m.charge,availableMax:m.availableMax,
    canCharge:m.canCharge,active:m.active,pendingCost:m.pendingCost,noDetonation:m.noDetonation,
    blockedByBuff:actor.buffs.some(b=>b.behaviors.some(row=>row.kind==='manaBreakBlock')), ...extra};}
export function applyManaBreakResult(actor,result){actor.mp=result.mp;
  for(const field of ['charge','availableMax','canCharge','active','pendingCost','maxCharge','minimumCharge'])actor.manaBreak[field]=result[field];}
export function clearRegisteredStunIdentities(actor){
  // User36541 clears registrations, preserving Buff objects and other effects.
  for(const buff of actor.buffs)for(const row of buff.behaviors)if(row.kind==='stun')row.identityCleared=true;
  actor.buffControls.inputBlock=false;
}
export function advanceManaBreak(native,actor,elapsed,chargeRate){
  // The charge pose owns the held attack key until a real hit clears its
  // NO_DETONATION state flag. Clear an earlier CommonEvent latch before the
  // Gauge frame, so entering charge cannot add one final green-bar packet.
  if(actor.manaBreak.noDetonation){actor.manaBreak.canCharge=false;actor.manaBreak.charge=0;}
  applyManaBreakResult(actor,native.evaluate('frame',manaBreakInput(actor,{elapsed,chargeRate})));
}
export function manaBreakEvent(native,actor,held={}){
  // Original31f6c7a0 clears BOTH fields in its NO_DETONATION branch;
  // the compiled2026 Event subset only returns, so bridge it explicitly.
  if(actor.manaBreak.noDetonation){actor.manaBreak.canCharge=false;actor.manaBreak.charge=0;}
  applyManaBreakResult(actor,native.evaluate('event',manaBreakInput(actor,manaBreakIntentHeld(actor,held))));
}
export function reserveManaBreak(native,actor,{grounded,fromFront,backY=0,damageType=0}){
  if(actor.manaBreak.pendingDown)return {triggered:false};
  const request=native.evaluate('request',manaBreakInput(actor));applyManaBreakResult(actor,request);
  if(!request.triggered)return {triggered:false};
  const down=native.evaluate('down',manaBreakInput(actor,{grounded,fromFront,backY,damageType}));
  return {...down,triggered:true,cost:request.pendingCost};
}
/** V61 project scheduling: preserve the triggering hit's reaction throughout
 * the original .7 stop, then apply the reserved down once the actor resumes.
 * This is a Web Now/Future presentation bridge, not original-client execution. */
export function holdManaBreakDown(actor,down){
  if(!down.state)return false;
  actor.manaBreak.pendingDown={state:down.state,vy:down.vy};actor.invincible=true;
  // Owner reports carry the public stop cache, not private native queues.
  // Project this newly scheduled Mana hold immediately so a same-packet
  // owner/critical restore cannot turn its .7 queue into a zero-time hold.
  actor.hitStop=Math.fround(down.hitStop??.7);return true;
}
export function resumeManaBreakDown(sim,actor){
  const pending=actor.manaBreak.pendingDown;if(!pending)return false;
  delete actor.manaBreak.pendingDown;
  if(actor.hp<=0){actor.manaBreak.active=false;actor.manaBreak.pendingCost=0;actor.manaBreak.charge=0;return false;}
  if(pending.state==='RSI_DAMAGE_AIR_DOWN_INVINCIBLE'){actor.vy=pending.vy;actor.grounded=false;actor.lineId=null;}
  else {actor.grounded=true;actor.lineId??=actor.lastTouchLineId;}
  sim.enter(actor,pending.state,'mana-break-held-reaction-end',{directChange:true});return true;
}
export function manaBreakStateStart(native,actor,raw={}){
  const m=actor.manaBreak;
  m.noDetonation=m.damageReactPending&&m.noDetonation;m.damageReactPending=false;
  // Target2016 LK charge rows explicitly forbid voluntary Mana Break. The
  // three VC held-Z callbacks set the same flag in fixed Raven StateStart.
  // DamageReact remains its existing source path: a normal received attack
  // can clear the pose's flag and enable charging while attack is held.
  if(raw.CAN_MANA_BREAK===0||veteranHeldCommandStates.has(actor.state)||addHeldCommandStates.has(actor.state)){
    m.noDetonation=true;m.canCharge=false;m.charge=0;
  }
  if(!native||!MANA_BREAK_DOWN_STATES.has(actor.state))return false;
  const result=native.evaluate('consume',manaBreakInput(actor));applyManaBreakResult(actor,result);
  if(result.triggered){
    // User36541 clears registered stun identities, not their Buff objects.
    // Stun.SetFactor only registers once; a retained/reapplied object must not
    // silently recreate that cleared identity on every frame.
    clearRegisteredStunIdentities(actor);
  }
  return result.triggered;
}
export function manaBreakDamageReact(actor,data){
  // GUUser7746: buff damage cannot clear an existing NO_DETONATION flag.
  if(!actor.manaBreak.noDetonation||data.DAMAGE_TYPE!==6)actor.manaBreak.noDetonation=data.NO_DETONATION===1||data.NO_DETONATION===true;
  actor.manaBreak.damageReactPending=true;
}

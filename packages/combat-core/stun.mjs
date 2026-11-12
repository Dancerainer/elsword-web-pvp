/** Target2016 Fatal loop + fixedV5 groggy/wait binding. The stun-over-KD
 * priority below is the user's explicit rule, not an inferred native macro.
 * Buff finalizers remain the sole lifetime; no second stun timer is invented. */
export const STUN_STATE='RSI_DAMAGE_GROGGY';
export function hasRegisteredStun(actor){
  return actor.buffs.some(buff=>buff.behaviors.some(row=>row.kind==='stun'&&!row.identityCleared));
}
export function synchronizeStunState(simulation,actor,{applied=false}={}){
  if(actor.hp<=0||actor.deathComplete)return;
  if(hasRegisteredStun(actor)){
    actor.buffControls.inputBlock=true;
    actor.pendingPressed=[];actor.buffered=null;actor.cancelInput=null;actor.comboStopInput=null;
    actor.pendingPlatformJump=null;actor.jumpOnLanding=false;actor.downForce=false;
    if(applied||actor.state!==STUN_STATE){
      const before={...actor.knockdown};
      Object.assign(actor.knockdown,{now:0,pending:null,activated:false,addedThisState:false,lastDamageSeconds:0});
      actor.downSuccessor=null;
      if(actor.state!==STUN_STATE)simulation.enter(actor,STUN_STATE,'buff-stun',{directChange:true});
      simulation.emit('stunReaction',actor.id,{state:actor.state,knockdownBefore:before,
        policy:'user-required-stun-over-knockdown; target2016 Fatal animation'});
    }
  }else if(actor.state===STUN_STATE){
    actor.buffControls.inputBlock=false;
    simulation.enter(actor,'RSI_WAIT','buff-stun-ended');
  }
}

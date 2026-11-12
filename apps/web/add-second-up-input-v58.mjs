/** Project usability rule; source2016 remains final-level sampled keyboard.
 * The adapter is applied once to local sampled input, before network/replay. */
export const ADD_SECOND_UP_INPUT_VERSION='add-rapid-second-up-project-v58';
const professions=new Set(['LP','MM','DE']),freeJump=new Set(['RSI_JUMP_UP','RSI_JUMP_DOWN']);
export function recoverAddSecondUp(input,actor){
 if(!professions.has(actor?.professionId)||actor.grounded!==false||!(actor.hp>0)||
    actor.skillId||actor.inputLock>0||actor.canNotJumpTime>0||actor.hitStop>0||actor.worldStop>0||actor.buffControls?.inputBlock)
  return input;
 const hover=actor.state==='ANSI_LEVITATION_WAIT';
 if(!hover&&(!freeJump.has(actor.state)||actor.sourceAddMovement?.levitationAvailable!==true))return input;
 if(input.sampledDevice!==true||input.pressed?.includes('UP')||
    !input.edges?.some(e=>e.key==='UP'&&e.down===true&&e.manual!==true))return input;
 // One real down edge can recover at most one existing canonical pressed
 // field. Held/released, native double bookkeeping and future queue stay as
 // sampled. Same-packet initial double-UP never synthesizes a later jump.
 return {...input,pressed:[...(input.pressed??[]),'UP']};
}

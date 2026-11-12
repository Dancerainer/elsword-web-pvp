import {isAddActor} from './add-systems.mjs';
import {SKILL_SLOT_KEYS} from './skill-availability.mjs';
import {sourceScaledSpeed} from './speed-attributes.mjs';

const AIR='ANSI_AIR_DASH',HOVER='ANSI_LEVITATION_WAIT';
const projectTakeoffStates=new Set(['RSI_WAIT','RSI_WALK','RSI_JUMP_LANDING']);
export const ADD_SPECIAL_AIR_STATES=Object.freeze([AIR,HOVER]);
export function validateAddMovement(value){
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===(value.projectAirAttack===undefined?2:3)&&typeof value.airDashAvailable==='boolean'&&typeof value.levitationAvailable==='boolean'&&
  (value.projectAirAttack===undefined||value.projectAirAttack&&Object.keys(value.projectAirAttack).length===2&&
   ['Z','X'].includes(value.projectAirAttack.key)&&Number.isSafeInteger(value.projectAirAttack.stateSerial)&&value.projectAirAttack.stateSerial>=0);
}
const movement=a=>(a.sourceAddMovement??={airDashAvailable:true,levitationAvailable:true});
export function releaseAddAirAttack(a,keys){
 const pending=a.sourceAddMovement?.projectAirAttack;if(!pending)return;
 delete a.sourceAddMovement.projectAirAttack;
 if(!isAddActor(a)||a.hp<=0||a.grounded||a.skillId||a.inputLock>0||a.canNotAttackTime>0||a.canNotJumpTime>0||
    a.hitStop>0||a.worldStop>0||a.buffControls?.inputBlock||pending.stateSerial!==a.stateSerial||
    !['RSI_JUMP_UP','RSI_JUMP_DOWN',HOVER].includes(a.state))return;
 keys.pressed.add(pending.key);
}
export function advanceAddMovement(a,dt){
 if(!isAddActor(a))return;
 const m=movement(a);if(a.grounded){m.airDashAvailable=true;m.levitationAvailable=true;}
 if(a.state===HOVER)a.mp=Math.max(0,Math.fround(a.mp-Math.fround(2*dt*a.stateTime)));
}
export function endAddMovement(a,next){
 if(isAddActor(a)&&a.state===AIR&&next!==AIR&&a.vx*a.facing>800)a.vx=800*a.facing;
}
/** Source Add free-air callbacks, distinct from Raven's hop-on-landing flow.
 * 0.45 seconds, the 800 exit cap and rising hover MP drain are qualified fixed
 * source literals. Original raw states own gravity and skateboard effect sets.
 */
export function addMovementInput(sim,a,keys){
 if(!isAddActor(a))return false;
 const m=movement(a),held=keys.held,pressed=keys.pressed;
 const direction=held.has('RIGHT')&&!held.has('LEFT')?1:held.has('LEFT')&&!held.has('RIGHT')?-1:0;
 const double=!a.buffControls?.dashBlock&&(keys.pureDoubleRight||keys.pureDoubleLeft||pressed.has('DASH'));
 const skill=()=>SKILL_SLOT_KEYS.some((key,index)=>pressed.has(key)&&sim.skillAvailability(a.id,index).available);
 // V61 user input adaptation: one canonical sampled UP packet may also
 // contain its following attack. Keep UP first, deliver one attack on the
 // next actor packet; held levels alone never create/repeat this intent.
 const deferAttack=()=>{const key=pressed.has('Z')?'Z':pressed.has('X')?'X':null;
  if(key&&!(a.canNotAttackTime>0))m.projectAirAttack={key,stateSerial:a.stateSerial};};
 if(a.grounded&&projectTakeoffStates.has(a.state)&&held.has('DOWN')&&pressed.has('UP')&&
    (pressed.has('Z')||pressed.has('X'))&&!(a.canNotJumpTime>0)&&!(a.canNotAttackTime>0)&&!skill()){
  sim.jump(a,false);deferAttack();return true;
 }
 const dash=()=>{if(direction)a.facing=direction;m.airDashAvailable=false;a.jumpOnLanding=false;sim.enter(a,AIR,'original-add-air-dash');return true;};
 const fall=()=>{a.y-=sim.profileFor(a).referenceSemantics.lineRadius*1.5;sim.enter(a,'RSI_JUMP_DOWN','original-add-hover-release');return true;};
 if(a.state===HOVER){
  if(pressed.has('DOWN')||a.mp<1||a.hp<=0)return fall();
  if(a.grounded){sim.enter(a,'RSI_JUMP_LANDING','original-add-special-air-land');return true;}
  if(pressed.has('Z')||pressed.has('X')||skill())return false;
  if(double&&m.airDashAvailable)return dash();
  if(pressed.has('RIGHT')||pressed.has('LEFT'))return fall();
  if(pressed.has('UP')){sim.enter(a,'RSI_JUMP_UP','original-add-levitation-jump');a.vy=sourceScaledSpeed(sim.profileFor(a).physics.JUMP_SPEED,a.stats.jumpSpeedMultiplier);a.y+=sim.profileFor(a).referenceSemantics.lineRadius;return true;}
  return true;
 }
 if(a.state===AIR){
  if(Math.fround(a.stateTime)>Math.fround(.45)){a.y-=sim.profileFor(a).referenceSemantics.lineRadius*1.5;sim.enter(a,'RSI_DASH_JUMP','original-add-air-dash-end');return true;}
  if(pressed.has('Z')||pressed.has('X')||skill())return false;
  if(pressed.has('UP')){sim.enter(a,'RSI_DASH_JUMP','original-add-air-dash-jump');a.vy=sourceScaledSpeed(sim.profileFor(a).physics.DASH_JUMP_SPEED,a.stats.jumpSpeedMultiplier);return true;}
  if(!direction||direction!==a.facing){sim.enter(a,'RSI_JUMP_DOWN','original-add-air-dash-direction-end');return true;}
  if(pressed.has('DOWN')&&sim.dropPlatform(a)){sim.enter(a,'RSI_DASH_JUMP','original-add-air-dash-down');return true;}
  return true;
 }
 if(['RSI_JUMP_UP','RSI_JUMP_DOWN'].includes(a.state)){
  if(double&&m.airDashAvailable)return dash();
  if(skill())return false;
  if(pressed.has('UP')&&m.levitationAvailable){m.levitationAvailable=false;sim.enter(a,HOVER,'original-add-second-up-levitation');deferAttack();return true;}
 }
 if(a.state==='RSI_DASH_JUMP'&&!a.grounded&&pressed.has('UP')&&m.airDashAvailable)return dash();
 return false;
}

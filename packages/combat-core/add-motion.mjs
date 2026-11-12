import {isAddActor} from './add-systems.mjs';

/** Original career motion inventory + qualified custom-animation reference.
 * Promotion careers inherit their original APT/AAT/ATT motion prefix. Raw
 * state declarations stay intact; no animation from another character is used.
 */
export function addMotionDefinition(profile,actor,definition){
 if(!isAddActor(actor)||!definition)return definition;
 const source=definition.sourceState,formed=actor.sourceAdd?.formation===true;
 const prefix={LP:'APT',MM:'AAT',DE:'ATT'}[actor.professionId.toUpperCase()];
 let animationName;
 if(source==='ANSI_HYPER_MODE'&&(formed||actor.sourceAdd?.formationPending))animationName=prefix+'_Formation_Start';
 else if(formed){
  if(source==='ANSI_WAIT'||source==='ANSI_HYPER_WAIT')animationName=prefix+'_Formation_Wait';
  else if(source==='ANSI_DASH'||source==='ANSI_AIR_DASH')animationName='Formation_Dash';
  else if(source==='ANSI_DASH_END')animationName=prefix+'_Formation_DashEnd';
  else if(source==='ANSI_COMBO_NASOD_ARMOR_LANDING'&&actor.professionId!=='LP')animationName=prefix+'_NA_preAttack_Landing';
 }
 if(!animationName)return definition;
 const clip=profile.clips?.[animationName];
 if(!clip)throw new TypeError('Missing original Add career motion '+animationName);
 return {...definition,animationName,clip};
}

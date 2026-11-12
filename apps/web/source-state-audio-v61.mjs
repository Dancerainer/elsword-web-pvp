import {SOURCE_DELETE_CONDITION_SOUND as DCS} from '../../packages/combat-core/source-extended-sound-v61.mjs';

/** Web presentation adapter for source-declared channel ownership. Playback
 * remains non-looping. The common simulation's stateChanged receipt supplies
 * the Web boundary; this does not claim a target-client callback timestamp.
 * V1 produces it in each receiver's simulation; V0 emits the same receipt.
 */
export function createSourceStateAudio({player,rawForState=()=>null,generationForActor=()=>0}){
 const actors=new Map();
 const validSerial=value=>Number.isSafeInteger(value)&&value>=0;
 const nativeSerial=event=>event.sourceNativeSound?.presentationSerial??event.sourceNativeSound?.stateSerial;
 const stopGeneration=actorId=>{
  player.stopNativeSounds(actorId,{handleGroup:'state'});
  for(const deleteCondition of [DCS.DCS_STATE_END,DCS.DCS_CUSTOM_STATE])
   player.stopNativeSounds(actorId,{handleGroup:'condition',deleteCondition});
 };
 const receipt=actorId=>{
  const generation=generationForActor(actorId);let record=actors.get(actorId);
  if(record&&record.generation!==generation){
   stopGeneration(actorId);
   record=null;
  }
  if(!record){record={generation,serial:-1,stateSerial:-1,customSerial:-1};actors.set(actorId,record);}
  return record;
 };
 return {
  event(event){
   if(event.type==='sound'){
    const native=event.sourceNativeSound,record=native?receipt(event.actorId):null,serial=nativeSerial(event);
    if(native&&(!['state','condition'].includes(native.handleGroup)||!validSerial(native.stateSerial)||
      native.presentationSerial!==undefined&&!validSerial(native.presentationSerial)||
      !Array.isArray(native.deleteConditions)||native.deleteConditions.some(value=>!Number.isInteger(value)||value<1||value>5)))return false;
    if(native&&record&&Number.isInteger(serial)){
     const conditions=native.deleteConditions??[];
     if((native.handleGroup==='state'||native.handleGroup==='condition'&&conditions.includes(DCS.DCS_STATE_END))&&serial<record.serial)return false;
     if(native.handleGroup==='condition'&&conditions.includes(DCS.DCS_CUSTOM_STATE)&&serial<record.customSerial)return false;
    }
    return player.play(event.name,event);
   }
   if(event.type!=='stateChanged'||!validSerial(event.stateSerial)||
     event.audioPresentationSerial!==undefined&&!validSerial(event.audioPresentationSerial))return false;
   const stamped=Number.isInteger(event.audioPresentationSerial),serial=stamped?event.audioPresentationSerial:event.stateSerial,previous=receipt(event.actorId);
   if(serial<=previous.serial)return false;
   // A fresh local presentation receipt can carry a smaller authoritative
   // source state serial. Retire the replaced prediction, not a late packet;
   // the private stamp cannot be supplied in an owner's actor/action payload.
   const replaced=stamped&&event.stateSerial<=previous.stateSerial;
   const raw=rawForState(event.actorId,event.state),custom=raw?.CUSTOM_STATE_DELETE_SOUND===1||raw?.CUSTOM_STATE_DELETE_SOUND===true;
   const boundary=stamped?{beforePresentationSerial:serial}:{beforeStateSerial:serial};
   player.stopNativeSounds(event.actorId,{handleGroup:'state',...boundary});
   player.stopNativeSounds(event.actorId,{handleGroup:'condition',deleteCondition:DCS.DCS_STATE_END,...boundary});
   if(custom||replaced)player.stopNativeSounds(event.actorId,{handleGroup:'condition',deleteCondition:DCS.DCS_CUSTOM_STATE,...boundary});
   actors.set(event.actorId,{generation:previous.generation,serial,stateSerial:event.stateSerial,customSerial:custom||replaced?serial:previous.customSerial});
   return true;
  },
  // Scene/reset/ownership generations already stop all audio through the
  // calling game lifecycle. They must also discard old serial receipts.
  clear(){actors.clear();},
 };
}

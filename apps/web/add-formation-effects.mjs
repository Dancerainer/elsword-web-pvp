import {isAddProfile,professionIdForProfile} from '../../packages/professions/identity.mjs';

export const ADD_FORMATION_EFFECT_SET='EffectSet_AN_Formation_Start';
/** This Web reconciliation retains the existing 25 attachment candidates from
 * the 37-layer source set. Native BDT ownership proves Finish stops its set;
 * this candidate classification is not a native emission-lifetime proof.
 * Actor state already
 * transmits formation, so restoring those attachments needs no extra combat
 * records, effect-ID history or owner-packet payload. */
export function addFormationPersistentMembers(profile){
 if(!isAddProfile(profile))return [];
 return Object.entries(profile.effectSets?.[ADD_FORMATION_EFFECT_SET]?.raw??{}).filter(([key,definition])=>{
  if(!/^EFFECT\d+$/.test(key)||!definition?.NAME)return false;
  const template=profile.effectTemplates?.[definition.NAME],fields=template?.fields;
  return template?.kind==='particle'&&fields.TriggerCount===undefined&&fields.TriggerTime===undefined;
 }).map(([member,definition])=>({member,definition}));
}

export function createAddFormationEffects({profile,samplers,start,stop,hasEffect=()=>true}){
 const members=addFormationPersistentMembers(profile),profession=professionIdForProfile(profile),actors=new Map();
 const byName=new Map();for(const entry of members){let rows=byName.get(entry.definition.NAME);if(!rows)byName.set(entry.definition.NAME,rows=[]);rows.push(entry);}
 const eligible=actor=>members.length>0&&(actor?.professionId??'RF').toUpperCase()===profession&&actor.hp>0&&actor.sourceAdd?.formation===true;
 const memberFor=event=>byName.get(event.name)?.find(entry=>{
  const definition=event.definition;if(!definition)return false;
  // Same-name weapon and arm layers must retain their independent bones.
  // These frozen formation members contain only scalar/string declarations.
  return Object.entries(entry.definition).every(([key,value])=>definition[key]===value);
 });
 function clearActor(id){
  const row=actors.get(id);if(!row)return;
  for(const slot of row.slots.values())stop(slot.id);
  actors.delete(id);
 }
 function ensure(actor,entry,state,birth=null){
  let row=actors.get(actor.id);if(!row){row={slots:new Map()};actors.set(actor.id,row);}
  if(row.slots.has(entry.member))return;
  const birthAnchor=birth?.birthAnchor??samplers.effectAnchorSampler({definition:entry.definition},actor);
  if(!birthAnchor?.position)return;
  const id='add-formation:'+actor.id+':'+entry.member;
  start({...birth,type:'effectStarted',effectId:id,actorId:actor.id,name:entry.definition.NAME,
   setName:ADD_FORMATION_EFFECT_SET,definition:entry.definition,birthAnchor,
   ownerStateSerial:actor.stateSerial,deleteConditions:[3]},state);
  if(hasEffect(id))row.slots.set(entry.member,{id});
 }
 return {
  event(event,state){
   if(event.type!=='effectStarted'||event.setName!==ADD_FORMATION_EFFECT_SET)return false;
   const entry=memberFor(event);if(!entry)return false;
   const actor=state.actors?.find(a=>a.id===event.actorId);
   if(eligible(actor))ensure(actor,entry,state,event);
   else if(actor)clearActor(actor.id);
   // A late/replayed birth cannot reopen an attachment after release.
   return true;
  },
  step(state){
   const live=new Set();
   for(const actor of state.actors??[]){
    if(!eligible(actor)){clearActor(actor.id);continue;}
    live.add(actor.id);
    const awakening=profile.states?.[actor.state]?.sourceState==='ANSI_HYPER_MODE'||actor.state==='ANSI_HYPER_MODE'||actor.state==='RSI_HYPER_MODE';
    // Original BDT PlayEffectSet keeps its default ESTT_ANIM clock: START_TIME
    // compares against the owner's absolute animation time, including layers
    // already due when formation applies at .46. It has no birth-time offset.
    const elapsed=awakening?(actor.animationTime??0):Infinity;
    for(const entry of members)if(elapsed+1e-7>=(entry.definition.START_TIME??0))ensure(actor,entry,state);
   }
   for(const id of actors.keys())if(!live.has(id))clearActor(id);
  },
  clear(){for(const id of [...actors.keys()])clearActor(id);},
  proof(){return {actors:actors.size,persistentMembers:members.length,handles:[...actors.values()].reduce((n,row)=>n+row.slots.size,0),
   sourceLayerCount:Object.keys(profile.effectSets?.[ADD_FORMATION_EFFECT_SET]?.raw??{}).filter(key=>/^EFFECT\d+$/.test(key)).length,
   wireFieldsAdded:0,combatRecordsAdded:0,
   attachments:[...actors].flatMap(([actorId,row])=>[...row.slots].map(([member,slot])=>({actorId,member,id:slot.id,
    bone:members.find(entry=>entry.member===member).definition.BONE_NAME}))),
   evidence:'target2016 Formation_Start set and native BDT stop ownership; existing Web attachment classification, emission lifetime unmeasured'};},
 };
}

import source from '../../contracts/add-crest-display-v61.json' with {type:'json'};
import {ADD_CREST_DISPLAY_SET} from '../../packages/combat-assets/add-crest-display-v61.mjs';
const definition=Object.freeze(source.effectSets[ADD_CREST_DISPLAY_SET].raw.EFFECT0);
/** Recipient snapshot already carries the ring lifecycle across ownership.
 * Reconcile its original436 BDT attachment without manufacturing combat buffs,
 * remote grants or timers. Actual remaining/consumption controls the handle. */
export function createAddTimeRingEffects({samplers,start,stop,hasEffect=()=>true}){
 const rows=new Map();
 function drop(id){const row=rows.get(id);if(row){stop(row.id);rows.delete(id);}}
 return {
  step(state){const live=new Set();
   for(const actor of state.actors??[]){
    if(!(actor.sourceTimeRing?.remaining>0)||!(actor.hp>0)||actor.pvpDead||actor.pvpDisconnected){drop(actor.id);continue;}
    live.add(actor.id);if(rows.has(actor.id))continue;
    const birthAnchor=samplers.effectAnchorSampler({definition},actor);if(!birthAnchor?.position)continue;
    const id='add-time-ring:'+actor.id;
    start({type:'effectStarted',effectId:id,actorId:actor.id,name:definition.NAME,setName:ADD_CREST_DISPLAY_SET,definition,
     birthAnchor,ownerStateSerial:actor.stateSerial,deleteConditions:[3]},state);
    if(hasEffect(id))rows.set(actor.id,{id});
   }
   for(const id of rows.keys())if(!live.has(id))drop(id);
  },
  clear(){for(const id of [...rows.keys()])drop(id);},
  proof(){return {actors:rows.size,attachments:[...rows].map(([actorId,row])=>({actorId,id:row.id,bone:definition.BONE_NAME})),
   combatRecordsAdded:0,wireFieldsAdded:0,source:'target2016 BT436 displayer + existing recipient sourceTimeRing lifecycle; no original GPU measurement'};},
 };
}

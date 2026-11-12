/** Exact target2016 RevengeWait minor sequence; separate from Rage particles. */
import {isElswordProfession} from '../../packages/professions/identity.mjs';
export function createCounterWaitEffects({runtime,qualityFor=()=>undefined}){
 const seen=new Map(),handles=new Set();let triggers=0,duplicates=0,lastTime=null;
 const clock=state=>{if(Number.isFinite(state.time)){if(lastTime!==null&&state.time<lastTime){
  for(const id of handles)runtime.stop(id,true);handles.clear();seen.clear();}lastTime=state.time;}};
 return {
  event(event,state){
   if(event.type!=='counterWaitVisual')return false;
   clock(state);
   const actor=state.actors?.find(a=>a.id===event.actorId);
   if(!actor||!isElswordProfession(actor.professionId)||!Number.isSafeInteger(event.ownerStateSerial)
    ||![event.position,event.rotation].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)))return false;
   const life=actor.networkFrameEpoch??actor.lifeEpoch??null,key=JSON.stringify([life,event.ownerStateSerial]);
   let row=seen.get(actor.id);if(!row||row.actor!==actor){row={actor,keys:new Set()};seen.set(actor.id,row);}
   if(row.keys.has(key)){duplicates++;return true;}row.keys.add(key);while(row.keys.size>32)row.keys.delete(row.keys.values().next().value);
   const e=runtime.add('RevengeWait',{position:[...event.position],facing:1,addRotate:[...event.rotation],
    emitRate:{random:[10,10]},triggerCount:5,effectQuality:qualityFor(actor)});
   if(e){handles.add(e.id);triggers++;}return true;
  },
  step(state){clock(state);const ids=new Set(state.actors?.map(a=>a.id));for(const id of seen.keys())if(!ids.has(id))seen.delete(id);for(const id of handles)if(!runtime.emitters.has(id))handles.delete(id);},
  clear(){for(const id of handles)runtime.stop(id,true);handles.clear();seen.clear();triggers=duplicates=0;lastTime=null;},
  proof(){return {triggers,duplicates,liveHandles:handles.size,template:'RevengeWait',triggerCount:5,emitRate:10,targetClientMeasured:false};}
 };
}

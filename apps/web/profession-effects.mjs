/** Separate target effect closures prevent equal template names from sharing
 * converted geometry, pools or clocks across profession source manifests. */
import {createEffectStateLookup} from './effect-state-lookup.mjs';
export function createProfessionEffects(views,localProfessionId='RF',{environmentView=null}={}) {
  const requireView=id=>{if(!Object.hasOwn(views,id))throw new RangeError('Unavailable profession effect view: '+id);};
  requireView(localProfessionId);
  const effectOwners=new Map(),idFor=actor=>actor?.professionId??localProfessionId;
  const rows=Object.entries(views);
  // Loaded libraries do not all belong to the current match. Continue a
  // departed profession once for owner cleanup, then only while it has tails.
  // Older adapters without an activity query keep their original scheduling.
  const pending=new Set(),active=new Set();
  const needsWork=view=>typeof view.hasPendingWork!=='function'||view.hasPendingWork();
  let eventBatch=null;
  function closeEventViews(batch){
    let failure;
    for(const view of batch.views)try{view.endEventBatch?.();}catch(error){failure??=error;}
    if(failure)throw failure;
  }
  function beginEventBatch(state){
    if(eventBatch){
      if(eventBatch.state!==state)throw new TypeError('A profession event batch must retain its state');
      eventBatch.depth++;return;
    }
    const batch={state,lookup:createEffectStateLookup(state),views:[],depth:1};
    try{
      for(const [,view]of rows){batch.views.push(view);view.beginEventBatch?.(state,batch.lookup);}
      eventBatch=batch;
    }catch(error){try{closeEventViews(batch);}finally{throw error;}}
  }
  function endEventBatch(){
    if(!eventBatch||--eventBatch.depth)return;
    const batch=eventBatch;eventBatch=null;closeEventViews(batch);
  }
  function event(event,state){
    const ownerId=event.actorId??event.playerId??event.ownerId??event.origin?.ownerId;
    const actor=eventBatch?.state===state?eventBatch.lookup.actors.get(ownerId):state.actors.find(a=>a.id===ownerId);
    const id=event.sourceProfessionId??(actor?idFor(actor):effectOwners.get(event.effectId));
    if(event.type==='hit'&&event.deleteDamageReactEffects===true)for(const [,view]of rows)view.cancelDamagedOwner?.(event.targetId);
    if(event.effectId!=null&&id)effectOwners.set(event.effectId,id);
    if(id&&views[id]){pending.add(id);views[id].event(event,state);}
    else if(['reset','clear'].includes(event.type))for(const [,view]of rows)view.event(event,state);
    if(event.type==='effectEnded')effectOwners.delete(event.effectId);
  }
  function splitState(state){
    const actorsById=new Map(),effectsByProfession=new Map(rows.map(([id])=>[id,[]])),sourceOwners=new Map();
    // Preserve Array.find's first owner when inspecting malformed duplicate
    // actor identities. Production packets have unique actor/effect IDs.
    for(const actor of state.actors)if(!actorsById.has(actor.id))actorsById.set(actor.id,actor);
    for(const effect of state.effects??[]){
      const id=effect.sourceProfessionId??idFor(actorsById.get(effect.ownerId));
      effectsByProfession.get(id)?.push(effect);
      if(effect.sourceProfessionId!=null){
        let owners=sourceOwners.get(effect.sourceProfessionId);
        if(!owners){owners=new Set();sourceOwners.set(effect.sourceProfessionId,owners);}owners.add(effect.ownerId);
      }
    }
    return new Map(rows.map(([id])=>[id,{...state,
      actors:state.actors.filter(actor=>idFor(actor)===id||sourceOwners.get(id)?.has(actor.id)),
      effects:effectsByProfession.get(id)}]));
  }
  return {
    setLocalProfession(id){requireView(id);localProfessionId=id;},
    get localProfessionId(){return localProfessionId;},
    event,beginEventBatch,endEventBatch,
    eventBatch(events,state){if(!events.length)return;beginEventBatch(state);try{for(const e of events)event(e,state);}finally{endEventBatch();}},
    step(dt,state){
      environmentView?.step(dt,state);
      const states=splitState(state);
      const next=new Set();
      for(const [id,view]of rows){
        const packet=states.get(id);
        if(packet.actors.length||packet.effects.length||pending.has(id)||needsWork(view))next.add(id);
        if(next.has(id)||active.has(id))view.step(dt,packet);
      }
      active.clear();for(const id of next)active.add(id);pending.clear();
      // Naturally retired combat effects need not emit effectEnded. Retain
      // ownership only while combat or an independent visual parent needs it.
      const live=new Set((state.effects??[]).map(e=>e.id));
      for(const [effectId,id]of effectOwners)if(!live.has(effectId)&&views[id]?.hasEffect?.(effectId)===false)effectOwners.delete(effectId);
    },
    render(options){for(const [id,view]of rows)if(active.has(id)||pending.has(id)||needsWork(view))view.render(options);environmentView?.render(options);},
    setMap(map){environmentView?.clear();environmentView?.setMap(map);},
    prewarm(loadout){return views[localProfessionId].prewarm(loadout);},
    releaseInactiveBurstPools(){for(const [id,view]of rows)if(id!==localProfessionId)view.releaseBurstPools?.();},
    async prepareProfession(id,actors,{prepareCombat=true}={}){
      requireView(id);this.clear();
      for(const [,view]of rows){
        if(view.releaseBurstPoolsAsync)await view.releaseBurstPoolsAsync();
        else view.releaseBurstPools?.();
      }
      if(prepareCombat)await views[id].prewarmActors(actors,{targetActors:actors});
    },
    prewarmActors(actors){return Promise.all(Object.entries(views).map(([id,view])=>view.prewarmActors(actors.filter(a=>idFor(a)===id),{targetActors:actors})));},
    clear(){effectOwners.clear();active.clear();pending.clear();for(const view of Object.values(views))view.clear();environmentView?.clear();},
    get count(){return Object.values(views).reduce((n,view)=>n+view.count,environmentView?.count??0);},
    performance(){const rows=Object.entries(views).map(([id,view])=>[id,view.performance()]);
      const combined={...views[localProfessionId].performance()};
      for(const key of Object.keys(combined))if(typeof combined[key]==='number'&&key!=='fxParticleDivisor')combined[key]=rows.reduce((sum,[,row])=>sum+(row[key]??0),0);
      return {...combined,fxEffectOwners:effectOwners.size,professions:Object.fromEntries(rows),...(environmentView?{environment:environmentView.performance()}: {})};
    },
    activity(){return {...views[localProfessionId].activity(),...(environmentView?{environment:environmentView.activity()}: {})};},
    sourceMeshClocks(){return Object.entries(views).flatMap(([id,view])=>view.sourceMeshClocks().map(row=>({...row,professionId:id})));},
    proof(options){return {...views[localProfessionId].proof(options),professions:Object.fromEntries(Object.entries(views).map(([id,view])=>[id,view.proof(options)])),...(environmentView?{environment:environmentView.proof(options)}: {})};},
  };
}

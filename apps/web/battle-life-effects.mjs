/** User requested displays: target2016 resources, qualified fixed-V5 callbacks.
 * Independent visual handles read actor lifecycles; they never grant a buff,
 * heal, revive, consume combat RNG, or modify an actor/snapshot. */
const respawning=a=>/^(?:RSI|ESSI|ESI)_START_INTRUDE$/.test(a.pvpPresentation?.state??'');
const f=Math.fround;
export function createBattleLifeEffects({runtime,samplers,index,onUnsupported=()=>{}}){
  const source=index.battleLife;
  if(!source)return {event(){},step(){},clear(){},proof:()=>({enabled:false})};
  const actors=new Map(),groups=[],counts=new Map(),notes=new Set();
  const note=(id,detail)=>{if(!notes.has(id)){notes.add(id);onUnsupported({type:'unsupported-visual',id,detail});}};
  function record(actor){
    let r=actors.get(actor.id);
    if(!r){r={observed:false,heroSeen:Boolean(actor.guild?.heroSacrificeFired),respawnSeen:false,respawn:null,chance:null,lastEventIds:new Map()};actors.set(actor.id,r);}
    return r;
  }
  function add(name,options){const emitter=runtime.add(name,options);if(emitter)counts.set(name,(counts.get(name)??0)+1);return emitter;}
  function rotation(actor){return samplers.actorRotationSampler?.(actor)??[0,actor.facing<0?180:0,0];}
  function forwardPoint(actor,height=0){const yaw=rotation(actor)[1]*Math.PI/180,d=source.callbacks.respawn.forwardOffset;
    return [actor.x+Math.cos(yaw)*d,actor.y+height,actor.z-Math.sin(yaw)*d];}
  function startRespawn(actor,r){
    const config=source.callbacks.respawn;
    for(const name of config.initialTemplates){
      const mesh=index.templates[name]?.kind==='mesh';
      add(name,{position:name==='RespawnLanding_P03'?forwardPoint(actor):[actor.x,actor.y,actor.z],
        facing:1,rotate:mesh?rotation(actor):[0,0,0]});
    }
    r.respawn={clock:0,mask:0};r.respawnSeen=true;
  }
  function setEntry(actor,entry){
    if(entry.EFFECT_TYPE!==8){note('life-effect-type:'+entry.EFFECT_TYPE,'Unsupported original life EffectSet entry');return null;}
    const parent={definition:entry},birth=samplers.effectAnchorSampler(parent,actor);
    if(!birth){note('life-bone:'+entry.BONE_NAME,'Original battle life bone unavailable');return null;}
    const follow=entry.TRACE===1||entry.TRACE_MORE===1;
    return add(entry.NAME,{position:birth.position,rotate:birth.rotation,facing:1,follow,traceMore:entry.TRACE_MORE===1,
      bone:entry.BONE_NAME,actorId:actor.id,
      anchor:follow?s=>{const a=s.actors.find(v=>v.id===actor.id);return a?samplers.effectAnchorSampler(parent,a)?.position:null;}:null});
  }
  function startSet(actor,name,{persistentOnly=false}={}){
    const raw=source.effectSets[name]?.raw;
    if(!raw){note('life-set:'+name,'Original battle life EffectSet unavailable');return null;}
    const entries=Object.entries(raw).filter(([key])=>/^EFFECT\d+$/.test(key)).map(([key,entry])=>({key,entry,fired:false}));
    const group={actorId:actor.id,name,elapsed:0,entries,handles:[]};
    for(const row of entries){
      const persistent=row.entry.TRACE===1||row.entry.TRACE_MORE===1;
      if(persistentOnly&&!persistent){row.fired=true;continue;}
      if(!(row.entry.START_TIME>0)){const e=setEntry(actor,row.entry);if(e)group.handles.push(e.id);row.fired=true;}
    }
    groups.push(group);return group;
  }
  function stopChance(r){if(r.chance){for(const id of r.chance.handles)runtime.stop(id,true);const i=groups.indexOf(r.chance);if(i>=0)groups.splice(i,1);r.chance=null;}}
  function duplicate(r,event){
    const id=event.eventId;if(!Number.isFinite(id))return false;
    const previous=r.lastEventIds.get(event.type);if(previous!=null&&id<=previous)return true;r.lastEventIds.set(event.type,id);return false;
  }
  return {
    event(event,state){
      if(!['respawn','guildHeroSacrifice'].includes(event.type))return;
      const actor=state.actors.find(a=>a.id===(event.actorId??event.playerId));if(!actor)return;
      const r=record(actor);if(duplicate(r,event))return;
      if(event.type==='respawn')startRespawn(actor,r);
      else {startSet(actor,source.callbacks.heroSacrifice.effectSet);r.heroSeen=true;}
    },
    step(state,dt){
      const live=new Set();
      for(const actor of state.actors??[]){
        live.add(actor.id);const r=record(actor),respawn=respawning(actor),clock=actor.pvpPresentation?.time??0;
        // Restore an in-progress snapshot without replaying an old initial flash.
        // Observed dead -> revival and real respawn events start the same display.
        if(respawn&&!r.respawnSeen&&(r.observed||clock===0))startRespawn(actor,r);
        r.respawnSeen=respawn;
        if(r.respawn){
          r.respawn.clock=Math.max(r.respawn.clock,respawn?clock:r.respawn.clock+dt);
          const c=source.callbacks.respawn;
          for(let i=0;i<c.ringTimes.length;i++)if(!(r.respawn.mask&(1<<i))&&r.respawn.clock>=f(c.ringTimes[i])){
            add(c.ringTemplate,{position:forwardPoint(actor,c.ringHeights[i]),facing:1});r.respawn.mask|=1<<i;
          }
          if(r.respawn.mask===(1<<c.ringTimes.length)-1)r.respawn=null;
        }
        const hero=Boolean(actor.guild?.heroSacrificeFired);
        if(r.observed&&hero&&!r.heroSeen)startSet(actor,source.callbacks.heroSacrifice.effectSet);
        r.heroSeen=hero;
        const buff=actor.hp>0&&(actor.buffs??[]).find(b=>Number(b.templateId)===source.callbacks.chanceToReverse.buffTemplateId);
        if(buff&&!r.chance)r.chance=startSet(actor,source.callbacks.chanceToReverse.effectSet,{persistentOnly:!r.observed&&(buff.elapsed??0)>0});
        else if(!buff)stopChance(r);
        if(r.chance)for(const id of r.chance.handles){const e=runtime.emitters.get(id);if(e)e.options.hidden=actor.hidden===true||actor.invisible===true;}
        r.observed=true;
      }
      for(const [id,r]of actors)if(!live.has(id)){stopChance(r);actors.delete(id);}
      for(let i=groups.length-1;i>=0;i--){
        const group=groups[i],actor=state.actors.find(a=>a.id===group.actorId);group.elapsed+=dt;
        for(const row of group.entries)if(!row.fired&&group.elapsed>=f(row.entry.START_TIME??0)){
          const e=actor&&setEntry(actor,row.entry);if(e)group.handles.push(e.id);row.fired=true;
        }
        const persistent=actors.get(group.actorId)?.chance===group;
        if(!persistent&&group.entries.every(r=>r.fired))groups.splice(i,1);
      }
    },
    clear(){for(const r of actors.values())stopChance(r);actors.clear();groups.length=0;counts.clear();notes.clear();},
    proof(){return {enabled:true,triggers:Object.fromEntries(counts),scheduledSets:groups.map(g=>({actorId:g.actorId,name:g.name,elapsed:g.elapsed,
      pending:g.entries.filter(e=>!e.fired).map(e=>e.key)})),hands:[...actors].flatMap(([actorId,r])=>(r.chance?.handles??[]).map(id=>runtime.emitters.get(id)).filter(e=>e?.options.bone)
        .map(e=>({actorId,template:e.name,bone:e.options.bone,position:[...e.position],traceMore:e.options.traceMore,activeParticles:e.particles.size}))),
      reference:source.reference,targetClientMeasured:false,unsupported:[...notes]};},
  };
}

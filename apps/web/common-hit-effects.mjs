// Fixed-V5 CX2GUUser::AttackResultPlayEffect / Play*DamageReactTypeParticle
// and CX2GURaven::CreateMajorParticleArray. These retained sequences belong to
// character attacks. CEffect::AttackResult uses its own HIT_PARTICLE list and
// Raven's AttackResultByType handles the core without common hit particles;
// the base GUUser callback returns immediately. It must not receive both.
const small=Object.freeze([
  ['DamageImpact',100,200,10,2],['DamageImpactCore',100,200,10,2],['DamageImpactSlash',50,50,2,2],
]);
const other=Object.freeze([
  ['DamageImpactRed',100,200,10,2],['DamageImpactRingRed',100,200,1,1],
  ['DamageImpactCoreRed',100,100,1,1],['DamageImpactSlashRed',50,50,1,1],
]);
export function characterHitConsumer(event){return event.origin?.kind==null||event.origin.kind==='character';}
export function createCommonHitEffects({runtime}){
  const actors=new Map(),triggers=new Map();
  function clearActor(id){const row=actors.get(id);if(row)for(const handle of row.values())runtime.stop(handle,true);actors.delete(id);}
  return {
    event(event,effectQuality){
      if(event.type!=='hit'||!characterHitConsumer(event))return;
      const point=event.origin?.impactPoint,react=event.data?.REACT_TYPE;
      if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite)||[0,7,8].includes(react))return;
      let sequences=actors.get(event.actorId);if(!sequences){sequences=new Map();actors.set(event.actorId,sequences);}
      for(const [name,min,max,count,drawCount]of react===1?small:other){
        const options={effectQuality,position:point,landPosition:point[1],emitRate:{random:[min,max]},triggerCount:count};
        let emitter=runtime.retrigger(sequences.get(name),options);
        if(!emitter){emitter=runtime.add(name,{...options,facing:1,drawCount,triggerWait:true});if(emitter)sequences.set(name,emitter.id);}
        if(emitter)triggers.set(name,(triggers.get(name)??0)+1);
      }
    },
    step(state){const live=new Set((state.actors??[]).filter(a=>!a.pvpDisconnected).map(a=>a.id));for(const id of [...actors.keys()])if(!live.has(id))clearActor(id);},
    clear(){for(const id of [...actors.keys()])clearActor(id);triggers.clear();},
    proof(){return {consumer:'fixed-V5 GUUser character AttackResult only; CEffect HIT_PARTICLE remains independent',
      triggers:Object.fromEntries(triggers),sequences:[...actors].flatMap(([actorId,row])=>[...row].map(([name,id])=>({actorId,name,id,live:runtime.emitters.has(id)})))};},
  };
}

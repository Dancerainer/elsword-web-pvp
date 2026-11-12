/** Every hit sphere comes from the owner's actual profession pose library. */
export function createProfessionSamplers(samplers,defaultProfessionId='RF') {
  const forActor=actor=>{
    const id=actor?.professionId??defaultProfessionId,result=samplers[id];
    if(!result)throw new RangeError('Missing profession pose library: '+id);
    return result;
  };
  const forEffect=(effect,actor)=>effect.sourceProfessionId?forActor({professionId:effect.sourceProfessionId}):forActor(actor);
  return {
    collisionSampler:(actor,options)=>forActor(actor).collisionSampler(actor,options),
    defenderSampler:actor=>forActor(actor).defenderSampler(actor),
    motionOffsetSampler:actor=>forActor(actor).motionOffsetSampler(actor),
    effectAnchorSampler:(effect,actor)=>forActor(actor).effectAnchorSampler(effect,actor),
    effectSampler:(effect,actor)=>forEffect(effect,actor).effectSampler(effect,actor),
    effectBoneSampler:(effect,actor,name,options)=>forEffect(effect,actor).effectBoneSampler(effect,actor,name,options),
    effectBoneMatrixSampler:(effect,actor,name,options)=>forEffect(effect,actor).effectBoneMatrixSampler?.(effect,actor,name,options)??null,
    nasodAttackSampler:(core,owner)=>forActor(owner).nasodAttackSampler(core),
    summonPoseSampler:(npc,definition,owner)=>forActor(owner??{professionId:'MM'}).summonPoseSampler?.(npc,definition,owner)??null,
    summonAnimationDuration:(npc,state,owner)=>forActor(owner??{professionId:'MM'}).summonAnimationDuration?.(npc,state,owner)??null,
    summonDefenderSampler:(npc,owner)=>forActor(owner??{professionId:'MM'}).summonDefenderSampler?.(npc,owner)??[],
    effectSamplingStats:()=>Object.fromEntries(Object.entries(samplers).map(([id,s])=>[id,s.effectSamplingStats()])),
  };
}

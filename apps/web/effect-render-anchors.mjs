/** Display-only attachment sampling. The particle runtime continues to own
 * lifetime, velocity and the source anchor. Only particles which the source
 * already moves with their emitter receive its displayed anchor correction.
 * World particles, impact/birth anchors and source-controlled flying meshes
 * therefore keep their independent trajectory. */
import {usesSourceTracePosition} from '../../packages/combat-core/trace-mesh-phase.mjs';
import {hasSetMeshBoneTarget,sampleSetMeshBoneAnchor} from '../../packages/combat-core/lk-effect-set-targets.mjs';

export function createEffectRenderState(state,actors,samplers){
  if(!state||!actors)return null;
  const current=new Map(state.actors.map(actor=>[actor.id,actor])),shown=new Map(actors.map(actor=>[actor.id,actor]));
  let effects=(state.effects??[]).map(effect=>{
    // Independent Add meshes/NPC bone anchors already use their source world
    // transform. Interpolating the caster cannot move the summon or its FX.
    if(effect.sourceAddSummonSerial!==undefined||effect.sourceAddFury||effect.sourceAddQuicksilverLink)return effect;
    // A saved TRACE mesh phase is still attached to its owner. Keep its saved
    // phase/rotation and translate only its output anchors with that actor.
    // Native independent motion controllers never inherit this correction.
    if(!effect.sourcePosedAnchor||!usesSourceTracePosition(effect)||effect.sourceSkillMeshControl||effect.sourceXCrashMeshClock)return effect;
    const a=current.get(effect.ownerId),b=shown.get(effect.ownerId);if(!a||!b)return effect;
    const delta=['x','y','z'].map(key=>b[key]-a[key]);
    if(!delta.every(Number.isFinite)||!delta.some(n=>n!==0))return effect;
    const shift=anchor=>anchor?.position?{...anchor,position:offsetEffectPosition(anchor.position,delta)}:anchor;
    return {...effect,sourcePosedAnchor:shift(effect.sourcePosedAnchor),currentAnchor:shift(effect.currentAnchor)};
  });
  if(samplers?.effectBoneSampler){
    // LK EffectSet children attach to the exact summoned mesh, whose bones
    // must use the same displayed owner pose as its mesh. A frozen/dead target
    // retains its saved anchor; it must not start following the owner again.
    const targets=effects.map(effect=>{
      if(effect.sourceAddSummonSerial!==undefined||effect.sourceBoneEffectSetId!==effect.id||hasSetMeshBoneTarget(effect)||!effect.active||effect.dead||
        ![effect.definition.TRACE,effect.definition.TRACE_MORE,effect.definition.TRACE_MATRIX].includes(1)||effect.sourcePosedAnchor)return effect;
      const actor=shown.get(effect.ownerId),anchor=actor&&samplers.effectAnchorSampler?.(effect,actor);
      return anchor?{...effect,currentAnchor:anchor}:effect;
    });
    effects=targets.map(effect=>{
      if(effect.sourceAddSummonSerial!==undefined||!hasSetMeshBoneTarget(effect)||!effect.active||effect.dead)return effect;
      const actor=shown.get(effect.ownerId);if(!actor)return effect;
      const anchor=sampleSetMeshBoneAnchor(effect,targets,actor,samplers.effectBoneSampler,samplers.effectBoneMatrixSampler);
      return anchor?{...effect,currentAnchor:anchor}:effect;
    });
  }
  return {...state,actors,effects};
}

export function createEffectRenderOffsets(runtime, state) {
  const offsets=new Map();
  const finite=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
  function offset(particle,depth=0){
    if(!state||!particle||depth>6)return null;
    const emitter=runtime.emitters.get(particle.emitterId);
    if(!emitter)return null;
    if(offsets.has(emitter.id))return offsets.get(emitter.id);
    const {options,template}=emitter;
    const follows=options.traceMore===true||options.trace===true||template.fields.Trace===true||template.kind==='mesh'&&options.follow===true;
    let delta=null;
    if(follows&&!options.sourceControl){
      if(options.anchor){
        const position=options.anchor(state);
        if(finite(position)&&finite(emitter.position)){
          const candidate=position.map((n,i)=>n-emitter.position[i]);
          if(candidate.some(n=>n!==0))delta=candidate;
        }
      }else if(options.parentParticleId!=null){
        // Trace children inherit only a live parent-position link. Children
        // which leave world-space trails and detached AutoDie tails do not.
        delta=offset(runtime.particles.get(options.parentParticleId),depth+1);
      }
    }
    offsets.set(emitter.id,delta);return delta;
  }
  return offset;
}

export function offsetEffectPosition(position,delta){
  return delta?position.map((n,i)=>n+delta[i]):position;
}

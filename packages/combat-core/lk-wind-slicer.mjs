/** Target2016 Wind Slicer + fixed-V5 EffectSet target-mesh consumer.
 * Bounded to this declared set. This is source-informed JS, not a measured
 * target-client trace. In particular, no other BONE_TRACE_TARGET_MESH set is
 * silently treated as a constant-velocity projectile.
 */
export const WIND_SLICER_SET='EffectSet_SI_P_ELK_WIND_SLICER';
export const WIND_SLICER_CARRIER='ELK_Wild_Slicer_Projetile';
const f=Math.fround,clone=structuredClone;
export const isWindSlicerCarrier=e=>e.setName===WIND_SLICER_SET&&e.name===WIND_SLICER_CARRIER;
export const hasSetTarget=e=>Object.hasOwn(e,'sourceTargetMeshId');

export function bindWindSlicerSet(effects,profile){
  const carrier=effects.find(isWindSlicerCarrier);if(!carrier)return;
  const t=profile.effectTemplates[carrier.name],d=carrier.definition;
  if(d.BONE_TRACE_TARGET_MESH!==1||d.TRACE_USER_TARGET_FORCE!==1||d.BONE_NAME!=='Bip01'||
    t?.fields.LifeType!=='LT_TIME'||t.fields.MeshType!=='X_SKIN_MESH'||
    JSON.stringify(t.initialVelocity)!=='[1500,0,0]'||t.initialDirSpeed!==1000||t.fields.LifeTime!==.55)
    throw new TypeError('Unverified Wind Slicer target-mesh declaration');
  for(const e of effects){
    e.sourceEffectSetId=carrier.id;
    if(e!==carrier&&e.definition.TRACE_MORE===1&&e.definition.TRACE_USER_TARGET_FORCE!==1)e.sourceTargetMeshId=carrier.id;
  }
}

/** MeshPlayer369 initializes with .0001f. Velocity and DirSpeed are separate
 * additive displacements (1683/1725 and1796–1822); facing is fixed at birth.
 * Only the two cardinal rotations authored by this set are accepted.
 */
export function initializeWindCarrier(e){
  const a=e.birthAnchor;if(!a?.position)throw new TypeError('Wind Slicer original Bip01 anchor required');
  const r=a.rotation??[0,a.facing<0?180:0,0];
  if(r[0]!==0||r[2]!==0||![0,180].includes(r[1]))throw new TypeError('Unverified Wind Slicer movement rotation');
  e.currentAnchor=clone(a);e.meshLifetimeElapsed=0;e.elapsed=0;e.animationTime=0;
  advanceWindCarrier(e,.0001);
}
function advanceWindCarrier(e,dt){
  if(e.meshLifetimeElapsed>=f(e.lifeTimeSeconds)){e.dead=true;e.endReason='template-life-time';return;}
  const elapsed=f(dt),old=e.elapsed;e.elapsed=f(old+elapsed);
  const velocityTime=f(e.elapsed-old),a=e.currentAnchor,face=(a.rotation?.[1]??(a.facing<0?180:0))===180?-1:1;
  // The selected V5 accumulated-velocity branch rounds each packet separately.
  a.position[0]=f(f(a.position[0]+f(f(e.initialVelocity[0]*velocityTime)*face))+f(f(e.initialDirSpeed*elapsed)*face));
  e.meshLifetimeElapsed=f(e.meshLifetimeElapsed+elapsed);e.animationTime=e.elapsed;
  [e.x,e.y,e.z]=a.position;
}
function targetFor(e,effects){return effects.find(t=>t.id===e.sourceTargetMeshId&&t.ownerId===e.ownerId&&
  t.sourceEffectSetId===e.sourceEffectSetId&&t.sourceSetTargetMesh&&!t.dead&&t.active);}
export function windSlicerBirthAnchor(e,effects){
  if(!hasSetTarget(e))return null;
  const t=targetFor(e,effects);return t?clone(t.currentAnchor):null;
}
export function advanceWindSlicerSets(effects,dt){
  for(const e of effects)if(e.sourceSetTargetMesh&&e.active&&!e.dead)advanceWindCarrier(e,dt);
  for(const e of effects){
    if(!hasSetTarget(e)||!e.active||e.dead)continue;
    const pending=e.currentAnchor??e.birthAnchor;if(!pending)continue;
    // The damage skin matrix was posed before EffectSet SetPos. Its own
    // template Velocity750 contributes to that pose for this packet, then
    // SetPos replaces its pending position with the flying carrier position.
    if(e.damage){
      e.sourcePosedAnchor=clone(pending);
      const face=(pending.rotation?.[1]??(pending.facing<0?180:0))===180?-1:1;
      e.sourcePosedAnchor.position[0]=f(e.sourcePosedAnchor.position[0]+f(f(e.initialVelocity[0]*f(dt))*face));
    }
    const target=targetFor(e,effects);
    if(target){e.currentAnchor={...clone(pending),position:[...target.currentAnchor.position]};[e.x,e.y,e.z]=e.currentAnchor.position;}
    else if(e.damage){e.currentAnchor=clone(e.sourcePosedAnchor);[e.x,e.y,e.z]=e.currentAnchor.position;}
    // A vanished target leaves the last position untouched. Native1288–1314
    // breaks SetPos once the target handle is invalid; never bind to owner.
    // The damage mesh still runs its own Velocity until its .65s lifetime.
  }
}
export function windSlicerVisualLifetime(e,profile){
  if(!hasSetTarget(e)||e.damage)return null;
  const t=profile.effectTemplates[e.name];
  return typeof t?.fields.TriggerTime==='number'&&typeof t?.fields.Lifetime==='number'
    ?t.fields.TriggerTime+t.fields.Lifetime:null;
}

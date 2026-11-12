/** The source has two independent constructors. XMeshTemplet (main mesh
 * players) defaults ZEnable/ZWriteEnable to false; CParticleEventSequence
 * (including PT_MESH/PT_SKINMESH particles) defaults both to true. Planes
 * override writes to false in their draw path. Keep explicit declarations.
 * See contracts/rf-effect-depth-source-v7.json; a shared true default turns
 * a zero-colour XCrash attack-box mesh into a rectangular depth occluder. */
export function nativeEffectDepthProfile(template){
  const fields=template?.fields??{},meshPlayer=template?.kind==='mesh';
  return {
    depthTest:fields.ZEnable??!meshPlayer,
    depthWrite:fields.particleType==='PT_3D_PLANE'?false:fields.ZWriteEnable??!meshPlayer,
  };
}

/** A main mesh with a literal zero colour for its entire life cannot change
 * colour under SRCALPHA/INVSRCALPHA, or depth when writes are disabled. Its
 * runtime particle, children, source pose and combat bindings still execute;
 * only model clones/materials/draws may be omitted. Reject animation fades,
 * random colours, unknown events and alternate passes rather than guessing. */
export function nativeEffectMeshHasNoOutput(template){
  const fields=template?.fields??{};
  if(template?.kind!=='mesh'||template.unsupported?.length||nativeEffectDepthProfile(template).depthWrite||
    (fields.RenderType??fields.MeshRenderType??'RT_REAL_COLOR')!=='RT_REAL_COLOR'||
    (fields.SourceBlendMode??'D3DBLEND_SRCALPHA')!=='D3DBLEND_SRCALPHA'||
    (fields.DestBlendMode??'D3DBLEND_INVSRCALPHA')!=='D3DBLEND_INVSRCALPHA')return false;
  const colors=(template.events??[]).filter(event=>event.property?.toUpperCase()==='COLOR');
  return colors.some(event=>event.start===0&&event.end===0&&!event.fade)&&
    colors.every(event=>!event.fade&&Array.isArray(event.value)&&event.value.length===4&&event.value.every(n=>n===0));
}

/** Successful source conversion emits glb:null plus poseData when the X file
 * contains only native attack helpers. Those poses stay in combat assets.
 * With no Trace/Final/Particle descendants, a second display-only sequence
 * has no output or child scheduling to perform, whatever its source lifetime.
 * Missing/failed conversions do not satisfy this predicate. */
export function nativeEffectMeshHasOnlyCombatHelpers(template){
  if(template?.kind!=='mesh'||template.glb!==null||typeof template.poseData!=='string'||template.unsupported?.length)return false;
  const fields=template.fields??{},repeated=template.repeated??{};
  return ['TraceParticleList','FinalParticleList','ParticleList'].every(key=>fields[key]==null&&repeated[key]==null);
}

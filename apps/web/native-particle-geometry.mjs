/** Native particle type chooses the geometry; a leftover Mesh field does not.
 * Fixed ParticleSystem Clone5557 / Render3360 dispatch on m_ParticleType.
 * Standalone mesh templates have no particle type and keep their GLB path. */
export function usesNativeMeshGeometry(template){
  if(!template?.glb)return false;
  const type=template.fields?.particleType;
  return type==='PT_MESH'||type==='PT_SKINMESH'||!type&&template.kind==='mesh';
}

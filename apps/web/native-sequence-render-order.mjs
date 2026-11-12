/** A native alpha object is a CParticleEventSequence, not an individual mesh
 * child or a template containing unrelated emitters. Fixed V5 ObjectChainSort
 * orders its layer and emitter distance; OnFrameRenderMesh_Draw then retains
 * particle-list, DrawCount and material-child order inside that sequence.
 */
const sequences=new WeakMap();

export function nativeParticleTextureEventId(particle){
  let id=null;
  for(const event of particle.channels.get('Texture')??[]){
    if(particle.age<event.start)break;
    id=event.nativeTextureId;
  }
  return id;
}

/** PT_3D_PLANE walks the native std::map<int,Texture*> in ascending ID,
 * collects particles in list order, then repeats that entire group's DVB.
 * A reused texture file at two IDs still represents two distinct groups. */
export function nativeQuadTextureDrawGroups(rows){
  const textures=new Map();
  for(const row of rows){
    const id=Number(row.textureId);
    if(!Number.isInteger(id))throw Error('Invalid native particle texture id');
    if(!textures.has(id))textures.set(id,[]);
    textures.get(id).push(row);
  }
  const draws=[];
  for(const [textureId,particles] of [...textures].sort((a,b)=>a[0]-b[0])){
    const count=particles.reduce((max,row)=>Math.max(max,row.drawCount),0);
    for(let draw=0;draw<count;draw++)draws.push({textureId,draw,rows:particles.filter(row=>draw<row.drawCount)});
  }
  return draws;
}

export function setNativeSequenceRenderOrder(meshes,{emitterId,position,cameraPosition,particleOrder=0,drawOrder=0}){
  const distance=Math.hypot(position[0]*.01-cameraPosition[0],
    position[1]*.01-cameraPosition[1],-position[2]*.01-cameraPosition[2]);
  if(!Number.isFinite(distance))throw Error('Non-finite native sequence distance');
  for(let childOrder=0;childOrder<meshes.length;childOrder++){
    const mesh=meshes[childOrder];
    let sequence=sequences.get(mesh);
    if(!sequence){sequence={};sequences.set(mesh,sequence);}
    sequence.emitterId=emitterId;sequence.distance=distance;sequence.particleOrder=particleOrder;
    sequence.drawOrder=drawOrder;sequence.childOrder=childOrder;
  }
}

export function nativeSequenceRenderOrder(mesh){return sequences.get(mesh);}

export function compareNativeTransparentSubMeshes(a,b){
  const layer=a._alphaIndex-b._alphaIndex;if(layer)return layer;
  const ma=a.getMesh(),mb=b.getMesh(),sa=sequences.get(ma),sb=sequences.get(mb);
  const distance=(sb?.distance??b._distanceToCamera)-(sa?.distance??a._distanceToCamera);
  if(distance)return distance;
  if(sa&&sb){
    return sa.emitterId-sb.emitterId||sa.particleOrder-sb.particleOrder||
      sa.drawOrder-sb.drawOrder||sa.childOrder-sb.childOrder||(a.index??0)-(b.index??0);
  }
  // Equal-distance ordinary world/actor objects retain a stable unit identity.
  // Keep a sequence contiguous even if another object's center is identical.
  if(Boolean(sa)!==Boolean(sb))return sa?-1:1;
  return (ma.uniqueId??0)-(mb.uniqueId??0)||(a.index??0)-(b.index??0);
}

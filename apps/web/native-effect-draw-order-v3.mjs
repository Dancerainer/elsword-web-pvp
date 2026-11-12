/** Fixed V5 X2Define.h X2_LAYER and KTDGObject constructor default. Babylon's
 * alphaIndex defaults to Number.MAX_VALUE: adding a native layer to that
 * default loses the offset. Map, actors and effects must use one finite scale.
 * This orders Babylon's transparent queue only; native opaque/alpha layer
 * groups and cross-template sequence interleaving are separate consumers.
 */
export const NATIVE_UNIT_LAYER=11;
const layerNames=['XL_GAME_BASE','XL_SKY_DOME_0','XL_SKY_DOME_1','XL_SKY_DOME_2',
  'XL_SKY_WORLD_BASE_0','XL_SKY_WORLD_BASE_1','XL_SKY_WORLD_BASE_2',
  'XL_SKY_WORLD_OBJECT_0','XL_SKY_WORLD_OBJECT_1','XL_SKY_WORLD_OBJECT_2',
  'XL_UNIT_0','XL_UNIT_1','XL_UNIT_2','XL_EFFECT_0','XL_EFFECT_1','XL_EFFECT_2',
  'XL_SKY_WORLD_OBJECT_OVER_EFFECT_0','XL_SKY_WORLD_OBJECT_OVER_EFFECT_1',
  'XL_SKY_WORLD_OBJECT_OVER_EFFECT_2','XL_SKY_WORLD_OBJECT_OVER_EFFECT_3',
  'XL_EFFECT_OVER_ALL_WORLD_OBJECT_0','XL_EFFECT_OVER_ALL_WORLD_OBJECT_1',
  'XL_LENS_FLARE','XL_MINIMAP'];
const layers=new Map(layerNames.map((name,i)=>[name,i+1]));

export function nativeTransparentLayer(value){
  if(Number.isInteger(value))return value;
  if(typeof value==='string'){
    const name=value.startsWith('X2_LAYER.')?value.slice(9):value;
    if(layers.has(name))return layers.get(name);
    throw Error('Unconfirmed native transparent layer: '+value);
  }
  if(value==null)return 0;
  throw Error('Invalid native transparent layer');
}

export function setNativeTransparentLayer(meshes,value){
  const layer=nativeTransparentLayer(value);
  for(const mesh of meshes)mesh.alphaIndex=layer;
  return layer;
}

/** glTF conversion retains the object id on a parent node; the manifest keeps
 * the original SetLayer declaration. Walk ancestors, so all material children
 * of one source object inherit the same queue layer. Missing declarations use
 * the native CKTDGObject default zero, rather than an invented world layer.
 */
export function setNativeMapTransparentLayers(meshes,map){
  const objects=new Map((map.objects??[]).map(object=>[object.id,object]));
  let assigned=0;
  for(const mesh of meshes){
    let object;
    for(let node=mesh;node&&!object;node=node.parent){
      const id=node.metadata?.gltf?.extras?.nativeObject??node.metadata?.nativeObject??node.name;
      object=objects.get(id);
    }
    mesh.alphaIndex=nativeTransparentLayer(object?.layer);
    if(object)assigned++;
  }
  return assigned;
}

/** A zero-filled capacity buffer contains non-affine matrices (w=0). Babylon
 * automatically scans its full capacity on installation, producing NaN
 * bounds. Suppress that scan until the renderer writes active matrices.
 */
export function installNativeParticleMatrixBuffer(mesh,matrices){
  const previous=mesh.doNotSyncBoundingInfo;
  mesh.doNotSyncBoundingInfo=true;
  try{mesh.thinInstanceSetBuffer('matrix',matrices,16,false);}
  finally{mesh.doNotSyncBoundingInfo=previous;}
  mesh.thinInstanceCount=0;
}

/** BufferUpdated uploads the matrices but does not refresh bounds. Recompute
 * from the active count, excluding unused zero slots, so transparent sorting
 * sees the current finite batch center. No particle/draw is added or removed.
 */
export function uploadNativeParticleMatrices(mesh,count){
  mesh.thinInstanceCount=count;
  if(count<=0)return;
  mesh.thinInstanceBufferUpdated('matrix');
  mesh.thinInstanceRefreshBoundingInfo(false);
}

/** SetTex0UVSpeed is a world clock, independent of an actor or animation.
 * Materials/textures are copied per source object: a conveyor must not scroll
 * every mesh that happens to share the same converted texture.
 */
export function createMapUvScroll(meshes,map){
  const objects=new Map((map.objects??[]).map(o=>[o.id,o])),rows=[],materials=new Map(),textures=new Set();
  for(const mesh of meshes){
    let object;
    for(let node=mesh;node&&!object;node=node.parent){
      const id=node.metadata?.gltf?.extras?.nativeObject??node.metadata?.nativeObject??node.name;
      object=objects.get(id);
    }
    const speed=object?.declarations?.find(d=>d.callee==='SetTex0UVSpeed')?.arguments;
    if(!speed?.every(Number.isFinite)||speed.length!==2||!mesh.material)continue;
    const key=object.id+':'+mesh.material.uniqueId;
    let material=materials.get(key);
    if(!material){
      material=mesh.material.clone('scroll-'+key);materials.set(key,material);
      // glTF materials use albedoTexture; StandardMaterial uses diffuseTexture.
      for(const field of ['albedoTexture','diffuseTexture','opacityTexture']){
        const source=material[field];if(!source)continue;
        const texture=source.clone();texture.wrapU=texture.wrapV=1;
        material[field]=texture;textures.add(texture);
        rows.push({objectId:object.id,speed:[...speed],texture,start:[texture.uOffset??0,texture.vOffset??0]});
      }
    }
    mesh.material=material;
  }
  let time=0;
  return {step(dt){if(!(Number.isFinite(dt)&&dt>=0))throw new RangeError('UV dt must be nonnegative');
    time+=dt;for(const row of rows){row.texture.uOffset=row.start[0]+row.speed[0]*time;row.texture.vOffset=row.start[1]+row.speed[1]*time;}},
    proof(){return {time,objects:rows.map(row=>({objectId:row.objectId,speed:row.speed,offset:[row.texture.uOffset,row.texture.vOffset]}))};},
    dispose(){for(const texture of textures)texture.dispose();for(const material of materials.values())material.dispose();}
  };
}

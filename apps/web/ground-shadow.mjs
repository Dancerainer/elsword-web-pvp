import {Mesh,VertexData,StandardMaterial,Color3,Texture} from '@babylonjs/core';
import {authoredLineBasis} from '../../packages/combat-assets/line-basis.mjs';
import source from '../../contracts/common-presentation-source-v28.json' with {type:'json'};
export function groundShadowValues(actor){
  const land=actor.landPosition;if(!Array.isArray(land)||land.length!==3||!land.every(Number.isFinite))return null;
  const distance=Math.hypot(actor.x-land[0],actor.y-land[1],(actor.z??0)-land[2]);if(!Number.isFinite(distance))return null;
  return {land:[...land],distance,sizeFactor:1-distance/300,alpha:Math.max(0,Math.min(1,.8-distance/200))};
}
export function createGroundShadows({scene,textureUrl,profileFor,mapFor}){
  const texture=new Texture(textureUrl,scene,false,false,Texture.BILINEAR_SAMPLINGMODE);texture.hasAlpha=true;
  texture.wrapU=texture.wrapV=Texture.CLAMP_ADDRESSMODE;const rows=new Map();
  function create(actor,size){
    const mesh=new Mesh('source-ground-shadow:'+actor.id,scene),data=new VertexData();
    data.positions=[-size/2,2,size/2,-size/2,2,-size/2,size/2,2,size/2,size/2,2,-size/2];
    data.uvs=[0,0,0,1,1,0,1,1];data.indices=[0,1,2,2,1,3];data.normals=[0,1,0,0,1,0,0,1,0,0,1,0];data.applyToMesh(mesh);
    const material=new StandardMaterial(mesh.name,scene);material.disableLighting=true;material.emissiveColor=Color3.White();
    material.diffuseTexture=texture;material.useAlphaFromDiffuseTexture=true;material.backFaceCulling=false;material.disableDepthWrite=true;
    mesh.material=material;mesh.isPickable=false;mesh.alphaIndex=14;mesh.scaling.setAll(.01);const row={mesh,material,size};rows.set(actor.id,row);return row;
  }
  return {
    step(actors){const live=new Set(actors.map(a=>a.id));for(const [id,row]of rows)if(!live.has(id)){row.mesh.dispose();row.material.dispose();rows.delete(id);}
      for(const actor of actors){const raw=profileFor(actor)?.components,values=groundShadowValues(actor);
        if(raw?.SHADOW_FILE_NAME?.toLowerCase()!=='shadow.dds'||!Number.isFinite(raw.SHADOW_SIZE))continue;
        const row=rows.get(actor.id)??create(actor,raw.SHADOW_SIZE),show=!!values&&actor.hidden!==true&&!actor.absoluteInvisibility&&values.alpha>0;
        row.mesh.setEnabled(show);row.values=values;if(!show)continue;
        row.mesh.position.set(values.land[0]*.01,values.land[1]*.01,-values.land[2]*.01);
        row.mesh.rotation.y=authoredLineBasis(actor,mapFor()).rendererYawRadians;
        row.mesh.scaling.set(.01*values.sizeFactor,.01,.01*values.sizeFactor);row.material.alpha=values.alpha;
      }},
    clear(){for(const row of rows.values()){row.mesh.dispose();row.material.dispose();}rows.clear();},
    dispose(){this.clear();texture.dispose();},
    proof:()=>[...rows].map(([actorId,r])=>({actorId,enabled:r.mesh.isEnabled(),size:r.size,...r.values,sourceTextureSha256:source.shadow.sha256})),
  };
}

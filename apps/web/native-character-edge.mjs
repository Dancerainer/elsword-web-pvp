import {ShaderMaterial,Vector4} from '@babylonjs/core';
const vertex=`precision highp float;attribute vec3 position;attribute vec3 normal;
uniform mat4 world;uniform mat4 viewProjection;uniform float nativeWidth;
#include<bonesDeclaration>
void main(){vec3 positionUpdated=position;mat4 finalWorld=world;
#include<bonesVertex>
vec4 worldPosition=finalWorld*vec4(position,1.0);
// No normalization: VertSkinningBlackEdge consumes the raw palette normal.
worldPosition.xyz+=mat3(finalWorld)*normal*nativeWidth;
gl_Position=viewProjection*worldPosition;}`;
const fragment=`precision highp float;uniform vec4 nativeEdgeColor;
void main(){gl_FragColor=nativeEdgeColor;}`;
const installed=new WeakMap();
const scenes=new WeakSet();
export function installNativeCharacterEdge(mesh){
  let row=installed.get(mesh);if(row)return row;
  if(!mesh.getTotalVertices()||!mesh.isVerticesDataPresent('normal'))return null;
  const scene=mesh.getScene();if(!scenes.has(scene)){
    const renderer=scene.getOutlineRenderer(),original=renderer.render;
    renderer.render=function(subMesh,batch,overlay,...args){
      if(!overlay&&installed.has(subMesh.getRenderingMesh()))return;
      return original.call(this,subMesh,batch,overlay,...args);
    };scenes.add(scene);
  }
  const edge=mesh.clone(mesh.name+':native-edge',mesh.parent,true),material=new ShaderMaterial(edge.name,mesh.getScene(),{vertexSource:vertex,fragmentSource:fragment},
    {attributes:['position','normal','matricesIndices','matricesWeights'],uniforms:['world','viewProjection','mBones','nativeWidth','nativeEdgeColor']});
  edge.material=material;edge.skeleton=mesh.skeleton;edge.renderOutline=false;edge.isPickable=false;
  edge.metadata={...edge.metadata,nativeCharacterEdge:true};material.backFaceCulling=true;material.cullBackFaces=false;
  const color=new Vector4(0,0,0,1);
  material.setFloat('nativeWidth',mesh.outlineWidth);material.setVector4('nativeEdgeColor',color);edge.setEnabled(false);
  row={edge,material,color};installed.set(mesh,row);
  mesh.onDisposeObservable.addOnce(()=>{edge.dispose();material.dispose();installed.delete(mesh);});return row;
}
export function updateNativeCharacterEdge(mesh){
  const row=installed.get(mesh);if(!row)return;
  row.edge.position.copyFrom(mesh.position);row.edge.scaling.copyFrom(mesh.scaling);row.edge.rotation.copyFrom(mesh.rotation);
  if(mesh.rotationQuaternion){if(row.edge.rotationQuaternion)row.edge.rotationQuaternion.copyFrom(mesh.rotationQuaternion);else row.edge.rotationQuaternion=mesh.rotationQuaternion.clone();}
  else row.edge.rotationQuaternion=null;
  row.edge.visibility=mesh.visibility;row.edge.alphaIndex=mesh.alphaIndex;row.edge.renderingGroupId=mesh.renderingGroupId;
  row.edge.setEnabled(mesh.renderOutline===true&&mesh.isVisible&&mesh.isEnabled()&&mesh.visibility>0);
  row.material.setFloat('nativeWidth',mesh.outlineWidth);const c=mesh.outlineColor;
  row.color.set(c.r,c.g,c.b,mesh.visibility);row.material.setVector4('nativeEdgeColor',row.color);
  // The source second pass has a solid edge, so it deliberately ignores the
  // surface alpha-test texture. Suppress Babylon's different outline pass.
}
export function nativeCharacterEdge(mesh){return installed.get(mesh);}

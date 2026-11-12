import {Vector3} from '@babylonjs/core';

const sourcePositions=[-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0];
const sourceIndices=[0,1,2,0,2,3];
const minimum=new Vector3(),maximum=new Vector3();
function same(data,expected){
  if(data?.length!==expected.length)return false;
  for(let i=0;i<expected.length;i++)if(data[i]!==expected[i])return false;
  return true;
}

/** Exact bounds for the renderer's canonical single-face quad. The source
 * plane has x/y in [-.5,.5], z=0; an affine transform's extent on each axis is
 * .5*(abs(first column)+abs(second column)). Union only active Float32 rows.
 *
 * This replaces eight corner transformations per instance without changing
 * geometric bounds. BoundingInfo and its box/sphere vectors stay in place.
 * Return false for other geometry/base transforms/projective rows so callers
 * can use Babylon's general path. Invalid active input throws before changing
 * bounds; zero active instances preserve the last bounds like the existing
 * upload helper. The caller owns thinInstanceCount and GPU matrix uploads.
 */
export function refreshNativeQuadBounds(mesh,matrices,count){
  if(!(matrices instanceof Float32Array)||!Number.isInteger(count)||count<0||count*16>matrices.length)
    throw new RangeError('Invalid native quad bounds matrix count');
  if(!mesh||mesh.subMeshes?.length!==1||!mesh.subMeshes[0].IsGlobal||
    mesh.getTotalVertices()!==4||!same(mesh.getVerticesData('position'),sourcePositions)||
    !same(mesh.getIndices(),sourceIndices)||!mesh.getWorldMatrix().isIdentity()||
    (mesh.geometry?.boundingBias&&(mesh.geometry.boundingBias.x!==0||mesh.geometry.boundingBias.y!==0))||
    mesh.skeleton||mesh.morphTargetManager||mesh.bakedVertexAnimationManager?.isEnabled||
    typeof mesh._updateBoundingInfo!=='function')return false;
  if(count===0)return true;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  let affine=true;
  for(let offset=0;offset<count*16;offset+=16){
    for(let component=0;component<16;component++)if(!Number.isFinite(matrices[offset+component]))
      throw new RangeError('Non-finite active native quad bounds matrix');
    if(matrices[offset+3]!==0||matrices[offset+7]!==0||matrices[offset+11]!==0||matrices[offset+15]!==1)affine=false;
    const x=matrices[offset+12],y=matrices[offset+13],z=matrices[offset+14];
    const ex=.5*(Math.abs(matrices[offset])+Math.abs(matrices[offset+4]));
    const ey=.5*(Math.abs(matrices[offset+1])+Math.abs(matrices[offset+5]));
    const ez=.5*(Math.abs(matrices[offset+2])+Math.abs(matrices[offset+6]));
    minX=Math.min(minX,x-ex);minY=Math.min(minY,y-ey);minZ=Math.min(minZ,z-ez);
    maxX=Math.max(maxX,x+ex);maxY=Math.max(maxY,y+ey);maxZ=Math.max(maxZ,z+ez);
  }
  if(!affine)return false;
  minimum.set(minX,minY,minZ);maximum.set(maxX,maxY,maxZ);
  mesh.getBoundingInfo().reConstruct(minimum,maximum);
  mesh._updateBoundingInfo();
  return true;
}

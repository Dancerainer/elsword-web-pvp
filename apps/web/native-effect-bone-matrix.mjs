/** EffectSet1437/3188 SetUseDXMatrix copies the complete traced bone matrix.
 * The source anchor is column-major/native XYZ. Model conversion already
 * reflected local Z, so conjugate once and convert native world units once.
 * Keeping the matrix avoids losing bone shear through an Euler/SRT roundtrip.
 */
export function writeNativeEffectBoneMatrix(source,target,size=[1,1,1],scale=[1,1,1],units=.01){
  if(source?.length!==16||!source.every(Number.isFinite))throw new TypeError('Complete original bone matrix required');
  for(let col=0;col<4;col++)for(let row=0;row<4;row++){
    const reflection=(row===2?-1:1)*(col===2?-1:1);
    target[col*4+row]=source[col*4+row]*reflection*(row<3?units:1)*(col<3?size[col]*scale[col]:1);
  }
  return target;
}

/** ParticleSystem3890–3937 BT_NONE uses Scale * Rotate * DXMatrix in
 * native row convention. Its column equivalent keeps the exact bone/shear,
 * then applies the particle's local axes. Camera billboard axes are absent
 * from this source branch. Native units/Z reflection are converted once. */
export function writeNativeEffectBonePlaneMatrix(source,target,size=[1,1,1],scale=[1,1,1],degrees=[0,0,0],units=.01){
  if(source?.length!==16||!source.every(Number.isFinite)||degrees?.length!==3||!degrees.every(Number.isFinite))
    throw new TypeError('Complete original bone matrix and BT_NONE rotation required');
  const [x,y,z]=degrees.map(n=>n*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
  const columns=[[cz*cy+sz*sx*sy,sz*cx,-cz*sy+sz*sx*cy],[-sz*cy+cz*sx*sy,cz*cx,sz*sy+cz*sx*cy],[cx*sy,-sx,cx*cy]];
  for(let col=0;col<4;col++)for(let row=0;row<4;row++){
    const axis=columns[col],value=col===3?source[12+row]:(source[row]*axis[0]+source[4+row]*axis[1]+source[8+row]*axis[2])*size[col]*scale[col];
    target[col*4+row]=value*(row===2?-1:1)*(col===2?-1:1)*(row<3?units:1);
  }
  return target;
}

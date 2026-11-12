// Babylon setters dirty the world transform even for identical numbers. These
// calls only skip identical SRT writes; signed zero is preserved, and no
// epsilon, frame skipping, pose caching or animation-rate reduction is used.
export function setVector3Exact(target,x,y,z){
  if(!Object.is(target.x,x)||!Object.is(target.y,y)||!Object.is(target.z,z))target.set(x,y,z);
}
export function setQuaternionExact(target,x,y,z,w){
  if(!Object.is(target.x,x)||!Object.is(target.y,y)||!Object.is(target.z,z)||!Object.is(target.w,w))target.set(x,y,z,w);
}

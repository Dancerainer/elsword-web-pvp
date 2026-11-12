/** Fixed V5 ParticleSystem.cpp:3981/3994/4007/4028 stores D3DXCOLOR as
 * a DWORD vertex diffuse colour before modulating the source texture.
 * D3DXCOLOR's DWORD cast saturates and rounds each float to an 8-bit channel.
 * The simulation keeps the authored float (including alpha=100); only this
 * vertex upload applies the original fixed-function representation. */
export function nativeParticleColorChannel(value) {
  const number=Math.fround(value);
  return number>=1?1:number<=0?0:Math.trunc(Math.fround(Math.fround(number*255)+.5))/255;
}
export function writeNativeParticleColor(target,offset,color) {
  for(let i=0;i<4;i++)target[offset+i]=nativeParticleColorChannel(color[i]);
  return target;
}

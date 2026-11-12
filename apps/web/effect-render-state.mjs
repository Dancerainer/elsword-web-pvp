/** Scope the native particle's render overrides to its actual material draw.
 *
 * Mesh.render calls setAlphaMode before Material._afterBind. The latter runs
 * onBind, then applies disableDepthWrite; Material.unbind runs onUnBind, then
 * restores its depth-write/function overrides. Keep those material-owned
 * states with Babylon and restore only the blend factors and depth test we
 * change here. Native ParticleSystem uses the same PushRenderState/KD3DEND
 * scope; it does not leave its SRCBLEND/DESTBLEND behind for map materials.
 */
export function installNativeEffectRenderState(material,engine,{sourceBlend,destBlend,depthTest=true}){
  if(!Number.isInteger(sourceBlend)||!Number.isInteger(destBlend))throw new TypeError('Invalid native blend factors');
  const alphaState=engine.alphaState;
  // Babylon 9.29 exposes setters but no blend-factor getter. This single
  // version-bound adapter reads its cached values; restoration uses setters
  // so the next GPU draw receives the restored state, including dirty flags.
  if(!Array.isArray(alphaState?._blendFunctionParameters)||alphaState._blendFunctionParameters.length<4)
    throw new TypeError('Unsupported Babylon blend-state layout');
  const previousBlend=new Array(4);
  let previousDepthTest=true,bound=false;
  material.onBindObservable.add(()=>{
    previousDepthTest=engine.getDepthBuffer();
    for(let i=0;i<4;i++)previousBlend[i]=alphaState._blendFunctionParameters[i];
    bound=true;
    engine.setDepthBuffer(depthTest);
    alphaState.setAlphaBlendFunctionParameters(sourceBlend,destBlend,sourceBlend,destBlend);
  });
  material.onUnBindObservable.add(()=>{
    if(!bound)return;
    alphaState.setAlphaBlendFunctionParameters(previousBlend[0],previousBlend[1],previousBlend[2],previousBlend[3]);
    engine.setDepthBuffer(previousDepthTest);
    bound=false;
  });
}

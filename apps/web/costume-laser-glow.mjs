import {GlowLayer} from '@babylonjs/core/Layers/glowLayer.js';

// User-requested web display adjustment, not a measured NA2016 post-process.
// Extract only the original Nasod laser texels; the hilt, body, map and other
// costume effects never emit into this layer. One low-resolution layer is
// shared by all players in a scene and sleeps when its meshes are hidden.
export const nasodLaserGlowSettings=Object.freeze({
  evidence:'web-display-adjustment; target2016 glow radius/intensity unmeasured',
  mainTextureRatio:.5,blurKernelSize:24,intensity:1.6,
});
const scenes=new WeakMap();
export function registerNasodLaserGlow(view,itemId,scene){
  if(itemId!==130892&&itemId!==130895)return;
  const meshes=view.meshes.filter(mesh=>mesh.getTotalVertices()&&mesh.material?.albedoTexture);
  if(!meshes.length)return;
  let state=scenes.get(scene);
  if(!state){
    const layer=new GlowLayer('nasod-laser-glow',scene,{
      mainTextureRatio:nasodLaserGlowSettings.mainTextureRatio,
      blurKernelSize:nasodLaserGlowSettings.blurKernelSize,
    });
    layer.intensity=nasodLaserGlowSettings.intensity;layer.isEnabled=false;
    state={layer,meshes:new Set(),observer:null};scenes.set(scene,state);
    layer.customEmissiveTextureSelector=(mesh,subMesh,material)=>state.meshes.has(mesh)?material.albedoTexture:null;
    layer.customEmissiveColorSelector=(mesh,subMesh,material,color)=>{
      const visible=state.meshes.has(mesh)&&mesh.isEnabled()&&mesh.isVisible&&mesh.visibility>0;
      color.set(visible?1:0,visible?1:0,visible?1:0,visible?mesh.visibility:0);
    };
    state.observer=scene.onBeforeRenderObservable.add(()=>{
      layer.isEnabled=[...state.meshes].some(mesh=>mesh.isEnabled()&&mesh.isVisible&&mesh.visibility>0);
    });
    layer.onDisposeObservable.addOnce(()=>{
      scene.onBeforeRenderObservable.remove(state.observer);state.meshes.clear();
      if(scenes.get(scene)===state)scenes.delete(scene);
    });
  }
  for(const mesh of meshes){
    if(state.meshes.has(mesh))continue;
    state.meshes.add(mesh);state.layer.addIncludedOnlyMesh(mesh);
    mesh.onDisposeObservable.addOnce(()=>{
      state.layer.removeIncludedOnlyMesh(mesh);state.meshes.delete(mesh);
      // An empty inclusion list means ALL meshes to Babylon. Dispose before
      // the next frame so ordinary emissive skill/map materials cannot leak.
      if(!state.meshes.size)state.layer.dispose();
    });
  }
}

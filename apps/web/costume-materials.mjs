import {PBRMaterial} from '@babylonjs/core';
import {installNativeEffectMaterial} from './native-effect-material.mjs';
import {installNativeEffectRenderState} from './effect-render-state.mjs';

const blends={D3DBLEND_SRCALPHA:770,D3DBLEND_INVSRCALPHA:771,D3DBLEND_DESTALPHA:772};
/** Apply AFTER character styling, to cloned materials only. Source REAL_COLOR
 * consumes the texture directly; scene lighting/outline must not darken it. */
export function styleCostumeMaterials(view,profile,engine){
  if(!profile)return;
  const seen=new Set();
  for(const mesh of view.meshes){
    if(!mesh.getTotalVertices())continue;
    if(profile.realColor){mesh.renderOutline=false;mesh.outlineWidth=0;mesh.metadata={...mesh.metadata,costumeEffect:true};}
    const material=mesh.material;if(!material||seen.has(material))continue;seen.add(material);
    material.backFaceCulling=profile.cull!=='none';
    material.disableDepthWrite=!profile.depthWrite;
    // Blended Babylon materials normally disable depth writes independently
    // of disableDepthWrite. Preserve the explicit equipment source setting.
    material.forceDepthWrite=profile.depthWrite;
    if(profile.realColor)installNativeEffectMaterial(material);
    if(profile.blend){
      material.transparencyMode=profile.alphaTest?PBRMaterial.PBRMATERIAL_ALPHATESTANDBLEND:PBRMaterial.PBRMATERIAL_ALPHABLEND;
      material.useAlphaFromAlbedoTexture=true;
      // KTDGXRenderer.cpp alpha-test branch: GREATER, reference 0x88.
      if(profile.alphaTest)material.alphaCutOff=136/255;
      installNativeEffectRenderState(material,engine,{sourceBlend:blends[profile.sourceBlend],destBlend:blends[profile.destBlend]});
    }
  }
}

import {Color3, Constants, PBRMaterial, Vector3} from '@babylonjs/core';
import '@babylonjs/core/Rendering/outlineRenderer.js';
import {setNativeTransparentLayer} from './native-effect-draw-order-v3.mjs';
import {installNativeCharacterEdge,updateNativeCharacterEdge} from './native-character-edge.mjs';

// Target Raven_NasodBall: RT_CARTOON_COLOR_EDGE, white Color alpha=1,
// SRCALPHA/INVSRCALPHA, ZEnable/ZWriteEnable=true, OutLineWide=1500.
// Fixed V5 mesh consumer divides camera distance by OutLineWide before the
// target shader expands along the scaled (not normalized) world normal.
// Babylon expands a local normal before the same world transform. Undo only
// the fixed native-to-web coordinate unit; preserve helper and bone scales.
// Cartoon lighting is still the web display adapter, not the native ramp.
export const NASOD_CORE_PRESENTATION = Object.freeze({
  outlineDivisor:1500,
  idleOutline:Object.freeze([1, Math.fround(.333), Math.fround(.0745), 1]),
  evidence:'target2016 mesh declaration + fixed-V5 consumer; native cartoon ramp/GPU comparison pending',
});

export function styleNasodCore(view, {unitScale=view.root.scaling.x}={}) {
  if(!(unitScale>0)||!Number.isFinite(unitScale))throw Error('Invalid Nasod coordinate unit scale');
  // Capture once before gameplay applies the source helper scale to the root.
  view.nasodCoordinateUnitScale??=unitScale;
  setNativeTransparentLayer(view.meshes,14);
  for (const mesh of view.meshes) {
    if (!mesh.getTotalVertices()) continue;
    const materials=mesh.material?.subMaterials??[mesh.material];
    for (const material of materials) {
      if (!(material instanceof PBRMaterial)) continue;
      // Keep authored texture alpha and the declared blend factors. The core's
      // actual two textures are opaque, but this is not a global opaque policy.
      material.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHABLEND;
      material.alphaMode=Constants.ALPHA_COMBINE;
      material.forceDepthWrite=true;
      material.disableDepthWrite=false;
      material.disableDepthTest=false;
    }
    mesh.renderOutline=true;
    mesh.outlineColor=Color3.FromArray(NASOD_CORE_PRESENTATION.idleOutline);
    mesh.outlineAlpha=1;
    installNativeCharacterEdge(mesh);
  }
  return view;
}

export function updateNasodCorePresentation(view, {camera, outlineColor}={}) {
  const color=outlineColor??NASOD_CORE_PRESENTATION.idleOutline;
  camera?.getWorldMatrix?.();
  const cameraPosition=camera?.globalPosition??camera?.position;
  const rootPosition=view.root.getAbsolutePosition();
  const distance=cameraPosition?Vector3.Distance(cameraPosition,rootPosition):null;
  for (const mesh of view.meshes) {
    if (!mesh.getTotalVertices()) continue;
    mesh.renderOutline=true;
    mesh.outlineColor??=new Color3();
    mesh.outlineColor.set(...color.slice(0,3));
    mesh.outlineAlpha=color[3]??1;
    if (distance!==null) {
      // XRenderer.fx _VS_Skin and VertSkinningColorEdge retain world-palette
      // normal scale. In particular authored .001 hidden parts must remain
      // collapsed, rather than acquire a full-size edge from scale division.
      mesh.outlineWidth=distance/view.nasodCoordinateUnitScale/NASOD_CORE_PRESENTATION.outlineDivisor;
    }
    updateNativeCharacterEdge(mesh);
  }
}

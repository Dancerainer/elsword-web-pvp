import { Color3, Vector3, HemisphericLight, DirectionalLight } from '@babylonjs/core';
import '@babylonjs/core/Rendering/outlineRenderer.js';
import {installCharacterToonMaterial} from './character-toon-material.mjs';
import {installNativeCharacterEdge} from './native-character-edge.mjs';

// Explicit web display adapter, not measured 2016 shader/light settings.
export const presentationSettings = Object.freeze({
  evidence: 'web-display-adapter; target-client lighting/edge settings pending',
  ambientIntensity: .68, keyIntensity: .95, outlineWidthNative: 1.15,
  outlineColor: [0, 0, 0], maximumDevicePixelRatio: 2,
});

export function createLighting(scene) {
  const ambient = new HemisphericLight('ambient-fill', new Vector3(0, 1, 0), scene);
  ambient.intensity = presentationSettings.ambientIntensity;
  ambient.diffuse = new Color3(.94, .96, 1); ambient.groundColor = new Color3(.45, .43, .48);
  const key = new DirectionalLight('character-key', new Vector3(-.45, -1, -.6).normalize(), scene);
  key.intensity = presentationSettings.keyIntensity; key.diffuse = new Color3(1, .94, .85);
  scene.imageProcessingConfiguration.toneMappingEnabled = false;
  return { ambient, key };
}

export function styleCharacter(view) {
  for (const mesh of view.meshes) {
    if (!mesh.getTotalVertices()) continue;
    const material = mesh.material;
    if (material && 'unlit' in material) {
      material.unlit = false; material.metallic = 0; material.roughness = 1;
      material.environmentIntensity = 0;
      // Original cartoon ramps choose final display-space colour. Physical
      // PBR lamps no longer stand in for the character shader.
      material.disableLighting=true;installCharacterToonMaterial(material);
    }
    // Babylon's outline pass uses the same bone palette and alpha test as the
    // visible surface. It follows animation; it does not draw triangle wireframes.
    mesh.renderOutline = true; mesh.outlineWidth = presentationSettings.outlineWidthNative;
    mesh.outlineColor = Color3.FromArray(presentationSettings.outlineColor);
    installNativeCharacterEdge(mesh);
  }
}

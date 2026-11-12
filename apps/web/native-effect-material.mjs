import {MaterialPluginBase,PBRMaterial} from '@babylonjs/core';
import {disableCharacterToonMaterial} from './character-toon-material.mjs';

// Target XRenderer.fx REAL_COLOR: its vs_1_1 writes g_Color to Diffuse and
// stage 0 modulates Texture * Diffuse. This is a display-space multiplication,
// without PBR material colour, lighting, or a gamma-encoded tint. The vs_1_1
// colour output is saturated before rasterization, but is NOT a DWORD cast.
// Keep Babylon's vertex/skinning pipeline; replace only this final fragment.
// Source chain and the independent pixel oracle are recorded in
// contracts/rf-effect-real-color-source-v3.json.
const fragment = `
vec4 nativeEffectTexel = vec4(1.0);
#ifdef ALBEDO
nativeEffectTexel = albedoTexture;
#endif
#ifdef NATIVE_EFFECT_HARDWARE_SRGB
// glTF fallback textures can have hardware sRGB storage. Our runtime PNG
// replacements do not. Recover the original display-space texel in either
// case before applying the authored colour (alpha is always unencoded).
nativeEffectTexel.rgb = mix(12.92 * nativeEffectTexel.rgb,
  1.055 * pow(max(nativeEffectTexel.rgb, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
  step(vec3(0.0031308), nativeEffectTexel.rgb));
#endif
finalColor = nativeEffectTexel * clamp(nativeEffectColor, 0.0, 1.0);
finalColor.a *= visibility;
`;

class NativeRealColorPlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, 'NativeEffectRealColor', 200,
      {NATIVE_EFFECT_HARDWARE_SRGB: false}, true, false);
    this.color = [1, 1, 1, 1];
    this.registerForExtraEvents = true;
    this.doNotSerialize = true;
    this._enable(true);
  }
  getClassName() { return 'NativeRealColorPlugin'; }
  prepareDefines(defines) {
    defines.NATIVE_EFFECT_HARDWARE_SRGB =
      this._material.albedoTexture?.getInternalTexture()?._useSRGBBuffer === true;
  }
  getUniforms() {
    return {ubo: [{name: 'nativeEffectColor', size: 4, type: 'vec4'}],
      fragment: 'uniform vec4 nativeEffectColor;'};
  }
  // Always bind, including consecutive draws/frames reusing this material.
  hardBindForSubMesh(uniformBuffer) {
    uniformBuffer.updateFloat4('nativeEffectColor', ...this.color);
  }
  getCustomCode(type) {
    return type === 'fragment' ? {CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: fragment} : null;
  }
  setColor(color) {
    if (!Array.isArray(color) || color.length !== 4 || color.some(v => !Number.isFinite(v)))
      throw new TypeError('Native effect colour must contain four finite floats');
    // Saturation occurs in the shader. Preserve authored floats here; in
    // particular, do not quantize small values through the quad's DWORD path.
    for (let i = 0; i < 4; i++) this.color[i] = color[i];
  }
}

const installed = new WeakMap();
export function installNativeEffectMaterial(material, fields = {}) {
  // Explicit cartoon passes need their own consumer. Their defaults must not
  // silently be changed to REAL_COLOR (e.g. Raven_NasodBall).
  const renderType = fields.RenderType ?? fields.MeshRenderType ?? 'RT_REAL_COLOR';
  if (renderType !== 'RT_REAL_COLOR') return null;
  if (!material || !('albedoTexture' in material) || !('unlit' in material))
    throw new TypeError('Native REAL_COLOR adapter requires a PBR material');
  disableCharacterToonMaterial(material);
  let plugin = installed.get(material);
  if (!plugin) {
    plugin = new NativeRealColorPlugin(material);
    installed.set(material, plugin);
    material.unlit = true;
    // Source REAL_COLOR particles always request alpha blending. A converted
    // OPAQUE/MASK decision must not suppress this queue or discard texels
    // before our native formula runs. Native colour/alpha are independent of
    // the source mesh material, including an original alpha of zero.
    material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    material.alpha = 1;
  }
  return plugin;
}

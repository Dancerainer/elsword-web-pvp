import {MaterialPluginBase,RawTexture,Texture} from '@babylonjs/core';
import source from '../../contracts/character-toon-source-v27.json' with {type:'json'};
import commonSource from '../../contracts/common-presentation-source-v28.json' with {type:'json'};

const resources=new WeakMap(),installed=new WeakMap();
function sceneResources(scene){
  let row=resources.get(scene);if(row)return row;
  // X2World/RenderParam start at zero. Actual maps supply SetLightPos; no
  // guessed old-version light or scene's physical lamp is substituted.
  row={direction:[0,0,0],mapSource:false,textures:{}};
  for(const [key,ramp]of Object.entries(source.ramps)){
    const texture=RawTexture.CreateRGBATexture(new Uint8Array(ramp.rgba),ramp.width,1,scene,false,false,Texture.BILINEAR_SAMPLINGMODE);
    texture.name='original-character-ramp:'+key;texture.wrapU=Texture.CLAMP_ADDRESSMODE;
    texture.wrapV=Texture.CLAMP_ADDRESSMODE;texture.gammaSpace=false;row.textures[key]=texture;
  }
  const ramp=commonSource.ramps.fire;
  row.textures.fire=RawTexture.CreateRGBATexture(new Uint8Array(ramp.rgba),ramp.width,1,scene,false,false,Texture.BILINEAR_SAMPLINGMODE);
  row.textures.fire.wrapU=row.textures.fire.wrapV=Texture.CLAMP_ADDRESSMODE;row.textures.fire.gammaSpace=false;
  resources.set(scene,row);return row;
}
export function setCharacterWorldLight(scene,map){
  const call=map?.worldSettings?.findLast(row=>row.callee==='SetLightPos');
  if(!call)return {supported:false,reason:'missing-original-world-light'};
  const v=call.arguments;if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))
    return {supported:false,reason:'invalid-original-world-light'};
  const row=sceneResources(scene),length=Math.hypot(...v,1);
  row.direction=[v[0]/length,v[1]/length,-v[2]/length];row.mapSource=true;
  return {supported:true,sourcePosition:[...v],rendererDirection:[...row.direction]};
}

class NativeCharacterToon extends MaterialPluginBase {
  constructor(material){
    super(material,'NativeCharacterToon',190,{NATIVE_CHARACTER_TOON:true,NATIVE_CHARACTER_HARDWARE_SRGB:false},true,false);
    this.damage=false;this.invincible=false;this.awakenedWeapon=false;this.direction=[0,0,0];this.active=true;
    // The original shader starts false. No target2016 rim producer/stage2
    // operation is available: retain the verified coordinate, never invent a
    // default white additive rim on every character.
    this.rim=null;
    this.resources=sceneResources(material.getScene());this.registerForExtraEvents=true;this.doNotSerialize=true;this._enable(true);
  }
  getClassName(){return 'NativeCharacterToon';}
  prepareDefines(defines){
    defines.NATIVE_CHARACTER_TOON=this.active;
    defines.NATIVE_CHARACTER_HARDWARE_SRGB=this._material.albedoTexture?.getInternalTexture()?._useSRGBBuffer===true;
  }
  getSamplers(samplers){samplers.push('nativeNormalRamp','nativeDamageRamp','nativeInvincibleRamp','nativeFireRamp','nativeRimTexture');}
  getActiveTextures(textures){textures.push(...Object.values(this.resources.textures));}
  getUniforms(){return {ubo:[{name:'nativeCharacterLight',size:3,type:'vec3'},{name:'nativeCharacterColor',size:4,type:'vec4'},{name:'nativeCharacterMode',size:1,type:'float'},
    {name:'nativeRimOp',size:1,type:'float'}],vertex:'uniform vec3 nativeCharacterLight;',fragment:'uniform vec4 nativeCharacterColor;\nuniform float nativeCharacterMode;\nuniform float nativeRimOp;'};}
  hardBindForSubMesh(ubo){
    const mode=this.awakenedWeapon?3:this.invincible?2:this.damage?1:0,dir=this.damage?this.direction:this.resources.direction,m=this._material;
    ubo.updateFloat3('nativeCharacterLight',...dir);ubo.updateFloat('nativeCharacterMode',mode);
    const color=m.albedoColor;ubo.updateFloat4('nativeCharacterColor',color.r,color.g,color.b,m.alpha);
    for(const [name,key]of [['nativeNormalRamp','normal'],['nativeDamageRamp','damage'],['nativeInvincibleRamp','invincible'],['nativeFireRamp','fire']])ubo.setTexture(name,this.resources.textures[key]);
    ubo.updateFloat('nativeRimOp',this.rim?.operation==='add'?1:this.rim?.operation==='multiply'?2:0);
    ubo.setTexture('nativeRimTexture',this.rim?.texture??this.resources.textures.normal);
  }
  getCustomCode(type){
    if(type==='vertex')return {CUSTOM_VERTEX_DEFINITIONS:'varying float vNativeCharacterRamp;\nvarying float vNativeCharacterRim;',CUSTOM_VERTEX_MAIN_END:`
#ifdef NATIVE_CHARACTER_TOON
#ifdef NORMAL
// Original normal is multiplied by the skin/world palette, not a physical
// PBR inverse-transpose normal matrix. Interpolate the vertex ramp coordinate.
vNativeCharacterRamp = dot(normalize(mat3(finalWorld) * normalUpdated), nativeCharacterLight);
vNativeCharacterRim = 1.0 - abs((view * vec4(normalize(mat3(finalWorld) * normalUpdated), 0.0)).z);
#else
vNativeCharacterRamp = 0.0;
vNativeCharacterRim = 0.0;
#endif
#endif`};
    if(type!=='fragment')return null;
    return {CUSTOM_FRAGMENT_DEFINITIONS:'varying float vNativeCharacterRamp;\nvarying float vNativeCharacterRim;\nuniform sampler2D nativeNormalRamp;\nuniform sampler2D nativeDamageRamp;\nuniform sampler2D nativeInvincibleRamp;\nuniform sampler2D nativeFireRamp;\nuniform sampler2D nativeRimTexture;',
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR:`
#ifdef NATIVE_CHARACTER_TOON
vec4 nativeCharacterTexel = vec4(1.0);
#ifdef ALBEDO
nativeCharacterTexel = albedoTexture;
#endif
#ifdef NATIVE_CHARACTER_HARDWARE_SRGB
nativeCharacterTexel.rgb = mix(12.92 * nativeCharacterTexel.rgb,
  1.055 * pow(max(nativeCharacterTexel.rgb, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
  step(vec3(0.0031308), nativeCharacterTexel.rgb));
#endif
vec4 nativeCharacterBase = nativeCharacterTexel * clamp(nativeCharacterColor, 0.0, 1.0);
vec2 nativeRampUv = vec2(clamp(vNativeCharacterRamp, 0.0, 1.0), 0.5);
vec3 nativeCharacterRgb;
if (nativeCharacterMode > 2.5) {
  nativeCharacterRgb = nativeCharacterBase.rgb * texture2D(nativeFireRamp, nativeRampUv).rgb;
} else if (nativeCharacterMode > 1.5) {
  nativeCharacterRgb = nativeCharacterBase.rgb + texture2D(nativeInvincibleRamp, nativeRampUv).rgb;
} else if (nativeCharacterMode > 0.5) {
  nativeCharacterRgb = nativeCharacterBase.rgb + texture2D(nativeDamageRamp, nativeRampUv).rgb;
} else {
  nativeCharacterRgb = nativeCharacterBase.rgb * texture2D(nativeNormalRamp, nativeRampUv).rgb;
}
if (nativeRimOp > 1.5) {
  nativeCharacterRgb *= texture2D(nativeRimTexture, vec2(vNativeCharacterRim, 0.5)).rgb;
} else if (nativeRimOp > 0.5) {
  nativeCharacterRgb += texture2D(nativeRimTexture, vec2(vNativeCharacterRim, 0.5)).rgb;
}
finalColor = vec4(clamp(nativeCharacterRgb, 0.0, 1.0), nativeCharacterBase.a * visibility);
#endif`};
  }
  proof(){return {mode:this.awakenedWeapon?'fire':this.invincible?'invincible':this.damage?'damage':'normal',active:this.active,mapSource:this.resources.mapSource,rimEnabled:!!this.rim,
    direction:[...(this.damage?this.direction:this.resources.direction)],shader:'original2016-CARTOON/ADD_CARTOON',material:this._material.name};}
}
export function installCharacterToonMaterial(material){
  if(!material||!('albedoTexture'in material)||!('unlit'in material))return null;
  let plugin=installed.get(material);if(!plugin){plugin=new NativeCharacterToon(material);installed.set(material,plugin);}
  return plugin;
}
export function characterToonMaterial(material){const p=installed.get(material);return p?.active?p:null;}
export function disableCharacterToonMaterial(material){const p=installed.get(material);if(p){p.active=false;p._enable(false);}}
/** Requires an explicit verified texture AND stage2 operation. Absent original
 * producer data remains unsupported, rather than selecting an attractive rim. */
export function configureCharacterRim(material,parameters){
  const p=characterToonMaterial(material);if(!p)return false;
  if(parameters==null){p.rim=null;return true;}
  if(!parameters.texture||!['add','multiply'].includes(parameters.operation))throw new TypeError('Unverified rim texture/stage2 operation');
  p.rim=parameters;return true;
}

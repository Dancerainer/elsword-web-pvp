/** Exact named Prism material adapter. Original2016 shader + pinned V5
 * particle/renderer consumer; original-client GPU comparison remains open.
 * Keep source geometry, Size, EffectSet scale, count and authored colours. */
import {MaterialPluginBase,ShaderMaterial,Engine} from '@babylonjs/core';
import {installNativeEffectMaterial} from './native-effect-material.mjs';
import {installNativeEffectRenderState} from './effect-render-state.mjs';
import toon from '../../contracts/character-toon-source-v27.json' with {type:'json'};
const meshes=new Map([['AN_PARTICLE_PRISM_01','AN_PARTICLE_PRISM_01.Y'],['AN_PARTICLE_PRISM_01_1','AN_PARTICLE_PRISM_01.Y'],['AN_PARTICLE_PRISM_02','AN_PARTICLE_PRISM_02.Y']]);
export function addPrismHasTex0Consumer(template,channel='Tex0UV'){
  return channel==='Tex0UV'&&meshes.get(template?.name)===template?.fields.Mesh&&meshes.has(template?.name)&&template.fields.particleType==='PT_MESH'&&
    template.fields.CullMode==='D3DCULL_CCW'&&template.events.some(e=>e.property.toUpperCase()==='TEX0UV');
}
class PrismTex0Offset extends MaterialPluginBase {
  constructor(material){super(material,'AddPrismTex0Offset',210,{},true,false);this.offset=[0,0];this.registerForExtraEvents=true;this.doNotSerialize=true;this._enable(true);}
  getClassName(){return 'AddPrismTex0Offset';}
  getUniforms(){return {ubo:[{name:'nativePrismTex0Offset',size:2,type:'vec2'}],fragment:'uniform vec2 nativePrismTex0Offset;'};}
  hardBindForSubMesh(ubo){ubo.updateFloat2('nativePrismTex0Offset',...this.offset);}
  getCustomCode(type){return type==='fragment'?{
    // Locked Babylon9.29 PBR fragment. The original .Y exporter preserves UV
    // coordinates; its embedded PNG and glTF sampler use that same origin.
    // Add the source offset after the identity glTF texture matrix. Never
    // multiply UVs or mutate a shared source texture per particle.
    // Babylon's plugin manager appends a newline to each replacement. Match
    // and replace the statement terminator too: leaving it after that newline
    // makes it a standalone ";", which ShaderCodeCursor deliberately drops.
    '!TEXRD\\(albedoSampler,vAlbedoUV\\+uvOffset\\);':'TEXRD(albedoSampler,vAlbedoUV+uvOffset+nativePrismTex0Offset);',
  }:null;}
  setUV(value){if(!Array.isArray(value)||value.length!==2||!value.every(Number.isFinite))throw new TypeError('Invalid original Prism Tex0UV');this.offset[0]=value[0];this.offset[1]=value[1];}
}
const installed=new WeakMap();
export function installAddPrismMaterial(material,template){
  if(!addPrismHasTex0Consumer(template))return null;
  let result=installed.get(material);if(result)return result;
  const uv=new PrismTex0Offset(material),black=template.fields.MeshRenderType==='RT_CARTOON_BLACK_EDGE';
  let color=null;
  if(black){
    // Original ParticleSystem constructor LightPos=(0,0,0), no LIGHTPOS
    // declaration here. Its normal-ramp coordinate is therefore exactly0.
    // Specialize the verified stage0/1 product with the original first BMP
    // texel. Saturate Diffuse BEFORE that product, as the vs_1_1 does. This
    // does not rename the source RenderType or substitute map lighting.
    const native=installNativeEffectMaterial(material,{...template.fields,MeshRenderType:'RT_REAL_COLOR'});
    const ramp=toon.ramps.normal.rgba.slice(0,3).map(n=>n/255);
    color={setColor(value){native.setColor(value.map((n,i)=>Math.max(0,Math.min(1,n))*(i<3?ramp[i]:1)));}};
  }
  material.backFaceCulling=true;material.cullBackFaces=true;
  result={uv,color,black,proof:()=>({sourceRenderType:template.fields.MeshRenderType??'RT_REAL_COLOR',tex0Offset:[...uv.offset],
    originalUVOffset:true,sourceCull:'D3DCULL_CCW',zeroLightNormalRamp:black?toon.ramps.normal.rgba.slice(0,4):null})};
  installed.set(material,result);return result;
}
const edgeVertex=`precision highp float;attribute vec3 position;attribute vec3 normal;
uniform mat4 world;uniform mat4 viewProjection;uniform float nativeWidth;
void main(){vec4 p=world*vec4(position,1.0);p.xyz+=mat3(world)*normal*nativeWidth;gl_Position=viewProjection*p;}`;
const edgeFragment=`precision highp float;void main(){gl_FragColor=vec4(0.0,0.0,0.0,1.0);}`;
export function installAddPrismBlackPass(view,template,engine){
  if(!addPrismHasTex0Consumer(template)||template.fields.MeshRenderType!=='RT_CARTOON_BLACK_EDGE')return;
  const rows=[];
  for(const body of [...view.meshes]){
    if(!body.getTotalVertices())continue;
    if(body.skeleton||!body.isVerticesDataPresent('normal'))throw new TypeError('Prism black pass requires its original rigid .Y normals');
    const edge=body.clone(body.name+':original-black-pass',body.parent,true);
    const material=new ShaderMaterial(edge.name,body.getScene(),{vertexSource:edgeVertex,fragmentSource:edgeFragment},
      {attributes:['position','normal'],uniforms:['world','viewProjection','nativeWidth'],needAlphaBlending:true});
    edge.material=material;edge.isPickable=false;edge.renderOutline=false;edge.alphaIndex=body.alphaIndex;
    material.alphaMode=Engine.ALPHA_COMBINE;material.backFaceCulling=true;material.cullBackFaces=false;
    material.disableDepthWrite=true;material.forceDepthWrite=false;material.setFloat('nativeWidth',0);
    // The original second technique pass inherits this sequence's source
    // SRCALPHA/INVSRCALPHA and ZEnable, but writes solid black alpha1 and
    // reverses culling. Do not use Babylon's texture-masked outline pass.
    installNativeEffectRenderState(material,engine,{sourceBlend:770,destBlend:771,depthTest:template.fields.ZEnable??true});
    body.onDisposeObservable.addOnce(()=>{edge.dispose();material.dispose();});
    rows.push({body,edge,material});view.meshes.push(edge);
  }
  view.addPrismBlackPass=rows;
}
export function updateAddPrismBlackPass(view,position,cameraPosition){
  if(!view.addPrismBlackPass)return;
  const distance=Math.hypot(position[0]*.01-cameraPosition[0],position[1]*.01-cameraPosition[1],-position[2]*.01-cameraPosition[2])/.01;
  // ParticleSystem4799..4803: native particle edge uses700 below threshold,
  // unlike the character consumer's500. World normals stay unnormalized.
  const width=distance/(distance>700?1000:700);
  for(const {body,edge,material}of view.addPrismBlackPass){
    edge.position.copyFrom(body.position);edge.scaling.copyFrom(body.scaling);edge.rotation.copyFrom(body.rotation);
    if(body.rotationQuaternion){if(edge.rotationQuaternion)edge.rotationQuaternion.copyFrom(body.rotationQuaternion);else edge.rotationQuaternion=body.rotationQuaternion.clone();}
    else edge.rotationQuaternion=null;
    edge.visibility=body.visibility;edge.alphaIndex=body.alphaIndex;edge.renderingGroupId=body.renderingGroupId;
    edge.setEnabled(body.isEnabled()&&body.isVisible);material.setFloat('nativeWidth',width);
  }
}

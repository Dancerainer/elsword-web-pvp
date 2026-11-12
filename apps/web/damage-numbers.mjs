import {Mesh,MeshBuilder,Matrix,Quaternion,Vector3,ShaderMaterial,Texture,Engine} from '@babylonjs/core';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {emitDamageNumber,emitAwakeningRecoveryNumbers,emitGuildRecoveryNumbers,emitBuffMpLossNumber,emitForceFingerResourceNumbers,emitAddResourceRecoveryNumbers,withAddResourceNumberStyles} from './damage-number-layout.mjs';

const vertex=`precision highp float;
attribute vec3 position;attribute vec2 uv;
attribute vec4 world0;attribute vec4 world1;attribute vec4 world2;attribute vec4 world3;attribute vec4 fxColor;
uniform mat4 viewProjection;varying vec2 vUV;varying vec4 vColor;
void main(){gl_Position=viewProjection*mat4(world0,world1,world2,world3)*vec4(position,1.0);vUV=uv;vColor=fxColor;}`;
const fragment=`precision highp float;varying vec2 vUV;varying vec4 vColor;uniform sampler2D diffuseSampler;
void main(){gl_FragColor=texture2D(diffuseSampler,vUV)*vColor;}`;

/** Original DDS-derived digit/prefix glyphs and UI particle declarations. Shared
 * shaders/textures are warmed at login; no texture allocation on a hit. */
export async function createDamageNumbers({scene,manifest,onUnsupported=()=>{}}) {
  manifest=withAddResourceNumberStyles(manifest);
  if(manifest.referenceDefaults?.BillBoardType!=='BT_ALL')throw new Error('Unconfirmed original PicChar billboard default');
  const runtime=createEffectRuntime({index:manifest,onUnsupported});
  const textures=new Map(),batches=new Map(),ready=[];
  let emitted=0;
  for (const [digit,glyph] of Object.entries(manifest.glyphs)) {
    let texture;
    ready.push(new Promise((resolve,reject)=>{
      // PNG rows are top-first; CreatePlane uses v=1 at its upper vertices.
      // Flip upload rows once so the unchanged DDS digit remains upright.
      texture=new Texture('/assets/ui/damage-numbers/'+glyph.file,scene,false,true,Texture.TRILINEAR_SAMPLINGMODE,
        resolve,(message)=>reject(new Error('Original damage glyph '+digit+': '+message)));
    }));
    texture.hasAlpha=true;textures.set(digit,texture);
  }
  for (const [style,definition] of Object.entries(manifest.styles)) {
    const t=manifest.templates[definition.template],capacity=t.fields.NumParticles;
    if (!Number.isInteger(capacity)||capacity<=0||capacity>1000||t.fields.ZEnable!==false||
        t.fields.SourceBlendMode!=='D3DBLEND_SRCALPHA'||t.fields.DestBlendMode!=='D3DBLEND_INVSRCALPHA')
      throw new Error('Damage number source rendering contract changed');
    // Keep normal/red digit-only batches and their original capacities.
    for (const digit of definition.glyphs??'0123456789') {
      if(!textures.has(digit))throw new Error('Missing original PicChar glyph '+digit);
      const mesh=MeshBuilder.CreatePlane('picchar:'+style+digit,{size:1,sideOrientation:Mesh.FRONTSIDE},scene);
      const material=new ShaderMaterial('picchar-material:'+style+digit,scene,{vertexSource:vertex,fragmentSource:fragment},
        {attributes:['position','uv','world0','world1','world2','world3','fxColor'],uniforms:['viewProjection'],samplers:['diffuseSampler'],needAlphaBlending:true});
      material.setTexture('diffuseSampler',textures.get(digit));material.alphaMode=Engine.ALPHA_COMBINE;
      material.backFaceCulling=false;material.disableDepthWrite=true;material.disableDepthTest=true;
      mesh.material=material;mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;
      // Original Layer=21 denotes UI priority; Babylon group 3 renders after
      // scene/skill passes. The engine group mapping is a presentation adapter.
      mesh.renderingGroupId=3;
      const b={mesh,material,capacity,count:0,matrices:new Float32Array(capacity*16),colors:new Float32Array(capacity*4)};
      mesh.thinInstanceSetBuffer('matrix',b.matrices,16,false);mesh.thinInstanceSetBuffer('fxColor',b.colors,4,false);
      mesh.thinInstanceCount=0;mesh.setEnabled(false);batches.set(style+digit,b);
      ready.push(material.forceCompilationAsync(mesh,{useInstances:true}));
    }
  }
  await Promise.all(ready);
  const position=new Vector3(),size=new Vector3(),rotation=new Quaternion(),matrix=new Matrix();
  return {
    event(event){emitted+=emitDamageNumber(runtime,manifest,event)+emitAwakeningRecoveryNumbers(runtime,manifest,event)+emitGuildRecoveryNumbers(runtime,manifest,event)+emitBuffMpLossNumber(runtime,manifest,event)+emitForceFingerResourceNumbers(runtime,manifest,event)+emitAddResourceRecoveryNumbers(runtime,manifest,event);},
    step(dt){runtime.step(dt);},
    render(alpha=1){
      for (const b of batches.values())b.count=0;
      // Original PicChar sequences omit billboard type; the pinned C++ default
      // is BT_ALL. Camera is updated before this pass by the caller.
      Quaternion.FromEulerAnglesToRef(scene.activeCamera.rotation.x,scene.activeCamera.rotation.y,scene.activeCamera.rotation.z,rotation);
      for (const p of runtime.particles.values()) {
        const b=batches.get(p.options.style+p.options.digit);if(!b||b.count>=b.capacity)continue;
        const v=p.values,s=v.Size,old=p.previousPosition??p.position;
        position.set((old[0]+(p.position[0]-old[0])*alpha)*.01,(old[1]+(p.position[1]-old[1])*alpha)*.01,-(old[2]+(p.position[2]-old[2])*alpha)*.01);
        size.set(s[0]*.01,s[1]*.01,s[2]*.01);Matrix.ComposeToRef(size,rotation,position,matrix);
        matrix.copyToArray(b.matrices,b.count*16);b.colors.set(v.Color,b.count*4);b.count++;
      }
      for (const b of batches.values()) {
        b.mesh.setEnabled(b.count>0);b.mesh.thinInstanceCount=b.count;
        if(b.count){b.mesh.thinInstanceBufferUpdated('matrix');b.mesh.thinInstanceBufferUpdated('fxColor');}
      }
    },
    clear(){runtime.clear();for(const b of batches.values())b.mesh.setEnabled(false);},
    proof(){return {originalDigitTextures:[...textures.keys()].filter(key=>/^\d$/.test(key)).length,
      originalPrefixTextures:[...textures.keys()].filter(key=>!/^\d$/.test(key)).length,activeDigits:runtime.count,emittedDigits:emitted,
      styles:Object.keys(manifest.styles),nativeClientMeasured:false,unsupported:[...runtime.notes],
      active:[...runtime.particles.values()].map(p=>({digit:p.options.digit,style:p.options.style,age:p.age,position:p.position,color:p.values.Color,size:p.values.Size}))};},
  };
}

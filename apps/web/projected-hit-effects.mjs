import {isElswordProfile,isElesisProfile} from '../../packages/professions/identity.mjs';
const hasProjectedCharacterHit=profile=>isElswordProfile(profile)||isElesisProfile(profile);
import {Mesh,Matrix,Vector2,Vector3,ShaderMaterial,Texture,Engine,VertexBuffer} from '@babylonjs/core';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {installNativeEffectRenderState} from './effect-render-state.mjs';
import {setNativeTransparentLayer} from './native-effect-draw-order-v3.mjs';
export const LK_SCREEN_FLASH='EffectSet_RBM_HYPER_STEP_EXPLO_P04';
export const BM_SCREEN_DARKEN='SA_RBM_Extrem_Blade_P09';
export const CA_FATE_SCREEN_LAYERS=Object.freeze(['SCA_FATE_SMASHER_L01','SCA_FATE_SMASHER_L02']);
const hasOriginalScreenFlash=profile=>[100,101,106].includes(profile.target?.unitClass);
const screenNames=profile=>[...(hasOriginalScreenFlash(profile)?[LK_SCREEN_FLASH]:[]),
  ...(profile.target?.unitClass===106?[BM_SCREEN_DARKEN]:[]),
  ...(profile.target?.unitClass===125?CA_FATE_SCREEN_LAYERS:[])];
export function originalScreenBlend(name,fields){
  if(name===BM_SCREEN_DARKEN&&fields.SourceBlendMode==='D3DBLEND_DESTCOLOR'&&fields.DestBlendMode==='D3DBLEND_INVBLENDFACTOR'){
    // Fixed-V5 PT_2D_PLANE3406..3432 scopes the declared blend factors but
    // never changes BLENDFACTOR. D3D9's documented default is opaque white,
    // so its inverse is ZERO. This is a reference/default consumer, not a
    // measurement of the target client's GPU state. See the v2 source proof.
    return {sourceBlend:774,destBlend:0,blendFactorEvidence:'D3D9 default 0xffffffff; fixed-V5 renderer has no override'};
  }
  const destination={D3DBLEND_INVSRCALPHA:771,D3DBLEND_DESTALPHA:772,
    ...(name===CA_FATE_SCREEN_LAYERS[1]?{D3DBLEND_DESTCOLOR:774}:{})}[fields.DestBlendMode];
  if(fields.SourceBlendMode!=='D3DBLEND_SRCALPHA'||destination==null)throw new Error('Unbound projected-hit blend: '+name);
  return {sourceBlend:770,destBlend:destination};
}

/** GUUser14523..26 /18156..92: first successful character attack per state,
 * ATTACK_TIME[3], projected impact + (50,-50), rate100 and trigger-count1.
 * An earlier successful unnamed window still consumes the state's first hit.
 */
export function createProjectedHitController({index,profile,project,onUnsupported=()=>{}}){
  const runtime=createEffectRuntime({index,onUnsupported}),seen=new Map(),screenEffects=new Set();let emitted=0;
  return {runtime,event(e,actor,effectQuality){
    if(!hasProjectedCharacterHit(profile)||e.type!=='hit'||e.origin?.kind!=='character'||!actor)return;
    const key=e.origin.id;if(seen.get(actor.id)===key)return;seen.set(actor.id,key);
    const raw=profile.states[e.origin.state??actor.state]?.raw??{},time=e.origin.animationTime??actor.animationTime;
    const entry=Object.entries(raw).find(([name,v])=>/^ATTACK_TIME\d+$/.test(name)&&time>v['1']&&time<v['2']);
    const name=entry?.[1]['3'];if(!name)return;
    const t=index.templates[name];if(!t||t.fields.particleType!=='PT_2D_PLANE')return;
    const point=project(e.origin.impactPoint);if(!point)return;
    const emitter=runtime.add(name,{effectQuality,position:[point[0]+50,point[1]-50,0],facing:1,emitRate:100,triggerCount:1});
    if(emitter)emitted++;
  },startEffect(e,effectQuality){
    if(!screenNames(profile).includes(e.name))return false;
    const t=index.templates[e.name];if(!t)return false;
    if(e.effectId&&screenEffects.has(e.effectId))return true;
    // LK GiganticSlash and BM ExtremeBlade invoke the same original RHW
    // particle declaration. Its single
    // initial Position event writes absolute screen coordinates (native
    // CParticleEvent_Position2097), overriding the effect's world anchor.
    const positions=t.events.filter(v=>v.property==='Position');
    if(positions.length!==1||positions[0].start!==0||positions[0].fade||!positions[0].value.every(Number.isFinite))
      throw new Error('Unbound original screen-flash position');
    runtime.add(e.name,{effectQuality:{...effectQuality,particleDivisor:1},position:positions[0].value,facing:1});
    if(e.effectId)screenEffects.add(e.effectId);return true;
  },step(dt){runtime.step(dt);},clear(){runtime.clear();seen.clear();screenEffects.clear();emitted=0;},
  proof(){return {emitted,active:runtime.count,screenTemplates:Object.fromEntries(screenNames(profile).map(name=>[name,
    [...runtime.particles.values()].filter(p=>p.name===name).length])),unsupported:[...runtime.notes],
    consumer:'reference-V5 GUUser first successful ATTACK_TIME projection and authored RHW screen templates; target client unmeasured'};}};
}

/** ParticleSystem4508..4610: native pixel quad, resolution-scaled Size,
 * integer pixel rounding then -0.5; m_bResolutionConvert defaults false.
 */
const projectedQuadUV=Object.freeze([0,1,0,0,1,1,1,1,0,0,1,0]);
function writeProjectedHitVertices(p,width,height,fields,result,offset=0){
  const [w,h]=p.values.Size,[px,py]=p.position,angle=p.values.Rotate[2]*Math.PI/180;
  // Fixed-V5 ParticleSystem4516: Size always converts; Position only when
  // ResolutionConvert is explicitly true (Fate's authored screen smoke).
  const x=fields.ResolutionConvert?px*width/1024:px,y=fields.ResolutionConvert?py*height/768:py;
  const c=Math.cos(angle),s=Math.sin(angle);
  for(let i=0;i<6;i++){
    const u=projectedQuadUV[i*2],v=projectedQuadUV[i*2+1];
    const dx=(u-.5)*w*width/1024,dy=(v-.5)*h*height/768;
    result[offset++]=Math.trunc(x+dx*c-dy*s)-.5;result[offset++]=Math.trunc(y+dx*s+dy*c)-.5;result[offset++]=0;
  }
  return result;
}
export function projectedHitVertices(p,width,height,fields={}){
  return writeProjectedHitVertices(p,width,height,fields,new Array(18));
}
function projectedHitBuffers(count){
  const uv=new Float32Array(count*12),indices=new Array(count*6);
  for(let i=0;i<count;i++)uv.set(projectedQuadUV,i*12);
  for(let i=0;i<indices.length;i++)indices[i]=i;
  return {positions:new Float32Array(count*18),colors:new Float32Array(count*24),uv,indices};
}

const vertex='precision highp float;attribute vec3 position;attribute vec2 uv;attribute vec4 color;uniform vec2 resolution;varying vec2 vUV;varying vec4 vColor;void main(){gl_Position=vec4(position.x/resolution.x*2.0-1.0,1.0-position.y/resolution.y*2.0,0.0,1.0);vUV=uv;vColor=color;}';
const fragment='precision highp float;varying vec2 vUV;varying vec4 vColor;uniform sampler2D diffuseSampler;void main(){gl_FragColor=texture2D(diffuseSampler,vUV)*vColor;}';
export function createProjectedHitView({scene,engine,index,profile,assetBase,onUnsupported}){
  const project=point=>{
    if(!Array.isArray(point)||!point.every(Number.isFinite)||!scene.activeCamera)return null;
    const viewport=scene.activeCamera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight());
    const v=Vector3.Project(new Vector3(point[0]*.01,point[1]*.01,-point[2]*.01),Matrix.Identity(),scene.getTransformMatrix(),viewport);
    return v.z<0||v.z>1?[99999,99999]:[v.x,v.y];
  };
  const controller=createProjectedHitController({index,profile,project,onUnsupported}),batches=new Map(),resolution=new Vector2();
  const names=[...(hasProjectedCharacterHit(profile)?[...new Set(Object.values(profile.states).flatMap(s=>Object.entries(s.raw)
    .filter(([key,v])=>/^ATTACK_TIME\d+$/.test(key)&&typeof v['3']==='string').map(([,v])=>v['3'])))]:[]),
    ...screenNames(profile)];
  for(const name of names){const t=index.templates[name];if(!t)continue;
    const blend=originalScreenBlend(name,t.fields);
    const mesh=new Mesh('projected-hit:'+name,scene),material=new ShaderMaterial('projected-hit-material:'+name,scene,{vertexSource:vertex,fragmentSource:fragment},
      {attributes:['position','uv','color'],uniforms:['resolution'],samplers:['diffuseSampler'],needAlphaBlending:true});
    const path=Object.values(t.textures)[0]?.file,texture=new Texture(assetBase+path,scene,false,false);texture.hasAlpha=true;
    material.setTexture('diffuseSampler',texture);material.alphaMode=Engine.ALPHA_COMBINE;material.backFaceCulling=false;material.disableDepthWrite=true;
    installNativeEffectRenderState(material,engine,{...blend,depthTest:false});
    // BM's layer13 background and Fate's layer10/11 smoke share the world
    // transparent queue with their higher-layer slashes. A final overlay
    // pass would hide the attack these authored layers are meant to reveal.
    mesh.material=material;mesh.renderingGroupId=name===BM_SCREEN_DARKEN||CA_FATE_SCREEN_LAYERS.includes(name)?0:3;
    setNativeTransparentLayer([mesh],t.fields.Layer);mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;
    const buffers=projectedHitBuffers(1);
    mesh.setVerticesData(VertexBuffer.PositionKind,buffers.positions,true);mesh.setVerticesData(VertexBuffer.UVKind,buffers.uv,true);
    mesh.setVerticesData(VertexBuffer.ColorKind,buffers.colors,true);mesh.setIndices(buffers.indices);mesh.setEnabled(false);
    batches.set(name,{mesh,material,count:1,buffers,particles:[]});
  }
  return {...controller,async prewarm(){await Promise.all([...batches.values()].map(b=>b.material.forceCompilationAsync(b.mesh)));},
    render(){const width=engine.getRenderWidth(),height=engine.getRenderHeight();resolution.set(width,height);
      // Preserve each template's source Map order in one pass. These arrays
      // retain capacity, but no retired particle references survive a frame.
      for(const b of batches.values())b.particles.length=0;
      for(const particle of controller.runtime.particles.values())batches.get(particle.name)?.particles.push(particle);
      for(const [name,b]of batches){const particles=b.particles,count=particles.length;
        b.mesh.setEnabled(count>0);if(!count)continue;
        const resized=count!==b.count;
        if(resized){b.buffers=projectedHitBuffers(count);b.count=count;}
        const buffers=b.buffers;
        for(let i=0;i<count;i++){
          const p=particles[i];writeProjectedHitVertices(p,width,height,index.templates[name].fields,buffers.positions,i*18);
          for(let vertex=0;vertex<6;vertex++)buffers.colors.set(p.values.Color,i*24+vertex*4);
        }
        if(resized){
          b.mesh.setVerticesData(VertexBuffer.PositionKind,buffers.positions,true);b.mesh.setVerticesData(VertexBuffer.UVKind,buffers.uv,true);
          b.mesh.setVerticesData(VertexBuffer.ColorKind,buffers.colors,true);b.mesh.setIndices(buffers.indices);
        }else{
          // RHW smoke keeps fixed topology for its authored five-second life.
          // Update the original positions/colours and bounds without replacing
          // three GPU buffers and the identity index buffer every frame.
          b.mesh.updateVerticesData(VertexBuffer.PositionKind,buffers.positions,true);
          b.mesh.updateVerticesData(VertexBuffer.ColorKind,buffers.colors);
        }
        b.material.setVector2('resolution',resolution);
      }
    },clear(){controller.clear();for(const b of batches.values()){b.particles.length=0;b.mesh.setEnabled(false);}}};
}

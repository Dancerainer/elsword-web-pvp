import {Mesh,ShaderMaterial,VertexBuffer,Constants} from '@babylonjs/core';
import {NativeTrailBuffer,unpackArgb,trailTip} from '../../packages/presentation/weapon-trails.mjs';
import {createNativeTrailGeometry} from './native-trail-geometry.mjs';

/** MeshPlayer1466..1515,1956..2029: native100 vertices, .4/.5 fading,
 * 1/3 draws, blue body/tip and original TRACE_START0/END0 mesh helpers.
 * Scoped to Archenemy; the browser strip renderer remains a GPU candidate. */
export function createNativeMeshTrails({scene,samplers,profile,onUnsupported=()=>{}}){
  const channels=new Map(),notes=new Set();let material;
  const note=id=>{if(!notes.has(id)){notes.add(id);onUnsupported({type:'unsupported-visual',id});}};
  function get(effect,part){const key=effect.id+':'+part;if(channels.has(key))return channels.get(key);
    material??=new ShaderMaterial('native-mesh-slash-trace',scene,{vertexSource:
      'precision highp float; attribute vec3 position; attribute vec4 color; uniform mat4 worldViewProjection; varying vec4 vColor; void main(){gl_Position=worldViewProjection*vec4(position,1.0);vColor=color;}',fragmentSource:
      'precision highp float; varying vec4 vColor; void main(){gl_FragColor=vColor;}'},
      {attributes:['position','color'],uniforms:['worldViewProjection'],needAlphaBlending:true});
    material.backFaceCulling=false;material.disableDepthWrite=true;material.alphaMode=Constants.ALPHA_ADD;
    const meshes=Array.from({length:part==='body'?1:3},(_,i)=>{const mesh=new Mesh('native-mesh-trace:'+key+':'+i,scene);
      mesh.material=material;mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;mesh.hasVertexAlpha=true;mesh.setEnabled(false);return mesh;});
    const c={effectId:effect.id,part,buffer:new NativeTrailBuffer({vertexCount:100,disableSeconds:part==='body'?.4:.5}),geometry:createNativeTrailGeometry(),meshes};
    channels.set(key,c);return c;}
  function drop(key,c){for(const mesh of c.meshes)mesh.dispose(false,false);channels.delete(key);}
  return {step(dt,state){if(dt===0)return;const live=new Set();
    for(const e of state.effects??[]){if((!e.sourceArcHandle&&!e.sourceArcStartMesh)||e.dead||!e.active||e.templateFields.UseSlashTrace!==true)continue;
      live.add(e.id);const owner=state.actors.find(a=>a.id===e.ownerId);if(!owner)continue;
      const active=e.sourceArcSlashTrace===true;
      const up=samplers.effectBoneSampler(e,owner,'TRACE_START0'),down=samplers.effectBoneSampler(e,owner,'TRACE_END0');
      if(!up||!down){note(e.mainEffectName+':slash-trace-helpers');continue;}
      for(const part of ['body','tip']){const c=get(e,part);c.buffer.step({dt,up,down:part==='tip'?trailTip(up,down,4):down,
        color:active?unpackArgb(part==='body'?0xcc5555ff:0xff5555ff):[0,0,0,0],emit:true,enabled:true,shown:true});
        c.sourceEndpoints={TRACE_START0:[...up],TRACE_END0:[...down]};c.emitting=active;
        c.globalTime=e.sourceArcGlobalTime;c.lifeTime=e.meshLifetimeElapsed;
        const geometry=c.geometry.sample(c.buffer),visible=Boolean(geometry);
        for(const mesh of c.meshes){mesh.setEnabled(visible);if(!visible)continue;
          if(c.vertices!==geometry.positions.length){mesh.setVerticesData(VertexBuffer.PositionKind,geometry.positions,true);mesh.setVerticesData(VertexBuffer.ColorKind,geometry.colors,true);}
          else {mesh.updateVerticesData(VertexBuffer.PositionKind,geometry.positions,false,false);mesh.updateVerticesData(VertexBuffer.ColorKind,geometry.colors,false,false);}
          if(c.indices!==geometry.indices.length)mesh.setIndices(geometry.indices);}
        if(visible){c.vertices=geometry.positions.length;c.indices=geometry.indices.length;}}
    }
    for(const [key,c] of [...channels])if(!live.has(c.effectId))drop(key,c);
  },clear(){for(const [key,c] of [...channels])drop(key,c);},
    proof(){return {channels:channels.size,traces:[...channels.values()].map(c=>({effectId:c.effectId,part:c.part,
      sourceEndpoints:c.sourceEndpoints,emitting:c.emitting,globalTime:c.globalTime,lifeTime:c.lifeTime,
      drawCount:c.meshes.length,vertexLimit:c.buffer.capacity*2,
      fadeSeconds:c.buffer.disableSeconds,visible:c.buffer.visible})),unsupported:[...notes],
      rendererCandidate:'Native strip endpoint/fade semantics; target GPU alpha quantization pending'};}};
}

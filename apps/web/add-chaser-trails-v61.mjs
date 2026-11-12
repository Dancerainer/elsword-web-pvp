import {Mesh,ShaderMaterial,VertexBuffer,Engine} from '@babylonjs/core';
import source from '../../contracts/mm-chaser-trail-v61.json' with {type:'json'};
import {AddChaserTrail} from '../../packages/presentation/add-chaser-trail-v61.mjs';
import {installNativeEffectRenderState} from './effect-render-state.mjs';
import {setNativeTransparentLayer} from './native-effect-draw-order-v3.mjs';
const NAME=source.target.template;
const vertex=`precision highp float; attribute vec3 position; attribute vec2 uv; attribute vec4 color; uniform mat4 worldViewProjection; varying vec2 vUV; varying vec4 vColor;
void main(){gl_Position=worldViewProjection*vec4(position,1.0);vUV=uv;vColor=color;}`;
const fragment=`precision highp float; varying vec2 vUV; varying vec4 vColor; uniform sampler2D nativeTraceSampler;
void main(){vec4 texel=texture2D(nativeTraceSampler,vUV);gl_FragColor=vec4(texel.rgb,clamp(vColor.a,0.0,1.0));}`;
export function createAddChaserTrails({scene,engine,index,profile,samplers,texture,prepareMesh,onUnsupported=()=>{}}){
 const template=index.templates[NAME],rows=new Map();let material,prepared;
 if(template&&template.declarationSha256!==source.target.declarationSha256)throw TypeError('Chaser trail original source mismatch');
 const enabled=profile.target?.unitClass===123&&template?.fields?.UseSlashTrace===true&&template.fields.SLASH_TRACE_TYPE===1&&template.fields.Slash_Trace_Curve_Type===1;
 function makeMesh(id){if(!material){material=new ShaderMaterial('add-chaser-native-trace',scene,{vertexSource:vertex,fragmentSource:fragment},
  {attributes:['position','uv','color'],uniforms:['worldViewProjection'],samplers:['nativeTraceSampler'],needAlphaBlending:true});
  material.setTexture('nativeTraceSampler',texture(source.texture.file));material.alphaMode=Engine.ALPHA_COMBINE;material.backFaceCulling=false;material.disableDepthWrite=true;
  installNativeEffectRenderState(material,engine,{sourceBlend:770,destBlend:772,depthTest:true});
  }
  const mesh=new Mesh('add-chaser-native-trace:'+id,scene);mesh.material=material;mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;mesh.hasVertexAlpha=true;
  setNativeTransparentLayer([mesh],template.fields.Layer);mesh.setEnabled(false);return mesh;
 }
 function drop(id){const row=rows.get(id);if(row){row.mesh.dispose(false,false);rows.delete(id);}}
 return {
  async prewarm(){if(!enabled)return;if(prepared)return prepared;const mesh=makeMesh('prewarm');mesh.setVerticesData(VertexBuffer.PositionKind,[0,0,0,0,0,0,0,0,0]);mesh.setVerticesData(VertexBuffer.UVKind,[0,0,0,0,0,0]);mesh.setVerticesData(VertexBuffer.ColorKind,Array(12).fill(0));mesh.setIndices([0,1,2]);
   prepared=prepareMesh(mesh).finally(()=>mesh.dispose(false,false));return prepared;},
  step(dt,state){if(!enabled||!(dt>0))return;const live=new Set();
   for(const effect of state.effects??[]){if(effect.mainEffectName!==NAME||!effect.active||effect.dead||!effect.sourceShadowMesh)continue;
    const actor=state.actors.find(a=>a.id===effect.ownerId);if(!actor)continue;
    const up=samplers.effectBoneSampler(effect,actor,'TRACE_START0'),down=samplers.effectBoneSampler(effect,actor,'TRACE_END0');
    if(!up||!down){onUnsupported({type:'unsupported-visual',id:NAME+':original-trace-helpers'});continue;}
    live.add(effect.id);let row=rows.get(effect.id);if(!row){row={mesh:makeMesh(effect.id),trail:new AddChaserTrail()};rows.set(effect.id,row);}
    const m=effect.sourceShadowMesh,direction=m.basis?.[0];if(!direction)continue;
    const event=template.events.filter(e=>e.property==='SlashTrace'&&m.globalTime>=e.start).at(-1),active=event?.value===true;
    row.trail.step({dt,up,down,direction,active});const geometry=row.trail.geometry(),shown=row.trail.buffer.visible&&geometry.indices.length>0;
    row.mesh.setEnabled(shown);if(shown){const resize=row.vertices!==geometry.positions.length;
     for(const [kind,data]of [[VertexBuffer.PositionKind,geometry.positions],[VertexBuffer.ColorKind,geometry.colors],[VertexBuffer.UVKind,geometry.uvs]]){if(resize)row.mesh.setVerticesData(kind,data,true);else row.mesh.updateVerticesData(kind,data,false,false);}
     if(row.indices!==geometry.indices.length)row.mesh.setIndices(geometry.indices);row.vertices=geometry.positions.length;row.indices=geometry.indices.length;}
    row.endpoints={up:[...up],down:[...down]};row.active=active;
   }
   for(const id of rows.keys())if(!live.has(id))drop(id);
  },
  clear(){for(const id of [...rows.keys()])drop(id);},
  proof(){return {sourceQualified:true,originalClientMeasured:false,channels:rows.size,traces:[...rows].map(([effectId,row])=>({effectId,pairs:row.trail.buffer.pairs.length,vertices:row.mesh.getTotalVertices(),indices:row.mesh.getTotalIndices(),visible:row.mesh.isEnabled(),emitting:row.active,endpoints:row.endpoints,texture:source.texture.file,vertexLimit:100,drawCount:1,fadeSeconds:.4}))};},
 };
}

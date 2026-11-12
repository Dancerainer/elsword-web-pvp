import {Mesh,ShaderMaterial,VertexBuffer,Color4,Constants} from '@babylonjs/core';
import {PHOENIX_AFTERIMAGE_COLOR,AFTERIMAGE_REFERENCE,phoenixAfterimageEnabled,createAfterimageClock} from '../../packages/presentation/buff-afterimage.mjs';
import {setNativeTransparentLayer} from './native-effect-draw-order-v3.mjs';
import {nativeCharacterEdge} from './native-character-edge.mjs';

/** Bake the actual displayed skin into a bounded pool of frozen silhouettes.
 * Source CopyCloneFrameStructure copies the current pose/world basis, rather
 * than replaying an animation or attaching an invented trail particle. */
export function createBuffAfterimages({scene,viewFor,localActorId}){
  const channels=new Map();let disposed=false;
  function material(name){const value=new ShaderMaterial(name,scene,
    {vertexSource:'precision highp float; attribute vec3 position; uniform mat4 worldViewProjection; void main(){gl_Position=worldViewProjection*vec4(position,1.0);}',
      fragmentSource:'precision highp float; uniform vec4 tint; void main(){gl_FragColor=tint;}'},
    {attributes:['position'],uniforms:['worldViewProjection','tint'],needAlphaBlending:true});
    value.backFaceCulling=false;value.disableDepthWrite=true;value.alphaMode=Constants.ALPHA_COMBINE;return value;}
  function drop(id,row){for(const slot of row.slots){for(const mesh of slot.meshes.values())mesh.dispose(false,false);slot.meshes.clear();slot.material.dispose(false,false);slot.mergedMaterial?.dispose(false,false);}channels.delete(id);}
  function channel(actor){
    let row=channels.get(actor.id);if(row)return row;
    const count=actor.id===(typeof localActorId==='function'?localActorId():localActorId)?AFTERIMAGE_REFERENCE.localImages:AFTERIMAGE_REFERENCE.remoteImages;
    row={clock:createAfterimageClock(count),slots:Array.from({length:count},(_,i)=>({meshes:new Map(),material:material('buff-afterimage:'+actor.id+':'+i),mergedMaterial:null,
      tint:new Color4(...PHOENIX_AFTERIMAGE_COLOR.slice(0,3),0),mergedTint:new Color4(...PHOENIX_AFTERIMAGE_COLOR.slice(0,3),0)}))};
    channels.set(actor.id,row);return row;
  }
  function capture(slot,view){
    const seen=new Set(),prepared=new Set(),sources=view.root.getChildMeshes(),mergedEdges=new Set(),mergedBodies=new Set();
    // Native outlines clone the skin and expand it only in their shader.
    // The solid ghost shader does not perform that expansion: baking both
    // produces identical body geometry twice. Merge only proven identical
    // matrices/skin/morph inputs and retain the two-draw alpha composition.
    for(const source of sources){
      if(!source.isEnabled()||source.isVisible===false||source.getTotalVertices()===0)continue;
      const edge=nativeCharacterEdge(source)?.edge;
      if(!edge?.isEnabled()||edge.isVisible===false||edge.geometry!==source.geometry||edge.skeleton!==source.skeleton
        ||edge.morphTargetManager!==source.morphTargetManager||edge.numBoneInfluencers!==source.numBoneInfluencers)continue;
      if(source.computeWorldMatrix(true).equals(edge.computeWorldMatrix(true))){mergedBodies.add(source);mergedEdges.add(edge);}
    }
    for(const source of sources){
      if(mergedEdges.has(source))continue;
      if(!source.isEnabled()||source.isVisible===false||source.getTotalVertices()===0)continue;
      source.computeWorldMatrix(true);
      if(source.skeleton&&!prepared.has(source.skeleton)){source.skeleton.prepare(true);prepared.add(source.skeleton);}
      const positions=source.getPositionData(true,true);if(!positions)continue;
      seen.add(source.uniqueId);let mesh=slot.meshes.get(source.uniqueId);
      if(!mesh){mesh=new Mesh('buff-afterimage:'+source.name,scene);mesh.material=slot.material;
        mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;
        const indices=source.getIndices();mesh.isUnIndexed=source.isUnIndexed||!indices?.length;
        mesh.setVerticesData(VertexBuffer.PositionKind,positions,true);if(indices?.length)mesh.setIndices(indices);
        setNativeTransparentLayer([mesh],'XL_EFFECT_0');
        slot.meshes.set(source.uniqueId,mesh);
      }else mesh.updateVerticesData(VertexBuffer.PositionKind,positions,false,false);
      const merged=mergedBodies.has(source);
      if(merged)slot.mergedMaterial??=material(slot.material.name+':merged-outline');
      mesh.material=merged?slot.mergedMaterial:slot.material;
      mesh.metadata={...mesh.metadata,afterimageSourceId:source.uniqueId,afterimageCopies:merged?2:1};
      mesh.freezeWorldMatrix(source.computeWorldMatrix(true).clone());mesh.setEnabled(true);
    }
    for(const [key,mesh]of slot.meshes)if(!seen.has(key)){mesh.dispose(false,false);slot.meshes.delete(key);}
  }
  return {step(actors,dt){
    if(disposed||!(dt>0))return;const present=new Set();
    for(const actor of actors){present.add(actor.id);const enabled=phoenixAfterimageEnabled(actor),view=viewFor(actor.id);
      const liveView=view&&!view.disposed;
      const row=enabled&&liveView?channel(actor):channels.get(actor.id);if(!row)continue;
      const frame=row.clock.step(dt,enabled&&!!liveView);
      if(!liveView||!enabled&&frame.alpha.every(a=>a===0)){drop(actor.id,row);continue;}
      if(frame.capture!==null)capture(row.slots[frame.capture],view);
      for(let i=0;i<row.slots.length;i++){const slot=row.slots[i],alpha=frame.alpha[i];
        slot.tint.a=alpha;slot.material.setColor4('tint',slot.tint);
        // c*a + background*(1-a), applied twice to the same skin pixel,
        // equals a single draw with a*(2-a); silhouette brightness is retained.
        if(slot.mergedMaterial){slot.mergedTint.a=alpha*(2-alpha);slot.mergedMaterial.setColor4('tint',slot.mergedTint);}
        if(alpha===0||actor.hidden||actor.hp<=0)for(const mesh of slot.meshes.values())mesh.setEnabled(false);
      }
    }
    for(const [id,row]of channels)if(!present.has(id))drop(id,row);
  },clear(){for(const [id,row]of channels)drop(id,row);},dispose(){if(disposed)return;disposed=true;for(const [id,row]of channels)drop(id,row);},
    proof(){return {actors:channels.size,meshSlots:[...channels.values()].reduce((n,row)=>n+row.slots.reduce((sum,s)=>sum+s.meshes.size,0),0),
      color:[...PHOENIX_AFTERIMAGE_COLOR],clock:AFTERIMAGE_REFERENCE,rendererCandidate:'Frozen actual skin geometry; source colour/timer/fade, WebGL solid-colour silhouette adapter'};}};
}

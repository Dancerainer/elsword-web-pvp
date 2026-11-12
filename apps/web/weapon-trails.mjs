import {isElswordProfile,isElesisProfile} from '../../packages/professions/identity.mjs';
import {Mesh,ShaderMaterial,VertexBuffer,Constants} from '@babylonjs/core';
import {NativeTrailBuffer,RF_TRAIL_REFERENCE,TARGET_TRACE_TYPES,unpackArgb,traceTiming,trailActive,trailTip} from '../../packages/presentation/weapon-trails.mjs';
import {createNativeTrailGeometry} from './native-trail-geometry.mjs';

// Fixed Raven::AddUnitSlashData is inherited by RF and VC. Weapon's major
// sword timing is shared with LK; qualification must not discard VC's raw
// SLASH_TRACE / UNIT_SLASH_TRACE declarations before sampling its actual pose.
export const supportsRavenClawTrail=profile=>[106,107,115].includes(profile?.target?.unitClass);
const supportsSwordTrail=profile=>isElswordProfile(profile)||isElesisProfile(profile)||supportsRavenClawTrail(profile);

/** sampleEndpoints(actor,names) must return native world coordinates from the
 * ACTUAL displayed/blended actor pose, including the mounted weapon transform.
 * Pure endpoint strips never run their own animation or combat clock.
 */
export function createRFWeaponTrails({scene,profile,profileFor=()=>profile,sampleEndpoints,scale=.01,localActorId='player1',onUnsupported=()=>{}}){
  if(!scene||!profile||typeof sampleEndpoints!=='function')throw new TypeError('Scene, target profile and endpoint sampler required');
  const channels=new Map(),notes=new Set();let disposed=false;
  const unsupported=note=>{if(!notes.has(note)){notes.add(note);onUnsupported(note);}};
  const material=new ShaderMaterial('rf-source-weapon-trail',scene,{vertexSource:
    'precision highp float; attribute vec3 position; attribute vec4 color; uniform mat4 worldViewProjection; varying vec4 vColor; void main(){ gl_Position=worldViewProjection*vec4(position,1.0); vColor=color; }',fragmentSource:
    'precision highp float; varying vec4 vColor; void main(){ gl_FragColor=vColor; }'},
    {attributes:['position','color'],uniforms:['worldViewProjection'],needAlphaBlending:true});
  material.backFaceCulling=false;material.disableDepthWrite=true;
  // Native SRC_ALPHA / DEST_ALPHA. ALPHA_ADD equals it on an opaque framebuffer;
  // destination-alpha and legacy texture-stage behavior remain renderer candidates.
  material.alphaMode=Constants.ALPHA_ADD;
  function get(actor,kind,part){
    const key=actor.id+':'+kind+':'+part;
    if(channels.has(key))return channels.get(key);
    const d=RF_TRAIL_REFERENCE[kind],count=actor.id===localActorId?400:150;
    const buffer=new NativeTrailBuffer({vertexCount:count,disableSeconds:part==='body'?d.bodySeconds:d.tipSeconds});
    const drawCount=part==='body'?d.bodyDrawCount:d.tipDrawCount;
    const meshes=[];
    for(let n=0;n<drawCount;n++){
      // Native ZENABLE=true / ZWRITE=false: use the scene transparent queue
      // with its existing map/actor depth, without a later group depth clear.
      const mesh=new Mesh('rf-trail-'+key+':pass'+n,scene);mesh.material=material;mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;mesh.renderingGroupId=0;mesh.hasVertexAlpha=true;mesh.setEnabled(false);meshes.push(mesh);
    }
    const c={key,actorId:actor.id,kind,part,buffer,geometry:createNativeTrailGeometry({scale}),meshes,drawCount,vertexLength:0,indexLength:0};channels.set(key,c);return c;
  }
  function render(c,shown){
    const geometry=shown?c.geometry.sample(c.buffer):null,visible=Boolean(geometry);
    for(const mesh of c.meshes){
      mesh.setEnabled(visible);if(!visible)continue;
      if(c.vertexLength!==geometry.positions.length){
        mesh.setVerticesData(VertexBuffer.PositionKind,geometry.positions,true);mesh.setVerticesData(VertexBuffer.ColorKind,geometry.colors,true);
      }else{mesh.updateVerticesData(VertexBuffer.PositionKind,geometry.positions,false,false);mesh.updateVerticesData(VertexBuffer.ColorKind,geometry.colors,false,false);}
      if(c.indexLength!==geometry.indices.length)mesh.setIndices(geometry.indices);
    }
    if(visible){c.vertexLength=geometry.positions.length;c.indexLength=geometry.indices.length;}
  }
  function drop(c){for(const mesh of c.meshes)mesh.dispose(false,false);channels.delete(c.key);}
  return {
    step({actors,dt,effectsEnabled=true,clawEnabled=true}){
      if(disposed)throw new Error('Weapon trails disposed');
      if(!(Number.isFinite(dt)&&dt>=0))throw new RangeError('dt must be nonnegative');
      const live=new Set(actors.map(a=>a.id));for(const c of [...channels.values()])if(!live.has(c.actorId))drop(c);
      // Pause/inspection must not inject duplicate samples or fade history.
      if(dt===0)return;
      for(const actor of actors){
        const actorProfile=profileFor(actor),raw=actorProfile.states[actor.state]?.raw??{},shown=actor.show!==false&&!actor.hidden&&(actor.deathAlpha??1)>0;
        for(const kind of ['sword','claw']){
          // Fixed-V5 medium disables the unit/claw manager, while the major
          // sword's Weapon::OnFrameMove keeps its independent timing route.
          if(!supportsSwordTrail(actorProfile)){for(const c of [...channels.values()])if(c.actorId===actor.id)drop(c);continue;}
          // LK uses the shared Weapon::OnFrameMove sword strip. Raven's left
          // claw is a distinct UnitSlashTraceManager channel and is never LK.
          if(kind==='claw'&&!supportsRavenClawTrail(actorProfile))continue;
          if(kind==='claw'&&!(typeof clawEnabled==='function'?clawEnabled(actor):clawEnabled)){
            for(const c of [...channels.values()])if(c.actorId===actor.id&&c.kind===kind){
              if(typeof clawEnabled!=='function'){drop(c);continue;}
              // An action quality boundary must not cut off the preceding
              // high-quality combo's original .4/.5-second fading strip.
              // Do not sample endpoints or create another channel here.
              c.buffer.step({dt,emit:false,enabled:effectsEnabled,shown});
              render(c,shown&&effectsEnabled);if(!c.buffer.visible)drop(c);
            }
            continue;
          }
          const d=RF_TRAIL_REFERENCE[kind],timing=traceTiming(raw,kind),active=trailActive(timing,actor.animationTime);
          const existed=[...channels.values()].some(c=>c.actorId===actor.id&&c.kind===kind);
          if(!active&&!existed)continue;
          if(active&&timing.type!==0&&timing.type!==TARGET_TRACE_TYPES.NONE){unsupported('Unsupported original '+kind+' trace type '+timing.type);}
          let points;
          if(shown&&effectsEnabled&&(active||kind==='sword'))points=sampleEndpoints(actor,[d.up,d.down]);
          const up=points?.[d.up],down=points?.[d.down],havePoints=Array.isArray(up)&&Array.isArray(down);
          if(active&&!havePoints)unsupported('Missing blended '+kind+' endpoints '+d.up+'/'+d.down);
          const awakened=actor.awakening?.remaining>0;
          for(const part of ['body','tip']){
            const c=get(actor,kind,part),hyper=part==='body'?RF_TRAIL_REFERENCE.hyperColor:RF_TRAIL_REFERENCE.hyperTipColor;
            const basic=part==='body'?RF_TRAIL_REFERENCE.color:RF_TRAIL_REFERENCE.tipColor;
            const supported=active&&timing.type===0;
            const color=supported?unpackArgb(awakened?hyper:basic):[0,0,0,0];
            // Weapon idle adds transparent endpoints; unit/claw manager simply
            // omits additions outside its timing, retaining its fading history.
            const emit=havePoints&&(supported||kind==='sword'||active&&timing.type===TARGET_TRACE_TYPES.NONE);
            c.buffer.step({dt,up,down:havePoints&&part==='tip'?trailTip(up,down,raw.SLASH_TRACE_TIP_WIDE??4):down,color,emit,enabled:effectsEnabled,shown});
            render(c,shown&&effectsEnabled);
          }
        }
      }
    },
    setLocalActor(id){if(localActorId===id)return;localActorId=id;for(const c of [...channels.values()])drop(c);},
    clear(){for(const c of [...channels.values()])drop(c);},
    proof(){return {evidence:RF_TRAIL_REFERENCE.evidence,channels:[...channels.values()].map(c=>({key:c.key,vertices:c.buffer.pairs.length*2,visible:c.buffer.visible,drawCount:c.drawCount,disableSeconds:c.buffer.disableSeconds})),unsupported:[...notes],rendererCandidate:'SRC_ALPHA/DEST_ALPHA approximated by additive opaque browser destination; target shader/alpha quantization pending'};},
    dispose(){if(disposed)return;for(const c of [...channels.values()])drop(c);material.dispose();disposed=true;},
  };
}

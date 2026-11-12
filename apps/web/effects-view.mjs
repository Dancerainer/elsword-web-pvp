import {setVector3Exact,setQuaternionExact} from './transform-values.mjs';
import {isElswordProfile,isElesisProfile,isAddProfile} from '../../packages/professions/identity.mjs';
import { Mesh, MeshBuilder, Matrix, Quaternion, Vector3, Color3, ShaderMaterial, Texture, SceneLoader, Engine, VertexBuffer } from '@babylonjs/core';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { createEffectRuntime } from '../../packages/effect-runtime/index.mjs';
import {normalizeEffectQuality,showsDamageParticle,showsCharacterHit,createEffectPresentationPolicy,effectMeshPresentationIndices} from '../../packages/effect-runtime/presentation-quality.mjs';
import { createActorView, sampleAnimation, copySampledAnimation } from './actor-presentation.mjs';
import {installOwnedFxMaterialUpdates} from './fx-owned-material-updates.mjs';
import {resolveEffectTemplateKey} from '../../packages/combat-assets/effect-template-key.mjs';
import {createEffectPrewarmPlanner,effectNumberUpperBound,collectSwordCallbackQuadCopies,collectActiveArmorCastQuadCopies} from './effect-prewarm.mjs';
import {createRenderPreparationCache,scheduleRenderPreparation,createPreparationDiagnostics,updateControlledEffectLookup} from './render-preparation.mjs';
import {createAwakeningEffects,awakeningAttachmentsFor,awakeningActorEligible} from './awakening-effects.mjs';
import {createAddTimeRingEffects} from './add-time-ring-effects-v61.mjs';
import {installAddCrestDisplayProfile} from '../../packages/combat-assets/add-crest-display-v61.mjs';
import {createAddFormationEffects} from './add-formation-effects.mjs';
import {isAddFactoryFollower} from '../../packages/combat-core/add-factory.mjs';
import {createDestructionRageEffects} from './destruction-rage-effects.mjs';
import {createCounterWaitEffects} from './counter-wait-effects-v49.mjs';
import {createVeteranOverheatIcons,veteranOverheatIconTemplates} from './vc-overheat-icons.mjs';
import {createCostumeParticles} from './costume-particles.mjs';
import {createCastDisplay} from './cast-display.mjs';
import {createBattleLifeEffects} from './battle-life-effects.mjs';
import {consumeParticleCrash} from '../../packages/effect-runtime/particle-control-events.mjs';
import {writeNativeEffectBoneMatrix,writeNativeEffectBonePlaneMatrix} from './native-effect-bone-matrix.mjs';
import {createProjectedHitView} from './projected-hit-effects.mjs';
import {arcEffectPose} from '../../packages/combat-assets/effect-transform.mjs';
import {createAddChaserTrails} from './add-chaser-trails-v61.mjs';
import {createNativeMeshTrails} from './mesh-trails.mjs';
import {xCrashMeshTransform} from '../../packages/combat-core/xcrash-mesh-transform.mjs';
import {nativeBillboardRotationToRef} from './particle-billboard.mjs';
import {writeNativeParticleColor} from './particle-color.mjs';
import {addVoidCollapseColor,createAddVoidCollapseDisplayRegistry,updateAddVoidCollapseDisplay} from './add-void-collapse-display-v57.mjs';
import {addStardustParticleScale} from './add-stardust-particle-scale-v58.mjs';
import {createLandingEffects} from './landing-effects.mjs';
import {createCommonHitEffects,characterHitConsumer} from './common-hit-effects.mjs';
import {installNativeEffectRenderState} from './effect-render-state.mjs';
import {installNativeEffectMaterial} from './native-effect-material.mjs';
import {addPrismHasTex0Consumer,installAddPrismMaterial,installAddPrismBlackPass,updateAddPrismBlackPass} from './add-prism-display-v57.mjs';
import {nativeMeshBillboardRotationToRef} from './native-mesh-billboard.mjs';
import {usesNativeMeshGeometry} from './native-particle-geometry.mjs';
import {createNativeParticleDrawCounts} from './native-particle-draw-count.mjs';
import {setNativeTransparentLayer,installNativeParticleMatrixBuffer} from './native-effect-draw-order-v3.mjs';
import {setNativeSequenceRenderOrder,nativeSequenceRenderOrder,compareNativeTransparentSubMeshes,nativeParticleTextureEventId} from './native-sequence-render-order.mjs';
import {createNativeQuadFramePlan} from './native-quad-frame-plan.mjs';
import {createNativeQuadBatcher} from './native-quad-batch-v5.mjs';
import {refreshNativeQuadBounds} from './native-quad-bounds-v5.mjs';
import {nativeEffectDepthProfile,nativeEffectMeshHasNoOutput,nativeEffectMeshHasOnlyCombatHelpers} from './native-effect-depth-v7.mjs';
import {sharedNativeQuadMaterial} from './native-quad-materials.mjs';
import {createEffectRenderState,createEffectRenderOffsets,offsetEffectPosition} from './effect-render-anchors.mjs';
import {createMapEffects} from './map-effects.mjs';
import {singlePlayMeshPeriod} from '../../packages/combat-core/literal-mesh-clock.mjs';
import {isGMSpawnRotationEffect,sampleGMSpawnRotation,GM_SPAWN_TEMPLATE} from '../../packages/combat-core/gm-sword-spawn-instance.mjs';
import {createEffectStateLookup} from './effect-state-lookup.mjs';
import {installElesisFeedbackSource} from '../../packages/combat-core/elesis-feedback-source-v45.mjs';
import {installCommonBuffs} from '../../packages/combat-core/buffs.mjs';
import {installAddMoonlightSource} from '../../packages/combat-core/add-moonlight-source-v45.mjs';
import {installAddDeCommandSource} from '../../packages/combat-core/add-de-command-v45.mjs';

const SCALE=.01,DEG=Math.PI/180;
const blends={D3DBLEND_ZERO:0,D3DBLEND_ONE:1,D3DBLEND_SRCCOLOR:768,D3DBLEND_INVSRCCOLOR:769,D3DBLEND_SRCALPHA:770,D3DBLEND_INVSRCALPHA:771,D3DBLEND_DESTALPHA:772,D3DBLEND_INVDESTALPHA:773,D3DBLEND_DESTCOLOR:774,D3DBLEND_INVDESTCOLOR:775};
const vertex=`precision highp float;
attribute vec3 position; attribute vec2 uv;
attribute vec4 world0; attribute vec4 world1; attribute vec4 world2; attribute vec4 world3; attribute vec4 fxColor;
uniform mat4 viewProjection; varying vec2 vUV; varying vec4 vColor;
void main(){gl_Position=viewProjection*mat4(world0,world1,world2,world3)*vec4(position,1.0);vUV=uv;vColor=fxColor;}`;
const fragment=`precision highp float;
varying vec2 vUV; varying vec4 vColor; uniform sampler2D diffuseSampler;
void main(){gl_FragColor=texture2D(diffuseSampler,vUV)*vColor;}`;
// Original map objects can override a mesh sequence to PT_3D_PLANE without
// assigning a texture. SetTexture(NULL) leaves its vertex diffuse colour.
const untexturedFragment=`precision highp float;
varying vec4 vColor; void main(){gl_FragColor=vColor;}`;

/** Native DDS quads are batched by sequence/texture, not one mesh per spark.
 * Source geometry is used for PT_MESH/PT_SKINMESH. Unsupported animation rates
 * are omitted; no invented glow, circle or attack-box display. */
export async function createEffectsView({scene,engine,index,profile,samplers,effectPoses={},loadout=[],nativeRandom,effectQuality,localActorId,assetBase='/assets/rf/',sourceIndexes=[],loadContainer,environment=false,costumeParticleSampler,diagnoseGpu=false,prepareResourcesOnly=false,onPreparationProgress,onUnsupported=()=>{}}){
  // The simulation installs these newly recovered declarations on its own
  // private profile. Presentation needs the same roots before budgeting, not
  // only after the first callback arrives in the middle of combat.
  if(!environment&&profile.target?.build)profile=installAddMoonlightSource(installCommonBuffs({...profile,buffTemplates:{...profile.buffTemplates},buffFactors:{...profile.buffFactors},
    effectSets:{...profile.effectSets},damageEffects:{...profile.damageEffects},effectTemplates:{...profile.effectTemplates}}));
  if([121,125].includes(profile.target?.unitClass))profile=installElesisFeedbackSource(profile);
  if(profile.target?.unitClass===126)profile=installAddDeCommandSource(profile);
  if(!environment)profile=installAddCrestDisplayProfile(profile,index);
  const baseQuality=normalizeEffectQuality(effectQuality);
  const quality=isAddProfile(profile)?normalizeEffectQuality({...baseQuality,sourceFamily:'add'}):baseQuality;
  const drawCountFor=createNativeParticleDrawCounts(index,{nativeRandom,onUnsupported});
  const indexSources=[...sourceIndexes];
  const presentationPolicy=createEffectPresentationPolicy(profile,quality);
  const invisibleMeshTemplates=new Set(Object.values(index.templates).filter(nativeEffectMeshHasNoOutput).map(t=>t.name));
  const batches=new Map(),containers=new Map(),pools=new Map(),meshViews=new Map(),liveMeshes=new Map(),parents=new Map(),notes=new Set(),textures=new Map(),meshCounts=new Map(),meshBudgets=new Map(),startParticleEmitters=new Map(),timedParticleEmitters=new Map(),hitParticleEmitters=new Map();
  const voidDisplays=createAddVoidCollapseDisplayRegistry();
  const planPrewarm=createEffectPrewarmPlanner(profile,index,{effectQuality:quality}),prepareMesh=createRenderPreparationCache();
  const projectedHits=createProjectedHitView({scene,engine,index,profile,assetBase,onUnsupported});
  const performanceState={updateMs:0,renderMs:0,quadInstances:0,quadBatches:0,clampedVertexColors:0,runtimeMeshCreates:0,runtimeMeshCreateMs:0};
  const coldMeshTemplates=new Map();
  const quadFrame=createNativeQuadFramePlan();
  const textureLoads=new Map(),textureErrors=new Map();
  const gpuDraws=new Map(),gpuTextures=new Map(),gpuTextureJobs=new Map();
  const diagnoseTemplate=name=>veteranOverheatIconTemplates.includes(name)||name.startsWith('RVC_C_dashJumpX_hitGround_');
  async function diagnoseTexture(path){
    if(!diagnoseGpu||!engine._gl)return;
    if(gpuTextureJobs.has(path))return gpuTextureJobs.get(path);
    const job=(async()=>{
      const t=textures.get(path),size=t.getSize();
      try{const pixels=await t.readPixels();if(!pixels)throw Error('GPU texture readPixels returned no pixels');
        let zeroAlpha=0,opaqueAlpha=0,alphaSum=0,fnv=2166136261;
        for(let i=0;i<pixels.length;i++){const value=pixels[i];fnv=Math.imul(fnv^value,16777619)>>>0;
          if(i%4===3){zeroAlpha+=value===0?1:0;opaqueAlpha+=value===255?1:0;alphaSum+=value;}}
        const pixel=(x,y)=>Array.from(pixels.slice((y*size.width+x)*4,(y*size.width+x+1)*4));
        gpuTextures.set(path,{path,width:size.width,height:size.height,byteLength:pixels.length,fnv,zeroAlpha,opaqueAlpha,alphaSum,
          corners:[pixel(0,0),pixel(size.width-1,0),pixel(0,size.height-1),pixel(size.width-1,size.height-1)],center:pixel(Math.floor(size.width/2),Math.floor(size.height/2))});
      }catch(error){gpuTextures.set(path,{path,error:String(error)});}
    })();gpuTextureJobs.set(path,job);return job;
  }
  scene.setRenderingOrder(0,null,null,compareNativeTransparentSubMeshes);
  const quadBatcher=createNativeQuadBatcher({scene,upload:uploadQuadBatch});
  scene.onDisposeObservable.addOnce(()=>quadBatcher.dispose());
  let meshSerial=0;
  function note(id,detail){if(!notes.has(id)){notes.add(id);onUnsupported({type:'unsupported-visual',id,detail});}}
  function texture(path){
    if(!textures.has(path)){
      let ready,failed;const loaded=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});
      // A lazily encountered texture still reports failure, even if it has no
      // prewarm caller awaiting it. A fallback is never recorded as ready.
      loaded.catch(()=>{});textureLoads.set(path,loaded);
      const t=new Texture(assetBase+path,scene,false,false,Texture.TRILINEAR_SAMPLINGMODE,ready,message=>{
        const detail=message??'Original texture failed to load';textureErrors.set(path,detail);
        note('texture-load:'+path,detail);failed(new Error(detail));
      });
      t.hasAlpha=true;textures.set(path,t);if(t.isReady()&&!t.loadingError)ready();
    }
    return textures.get(path);
  }
  function blend(material,template){
    const fields=template.fields,depth=nativeEffectDepthProfile(template);
    const src=blends[fields.SourceBlendMode??'D3DBLEND_SRCALPHA'],dst=blends[fields.DestBlendMode??(template.kind==='mesh'?'D3DBLEND_INVSRCALPHA':'D3DBLEND_DESTALPHA')];
    if(src==null||dst==null){note('blend:'+fields.SourceBlendMode+':'+fields.DestBlendMode,'Unimplemented native blend factor');return;}
    material.alphaMode=Engine.ALPHA_COMBINE;
    // Preserve exact D3D9 factors during this draw and restore their previous
    // values afterwards. Merely setting ALPHA_COMBINE on the next material
    // cannot repair the state: Babylon returns early when its mode is cached.
    installNativeEffectRenderState(material,engine,{sourceBlend:src,destBlend:dst,depthTest:depth.depthTest});
    material.backFaceCulling=false;material.disableDepthWrite=!depth.depthWrite;
    // Mesh players and mesh particles have different constructor defaults.
    // Transparent Babylon draws otherwise suppress an explicit/source TRUE.
    material.forceDepthWrite=depth.depthWrite;
  }
  function batch(t,path,slot=0){
    const baseKey=t.name+'|'+path,key=baseKey+'|'+slot;if(batches.has(key))return batches.get(key);
    // NumParticles is a cap per emitter; a template can have many live emitters.
    // A slot represents one emitter/texture/DrawCount pass, not all copies of
    // that template. XCrash trace children have NumParticles=1: reserving256
    // instances for each of thousands of slots stalls their first creation.
    // Grow only when the actual group needs more room; no particle is capped.
    const capacity=Math.max(1,Math.ceil(typeof t.fields.NumParticles==='number'?t.fields.NumParticles:1));
    // Native3974..4022 emits two triangles with CULL_NONE, not duplicate faces.
    const mesh=MeshBuilder.CreatePlane('native-particle:'+key,{size:1,sideOrientation:Mesh.FRONTSIDE},scene);
    // Native ParticleSystem3974..4022: top Y uses V=0, bottom Y V=1.
    // Texture(invertY=false) retains the original TGA/PNG top-row order.
    mesh.setVerticesData(VertexBuffer.UVKind,[0,1,1,1,1,0,0,0]);
    // Extra simultaneous emitters share the already compiled template material.
    // Their geometry buffers remain separate draw units and slots are reused.
    const untextured=path==='@native-untextured';
    const material=sharedNativeQuadMaterial({scene,template:t,path,assetBase,create(){
      const material=new ShaderMaterial('native-particle-material:'+baseKey,scene,{vertexSource:vertex,fragmentSource:untextured?untexturedFragment:fragment},{attributes:['position','uv','world0','world1','world2','world3','fxColor'],uniforms:['viewProjection'],samplers:untextured?[]:['diffuseSampler'],needAlphaBlending:true});
      const sampler=untextured?null:texture(path);
      if(sampler)material.setTexture('diffuseSampler',sampler);
      blend(material,t);return {material,texture:sampler,textureLoad:textureLoads.get(path)};
    },adopt(entry){
      if(untextured||textures.get(path)===entry.texture&&textureLoads.get(path)===entry.textureLoad)return;
      // Canonical aliases across profession views own one sampler/load. Keep
      // each view's path-indexed readiness and GPU diagnostics complete without
      // creating another Texture or compiling against a failed sampler.
      textures.set(path,entry.texture);textureLoads.set(path,entry.textureLoad);
      entry.textureLoad.catch(error=>{
        const detail=error.message;textureErrors.set(path,detail);note('texture-load:'+path,detail);
      });
    }});
    // PT_3D_PLANE uses the forced no-depth-write render-state profile
    // (ParticleSystem.cpp18,3383..3390), regardless of constructor ZWrite.
    mesh.material=material;mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;
    // Keep source CPU rows independent of the GPU scratch buffer. A final
    // transparent-queue batch may concatenate several consecutive sequences,
    // then restore this slot for another camera without changing those rows.
    const result={mesh,material,capacity,count:0,matrices:new Float32Array(capacity*16),colors:new Float32Array(capacity*4),gpuCapacity:capacity,gpuMatrices:new Float32Array(capacity*16),gpuColors:new Float32Array(capacity*4)};
    if(diagnoseGpu&&engine._gl&&diagnoseTemplate(t.name))mesh.onAfterRenderObservable.add(()=>{
      const gl=engine._gl;
      try{
        const effect=material.getEffect(),program=effect?.getPipelineContext()?.program;
        const unit=program?gl.getUniform(program,effect.getUniform('diffuseSampler')):null;
        let boundTextureMatches=null;
        if(Number.isInteger(unit)){
          const previous=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE0+unit);
          boundTextureMatches=gl.getParameter(gl.TEXTURE_BINDING_2D)===textures.get(path)?.getInternalTexture()?._hardwareTexture?.underlyingResource;
          gl.activeTexture(previous);
        }
        const previous=gpuDraws.get(t.name);
        gpuDraws.set(t.name,{name:t.name,path,draws:(previous?.draws??0)+1,blendEnabled:gl.isEnabled(gl.BLEND),
          sourceRGB:gl.getParameter(gl.BLEND_SRC_RGB),destRGB:gl.getParameter(gl.BLEND_DST_RGB),
          sourceAlpha:gl.getParameter(gl.BLEND_SRC_ALPHA),destAlpha:gl.getParameter(gl.BLEND_DST_ALPHA),
          equationRGB:gl.getParameter(gl.BLEND_EQUATION_RGB),equationAlpha:gl.getParameter(gl.BLEND_EQUATION_ALPHA),
          expectedSource:blends[t.fields.SourceBlendMode??'D3DBLEND_SRCALPHA'],expectedDest:blends[t.fields.DestBlendMode??'D3DBLEND_DESTALPHA'],
          depthTest:gl.isEnabled(gl.DEPTH_TEST),depthWrite:gl.getParameter(gl.DEPTH_WRITEMASK),unit,boundTextureMatches,
          vertexColor:Array.from(result.colors.slice(0,4)),instances:result.count});
      }catch(error){gpuDraws.set(t.name,{name:t.name,error:String(error)});}
    });
    setNativeTransparentLayer([mesh],t.fields.Layer);installNativeParticleMatrixBuffer(mesh,result.gpuMatrices);mesh.thinInstanceSetBuffer('fxColor',result.gpuColors,4,false);mesh.thinInstanceCount=0;mesh.setEnabled(false);batches.set(key,result);quadBatcher.register(result);return result;
  }
  function uploadQuadBatch(b,{matrices,colors,count}){
    if(count>b.gpuCapacity){
      while(count>b.gpuCapacity)b.gpuCapacity*=2;
      b.gpuMatrices=new Float32Array(b.gpuCapacity*16);b.gpuColors=new Float32Array(b.gpuCapacity*4);
      installNativeParticleMatrixBuffer(b.mesh,b.gpuMatrices);b.mesh.thinInstanceSetBuffer('fxColor',b.gpuColors,4,false);
    }
    b.gpuMatrices.set(matrices.subarray(0,count*16));b.gpuColors.set(colors.subarray(0,count*4));
    b.mesh.thinInstanceCount=count;
    if(count){
      b.mesh.thinInstanceBufferUpdated('matrix');
      if(!refreshNativeQuadBounds(b.mesh,b.gpuMatrices,count))b.mesh.thinInstanceRefreshBoundingInfo(false);
    }
    if(count)b.mesh.thinInstancePartialBufferUpdate('fxColor',count,0);
  }
  const glbs=[...new Set(Object.values(index.templates).filter(t=>usesNativeMeshGeometry(t)&&drawCountFor(t)>0&&!invisibleMeshTemplates.has(t.name)).map(t=>t.glb))];
  let nextGlb=0;
  await Promise.all(Array.from({length:Math.min(4,glbs.length)},async()=>{
    while(nextGlb<glbs.length){const file=glbs[nextGlb++];const container=await (loadContainer?loadContainer(assetBase,file):SceneLoader.LoadAssetContainerAsync(assetBase,file,scene));for(const g of container.animationGroups)g.stop();containers.set(file,container);}
  }));
  function makeMesh(t){
    if(!usesNativeMeshGeometry(t)||invisibleMeshTemplates.has(t.name))return null;
    const container=containers.get(t.glb);if(!container)return null;
    const sourcePose=effectPoses[t.poseData];
    if(!sourcePose){note(t.name+':pose','Original complete pose document missing; effect mesh omitted');return null;}
    const v=createActorView(container,scene,'fx-'+t.name+'-'+(++meshSerial),SCALE,sourcePose);
    setNativeTransparentLayer(v.meshes,t.fields.Layer);
    v.sourceMaterials=[];
    for(const mesh of v.meshes){const m=mesh.material;if(!m||!mesh.getTotalVertices())continue;
      if('unlit' in m)m.unlit=true;blend(m,t);mesh.isPickable=false;mesh.renderOutline=false;
      const prism=installAddPrismMaterial(m,t);
      v.sourceMaterials.push({material:m,color:m.albedoColor?.clone(),alpha:m.alpha,texture:m.albedoTexture,prism,
        nativeColor:prism?.color??installNativeEffectMaterial(m,t.fields)});
    }
    // Only private FX clones opt in, after all blend/native-color plugins exist.
    // Unsupported/custom-plugin materials keep Babylon's original traversal.
    v.materialUpdates=installOwnedFxMaterialUpdates(v);
    const sourceMeshes=v.meshes.filter(mesh=>mesh.getTotalVertices()>0),visible=new Set(effectMeshPresentationIndices(t,sourceMeshes.length,quality));
    // Child enablement remains fixed across pool reuse and native pose/color
    // sampling. Re-enabling a pooled root cannot restore omitted fragments.
    for(const [i,mesh]of sourceMeshes.entries())if(!visible.has(i))mesh.setEnabled(false);
    installAddPrismBlackPass(v,t,engine);
    v.root.setEnabled(false);meshCounts.set(t.name,(meshCounts.get(t.name)??0)+1);
    if(!meshViews.has(t.name))meshViews.set(t.name,[]);meshViews.get(t.name).push(v);return v;
  }
  for(const t of Object.values(index.templates))if(usesNativeMeshGeometry(t))pools.set(t.name,[]);
  const warmed=new Set(),preparedBudgets=new Map();
  async function prepareBudget(budget){
    const jobs=[];
    const diagnostic=createPreparationDiagnostics(onPreparationProgress,{templates:budget.templates.size});
    diagnostic?.phase('starting');
    try{
    // Jobs can reject while a later creation batch yields to the browser.
    // Observe rejection immediately; the final Promise.all still propagates it.
    const track=(list,job)=>{job.catch(()=>{});list.push(job);};
    for(const row of budget.unsupported)note(row.name+':pool-budget',row.detail);
    for(const name of budget.templates){
      diagnostic?.template(name);
      const t=index.templates[name],templateJobs=[];
      if(t.animationRequiresUnconfirmedRate){note(name+':animation-rate','Time-varying original .X lacks a confirmed tick rate; mesh omitted instead of displaying a wrong frozen deformation');warmed.add(name);continue;}
      if(drawCountFor(t)<=0||invisibleMeshTemplates.has(name)){warmed.add(name);continue;}
      const demand=budget.demands.get(name),wanted=Math.max(meshBudgets.get(name)?.views??0,demand?.views??0);
      if(demand&&demand.views>=wanted)meshBudgets.set(name,demand);
      const quadCopies=budget.quadCopies?.get(name)??1,prepared=preparedBudgets.get(name);
      // Resource prewarm and previous loadouts retain their meshes/materials.
      // Only grow a completed capacity; never skip an in-flight or failed job.
      // Rewalking all retained slots also queued a browser yield for every
      // already-created particle batch on every practice skill change.
      if(prepared&&prepared.views>=wanted&&prepared.quadCopies>=quadCopies&&
        (!usesNativeMeshGeometry(t)||(meshCounts.get(name)??0)>=wanted))continue;
      if(usesNativeMeshGeometry(t))for(let i=meshCounts.get(name)??0;i<wanted;i++){
        await scheduleRenderPreparation(()=>{
          // A concurrent loadout preparation may have filled the same pool
          // while this job waited for a browser task boundary.
          if((meshCounts.get(name)??0)<wanted){const view=makeMesh(t);if(view){pools.get(name).push(view);diagnostic?.created();}}
        });
      }
      if(usesNativeMeshGeometry(t))for(const view of meshViews.get(name)??[])for(const mesh of view.meshes)
        if(mesh.material&&mesh.getTotalVertices()){
          const job=prepareMesh(mesh);diagnostic?.observe(job,name+' / '+mesh.name);track(templateJobs,job);
        }
      if(t.fields.particleType==='PT_3D_PLANE'||t.kind==='particle'&&!t.fields.particleType){
        const drawSlots=Math.max(1,Math.floor(effectNumberUpperBound(t.fields.DrawCount??1)??1))*(budget.quadCopies?.get(name)??1);
        for(const path of [...Object.values(t.textures).map(v=>v.file),...(t.untexturedPlane?['@native-untextured']:[])]){
          // Each whole-sequence DrawCount pass owns a slot. Prepare those
          // source passes now, so a first smoke/critical burst cannot create
          // its second/fourth plane and instance buffers on the combat tick.
          for(let slot=0;slot<drawSlots;slot++){
            const b=await scheduleRenderPreparation(()=>batch(t,path,slot));
            const job=(textureLoads.get(path)??Promise.resolve()).then(()=>prepareMesh(b.mesh,{useInstances:true}));
            diagnostic?.observe(job,name+' / '+path+' / draw '+slot);track(templateJobs,job);
          }
        }
      }
      track(jobs,Promise.all(templateJobs).then(()=>{
        warmed.add(name);const previous=preparedBudgets.get(name);
        preparedBudgets.set(name,{views:Math.max(previous?.views??0,wanted),
          quadCopies:Math.max(previous?.quadCopies??0,quadCopies)});
      }));
    }
    diagnostic?.phase('awaiting-shaders');await Promise.all(jobs);
    if(diagnoseGpu)await Promise.all([...budget.templates].filter(diagnoseTemplate)
      .flatMap(name=>Object.values(index.templates[name].textures??{}).map(t=>diagnoseTexture(t.file))));
    diagnostic?.finish();
    }catch(error){diagnostic?.finish(error);throw error;}
  }
  async function prewarm(slots){await prepareBudget(planPrewarm(slots));}
  async function prewarmResources(slots){
    const source=planPrewarm(slots);
    // Prepare every source material/pose and authored draw pass, without
    // reserving all skills' simultaneous particle bursts on the first page.
    // Actual saved loadouts/rosters still grow the normal pool before play.
    const demands=new Map([...source.demands].map(([name,demand])=>[name,{...demand,
      views:Math.min(demand.views,demand.drawCount),burstUpperBound:false,budgetScope:'resource-materials-only'}]));
    const quadCopies=new Map([...source.quadCopies].map(([name])=>[name,1]));
    await prepareBudget({...source,demands,quadCopies});
  }
  async function prewarmActors(actors,{targetActors=actors}={}){
    // Opponents can carry a different frozen loadout. Preparing only this
    // browser's slots makes their first visible cast synchronously clone and
    // compile source meshes on the battle tick. Sum the actual roster's burst
    // demand, then publish readiness only after those resources are prepared.
    const budget={templates:new Set(),demands:new Map(),unsupported:[],quadCopies:new Map()},addQuadCopies=new Map();
    // A marked target can be struck by any current attacker profession. Warm
    // the original three reaction alternatives only when the frozen roster
    // actually equips Moonlight, instead of reserving every skill everywhere.
    const moonlightReactions=targetActors.some(actor=>actor.professionId==='DE'&&
      (actor.loadout??[]).some(slot=>Number(slot?.skillId)===29024));
    // Multiple actual owners can transition or emit destruction feedback on
    // the same combat tick. Warm their original passes, including End tails;
    // the remaining command/skill templates keep their existing capacities.
    if(actors.length){
      if(isElswordProfile(profile))budget.quadCopies=collectSwordCallbackQuadCopies(profile,index,actors.length);
      if(isElesisProfile(profile))for(const name of ['MonsterAngryWind','Counter_Particle01'])budget.quadCopies.set(name,actors.length);
      for(const [name,copies]of collectActiveArmorCastQuadCopies(profile,index,actors))
        budget.quadCopies.set(name,Math.max(budget.quadCopies.get(name)??0,copies));
    }
    for(const actor of actors){
      const targetCount=Math.max(1,targetActors.filter(other=>other!==actor&&(actor.id==null||other.id!==actor.id)&&
        (actor.team==null||other.team==null||other.team!==actor.team)).length);
      const actorBudget=planPrewarm(actor.loadout??[],{targetCount,moonlightReactions});
      for(const name of actorBudget.templates)budget.templates.add(name);
      budget.unsupported.push(...actorBudget.unsupported);
      for(const [name,demand]of actorBudget.demands){const existing=budget.demands.get(name);
        budget.demands.set(name,{...demand,views:(existing?.views??0)+demand.views,rosterActors:(existing?.rosterActors??0)+1});
      }
      for(const [name,copies]of actorBudget.quadCopies)
        addQuadCopies.set(name,(addQuadCopies.get(name)??0)+copies);
    }
    for(const [name,copies]of addQuadCopies)
      budget.quadCopies.set(name,Math.max(budget.quadCopies.get(name)??0,copies));
    await prepareBudget(budget);
  }
  function* retireBurstPools(){
    if(runtime.count||parents.size)throw Error('Cannot release live effect pools');
    let released=0;
    for(const [name,all]of meshViews){
      const budget=meshBudgets.get(name),keep=Math.min(all.length,budget?.drawCount??1);
      const idle=pools.get(name),retired=new Set();
      let remaining=all.length;
      while(remaining>keep&&idle?.length){const view=idle.pop();retired.add(view);view.dispose();released++;remaining--;yield released;}
      if(retired.size){const retained=all.filter(view=>!retired.has(view));meshViews.set(name,retained);meshCounts.set(name,retained.length);}
      if(budget)meshBudgets.set(name,{...budget,views:keep,burstUpperBound:false,budgetScope:'resource-materials-only'});
    }
    return released;
  }
  function releaseBurstPools(){let released=0;for(const count of retireBurstPools())released=count;return released;}
  async function releaseBurstPoolsAsync(){
    const retired=retireBurstPools();let released=0;
    // Disposal walks complete original skeletons/materials. Bound its starts
    // just like model preparation, so cached profession switching does not
    // occupy one uninterrupted browser task while shedding burst instances.
    while(true){const complete=await scheduleRenderPreparation(()=>{
      const started=performance.now();
      for(let count=0;count<16;count++){
        const next=retired.next();if(next.done)return true;released=next.value;
        if(performance.now()-started>=4)break;
      }
      return false;
    });if(complete)return released;}
  }
  const runtime=createEffectRuntime({index,onUnsupported,seed:2016,nativeRandom,effectQuality:quality,opaqueTarget:true,uvConsumer:addPrismHasTex0Consumer,onBirth(p){
    const drawCount=drawCountFor(p.template,p.options.drawCount);if(drawCount<=0)return;
    if(p.template.animationRequiresUnconfirmedRate){note(p.name+':animation-rate','Time-varying original .X lacks a confirmed tick rate; mesh omitted instead of displaying a wrong frozen deformation');return;}
    if(usesNativeMeshGeometry(p.template)){const pool=pools.get(p.name),views=[];for(let i=0;i<drawCount;i++){
      let view=pool?.pop();if(!view){const began=performance.now();view=makeMesh(p.template);
        if(view){performanceState.runtimeMeshCreates++;performanceState.runtimeMeshCreateMs+=performance.now()-began;coldMeshTemplates.set(p.name,(coldMeshTemplates.get(p.name)??0)+1);}}
      if(view){view.root.setEnabled(true);views.push(view);}}if(views.length)liveMeshes.set(p.id,views);}
  },onDeath(p){const views=liveMeshes.get(p.id);if(views){for(const v of views){v.root.setEnabled(false);(pools.get(p.name)??[]).push(v);}liveMeshes.delete(p.id);}}});
  const mapEffects=environment?createMapEffects({runtime,index}):null;
  const zero=new Vector3(),size=new Vector3(),rotation=new Quaternion(),world=new Matrix();
  const billboardMatrix=new Matrix(),billboardRotation=new Quaternion(),localBillboardRotation=new Quaternion();
  const targetPlaneValues=new Float32Array(16),targetPlaneRotation=[0,0,0];
  const awakening=createAwakeningEffects({runtime,samplers,maxHyperModeTime:profile.components.MAX_HYPER_MODE_TIME,
    eligibleActor:actor=>awakeningActorEligible(profile,actor),
    attachments:awakeningAttachmentsFor(profile),onUnsupported});
  const overheatIcons=createVeteranOverheatIcons({runtime,onUnsupported});
  const landing=createLandingEffects({runtime,onUnsupported});
  const commonHits=createCommonHitEffects({runtime});
  const destructionRage=createDestructionRageEffects({runtime,qualityFor:actor=>presentationPolicy.actor(actor)});
  const counterWait=createCounterWaitEffects({runtime,qualityFor:actor=>presentationPolicy.actor(actor)});
  const meshTrails=createNativeMeshTrails({scene,samplers,profile,onUnsupported});
  const addChaserTrails=createAddChaserTrails({scene,engine,index,profile,samplers,texture,prepareMesh,onUnsupported});
  // Quicksilver's link changes only the main mesh; its DamageEffect and hit
  // particles retain their own anchors and unscaled source payload.
  const controlledAnchor=e=>e?.sourceAddQuicksilverLink?.mainAnchor??e?.sourcePosedAnchor??e?.currentAnchor;
  function rotationFor(p,controlled){
    const fields=p.template.fields,angles=p.values.Rotate,billboard=p.options.billboardType??fields.BillBoardType;
    const sourceRotation=controlledAnchor(controlled)?.rotation;
    if(sourceRotation){Quaternion.RotationYawPitchRollToRef(-(angles[1]+sourceRotation[1])*DEG,-(angles[0]+sourceRotation[0])*DEG,(angles[2]+sourceRotation[2])*DEG,rotation);return rotation;}
    if(billboard==='BT_ALL'){
      // The DamageEffect BONE/POS adapter writes the same authored global
      // rotation to AddRotate and AxisAngle. Impact/NULL child sequences
      // supply zero. Meshes consume global + local; planes consume local.
      if(fields.particleType==='PT_MESH')nativeMeshBillboardRotationToRef(billboardRotation,angles,p.visualRotation,rotation,localBillboardRotation);
      else nativeBillboardRotationToRef(billboardRotation,angles,fields.ReverseY===true,rotation,localBillboardRotation);
    }
    else if(fields.BillBoardType==='BT_Y'){Quaternion.RotationYawPitchRollToRef(scene.activeCamera.rotation.y,-angles[0]*DEG,angles[2]*DEG,rotation);}
    else {Quaternion.RotationYawPitchRollToRef(-(angles[1]+p.visualRotation[1])*DEG,-(angles[0]+p.visualRotation[0])*DEG,(angles[2]+p.visualRotation[2])*DEG,rotation);}
    return rotation;
  }
  const controlledEffects=new Map();let latestState=null,stateLookups=new WeakMap(),eventBatchState=null,eventBatchDepth=0;
  function stateLookup(state){
    let lookup=stateLookups.get(state);
    if(!lookup){
      lookup=createEffectStateLookup(state);
      stateLookups.set(state,lookup);
    }
    return lookup;
  }
  const actorIn=(state,id)=>stateLookup(state).actors.get(id),effectIn=(state,id)=>stateLookup(state).effects.get(id);
  function beginEventBatch(state,lookup){
    if(eventBatchDepth){
      if(eventBatchState!==state)throw new TypeError('A presentation event batch must retain its state');
      eventBatchDepth++;return;
    }
    stateLookups=new WeakMap();stateLookups.set(state,lookup??createEffectStateLookup(state));
    eventBatchState=state;eventBatchDepth=1;
  }
  function endEventBatch(){
    if(!eventBatchDepth||--eventBatchDepth)return;
    eventBatchState=null;stateLookups=new WeakMap();
  }
  const costumeParticles=createCostumeParticles({runtime,sample:costumeParticleSampler});
  const addFormation=createAddFormationEffects({profile,samplers,start,
    stop:id=>{const parent=parents.get(id);if(parent)endParent(id,parent,true);},hasEffect:id=>parents.has(id)});
  const addTimeRing=createAddTimeRingEffects({samplers,start,stop:id=>{const parent=parents.get(id);if(parent)endParent(id,parent,true);},hasEffect:id=>parents.has(id)});
  const castDisplay=createCastDisplay({runtime,samplers,index,profile,onUnsupported});
  const battleLife=createBattleLifeEffects({runtime,samplers,index,onUnsupported});
  const activeBatches=new Set(),batchSlots=new Map();
  function render({actors}={}){
    const renderStarted=performance.now();performanceState.quadInstances=performanceState.quadBatches=performanceState.clampedVertexColors=0;
    // Only the live particle loop consumes displayed effect anchors. Keep all
    // draw cleanup and projected hits below active even when it is empty.
    const displayState=createEffectRenderState(runtime.count?latestState:null,actors,samplers);
    const displayControls=displayState?new Map(displayState.effects.filter(effect=>controlledEffects.has(effect.id)).map(effect=>[effect.id,effect])):controlledEffects;
    const displayOffset=createEffectRenderOffsets(runtime,displayState),displayBones=new Map();
    quadBatcher.beginFrame();
    // Source uses the view rotation transpose. Sample it once per render,
    // rather than discarding local rotation or reading camera Euler angles.
    if(scene.activeCamera){scene.activeCamera.getViewMatrix().transposeToRef(billboardMatrix);
      Quaternion.FromRotationMatrixToRef(billboardMatrix,billboardRotation);}
    // Only touch last frame's active slots. The preloaded/past peak slots can
    // number in the thousands after a long fight, even when no FX are visible.
    for(const b of activeBatches)b.count=0;
    const cameraPosition=scene.activeCamera?.globalPosition.asArray()??[0,0,0];
    batchSlots.clear();quadFrame.beginFrame();
    // Map insertion order is the native particle birth/list order. The actual
    // transparent queue applies sequence/layer/distance order once at drawing;
    // sorting all particles here again adds work but cannot change that queue.
    for(const p of runtime.particles.values()){
      if(invisibleMeshTemplates.has(p.name))continue;
      const t=p.template,fields=t.fields,values=p.values,drawCount=drawCountFor(t,p.options.drawCount);if(drawCount<=0||p.options.hidden===true)continue;
      let scale=p.options.scale??[1,1,1];const s=values.Size;
      // Archenemy's compiled callback owns the effect transform. The combat
      // packet includes this tick's mesh integration; do not integrate it a
      // second time through the presentation-only particle clock.
      let controlled=displayControls.get(p.options.effectParentId);
      // NPC ownership also marks ordinary particle sequences. Only the main
      // mesh consumes the combat transform; particles retain their authored
      // emission radius, velocity, age and emitter-relative Trace movement.
      if((controlled?.sourceAddFury||controlled?.sourceAddQuicksilverLink||isAddFactoryFollower(controlled)||controlled?.sourceAddSummonSerial!==undefined||controlled?.name==='DamageEffect_SA_APT_Magnetron_Dynamo_Start')&&
          (t.kind!=='mesh'||p.name!==controlled.mainEffectName))controlled=null;
      if(controlled?.sourceAddQuicksilverLink)
        scale=controlled.sourceAddQuicksilverLink.mainScale.map((value,i)=>value/s[i]);
      else if(controlled?.sourceElesisShadowLink)
        scale=[controlled.definition.SCALE_X,controlled.definition.SCALE_Y,controlled.definition.SCALE_Z];
      else if(controlled?.sourceAddLinkScale!==undefined&&p.name===controlled.mainEffectName)
        scale=['X','Y','Z'].map(axis=>controlled.definition['SCALE_'+axis]??1);
      else if(controlled?.sourceAddVoidCollapse&&p.name===controlled.mainEffectName)
        scale=scale.map(v=>v*controlled.sourceAddVoidCollapse.scale);
      // Void SetDisplayMultiplier reaches its particle lists without owning
      // their independent authored positions, sizes or lifetime clocks.
      const colorControl=controlled??displayControls.get(p.options.sourceColorParentId);
      const parent=parents.get(p.options.effectParentId);
      // Phantom Sword owns a delayed complete hand matrix. Sampling the live
      // actor here would discard the source's .2 second pose history.
      let tracedMatrix=controlled?.sourcePhantomSword||controlled?.sourceISSheath?controlled.sourcePosedAnchor?.matrix:parent?.sourceBoneMatrix;
      if(tracedMatrix&&displayState&&!controlled&&!p.options.sourceControl){
        if(!displayBones.has(parent.id)){
          const owner=actors.find(actor=>actor.id===parent.ownerId);
          displayBones.set(parent.id,parent.sourceBoneTargetMeshBound?effectIn(displayState,parent.id)?.currentAnchor?.matrix??tracedMatrix:
            owner?samplers.effectAnchorSampler(parent,owner)?.matrix??tracedMatrix:tracedMatrix);
        }
        tracedMatrix=displayBones.get(parent.id);
      }
      const delta=controlled?null:displayOffset(p);
      const position=offsetEffectPosition(controlledAnchor(controlled)?.position??p.position,delta);
      const sourceControl=controlledEffects.get(p.options.effectParentId);
      const oldAnchor=controlledAnchor(sourceControl)?.position;
      const shownAnchor=controlledAnchor(controlled)?.position;
      const sequenceDelta=controlled!==sourceControl&&oldAnchor&&shownAnchor?shownAnchor.map((n,i)=>n-oldAnchor[i]):delta;
      const sequencePosition=offsetEffectPosition(runtime.emitters.get(p.emitterId)?.position??p.position,sequenceDelta);
      const crash=consumeParticleCrash(p.particleControl);
      zero.set((position[0]+(crash?.[0]??0))*SCALE,(position[1]+(crash?.[1]??0))*SCALE,-(position[2]+(crash?.[2]??0))*SCALE);rotationFor(p,controlled);
      const views=liveMeshes.get(p.id);
      if(views){for(const [drawOrder,view] of views.entries()){
        setNativeSequenceRenderOrder(view.meshes,{emitterId:p.emitterId,
          position:sequencePosition,
          cameraPosition,particleOrder:p.id,drawOrder});
        if(tracedMatrix){
          view.sourceBoneWorld??=Matrix.Identity();view.sourceBoneValues??=new Float32Array(16);
          // freezeWorldMatrix(matrix) directly replaces Babylon's matrix but
          // does not advance its parent update ID. Descendants otherwise keep
          // the first position during unanimated mesh trails/attached swords.
          // Unfreeze BEFORE writing: the frozen matrix aliases this buffer.
          view.root.unfreezeWorldMatrix();
          Matrix.FromArrayToRef(writeNativeEffectBoneMatrix(tracedMatrix,view.sourceBoneValues,s,scale,SCALE),0,view.sourceBoneWorld);
          view.root.freezeWorldMatrix(view.sourceBoneWorld);
        }else{
          if(view.root.isWorldMatrixFrozen)view.root.unfreezeWorldMatrix();
          setVector3Exact(view.root.position,zero.x,zero.y,zero.z);view.root.rotationQuaternion??=new Quaternion();setQuaternionExact(view.root.rotationQuaternion,rotation.x,rotation.y,rotation.z,rotation.w);
          setVector3Exact(view.root.scaling,s[0]*scale[0]*SCALE,s[1]*scale[1]*SCALE,s[2]*scale[2]*SCALE);
        }
        if(drawOrder===0||!copySampledAnimation(views[0],view)){
          const name=values.AniName?.animation??view.clips.keys().next().value;
          const arc=controlled&&arcEffectPose({...t,initialAnimation:{name,playback:values.AniName?.playback}},view.sourceLibrary,controlled);
          if(arc?.bind){view.resetBindPose();view.sample=null;}
          else if(arc)sampleAnimation(view,arc.controllerState.animationName,arc.controllerState.animationTime,arc.controllerState.animationLoop,arc.controllerState.presentationTransition);
          else if(name&&!t.animationMissingTickRate)sampleAnimation(view,name,controlled?.sourceShadowMesh?.animationTime??(controlled?.sourceArcHandle||controlled?.sourceLiteralMeshClock||controlled?.sourceXCrashMeshClock?controlled.animationTime:null)??p.meshAnimationTime??p.age*(values.AniSpeed??1),values.AniName?.playback==='XAP_LOOP'||fields.particleType==='PT_SKINMESH');
        }
        for(const source of view.sourceMaterials){const m=source.material;
          source.prism?.uv.setUV(values.Tex0UV);
          if(source.nativeColor){source.nativeColor.setColor(addVoidCollapseColor(values.Color,colorControl,p.options.sourceVoidCollapseDisplay));m.alpha=1;}
          else {if(source.color)m.albedoColor.set(source.color.r*values.Color[0],source.color.g*values.Color[1],source.color.b*values.Color[2]);m.alpha=source.alpha*(p.options.sourceVoidCollapseDisplay?addVoidCollapseColor(values.Color,colorControl,p.options.sourceVoidCollapseDisplay)[3]:values.Color[3]*(colorControl?.sourceAddVoidCollapse?.alpha??1));}
          // PT_MESH/skin Clone opens the model, not OpenTexture. The Texture
          // event sets a particle id used by planes; mesh Render consumes the
          // original material (or explicit XET), never that event's sampler.
          // See fixed V5 ParticleSystem5317..5322,5556..5575 and XMesh372..422.
          m.albedoTexture=source.texture;}
        updateAddPrismBlackPass(view,position,cameraPosition);
        }continue;
      }
      if(fields.particleType&&fields.particleType!=='PT_3D_PLANE'){if(!t.glb)note(p.name+':geometry','Original mesh not available');continue;}
      const path=t.textures[values.Texture]?.file??(t.untexturedPlane?'@native-untextured':null);if(!path){if(values.Texture!=null)note(p.name+':texture','Declared source texture unavailable');continue;}
      const stretch=values.Stretch??1;
      if(values.Color.some(n=>n<0||n>1))performanceState.clampedVertexColors++;
      if(stretch!==1)note('stretch-orientation','Native velocity-aligned stretch orientation is not yet supported; source width multiplier retained');
      if(tracedMatrix&&parent?.sourceBoneTargetMeshBound&&fields.BillBoardType==='BT_NONE'){
        for(let i=0;i<3;i++)targetPlaneRotation[i]=values.Rotate[i]+p.visualRotation[i];
        Matrix.FromArrayToRef(writeNativeEffectBonePlaneMatrix(tracedMatrix,targetPlaneValues,[s[0]*stretch,s[1],1],[scale[0],scale[1],1],targetPlaneRotation,SCALE),0,world);
      }else {size.set(s[0]*scale[0]*SCALE*stretch,s[1]*scale[1]*SCALE,1);Matrix.ComposeToRef(size,rotation,zero,world);}
      const row=quadFrame.append(p,path,nativeParticleTextureEventId(p),drawCount,sequencePosition);
      row.sourceColor=addVoidCollapseColor(values.Color,colorControl,p.options.sourceVoidCollapseDisplay);
      world.copyToArray(row.matrix);
    }
    for(const {emitterId,groups} of quadFrame.finishFrame()){
      // Native texture map groups precede their whole-group DrawCount repeats.
      // Neither birth-path segments nor emitter-wide repeated passes match it.
      let order=0;
      for(const group of groups)for(let draw=0;draw<group.drawCount;draw++){
        let b=null;
        for(const row of group.rows){
          if(draw>=row.drawCount)continue;
          const {p,path,matrix}=row;
          if(!b){
            const key=p.name+'|'+path,slot=batchSlots.get(key)??0;batchSlots.set(key,slot+1);
            b=batch(p.template,path,slot);
            activeBatches.add(b);
            setNativeSequenceRenderOrder([b.mesh],{emitterId,
              position:row.sequencePosition,cameraPosition,drawOrder:order++});
          }
          if(b.count>=b.capacity){b.capacity*=2;const matrices=new Float32Array(b.capacity*16),colors=new Float32Array(b.capacity*4);matrices.set(b.matrices);colors.set(b.colors);b.matrices=matrices;b.colors=colors;}
          b.matrices.set(matrix,b.count*16);writeNativeParticleColor(b.colors,b.count*4,row.sourceColor);b.count++;
        }
      }
    }
    for(const b of activeBatches){b.mesh.setEnabled(b.count>0);if(!b.count){b.mesh.thinInstanceCount=0;activeBatches.delete(b);continue;}uploadQuadBatch(b,b);if(b.count){performanceState.quadBatches++;performanceState.quadInstances+=b.count;b.material.setMatrix('viewProjection',scene.getTransformMatrix());}}
    projectedHits.render();
    performanceState.renderMs=performance.now()-renderStarted;
  }
  function ownerAnchor(parent,state){
    if(parent.sourceBoneTargetMeshBound){
      const candidate=effectIn(state,parent.id),bound=candidate?.ownerId===parent.ownerId?candidate:null;
      if(bound?.currentAnchor)parent.lastSetTargetAnchor=bound.currentAnchor;
      return (parent.lastSetTargetAnchor??parent.birthAnchor)?.position;
    }
    if(parent.sourceTargetMeshBound){
      const candidate=effectIn(state,parent.id),bound=candidate?.ownerId===parent.ownerId?candidate:null;
      if(bound?.currentAnchor)parent.lastSetTargetAnchor=bound.currentAnchor;
      return (parent.lastSetTargetAnchor??parent.birthAnchor)?.position;
    }
    const candidate=effectIn(state,parent.id);
    // Recipient-owned marks/countdowns retain offensive ownership on their
    // caster but already have the accepted target's authoritative anchor.
    // Resolving TRACE against ownerId here moves them back onto the caster.
    if(candidate?.traceActorId!=null)return (candidate.sourcePosedAnchor??candidate.currentAnchor??candidate.birthAnchor)?.position;
    if(parent.sourceAddSummonSerial!==undefined){
      const anchor=candidate?.sourcePosedAnchor??candidate?.currentAnchor??candidate?.birthAnchor;
      if(anchor)parent.lastSummonAnchor=anchor;
      // The NPC has its own skeleton. A missing/orphaned sample must never
      // fall through to the caster's same-named bone or actor position.
      return (parent.lastSummonAnchor??parent.birthAnchor)?.position;
    }
    const controlled=candidate&&(candidate.sourcePosedAnchor||candidate.sourceArcHandle>0||candidate.sourceSkillMeshControl||isAddFactoryFollower(candidate))?candidate:null;
    if((controlled?.sourcePosedAnchor??controlled?.currentAnchor)?.position)return (controlled.sourcePosedAnchor??controlled.currentAnchor).position;
    const a=actorIn(state,parent.ownerId);if(!a)return parent.birthAnchor?.position;
    if(parent.birthAnchor?.customPosition)return parent.birthAnchor.position;
    const follow=parent.definition.TRACE===1||parent.definition.TRACE_MORE===1||parent.definition.TRACE_MATRIX===1;
    return (follow?samplers.effectAnchorSampler(parent,a):parent.birthAnchor)?.position;
  }
  function addParticle(entry,parent,state,impact,{start=false,passive=false,timed=false,mainAnchor=null}={}){
    const parentQuality=presentationPolicy.effect(parent);
    if(!showsDamageParticle(entry,parentQuality))return;
    const actor=actorIn(state,parent.ownerId);if(!actor)return;
    const positionType=entry.POSITION_TYPE??0;
    const current=effectIn(state,parent.id)??parent;
    const main=mainAnchor??current.currentAnchor??parent.birthAnchor;
    const template=profile.effectTemplates?.[current.mainEffectName??parent.mainEffectName];
    const mainRotation=s=>{
      const e=controlledEffects.get(parent.id)??effectIn(s,parent.id)??current;
      const basis=start?main:e.sourcePosedAnchor??e.currentAnchor??e.birthAnchor??main;
      return xCrashMeshTransform(template,e,basis)?.rotation??basis?.rotation;
    };
    const offsetDirection={angles:[NaN,NaN,NaN],x:1,z:0};
    const anchor=s=>{
      const a=actorIn(s,parent.ownerId);if(!a)return null;let pos;
      if(entry.POSITION_TYPE===2)pos=impact;
      else if((entry.POSITION_TYPE??0)===0)pos=samplers.effectBoneSampler(effectIn(s,parent.id)??parent.lastXCrashMesh??parent,a,entry.BONE_NAME,{nativeMissingFramePosition:true});
      else if(entry.POSITION_TYPE===1)pos=samplers.effectAnchorSampler({definition:{BONE_NAME:entry.BONE_NAME}},a)?.position;
      else if(entry.POSITION_TYPE===3)pos=start?mainAnchor?.position:ownerAnchor(parent,s);
      else {note('particle-position:'+entry.POSITION_TYPE,'Unsupported native position type');return null;}
      if(!pos)return null;
      // SetParticleData's OFFSET consumer exists only under DEPT_BONE. Unit
      // bone, impact and main-position branches pass their original point.
      if(positionType!==0)return pos;
      const dx=entry.OFFSET_X??0,dy=entry.OFFSET_Y??0,dz=entry.OFFSET_Z??0;
      if(entry.APPLY_ROTATED_OFFSET!==1)return [pos[0]+dx,pos[1]+dy,pos[2]+dz];
      // Native GetDirVec rotates +X by the main mesh global+local angles,
      // then SetParticleData projects it horizontally. Owner facing and the
      // particle entry's additional rotation do not enter this offset basis.
      const angles=mainRotation(s);
      if(angles&&(angles[0]!==offsetDirection.angles[0]||angles[1]!==offsetDirection.angles[1]||angles[2]!==offsetDirection.angles[2])){
        for(let i=0;i<3;i++)offsetDirection.angles[i]=angles[i];
        const pitch=angles[0]*DEG,yaw=angles[1]*DEG,roll=angles[2]*DEG;
        const c=Math.cos(roll),b=Math.sin(roll),d=b*Math.sin(pitch);
        let x=c*Math.cos(yaw)+d*Math.sin(yaw),z=-c*Math.sin(yaw)+d*Math.cos(yaw);
        if(b*Math.cos(pitch)!==0){const length=Math.hypot(x,z);x=length?x/length:0;z=length?z/length:0;}
        offsetDirection.x=x;offsetDirection.z=z;
      }
      return [pos[0]+offsetDirection.x*dx-offsetDirection.z*dz,pos[1]+dy,pos[2]+offsetDirection.z*dx+offsetDirection.x*dz];
    };
    const position=anchor(state);if(!position){note(entry.PARTICLE_NAME+':bone','Original particle attachment bone cannot be sampled');return;}
    const inheritMain=[0,3].includes(positionType)&&entry.APPLY_ROTATE!==0;
    const track=passive||timed&&entry.TRACE!==0;
    const orientation={axis:[0,0,0],addRotate:[0,0,0]},extraRotate=[entry.ROTATE_X??0,entry.ROTATE_Y??0,entry.ROTATE_Z??0];
    const sampleOrientation=s=>{
      let angles;
      if(positionType===1){const a=actorIn(s,parent.ownerId);if(!a)return null;
        angles=samplers.actorRotationSampler?.(a)??samplers.effectAnchorSampler({definition:{}},a)?.rotation;
      }else if(inheritMain)angles=mainRotation(s);
      else return orientation;
      if(!angles)return null;
      for(let i=0;i<3;i++){
        orientation.axis[i]=angles[i]+extraRotate[i];
        orientation.addRotate[i]=entry.APPLY_ROTATE!==0?orientation.axis[i]:0;
      }
      return orientation;
    };
    sampleOrientation(state);
    const rotationSource=track&&(inheritMain||positionType===1)?sampleOrientation:null;
    const emitter=runtime.add(entry.PARTICLE_NAME,{effectQuality:parentQuality,position,
      ...(parent.name==='DamageEffect_ATT_Void_Field'?{sourceColorParentId:parent.id,sourceVoidCollapseDisplay:parent.voidDisplay}:{}),
      // SetParticleTable copies the damage mesh's land plane before its first
      // SetParticleData call (DamageEffect.cpp5477), including UseLand flames.
      landPosition:current.sourceDamageLandY??current.sourceMeshLandY??actor.landPosition?.[1],
      // START entries are positioned once: the per-frame update iterates
      // PASSIVE/TIME lists (.cpp1894–1945), never the START list.
      // PASSIVE always calls SetParticleData; TRACE gates only the TIME list.
      anchor:start||entry.POSITION_TYPE===2||!passive&&entry.TRACE===0?null:anchor,rotationSource,
      // DEPT_IMPACT_POINT only calls SetPosition, never SetAxisAngle/AddRotate
      // (DamageEffect.cpp6305..6327): owner's left-facing yaw cannot leak in.
      facing:1,axisRotate:orientation.axis,addRotate:orientation.addRotate,scale:addStardustParticleScale(entry,parent,{passive}),
      triggerCount:entry.TRIGGER_COUNT,triggerTime:entry.TRIGGER_TIME});
    if(emitter&&parent.voidDisplay)voidDisplays.track(parent.voidDisplay,emitter.id);
    if(emitter&&(start||!impact))parent.passive.push({id:emitter.id,forceDie:entry.FORCE_DIE===1,forceDieHit:entry.FORCE_DIE_HIT===1});
    return emitter;
  }
  function start(event,state){
    const actor=actorIn(state,event.actorId);if(!actor)return;
    if(projectedHits.startEffect(event,presentationPolicy.effect(event)))return;
    // An active effect identity owns exactly one group of native sequences.
    // Replayed network births must not overwrite this group's handles: the
    // old EnchantHand_PM has no trigger count and requires its parent's stop.
    if(parents.has(event.effectId))return;
    const damage=profile.damageEffects[event.name]?.raw,main=damage?.MAIN_EFFECT_NAME??resolveEffectTemplateKey(index.templates,event.name,event.definition?.EFFECT_TYPE);
    if(main===null){note(event.name+':type','EffectSet type has no matching source template registry');return;}
    const parent={...event,id:event.effectId,ownerId:event.actorId,damage,mainEffectName:main,elapsed:0,animationTime:0,passive:[]};
    // A damage declaration can still deliver later START/TIME/HIT particles
    // even when its main sequence is invisible or unsupported. A pure visual
    // with no successfully created emitter has no work to retain. In
    // particular, the unsupported Wild Charge smoke used to leave one empty
    // parent per cast, although no particle sequence had ever been created.
    if(damage)parents.set(parent.id,parent);
    const follow=event.definition.TRACE===1||event.definition.TRACE_MORE===1||event.definition.TRACE_MATRIX===1;
    const anchor=s=>ownerAnchor(parent,s),position=event.birthAnchor?.position;
    if(!position){note(main+':birth','Original birth anchor not available');return;}
    const t=index.templates[main];
    const helperOnly=!damage&&!event.sourceSetTargetMesh&&!event.sourceShadowMesh&&!event.sourceArcMesh&&!event.sourceArcStartMesh&&!event.sourceXCrashMeshClock&&nativeEffectMeshHasOnlyCombatHelpers(t);
    const sourceMain=effectIn(state,parent.id);
    if(parent.name==='DamageEffect_ATT_Void_Field')parent.voidDisplay=voidDisplays.acquire(parent,sourceMain);
    if(sourceMain?.sourceAddSummonSerial!==undefined)parent.sourceAddSummonSerial=sourceMain.sourceAddSummonSerial;
    // Qualified single-play damage meshes already have an original main
    // clock in combat/owner snapshots. A late network birth must sample that
    // phase instead of starting another complete local playback. Pure visual
    // births remain independent of the naturally retired combat list.
    const sourceSinglePlay=damage&&singlePlayMeshPeriod(profile.effectTemplates?.[main])!==null&&Number.isFinite(sourceMain?.sourceMeshGlobalTime)&&Number.isFinite(sourceMain?.animationTime);
    if(t&&!helperOnly){const emitter=runtime.add(main,{effectQuality:presentationPolicy.effect(parent),position,effectParentId:parent.id,landPosition:actor.landPosition?.[1],
      sourceControl:sourceMain?.sourceGMSpawnRotation!==undefined&&isGMSpawnRotationEffect(sourceMain,profile)?s=>{
        const e=effectIn(s,parent.id),basis=e?.sourcePosedAnchor??e?.currentAnchor??e?.birthAnchor;
        return e?.ownerId===parent.ownerId&&!e.dead&&basis?.position?{
          position:basis.position,velocity:[0,0,0],nowLifeTime:e.meshLifetimeElapsed??e.elapsed,animationTime:e.animationTime,
          localRotation:sampleGMSpawnRotation(e,e.meshLifetimeElapsed??e.elapsed)}:null;}:
        sourceMain?.sourceElesisShadowLink?s=>{const e=effectIn(s,parent.id);return e?.ownerId===parent.ownerId&&!e.dead?{
        position:e.currentAnchor.position,velocity:[0,0,0],nowLifeTime:e.elapsed,animationTime:e.animationTime}:null;}:
        t.kind==='mesh'&&(sourceMain?.sourceAddFury||sourceMain?.sourceAddQuicksilverLink||isAddFactoryFollower(sourceMain)||sourceMain?.sourceAddSummonSerial!==undefined||sourceMain?.name==='DamageEffect_SA_APT_Magnetron_Dynamo_Start')?s=>{const e=effectIn(s,parent.id),anchor=controlledAnchor(e)??e?.birthAnchor;return e&&!e.dead&&anchor?{
        position:anchor.position,velocity:[0,0,0],nowLifeTime:e.meshLifetimeElapsed??e.elapsed,animationTime:e.animationTime}:null;}:
        event.sourceSetTargetMesh?s=>{const candidate=effectIn(s,parent.id),e=candidate?.ownerId===parent.ownerId?candidate:null;return e?{
        position:e.currentAnchor.position,velocity:[0,0,0],nowLifeTime:e.meshLifetimeElapsed,animationTime:e.animationTime}:null;}:
        event.sourceArcStartMesh?s=>{const e=effectIn(s,parent.id);return e?{
        position:e.currentAnchor.position,velocity:[0,0,0],nowLifeTime:e.sourceArcGlobalTime,animationTime:e.sourceArcPose.animationTime}:null;}:
        event.sourceShadowMesh?s=>effectIn(s,parent.id)?.sourceShadowMesh:
        sourceMain?.sourceElesisBloodCutter!==undefined?s=>{const e=effectIn(s,parent.id),basis=e?.sourcePosedAnchor??e?.currentAnchor;return e?.ownerId===parent.ownerId&&!e.dead&&basis?.position?{
          // NPC1641's walk owns both the moving mesh and its remaining age.
          // A late received birth cannot replay another two-second Normal
          // sequence, or keep a visible weapon after that NPC has retired.
          position:basis.position,velocity:[0,0,0],nowLifeTime:e.meshLifetimeElapsed??e.elapsed,animationTime:e.animationTime}:null;}:
        sourceSinglePlay?s=>{const e=effectIn(s,parent.id),basis=e?.sourcePosedAnchor??e?.currentAnchor??e?.birthAnchor;return e?.ownerId===parent.ownerId&&basis?.position?{
          position:basis.position,velocity:[0,0,0],nowLifeTime:e.sourceMeshGlobalTime,animationTime:e.animationTime}:null;}:
        (event.sourceXCrashMeshClock||event.sourcePhantomSword||event.sourceISSheath)?s=>{const e=effectIn(s,parent.id);return e?{
          position:(e.currentAnchor??e.birthAnchor).position,velocity:[0,0,0],nowLifeTime:e.elapsed,animationTime:e.animationTime}:null;}:null,
      anchor:follow?anchor:null,follow,traceMore:event.definition.TRACE_MORE===1,facing:Array.isArray(event.birthAnchor?.rotation)?1:event.birthAnchor?.facing??actor.facing,
      scale:[event.definition.SCALE_X??1,event.definition.SCALE_Y??1,event.definition.SCALE_Z??1],rotate:event.birthAnchor?.rotation??[event.definition.ROTATE_X??0,event.definition.ROTATE_Y??0,event.definition.ROTATE_Z??0]});parent.emitterId=emitter?.id;
      // World EffectSet creation never invokes the UI's direct-particle or
      // retained-hit trigger APIs. A literal/default zero-rate particle main
      // has no output to keep alive. Construct then release it to preserve
      // constructor RNG/sequence ordering without accumulating empty handles.
      if(emitter&&t.kind==='particle'&&(t.fields.Emitrate??0)===0){runtime.stop(emitter.id,true);parent.emitterId=undefined;}
      if(emitter&&t.kind==='mesh'&&t.fields.LifeType==='LT_TIME')parent.meshLifetime=runtime.particles.get([...emitter.particles][0])?.nativeLifetime;}
    if(damage)for(const [key,entry] of Object.entries(damage))if(/^PASSIVE_PARTICLE\d+$/.test(key))addParticle(entry,parent,state,undefined,{passive:true});
    if(parent.emitterId||parent.passive.length)parents.set(parent.id,parent);
  }
  function endParent(id,parent,immediateMain=false,hitLimit=false){
    if(parent.voidDisplay)updateAddVoidCollapseDisplay(parent.voidDisplay,effectIn(latestState,id));
    if(parent.emitterId){
      const emitter=runtime.emitters.get(parent.emitterId);
      // Once its EffectSet is destroyed, a surviving finite main tail keeps
      // the last sampled point. It cannot follow a later action by the owner.
      // A source-controlled main has no independent playback after its owner
      // ends; an older snapshot must not keep driving that destroyed handle.
      if(emitter){emitter.options.anchor=null;emitter.options.rotationSource=null;}
      // CEffect destruction deletes its main mesh handle (DamageEffect1711),
      // while its particle lists use FORCE_DIE/AutoDie. LT_MANUAL EffectSet
      // meshes likewise require their owner's explicit destruction. Otherwise
      // Windmill and Maelstrom's 9999-second helper survive every completed cast.
      const ownedMesh=emitter?.template.kind==='mesh'&&(parent.damage||emitter.template.fields.LifeType==='LT_MANUAL');
      runtime.stop(parent.emitterId,immediateMain||!!ownedMesh||typeof emitter?.options.sourceControl==='function');
    }
    // Native DestroyParticleSequence uses SetAutoDie unless FORCE_DIE=true.
    // Cancelling the parent stops emission while existing particles expire.
    for(const p of parent.passive){
      // CEffect destruction stops calling SetParticleData. AutoDie leaves
      // existing particles alive at their last position; the old attachment
      // must not keep sampling an expired mesh or the owner's later animation.
      const emitter=runtime.emitters.get(p.id);if(emitter){emitter.options.anchor=null;emitter.options.rotationSource=null;}
      runtime.stop(p.id,p.forceDie||hitLimit&&p.forceDieHit);
    }
    parents.delete(id);
    controlledEffects.delete(id);
  }
  function event(e,state){
    if(!eventBatchDepth||eventBatchState!==state)stateLookups=new WeakMap();
    latestState=state;
    overheatIcons.event(e,state);
    battleLife.event(e,state);
    if(e.type==='destructionRageStarted'&&isElswordProfile(profile))destructionRage.event(e,state);
    if(e.type==='counterWaitVisual'&&isElswordProfile(profile))counterWait.event(e,state);
    if(e.type==='effectEnded'){
      const parent=parents.get(e.effectId);
      // StopEffectSet destroys its main particle sequence immediately
      // (EffectSet.cpp:2033..2090,2585..2592). Passive damage particles retain
      // their separate FORCE_DIE / SetAutoDie contract in endParent.
      // VC DeleteOverHeatObject / flamethrower End delete their main object.
      // Keep this ownership on network retirements too: LT_LOOP cannot AutoDie.
      // IS Shield's EffectSet uses the skill's custom effective time
      // (SwordMan19520). Its hidden attack-box mesh cannot retain the original
      // template's 99999s lifetime after that owned set has expired.
      const shieldMain=profile.target?.unitClass===112&&parent?.skillId===21221&&/^DAMAGE_EFFECT_SWORD_SHIELD(?:_ULTIMATE)?$/.test(parent.name);
      const sourceHandleStop=['add-void-handle-stop','moonlight-next-pulse','add-panzer-aim-ended','add-stigma-mark-ended','add-chaser-retain-ended','add-chaser-replaced','add-chaser-owner-ended','elesis-effect-set-carrier-ended'].includes(e.reason);
      if(parent)endParent(e.effectId,parent,shieldMain||sourceHandleStop||parent.buffTemplateId!=null||parent.deleteConditions?.includes(2)||parent.name==='DAMAGE_EFFECT_RVC_FRAME_THROW'||parent.sourceShadowMesh===true||parent.sourceArcMesh===true||parent.sourceArcStartMesh===true||e.reason?.startsWith('buff-')||e.reason==='delete-condition'||e.reason==='original-stop-effect-set'||e.reason==='original-custom-state-delete'||e.reason==='projectile-reflected',e.reason==='hit-limit');
    }
    if(e.type==='hit'&&e.deleteDamageReactEffects===true)for(const [id,parent] of parents)if(parent.ownerId===e.targetId&&parent.deleteConditions?.includes(1))endParent(id,parent,true);
    if(e.type==='effectStarted'&&!addFormation.event(e,state))start(e,state);
    if(e.type==='projectileReflectionFeedback'&&e.particles!==false)for(const [name,min,max,count,drawCount]of [
      ['RevengeImpactSlashCW',50,50,3,1],['RevengeImpactSlashCCW',50,50,3,1],
      ['RevengeImpact',50,50,1,1],['RevengeImpactTick',200,200,20,2]])
      runtime.add(name,{position:e.position,facing:1,landPosition:e.landY,emitRate:{random:[min,max]},triggerCount:count,drawCount});
    if(e.type==='effectStartParticles'){
      const parent=parents.get(e.effectId);
      if(!parent){note('start-particle-parent','Damage effect parent unavailable');return;}
      parent.startParticleKeys??=new Set();
      for(const {key,entry} of e.entries){
        if(key!=null&&parent.startParticleKeys.has(key))continue;
        const emitter=addParticle(entry,parent,state,e.impactPoint,{start:true,mainAnchor:e.mainAnchor});
        if(key!=null)parent.startParticleKeys.add(key);
        if(emitter)startParticleEmitters.set(entry.PARTICLE_NAME,(startParticleEmitters.get(entry.PARTICLE_NAME)??0)+1);
      }
    }
    if(e.type==='effectTimedParticles'){
      const parent=parents.get(e.effectId);
      if(!parent){note('timed-particle-parent','Damage effect parent unavailable');return;}
      // TIME can legitimately fire the same source entry in a later native
      // animation cycle. Suppress a replay of this dispatch identity only;
      // a new eventId/time keeps that later birth (START is once per parent).
      parent.timedParticleDispatches??=new Map();
      const dispatch=e.eventId??e.time;
      for(const {key,entry} of e.entries){
        const previous=key!=null?parent.timedParticleDispatches.get(key):undefined;
        if(dispatch!=null&&(previous===dispatch||Number.isFinite(previous)&&Number.isFinite(dispatch)&&dispatch<previous))continue;
        const emitter=addParticle(entry,parent,state,undefined,{timed:true,mainAnchor:e.mainAnchor});
        if(key!=null&&dispatch!=null)parent.timedParticleDispatches.set(key,dispatch);
        if(emitter)timedParticleEmitters.set(entry.PARTICLE_NAME,(timedParticleEmitters.get(entry.PARTICLE_NAME)??0)+1);
      }
    }
    if(e.type==='hit'||e.type==='effectContact'){
      if(e.criticalFx?.name==='CriticalHit01'&&Array.isArray(e.criticalFx.position))
        runtime.add('CriticalHit01',{position:e.criticalFx.position,facing:1});
      const point=e.origin?.impactPoint;if(!point){note('hit-point:'+e.origin?.kind,'No native collision impact point supplied');return;}
      const actor=state.actors.find(a=>a.id===e.actorId);if(!actor)return;
      // UnitToUnit uses GUUser's retained common sequences; EffectToUnit
      // invokes CEffect::AttackResult/SetHitParticle, not that character path.
      const localId=typeof localActorId==='function'?localActorId(state):localActorId??state.actors[0]?.id;
      const hitQuality=presentationPolicy.characterHit(e);
      if(e.type==='hit'){projectedHits.event(e,actor,hitQuality);
        if(showsCharacterHit(e,localId,hitQuality))commonHits.event(e,hitQuality);}
      const parent=parents.get(e.origin.id)??{ownerId:actor.id,skillId:e.origin.skillId,definition:{},birthAnchor:{position:point,facing:actor.facing},elapsed:0,animationTime:0,passive:[]};
      // DamageEffect::AttackResult4562–4599 applies FORCE_DIE_HIT only
      // when DAMAGE_TIME is exhausted. A repeat-hit effect keeps its passive
      // sequence through earlier contacts (notably IS Sword Shield).
      const damage=e.origin.kind==='core'?profile.damageEffects.RAVEN_NASOD_BALL?.raw:parent.damage;
      for(const [k,entry] of Object.entries(damage??{}))if(/^HIT_PARTICLE\d+$/.test(k)){const emitter=addParticle(entry,parent,state,point);if(emitter)hitParticleEmitters.set(entry.PARTICLE_NAME,(hitParticleEmitters.get(entry.PARTICLE_NAME)??0)+1);}
      if(characterHitConsumer(e))for(const name of Object.values(e.data.CUSTOM_HIT_PARTICLE??{}))runtime.add(name,{effectQuality:hitQuality,position:point,facing:1,landPosition:actor.landPosition?.[1]});
    }
  }
  function step(dt,state){
    const updateStarted=performance.now();
    mapEffects?.step(state);
    if(environment)state={...state,actors:[],effects:[]};
    // Combat updates may replace lists on the same mutable state object.
    // One packet-local index serves all attachment emitters and particles;
    // displayed render states receive their own weakly held index.
    stateLookups=new WeakMap();
    latestState=state;
    updateControlledEffectLookup(controlledEffects,state.effects);
    // A stopped presentation identity may still be present in the body/effect
    // snapshot that accompanied its end event. It no longer owns tail poses.
    for(const id of controlledEffects.keys())if(!parents.has(id))controlledEffects.delete(id);
    projectedHits.step(dt);
    meshTrails.step(dt,state);addChaserTrails.step(dt,state);
    awakening.step(state);castDisplay.step(state);
    overheatIcons.step(state,dt);
    landing.step(state);
    costumeParticles.step(state);
    battleLife.step(state,dt);
    commonHits.step(state);
    destructionRage.step(state);
    counterWait.step(state);
    addFormation.step(state);addTimeRing.step(state);
    const liveEffectIds=new Set((state.effects??[]).map(e=>e.id));
    for(const [id,parent] of parents){const actor=actorIn(state,parent.ownerId);
      if(parent.voidDisplay)updateAddVoidCollapseDisplay(parent.voidDisplay,effectIn(state,id));
      // Completed one-shot passive sequences no longer need attachment/stop
      // bookkeeping. Retain a live combat parent for later TIME/HIT dispatches.
      let kept=0;
      for(const passive of parent.passive)if(runtime.emitters.has(passive.id))parent.passive[kept++]=passive;
      parent.passive.length=kept;
      if(!liveEffectIds.has(id)&&!runtime.emitters.has(parent.emitterId)){
        // A naturally retired combat record does not necessarily send an end
        // event. After its independent main sequence has ended, no native
        // mesh remains to drive PASSIVE/TIME emission or attachment sampling.
        // Stop emission and preserve authored AutoDie particle tails.
        endParent(id,parent);continue;
      }
      const controlled=controlledEffects.get(id);
      if(parent.definition.TRACE_MATRIX===1&&actor&&!parent.birthAnchor?.customPosition)
        parent.sourceBoneMatrix=parent.sourceBoneTargetMeshBound?effectIn(state,id)?.currentAnchor?.matrix??parent.sourceBoneMatrix??null:
          samplers.effectAnchorSampler(parent,actor)?.matrix??null;
      if(controlled?.sourceXCrashMeshClock)parent.lastXCrashMesh={mainEffectName:controlled.mainEffectName,
        definition:controlled.definition,animationTime:controlled.animationTime,elapsed:controlled.elapsed,
        currentAnchor:controlled.currentAnchor,birthAnchor:controlled.birthAnchor};
      // DAMAGE_TIME limits hits, not seconds; LifeTime is a play count under
      // LT_PLAY_COUNT. Only the source LT_TIME field defines this time bound.
      const lifetime=parent.meshLifetime??Infinity;
      const conditions=parent.deleteConditions??[];
      const buffEnded=parent.buffTemplateId!=null&&(actor?.hp<=0||!actor?.buffs?.some(b=>b.templateId===parent.buffTemplateId));
      const ownerChanged=parent.sourceAddSummonSerial===undefined&&(conditions.includes(2)&&actor?.stateSerial!==parent.ownerStateSerial||conditions.includes(3)&&actor?.hp<=0||conditions.includes(5)&&parent.skillId&&actor?.skillId!==parent.skillId);
      const cancelled=!actor||buffEnded||ownerChanged||parent.setName==='EffectSet_RAVEN_HYPER_AURA'&&actor.awakening.remaining<=0;
      if(cancelled||parent.elapsed>=lifetime)endParent(id,parent,cancelled);
      else {parent.elapsed=controlled?.sourceXCrashMeshClock?controlled.elapsed:parent.meshLifetime==null?parent.elapsed+dt:Math.fround(parent.elapsed+Math.fround(dt));
        parent.animationTime=controlled?.sourceXCrashMeshClock?controlled.animationTime:parent.animationTime+dt;
        if(!liveEffectIds.has(id)&&!runtime.emitters.has(parent.emitterId)&&parent.passive.length===0)parents.delete(id);}
    }
    runtime.step(dt,state);
    voidDisplays.prune(runtime.emitters);
    performanceState.updateMs=performance.now()-updateStarted;
  }
  // Compile original particle materials before accepting input. Instancing makes
  // each native sequence in its own draw unit, preserving complete draw passes.
  await addChaserTrails.prewarm();
  // Page initialization compiles complete materials/draw passes first. The
  // actual equipped roster reserves repeated bursts through prewarmActors.
  if(prepareResourcesOnly)await prewarmResources(loadout);else await prewarm(loadout);
  await prepareBudget({templates:new Set(Object.keys(index.templates).filter(name=>name.startsWith('costume:'))),demands:new Map(),unsupported:[]});
  await projectedHits.prewarm();
  function nativeParticleDrawProof(){
    const counts={},samples=[];
    for(const p of runtime.particles.values()){
      counts[p.name]=(counts[p.name]??0)+1;
      const views=liveMeshes.get(p.id);
      if(views&&samples.length<64)samples.push({name:p.name,effectParentId:p.options.effectParentId,age:p.age,axis:[...p.axis],visualRotation:[...p.visualRotation],
        position:[...p.position],scale:p.options.scale??[1,1,1],size:[...p.values.Size],
        rotate:[...p.values.Rotate],color:[...p.values.Color],drawCount:views.length,
        meshes:views[0].meshes.filter(m=>m.getTotalVertices()>0).map(m=>({
          name:m.name.slice(views[0].id.length+1),world:m.computeWorldMatrix(true).asArray(),
          realColor:m.material?.pluginManager?.getPlugin('NativeEffectRealColor')!=null}))});
    }
    return {counts,samples,particleAnchors:[...runtime.particles.values()].slice(-128).map(p=>({name:p.name,effectParentId:p.options.effectParentId,
      position:[...p.position],kind:p.template.kind,particleType:p.template.fields.particleType})),sequences:[...runtime.emitters.values()].slice(-128).map(e=>({name:e.name,id:e.id,effectParentId:e.options.effectParentId,
      quality:e.quality,densityDivisor:e.divisor,position:[...e.position],landPosition:e.options.landPosition})),batches:[...batches.values()].filter(b=>b.count>0).map(b=>({
      name:b.mesh.name,instances:b.count,layer:b.mesh.alphaIndex,
      center:b.mesh.getBoundingInfo().boundingSphere.centerWorld.asArray(),
      sequence:nativeSequenceRenderOrder(b.mesh)}))};
  }
  function textureStatus(){
    const row=path=>{const t=textures.get(path),size=t?.getSize();return {path,url:t?.url??assetBase+path,
      requested:!!t,ready:!!t?.isReady()&&!textureErrors.has(path),error:textureErrors.get(path)??null,
      width:size?.width??0,height:size?.height??0};};
    return {requested:textures.size,ready:[...textures].filter(([path,t])=>t.isReady()&&!textureErrors.has(path)).length,
      failures:[...textureErrors].map(([path,error])=>({path,error})),
      overheat:veteranOverheatIconTemplates.filter(name=>index.templates[name]).map(name=>({name,
        textures:Object.values(index.templates[name].textures??{}).map(t=>row(t.file))}))};
  }
  function ownedMaterialUpdatesProof(){
    const total={views:0,installed:0,active:0,scopedCalls:0,visitedMeshes:0,fallbacks:0},templates={};
    for(const [name,views]of meshViews){
      const row={views:0,installed:0,active:0,scopedCalls:0,visitedMeshes:0,fallbacks:0};
      for(const view of views){const state=view.materialUpdates?.proof();if(!state)continue;row.views++;
        for(const key of ['installed','active','scopedCalls','visitedMeshes','fallbacks'])row[key]+=state[key];}
      for(const key of Object.keys(total))total[key]+=row[key];
      if(row.installed||row.scopedCalls||row.fallbacks)templates[name]=row;
    }
    return {scope:'resident-private-fx-views',...total,templates};
  }
  return {hasPendingWork:()=>parents.size>0||runtime.emitters.size>0||projectedHits.runtime.emitters.size>0||activeBatches.size>0,
    event,beginEventBatch,endEventBatch,step,render,prewarm,prewarmResources,prewarmActors,releaseBurstPools,releaseBurstPoolsAsync,setMap:map=>mapEffects?.setMap(map),async prewarmMap(){
    const budget=planPrewarm([]);
    const demands=new Map([...budget.demands].map(([name,demand])=>[name,{...demand,views:demand.views*12,budgetScope:'six-actors-entry-and-exit-bursts'}]));
    await prepareBudget({...budget,demands});
  },hasEffect:id=>parents.has(id),cancelDamagedOwner(actorId){for(const [id,parent]of parents)if(parent.ownerId===actorId&&parent.deleteConditions?.includes(1))endParent(id,parent,true);},clear(){counterWait.clear();destructionRage.clear();addFormation.clear();addTimeRing.clear();latestState=null;mapEffects?.clear();costumeParticles.clear();battleLife.clear();castDisplay.clear();projectedHits.clear();quadFrame.clear();batchSlots.clear();quadBatcher.beginFrame();awakening.clear();overheatIcons.clear();landing.clear();commonHits.clear();meshTrails.clear();addChaserTrails.clear();runtime.clear();parents.clear();voidDisplays.clear();controlledEffects.clear();startParticleEmitters.clear();timedParticleEmitters.clear();hitParticleEmitters.clear();coldMeshTemplates.clear();for(const key of Object.keys(performanceState))performanceState[key]=0;for(const b of activeBatches){b.mesh.setEnabled(false);b.mesh.thinInstanceCount=0;b.count=0;}activeBatches.clear();},get count(){return runtime.count;},
    performance(){const batching=quadBatcher.performance();return {fxEffectQuality:quality.level,fxParticleDivisor:quality.particleDivisor,fxUpdateMs:performanceState.updateMs,fxRenderMs:performanceState.renderMs,fxParticles:runtime.count,fxEmitters:runtime.emitters.size,fxActiveParents:parents.size,fxQuadDrawSlots:batches.size,fxQuadInstances:performanceState.quadInstances,fxQuadBatches:performanceState.quadBatches,fxTransparentDrawCalls:batching.outputDraws,fxQuadMergedDraws:batching.mergedDraws,fxQuadMergeMs:batching.mergeMs,fxBatchFallbacks:batching.fallbacks,fxClampedVertexColors:performanceState.clampedVertexColors,fxRuntimeMeshCreates:performanceState.runtimeMeshCreates,fxRuntimeMeshCreateMs:performanceState.runtimeMeshCreateMs,fxMeshesLive:liveMeshes.size,fxPoolInstances:meshSerial,fxPoolResident:[...meshCounts.values()].reduce((n,count)=>n+count,0)};},
    activity(){return {landing:landing.proof(),battleLife:battleLife.proof(),castDisplay:castDisplay.proof(),hitParticles:Object.fromEntries(hitParticleEmitters),commonHits:commonHits.proof(),...(mapEffects?{map:mapEffects.proof()}: {})};},
    sourceMeshClocks(){return [...runtime.particles.values()].filter(p=>p.options.sourceControl).map(p=>({
      name:p.name,effectId:p.options.effectParentId,animationTime:p.meshAnimationTime,globalTime:p.age,
      ...(p.name===GM_SPAWN_TEMPLATE?{localRotation:[...p.values.Rotate]}:{})}));},
    proof({includeDraws=false}={}){return {ownedMaterialUpdates:ownedMaterialUpdatesProof(),quadFramePlan:quadFrame.proof(),coldMeshTemplates:Object.fromEntries(coldMeshTemplates),destructionRage:destructionRage.proof(),counterWait:counterWait.proof(),addFormation:addFormation.proof(),addTimeRing:addTimeRing.proof(),...(diagnoseGpu?{gpuDiagnostics:{draws:[...gpuDraws.values()],textures:[...gpuTextures.values()]}}:{}),textureStatus:textureStatus(),effectSetTargets:[...controlledEffects.values()].filter(e=>e.sourceSetTargetMesh&&e.active&&e.currentAnchor).slice(0,32).map(e=>({effectId:e.id,setId:e.sourceEffectSetId,ownerId:e.ownerId,name:e.name,position:[...e.currentAnchor.position],birthPosition:[...e.birthAnchor.position],elapsed:e.meshLifetimeElapsed,lifeTime:e.lifeTimeSeconds})),effectQuality:quality,...(includeDraws?{nativeParticleDraws:nativeParticleDrawProof()}:{}),sourceTemplates:Object.keys(index.templates).length,invisibleMeshTemplates:[...invisibleMeshTemplates],activeInvisibleMeshParticles:[...runtime.particles.values()].filter(p=>invisibleMeshTemplates.has(p.name)).length,indexes:[...indexSources],activeParticles:runtime.count,activeEmitters:runtime.emitters.size,activeEffectParents:parents.size,startParticleEmitters:Object.fromEntries(startParticleEmitters),timedParticleEmitters:Object.fromEntries(timedParticleEmitters),hitParticleEmitters:Object.fromEntries(hitParticleEmitters),projectedHits:projectedHits.proof(),commonHits:commonHits.proof(),awakening:awakening.proof(),costumes:costumeParticles.proof(),battleLife:battleLife.proof(),castDisplay:castDisplay.proof(),overheatIcons:overheatIcons.proof(),landing:landing.proof(),meshTrails:meshTrails.proof(),addChaserTrails:addChaserTrails.proof(),meshPools:pools.size,prewarmedTemplates:warmed.size,meshInstances:meshSerial,meshPoolBudgets:Object.fromEntries(meshBudgets),meshPoolBudgetScope:'sum-of-frozen-roster-bursts-or-single-prewarm',batchedQuadMaterials:new Set([...batches.values()].map(b=>b.material)).size,quadDrawSlots:batches.size,nativeQuadVertexColor:'DWORD-saturated-8bit-before-texture-modulation',opaqueViewport:true,quadFacesPerDraw:1,sourceLayerOrder:true,sequenceDistanceWithinTemplate:true,crossTemplateSequenceOrder:true,quadWholeSequenceDrawCount:true,unsupported:[...runtime.notes,...notes],pending:['Native render-target/post-processing, outline and light parameters','Target emission scheduling, RNG and GPU blend comparison']};}};
}

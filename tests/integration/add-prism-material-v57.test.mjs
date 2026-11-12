/** Real source stage geometry/materials under NullEngine. Texture source bytes
 * are sealed separately; GPU pixels/whole-frame equivalence require a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,RawTexture,Engine} from '@babylonjs/core';
import {originalAddFixture,originalAddSamplers} from '../helpers/add-native-pose-fixture.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer,readGlb} from '../helpers/babylon-assets.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {addPrismHasTex0Consumer,installAddPrismMaterial,installAddPrismBlackPass,updateAddPrismBlackPass} from '../../apps/web/add-prism-display-v57.mjs';
import {createActorView} from '../../apps/web/actor-presentation.mjs';
import {nativeSequenceRenderOrder,setNativeSequenceRenderOrder,compareNativeTransparentSubMeshes} from '../../apps/web/native-sequence-render-order.mjs';
import {installNativeEffectRenderState} from '../../apps/web/effect-render-state.mjs';
import {installActiveMeshCandidates} from '../../apps/web/active-mesh-candidates.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8')),dt=1/60;
const manifest=read('artifacts/lp/manifest.json'),all=Object.assign({},...[manifest.effectAssetIndex,...manifest.visualEffectIndexes].map(p=>read('artifacts/lp/'+p).templates));
const targets=['AN_PARTICLE_PRISM_01','AN_PARTICLE_PRISM_01_1','AN_PARTICLE_PRISM_02'];
test('actual Prism glTF retains native UVs, REPEAT sampling and raw1→1.5 source declarations independently of the project instance override',()=>{
 const {profile}=originalAddFixture('LP',{skillId:29029}),set=profile.effectSets.EffectSet_SA_AN_PARTICLE_PRISM.raw;
 assert.equal(set.EFFECT9.NAME,'AN_PARTICLE_PRISM_01_1');assert.equal(set.EFFECT9.SCALE_X,undefined);
 for(const key of ['EFFECT10','EFFECT11'])assert.deepEqual(['X','Y','Z'].map(a=>set[key]['SCALE_'+a]),[1.5,1.5,1.5]);
 assert.equal(all.Mesh_Particle_Prism.glb,null);assert.ok(all.Mesh_Particle_Prism.poseData);
 for(const name of targets){const {json,accessor}=readGlb(resolve(root,'artifacts/lp',all[name].glb));
  assert.ok(json.samplers.every(s=>s.wrapS===10497&&s.wrapT===10497));
  assert.ok(!json.materials.some(m=>m.pbrMetallicRoughness?.baseColorTexture?.extensions?.KHR_texture_transform));
  const uv=accessor(json.meshes[0].primitives[0].attributes.TEXCOORD_0);assert.ok(uv.some(([u,v])=>u!==v));
  assert.equal(addPrismHasTex0Consumer(all[name]),true);assert.equal(addPrismHasTex0Consumer(all[name],'Tex1UV'),false);
 }
});
test('explicit render consumer clears only confirmed Prism Tex0 diagnostics and leaves unrelated UV channels unsupported',()=>{
 const template=all.AN_PARTICLE_PRISM_02;
 for(const supported of [false,true]){const index={templates:{[template.name]:template}},runtime=createEffectRuntime({index,effectQuality:{level:'high',particleDivisor:1},uvConsumer:supported?addPrismHasTex0Consumer:undefined});
  runtime.add(template.name);for(let i=0;i<20;i++)runtime.step(1/60,{});
  assert.equal([...runtime.notes].some(n=>n===template.name+':uv-render:Tex0UV'),!supported);
 }
 assert.equal(addPrismHasTex0Consumer({...template,name:'unverified-template'}),false);
});
test('Prism source BLACK_EDGE uses original saturated diffuse × normal-ramp texel and a solid reverse-cull second pass',async t=>{
 const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
 engine.setAlphaMode=Engine.prototype.setAlphaMode;scene.skipFrustumClipping=true;
 const camera=new FreeCamera('prism-two-pass-camera',new Vector3(0,0,8),scene);camera.setTarget(Vector3.Zero());
 scene.setRenderingOrder(0,null,null,compareNativeTransparentSubMeshes);const candidates=installActiveMeshCandidates(scene);
 const template=all.AN_PARTICLE_PRISM_02,pose=read('artifacts/lp/'+template.poseData);
 const container=await loadPoseContainer(scene,resolve(root,'artifacts/lp',template.glb),{materials:true});
 const view=createActorView(container,scene,'prism-two-source-passes',.01,pose),mesh=view.meshes.find(m=>m.getTotalVertices()>0);
 const material=mesh.material,texture=RawTexture.CreateRGBATexture(new Uint8Array([255,255,255,255]),1,1,scene);
 texture.getInternalTexture().isReady=true;
 material.albedoTexture=texture;
 const handle=installAddPrismMaterial(material,template);handle.color.setColor([.1,.05,.2,1]);handle.uv.setUV([.51,1]);
 const real=material.pluginManager.getPlugin('NativeEffectRealColor');
 for(const [i,n]of [.1*232/255,.05*218/255,.2*221/255,1].entries())assert.ok(Math.abs(real.color[i]-n)<1e-15);
 assert.deepEqual(handle.proof().tex0Offset,[.51,1]);assert.equal(material.backFaceCulling,true);assert.equal(material.cullBackFaces,true);
 installAddPrismBlackPass(view,template,engine);assert.equal(view.addPrismBlackPass.length,1);
 const edge=view.addPrismBlackPass[0];assert.equal(edge.material.cullBackFaces,false);assert.equal(edge.material.backFaceCulling,true);
 assert.equal(edge.material.needAlphaBlending(),true);assert.equal(edge.material.disableDepthWrite,true);
 updateAddPrismBlackPass(view,[0,0,0],[0,0,6]);assert.equal(edge.material._floats.nativeWidth,600/700);
 updateAddPrismBlackPass(view,[0,0,0],[0,0,8]);assert.equal(edge.material._floats.nativeWidth,.8);
 assert.match(edge.material._shaderPath.fragmentSource,/vec4\(0\.0,0\.0,0\.0,1\.0\)/);
 assert.match(edge.material._shaderPath.vertexSource,/mat3\(world\)\*normal\*nativeWidth/);
 assert.ok(!edge.material._shaderPath.vertexSource.includes('normalize'));
 material.alphaMode=Engine.ALPHA_COMBINE;material.disableDepthWrite=true;material.forceDepthWrite=false;
 installNativeEffectRenderState(material,engine,{sourceBlend:770,destBlend:771,depthTest:true});
 setNativeSequenceRenderOrder(view.meshes,{emitterId:17,position:[0,0,0],cameraPosition:[0,0,8],particleOrder:18,drawOrder:0});
 const actual=scene.getActiveMeshCandidates();assert.ok(actual.data.slice(0,actual.length).includes(edge.edge),'a new second pass enters the default candidate provider');
 let active;const draws=[];for(const m of [mesh,edge.edge]){m.onBeforeRenderObservable.add(()=>{active=m;});await m.material.forceCompilationAsync(m);}
 engine.drawElementsType=engine.drawArraysType=()=>draws.push({name:active?.name,blend:engine.alphaState._blendFunctionParameters.slice(0,4),depthTest:engine.getDepthBuffer(),depthWrite:engine.getDepthWrite()});
 assert.equal(texture.isReady(),true);assert.equal(material.isReadyForSubMesh(mesh,mesh.subMeshes[0]),true,'isolated source material is ready before testing its draw order');
 scene.render();assert.deepEqual(draws.map(d=>d.name),[mesh.name,edge.edge.name],'source body pass then black reverse-cull pass');
 for(const draw of draws){assert.deepEqual(draw.blend,[770,771,770,771]);assert.equal(draw.depthTest,true);assert.equal(draw.depthWrite,false);}
 assert.ok(edge.edge.computeWorldMatrix(true).equalsWithEpsilon(mesh.computeWorldMatrix(true),1e-6));
 view.dispose();assert.equal(edge.edge.isDisposed(),true);assert.equal(scene.materials.includes(edge.material),false);
 candidates.dispose();texture.dispose();container.dispose();scene.dispose();engine.dispose();
});
test('LP29029 ordinary real input keeps black pass and per-particle UV motion through initial and9s phases, then retires with original carrier',async t=>{
 const {sim,a,b,profile}=originalAddFixture('LP',{skillId:29029});a.mp=a.mpMax;a.sourceAdd.dp=8000;b.x=2000;sim.drainEvents();
 const names=new Set(['Mesh_Particle_Prism','ADD_Effect_Explosion_29_2','AN_PARTICLE_PRISM_04',...targets]);
 const templates=Object.fromEntries([...names].map(n=>[n,all[n]]));
 const effectPoses=Object.fromEntries(Object.values(templates).filter(v=>v.poseData).map(v=>[v.poseData,read('artifacts/lp/'+v.poseData)]));
 const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
 new FreeCamera('prism-material-stage-v57',new Vector3(0,35,50),scene);
 const p={...profile,states:{},skillCatalog:profile.skillCatalog.filter(s=>s.executor==='ParticlePrism'),buffTemplates:{},resourceOnlyTemplates:[],resourceOnlyEffectSets:[]};
 const view=await createEffectsView({scene,engine,index:{templates},profile:p,effectPoses,samplers:originalAddSamplers('LP'),effectQuality:{level:'high',particleDivisor:1},
  loadout:a.loadout,loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(root,'artifacts/lp',file),{materials:true})});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 let early=false,late=false,uvVaries=false,lateEdges=0;const offsets=new Set(),known=new Set();
 const prepared=view.proof().meshInstances;
 for(let frame=0;frame<760;frame++){
  sim.step(dt,frame===0?{add:{pressed:['A'],held:['A']}}:{},{snapshot:false});
  for(const e of sim.drainEvents()){
   if(e.type==='effectStarted'&&e.setName==='EffectSet_SA_AN_PARTICLE_PRISM')known.add(e.effectId);
   if(known.has(e.effectId))view.event(e,sim.state);
  }
  view.step(dt,sim.state);view.render();
  for(const sample of view.proof({includeDraws:true}).nativeParticleDraws.samples)
   if([...targets,'AN_PARTICLE_PRISM_04'].includes(sample.name))assert.deepEqual(sample.scale,[1,1,1],'Project instance scale; original raw1.5 remains independent');
  const shown=scene.meshes.filter(m=>m.name.endsWith(':original-black-pass')&&m.isEnabled()&&m.isVisible);
  for(const mesh of scene.meshes){if(!mesh.isEnabled()||!mesh.material?.pluginManager)continue;
   const uv=mesh.material.pluginManager.getPlugin('AddPrismTex0Offset');if(!uv)continue;offsets.add(uv.offset.map(n=>n.toFixed(5)).join(','));
  }
  uvVaries||=offsets.size>4;
  if(frame>90&&frame<180)early||=shown.length>0;
  if(frame>480&&frame<555){late||=shown.length>0;lateEdges=Math.max(lateEdges,shown.length);
   for(const edge of shown){const order=nativeSequenceRenderOrder(edge);assert.ok(order?.emitterId>0);assert.ok(order.childOrder>0);}
  }
  assert.equal(view.proof().meshInstances,prepared,'no runtime model clones introduced by restoring its source second pass');
 }
 assert.equal(early,true);assert.equal(late,true);assert.equal(uvVaries,true);assert.ok(lateEdges>0);
 assert.ok(!scene.meshes.some(m=>m.name.endsWith(':original-black-pass')&&m.isEnabled()));
 assert.ok(!view.proof().unsupported.some(n=>(typeof n==='string'?n:n.id)?.includes('AN_PARTICLE_PRISM_02:uv-render:Tex0UV')));
 assert.equal(sim.state.effects.some(e=>!e.dead&&e.setName==='EffectSet_SA_AN_PARTICLE_PRISM'),false);
 t.diagnostic(JSON.stringify({skillId:29029,formed:false,originalRawScale:1.5,projectInstanceScale:1,lateBlackPasses:lateEdges,observedDistinctUVOffsets:offsets.size,
  preparedViews:prepared,runtimeMeshCreates:view.performance().fxRuntimeMeshCreates,gpuMeasured:false}));
});

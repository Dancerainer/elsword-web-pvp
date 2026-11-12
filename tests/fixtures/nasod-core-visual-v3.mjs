import {Engine,Scene,Color3,Color4,Vector3,FreeCamera,SceneLoader,MeshBuilder,StandardMaterial} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {createActorView,sampleAnimation} from '../../apps/web/actor-presentation.mjs';
import {styleNasodCore,updateNasodCorePresentation} from '../../apps/web/nasod-core-presentation.mjs';
import {createLighting} from '../../apps/web/lighting.mjs';
const canvas=document.querySelector('canvas'),status=document.querySelector('output');
const engine=new Engine(canvas,true,{alpha:false,stencil:true,preserveDrawingBuffer:true});
const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.clearColor=new Color4(.1,.14,.22,1);createLighting(scene);
const camera=new FreeCamera('core-camera',new Vector3(0,1,8),scene);camera.setTarget(new Vector3(0,1,0));
try{
  const [container,pose]=await Promise.all([
    SceneLoader.LoadAssetContainerAsync('/assets/rf/','effects/Motion_Raven_RageMode_Nasod.glb',scene),
    fetch('/assets/rf/effects/Motion_Raven_RageMode_Nasod.pose.json').then(r=>{if(!r.ok)throw Error('Pose HTTP '+r.status);return r.json();}),
  ]);
  const legacy=createActorView(container,scene,'legacy-core',.01,pose),fixed=styleNasodCore(createActorView(container,scene,'corrected-core',.01,pose));
  legacy.root.position.set(-2,1,0);fixed.root.position.set(2,1,0);
  // The original shield faces the authored +X line, so turn both equal views
  // toward this fixture's +Z camera. No source bone/mesh scale is altered.
  legacy.root.rotation.y=fixed.root.rotation.y=Math.PI/2;
  for(const mesh of legacy.meshes)if(mesh.getTotalVertices()){mesh.renderOutline=true;mesh.outlineColor=new Color3(.968,.443,0);}
  const backMaterial=new StandardMaterial('depth-background',scene);backMaterial.diffuseColor=new Color3(.1,.4,.62);backMaterial.emissiveColor=backMaterial.diffuseColor;
  for(const x of [-2,2]){const plane=MeshBuilder.CreateBox('behind-core-'+x,{width:2.8,height:2.8,depth:.1},scene);plane.material=backMaterial;plane.position.set(x,1,-.8);}
  let selected='Guard',distance=8,frame=0;
  const meshes=view=>view.meshes.filter(m=>m.getTotalVertices());
  function worldScale(mesh){const matrix=mesh.computeWorldMatrix(true).m;return Math.max(Math.hypot(...matrix.slice(0,3)),Math.hypot(...matrix.slice(4,7)),Math.hypot(...matrix.slice(8,11)));}
  function publish(){
    // Diagnostic groups only; production never hides meshes at this threshold.
    const geometry=meshes(fixed),live=geometry.filter(m=>m.isEnabled()&&worldScale(m)>.0001),ready=live.filter(m=>m.isReady(true));
    const collapsed=geometry.filter(m=>worldScale(m)<=.0001);
    const range=values=>values.length?[Math.min(...values),Math.max(...values)]:[];
    status.textContent=JSON.stringify({fixture:'actual original GLB/textures/pose; web adapter; native2016 full shader comparison pending',
      selected,distance,legacy:{surfaceDepthWrites:meshes(legacy).filter(m=>m.material.forceDepthWrite).length,
        visibleWidthRange:range(meshes(legacy).filter(m=>worldScale(m)>.0001).map(m=>m.outlineWidth))},
      corrected:{surfaceDepthWrites:meshes(fixed).filter(m=>m.material.forceDepthWrite).length,
        visibleLocalWidthRange:range(live.map(m=>m.outlineWidth)),visibleWorldWidthRange:range(live.map(m=>m.outlineWidth*worldScale(m))),
        collapsedSurfaceMeshes:collapsed.length,collapsedWorldWidthRange:range(collapsed.map(m=>m.outlineWidth*worldScale(m))),
        collapsedBounds:collapsed.slice(0,3).map(m=>({name:m.name,worldScale:worldScale(m),
          boundsDiagonal:Vector3.Distance(m.getBoundingInfo().boundingBox.minimumWorld,m.getBoundingInfo().boundingBox.maximumWorld)})),
        nativeLayers:[...new Set(meshes(fixed).map(m=>m.alphaIndex))],readySurfaceMeshes:ready.length,
        visibleSurfaceMeshes:live.length,geometryMeshes:meshes(fixed).length},sceneMeshes:scene.meshes.length,sceneMaterials:scene.materials.length});
    document.querySelector('#ready').textContent=ready.length===live.length&&live.length?'Nasod Core model loaded. Left: previous display. Right: source depth writes and scaled orange outline.':'Compiling Nasod Core materials and outline…';
    document.querySelector('#ready').dataset.loaded=String(ready.length===live.length&&live.length>0);
  }
  function present(){
    selected=document.querySelector('input[name=pose]:checked').value;distance=Number(document.querySelector('input[name=distance]:checked').value);
    camera.position.z=distance;camera.setTarget(new Vector3(0,1,0));
    for(const view of [legacy,fixed])sampleAnimation(view,selected,selected==='Guard'?.2:.4,selected==='Wait');
    updateNasodCorePresentation(fixed,{camera,outlineColor:selected==='Guard'?[.968,.443,0,1]:[1,.333,.0745,1]});
    scene.render();
    publish();
  }
  for(const input of document.querySelectorAll('input'))input.addEventListener('change',present);
  present();engine.runRenderLoop(()=>{scene.render();if(frame++%30===0)publish();});
  const resize=()=>{engine.resize();present();};new ResizeObserver(resize).observe(canvas);resize();
}catch(error){status.textContent=String(error.stack??error);document.querySelector('#ready').textContent='Load failed';throw error;}

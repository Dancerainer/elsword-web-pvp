import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Engine,Scene,FreeCamera,Vector3,MeshBuilder,StandardMaterial} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {profile,visualIndex} from '../helpers/rf-passive-fixture-v12.mjs';

test('actual scene draw disables native ZEnable=false depth and restores it for other transparent objects',async()=>{
 const engine=new NullEngine();engine.setAlphaMode=Engine.prototype.setAlphaMode;
 const scene=new Scene(engine);const camera=new FreeCamera('depth-state',new Vector3(0,0,10),scene);camera.setTarget(Vector3.Zero());
 const real=visualIndex.templates.RavenHandFireP03;
 assert.equal(real.fields.ZEnable,false);
 const index={...visualIndex,templates:{RavenHandFireP03:real}};
 const bounded={...profile,states:{},skillCatalog:[],damageEffects:{},buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
 const view=await createEffectsView({scene,engine,index,profile:bounded,samplers:{}});
 const state={actors:[{id:'rf',facing:1,awakening:{remaining:0,orbs:0}}],effects:[]};
 view.event({type:'effectStarted',effectId:1,actorId:'rf',name:real.name,definition:{},birthAnchor:{position:[0,0,0],facing:1}},state);
 view.step(1/60,state);view.render();
 const regular=MeshBuilder.CreatePlane('regular-transparent',{size:1},scene);
 const material=new StandardMaterial('regular-transparent-material',scene);material.alpha=.5;material.disableLighting=true;
 regular.material=material;regular.position.z=5;regular.alwaysSelectAsActiveMesh=true;
 let active=null;const draws=[];
 for(const mesh of scene.meshes){mesh.onBeforeRenderObservable.add(()=>{active=mesh;});
  if(mesh.material)await mesh.material.forceCompilationAsync(mesh,{useInstances:mesh.hasThinInstances});}
 engine.drawElementsType=engine.drawArraysType=function(){draws.push({name:active?.name,depth:this.getDepthBuffer(),blend:this.alphaState._blendFunctionParameters.slice(0,4)});};
 scene.render();
 const fx=draws.filter(d=>d.name?.startsWith('native-particle:'));
 assert.ok(fx.length>0,'test must observe an actual draw, not only notify onBind');
 assert.ok(fx.every(d=>d.depth===false),'original ZEnable=false reaches draw state');
 assert.ok(fx.every(d=>d.blend.join(',')==='770,772,770,772'),'original source-alpha/dest-alpha factors reach actual draw');
 const other=draws.filter(d=>d.name==='regular-transparent');
 assert.ok(other.length>0);assert.ok(other.every(d=>d.depth===true),'state must not leak into other transparent meshes');
 assert.ok(other.every(d=>d.blend.join(',')==='770,771,1,1'),'regular ALPHA_COMBINE must not inherit native DESTALPHA');
 assert.equal(engine.getDepthBuffer(),true,'original engine state restored after unbind');
 view.clear();scene.dispose();engine.dispose();
});

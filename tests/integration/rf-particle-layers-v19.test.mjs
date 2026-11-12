import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {profile,visualIndex} from '../helpers/rf-passive-fixture-v12.mjs';
import {compareNativeTransparentSubMeshes,nativeSequenceRenderOrder} from '../../apps/web/native-sequence-render-order.mjs';

test('native layer and far-to-near sequence order retain real P03 DrawCount2 instances',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
 new FreeCamera('native-alpha-order',new Vector3(0,0,10),scene);
 const t=visualIndex.templates.RavenHandFireP03;
 assert.equal(t.fields.Layer,16);assert.equal(t.fields.DrawCount,2);assert.equal(t.fields.ZEnable,false);
 const index={...visualIndex,templates:{RavenHandFireP03:t}};
 const bounded={...profile,states:{},skillCatalog:[],damageEffects:{},buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
 const view=await createEffectsView({scene,engine,index,profile:bounded,samplers:{},loadout:[]});
 const state={actors:[{id:'rf',facing:1,awakening:{remaining:0,orbs:0}}],effects:[]};
 // World and actor layers are mapped by the scene adapter too. Within this
 // template the original sequence distance order precedes adjacent repeats.
 for(const [id,z] of [[1,0],[2,1000]])view.event({type:'effectStarted',effectId:id,actorId:'rf',name:'RavenHandFireP03',definition:{},birthAnchor:{position:[0,0,z],facing:1}},state);
 view.step(1/60,state);view.render();
 const meshes=scene.meshes.filter(m=>m.name.startsWith('native-particle:RavenHandFireP03|')&&m.thinInstanceCount>0);
 const mesh=meshes[0];
 assert.equal(mesh.alphaIndex,16);assert.equal(mesh.material.disableDepthWrite,true);
 assert.equal(meshes.reduce((n,m)=>n+m.thinInstanceCount,0),4,'two original sequences, each repeated twice');
 assert.equal(meshes.length,4,'each emitter retains separate complete DrawCount passes');
 const ordered=meshes.map(m=>({_alphaIndex:m.alphaIndex,_distanceToCamera:0,getMesh:()=>m})).sort(compareNativeTransparentSubMeshes).map(s=>s.getMesh());
 const positions=ordered.map(m=>m._thinInstanceDataStorage.matrixData[14]);
 assert.ok(positions[0]<-9&&positions[1]<-9,'far sequence passes precede the near sequence');
 assert.ok(Math.abs(positions[2])<.1&&Math.abs(positions[3])<.1,'near sequence retains both passes');
 assert.deepEqual(ordered.map(m=>nativeSequenceRenderOrder(m).drawOrder),[0,1,0,1]);
 assert.equal(new Set(meshes.map(m=>m.material)).size,1,'simultaneous emitters share the compiled material');
 const poolSize=scene.meshes.length;view.render();assert.equal(scene.meshes.length,poolSize,'draw-unit slots are reused');
 view.clear();scene.dispose();engine.dispose();
});

test('actual XCrash fire layer declarations reach original shader materials without changing blend factors',async()=>{
 const names=['Raven_Hand_Fire05','RavenHandFireP01','RavenHandFireP02','RavenHandFireP03'];
 const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('layers',new Vector3(0,0,10),scene);
 const index={...visualIndex,templates:Object.fromEntries(names.map(name=>[name,visualIndex.templates[name]]))};
 const bounded={...profile,states:{},skillCatalog:[],damageEffects:{},buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
 const view=await createEffectsView({scene,engine,index,profile:bounded,samplers:{}});
 const state={actors:[{id:'rf',facing:1,awakening:{remaining:0,orbs:0}}],effects:[]};
 view.event({type:'effectStarted',effectId:1,actorId:'rf',name:names[0],definition:{},birthAnchor:{position:[0,0,0],facing:1}},state);
 for(let i=0;i<3;i++){view.step(1/60,state);view.render();}
 assert.deepEqual(names.map(name=>scene.meshes.find(m=>m.name.startsWith('native-particle:'+name+'|')).alphaIndex),[13,14,15,16]);
 const fire=scene.meshes.find(m=>m.name.startsWith('native-particle:'+names[0]+'|'));
 fire.material.onBindObservable.notifyObservers(fire);
 assert.deepEqual(engine.alphaState._blendFunctionParameters.slice(0,4),[770,771,770,771]);
 const child=scene.meshes.find(m=>m.name.startsWith('native-particle:'+names[1]+'|'));
 child.material.onBindObservable.notifyObservers(child);
 assert.deepEqual(engine.alphaState._blendFunctionParameters.slice(0,4),[770,772,770,772]);
 view.clear();scene.dispose();engine.dispose();
});

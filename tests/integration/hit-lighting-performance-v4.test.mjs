import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,MeshBuilder,TransformNode,PBRMaterial} from '@babylonjs/core';
import {createHitLighting} from '../../apps/web/hit-lighting.mjs';
import {installCharacterToonMaterial,characterToonMaterial} from '../../apps/web/character-toon-material.mjs';
function body(scene,name,parent){const mesh=MeshBuilder.CreateBox(name,{},scene);mesh.parent=parent;
 mesh.material=new PBRMaterial(name,scene);mesh.material.disableLighting=true;installCharacterToonMaterial(mesh.material);
 mesh.material.forceCompilationAsync=async()=>{};return mesh;}
test('prepared toon hit bindings never rescan dormant meshes or repeat hierarchy traversal during contacts',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine),roots=[new TransformNode('a',scene),new TransformNode('b',scene)];
 const a=body(scene,'a-body',roots[0]),b=body(scene,'b-body',roots[1]);let traversals=0;
 for(const root of roots){const original=root.getChildMeshes.bind(root);root.getChildMeshes=(...args)=>{traversals++;return original(...args);};}
 const views=new Map([['a',{root:roots[0],meshes:[a]}],['b',{root:roots[1],meshes:[b]}]]),actors=[{id:'a',x:0,z:0},{id:'b',x:100,z:0}];
 for(let i=0;i<256;i++)MeshBuilder.CreateBox('idle'+i,{},scene).setEnabled(false);
 const light=createHitLighting({scene,viewFor:id=>views.get(id)});await light.prewarm(actors);assert.equal(traversals,2);
 let rescans=0;for(const mesh of scene.meshes){const original=mesh._resyncLightSource.bind(mesh);mesh._resyncLightSource=(...args)=>{rescans++;return original(...args);};}
 for(let i=0;i<120;i++){if(i%5===0)light.event({type:'hit',actorId:'a',targetId:'b',amount:1},{actors});light.step(1/60);}
 assert.equal(rescans,0);assert.equal(traversals,2);assert.equal(scene.lights.length,0,'retain v27 additive shader, no physical lamps');
 assert.equal(characterToonMaterial(a.material).damage,true);light.step(.2);assert.equal(characterToonMaterial(a.material).damage,false);
 light.reset();assert.ok(light.proof().every(r=>r.activeMaterials===0));light.clear();scene.dispose();engine.dispose();
});
test('costume/view changes and removal refresh toon bindings without retaining old damage state',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('actor',scene),a=body(scene,'a',root);
 const view={root,meshes:[a]},actors=[{id:'a',x:0,z:0},{id:'b',x:100,z:0}];let current=view;
 const light=createHitLighting({scene,viewFor:id=>id==='a'?current:null});await light.prewarm(actors);
 light.event({type:'hit',actorId:'b',targetId:'a',amount:1,origin:{kind:'effect'}},{actors});light.step(0);
 const costume=body(scene,'costume',root);view.costume={};light.step(0);assert.equal(characterToonMaterial(costume.material).damage,true);
 const replacement=body(scene,'replacement');current={meshes:[replacement]};light.step(0);
 assert.equal(characterToonMaterial(a.material).damage,false);assert.equal(characterToonMaterial(costume.material).damage,false);
 assert.equal(characterToonMaterial(replacement.material).damage,true);current=null;light.step(0);
 assert.equal(characterToonMaterial(replacement.material).damage,false);assert.deepEqual(light.proof(),[]);
 scene.dispose();engine.dispose();
});

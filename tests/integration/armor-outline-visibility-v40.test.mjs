import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,MeshBuilder,PBRMaterial,TransformNode} from '@babylonjs/core';
import {styleCharacter} from '../../apps/web/lighting.mjs';
import {updateActorArmorPresentation} from '../../apps/web/armor-presentation.mjs';
import {updateWeaponPresentation} from '../../apps/web/weapon-presentation.mjs';
import {nativeCharacterEdge} from '../../apps/web/native-character-edge.mjs';

const professions=['RF','LK','VC','RS','BM','IS','GM','BH','CA','LP','MM','DE'];
function fixture(scene,id){
  const root=new TransformNode(id,scene),meshes=['body','accessory'].map(name=>{
    const mesh=MeshBuilder.CreateBox(id+'-'+name,{},scene);mesh.parent=root;mesh.material=new PBRMaterial(mesh.name,scene);return mesh;
  });
  const view={id,root,meshes,nodesBySourceName:new Map()};styleCharacter(view);return view;
}
function renderPresentation(view,actor,distance=1000){
  // Match the game's ordering: armor first, then camera/weapon presentation.
  updateActorArmorPresentation(view,actor,{}, {showAll:true});
  updateWeaponPresentation(view,actor,actor.professionId,{cameraDistance:distance});
}
function assertEdges(view,width,color){
  for(const mesh of view.meshes){
    const edge=nativeCharacterEdge(mesh);assert.equal(mesh.outlineWidth,width);assert.deepEqual(mesh.outlineColor.asArray(),color);
    assert.equal(edge.material._floats.nativeWidth,width);assert.deepEqual(edge.color.asArray(),[...color,1]);assert.equal(edge.edge.isEnabled(),true);
  }
}
test('all twelve professions keep widened protection through the camera pass and restore ordinary edges without adding resources',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    for(const professionId of professions){
      const view=fixture(scene,professionId),actor={professionId,hp:100,superArmor:true,superArmorNotRed:true,invincible:false,buffs:[]};
      const before=structuredClone(actor),edges=view.meshes.map(mesh=>nativeCharacterEdge(mesh)),counts=[scene.meshes.length,scene.materials.length];
      for(let cycle=0;cycle<3;cycle++){
        actor.superArmor=true;renderPresentation(view,actor);assertEdges(view,2.5,[1,0,0]);
        assert.equal(view.armorPresentation.sourceGateActive,false,'showAll reveals the real protection without changing its source gate');
        renderPresentation(view,actor,600);assertEdges(view,3,[1,0,0]);
        actor.superArmor=false;renderPresentation(view,actor,600);assertEdges(view,1.2,[0,0,0]);
        renderPresentation(view,actor);assertEdges(view,1,[0,0,0]);
      }
      actor.superArmor=true;assert.deepEqual(actor,before,'presentation must not change combat protection or buffs');
      assert.deepEqual(view.meshes.map(mesh=>nativeCharacterEdge(mesh)),edges);
      assert.deepEqual([scene.meshes.length,scene.materials.length],counts,'width changes reuse the existing hull and material');
      for(const mesh of view.meshes){const material=mesh.material;mesh.dispose();material.dispose();}view.root.dispose();
    }
  }finally{scene.dispose();engine.dispose();}
});
test('Elesis endurance keeps its orange precedence and restores active red or ordinary width when the buff expires',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    for(const professionId of ['GM','BH','CA']){
      const view=fixture(scene,professionId),buff={templateId:238,finalizers:[{remaining:10}],behaviors:[]};
      const actor={professionId,hp:100,superArmor:true,superArmorNotRed:false,buffs:[buff]};
      renderPresentation(view,actor);assertEdges(view,2.125,[1,.5,0]);assert.equal(view.armorPresentation.endurance,true);
      buff.finalizers[0].remaining=0;renderPresentation(view,actor);assertEdges(view,2.5,[1,0,0]);
      actor.superArmor=false;renderPresentation(view,actor);assertEdges(view,1,[0,0,0]);
      buff.finalizers[0].remaining=10;renderPresentation(view,actor);assertEdges(view,2.125,[1,.5,0]);
      actor.hp=0;renderPresentation(view,actor);assertEdges(view,1,[0,0,0]);
    }
  }finally{scene.dispose();engine.dispose();}
});
test('invulnerability and hidden-source gates still suppress red armor without widening the ordinary edge',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const view=fixture(scene,'LK'),actor={professionId:'LK',hp:100,superArmor:true,superArmorNotRed:false,invincible:true};
    renderPresentation(view,actor);assertEdges(view,1,[0,0,0]);
    actor.invincible=false;renderPresentation(view,actor);assertEdges(view,2.5,[1,0,0]);
    actor.superArmorNotRed=true;
    updateActorArmorPresentation(view,actor);updateWeaponPresentation(view,actor,'LK',{cameraDistance:1000});assertEdges(view,1,[0,0,0]);
  }finally{scene.dispose();engine.dispose();}
});

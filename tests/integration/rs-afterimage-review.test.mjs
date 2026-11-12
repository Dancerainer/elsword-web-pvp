import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,VertexBuffer} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createActorView,sampleAnimation,placeActor} from '../../apps/web/actor-presentation.mjs';
import {createBuffAfterimages} from '../../apps/web/buff-afterimages.mjs';
import {fixture} from '../helpers/rs-fixture.mjs';
test('Phoenix afterimage freezes actual original skinned pose/world matrix, stays bounded and retires after buff end',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{const sourcePose=JSON.parse(readFileSync('artifacts/rs/runtime-pose.json'));
    const container=await loadPoseContainer(scene,'artifacts/rs/rs-runtime.glb');
    const view=createActorView(container,scene,'rs',.01,sourcePose),f=fixture();f.sim.grantBuff(f.a,f.a,46,1);
    sampleAnimation(view,'SI_SA_EMK_PHOENIX_TALON',.5);placeActor(view,f.a);
    const baseline={meshes:scene.meshes.length,materials:scene.materials.length};
    const renderer=createBuffAfterimages({scene,viewFor:()=>view,localActorId:'rs'});renderer.step([f.a],1/60);
    const ghosts=scene.meshes.filter(m=>m.name.startsWith('buff-afterimage:')&&m.isEnabled());assert.ok(ghosts.length>=6);
    assert.ok(ghosts.every(m=>m.getTotalIndices()>0||m.isUnIndexed&&m.getTotalVertices()>0),'original unindexed triangle geometry must submit actual draws');
    const ghost=ghosts[0],vertices=[...ghost.getVerticesData(VertexBuffer.PositionKind)],matrix=ghost.getWorldMatrix().asArray();
    f.a.x+=150;sampleAnimation(view,'SI_SA_EMK_PHOENIX_TALON',1.2);placeActor(view,f.a);renderer.step([f.a],1/60);
    assert.deepEqual([...ghost.getVerticesData(VertexBuffer.PositionKind)],vertices);assert.deepEqual(ghost.getWorldMatrix().asArray(),matrix);
    for(let i=0;i<120;i++)renderer.step([f.a],1/60);
    assert.ok(renderer.proof().meshSlots<=ghosts.length*10);
    f.a.buffs=[];for(let i=0;i<30;i++)renderer.step([f.a],1/60);
    assert.equal(renderer.proof().actors,0);assert.equal(scene.meshes.length,baseline.meshes);assert.equal(scene.materials.length,baseline.materials);
    f.sim.grantBuff(f.a,f.a,46,1);
    // Each new match actor must release all predecessor geometry and ten/five
    // shader slots. Check actual engine resources, not controller bookkeeping.
    for(let i=0;i<20;i++){renderer.step([{...f.a,id:'peer-'+i}],1/60);
      assert.equal(renderer.proof().actors,1);assert.equal(scene.materials.length,baseline.materials+5);
      assert.ok(scene.meshes.length<=baseline.meshes+ghosts.length);}
    renderer.clear();assert.equal(scene.meshes.length,baseline.meshes);assert.equal(scene.materials.length,baseline.materials);
    renderer.step([f.a],1/60);renderer.step([],1/60);
    assert.equal(scene.meshes.length,baseline.meshes);assert.equal(scene.materials.length,baseline.materials);
    renderer.step([f.a],1/60);f.a.hp=0;for(let i=0;i<30;i++)renderer.step([f.a],1/60);
    assert.equal(scene.meshes.length,baseline.meshes);assert.equal(scene.materials.length,baseline.materials);
    f.a.hp=f.a.hpMax;renderer.step([f.a],1/60);renderer.dispose();renderer.dispose();
    assert.equal(scene.meshes.length,baseline.meshes);assert.equal(scene.materials.length,baseline.materials);view.dispose();
  }finally{scene.dispose();engine.dispose();}
});

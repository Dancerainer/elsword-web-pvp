import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,FreeCamera,Vector3,VertexBuffer} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
const read=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));

test('actual UnitStunB production quad matches original D3D corner/UV pairs without a texture flip',async()=>{
  const profile=read('packages/combat-core/rf-profile.json'),index=read('contracts/rf-buff-display-fx-index.json');
  const selected={...index,templates:{UnitStunB:index.templates.UnitStunB}};
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  new FreeCamera('quad-source-check',new Vector3(0,0,10),scene);
  const view=await createEffectsView({scene,engine,index:selected,profile:{...profile,resourceOnlyTemplates:['UnitStunB']},samplers:{}});
  try{
    const mesh=scene.meshes.find(m=>m.name.startsWith('native-particle:UnitStunB|'));assert.ok(mesh);
    const positions=mesh.getVerticesData(VertexBuffer.PositionKind),uv=mesh.getVerticesData(VertexBuffer.UVKind);
    const corners=Array.from({length:positions.length/3},(_,i)=>[positions[i*3],positions[i*3+1],uv[i*2],uv[i*2+1]]);
    // Fixed V5 KTDGParticleSystem.cpp3974..4022, independently copied four
    // unique native vertices (native draws six indexed-equivalent vertices).
    const original=[[-.5,.5,0,0],[-.5,-.5,0,1],[.5,.5,1,0],[.5,-.5,1,1]];
    assert.deepEqual(corners.sort((a,b)=>a[0]-b[0]||a[1]-b[1]),original.sort((a,b)=>a[0]-b[0]||a[1]-b[1]));
    const texture=mesh.material.getActiveTextures()[0];assert.ok(texture);assert.equal(texture.invertY,false);
    assert.equal(mesh.material.backFaceCulling,false);
  }finally{view.clear();scene.dispose();engine.dispose();}
});

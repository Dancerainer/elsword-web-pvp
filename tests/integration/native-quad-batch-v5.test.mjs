import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Engine,Scene,FreeCamera,Vector3,MeshBuilder,Matrix,ShaderMaterial,VertexBuffer} from '@babylonjs/core';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import {RenderingGroup} from '@babylonjs/core/Rendering/renderingGroup.js';
import {createNativeQuadBatcher} from '../../apps/web/native-quad-batch-v5.mjs';
import {setNativeSequenceRenderOrder,compareNativeTransparentSubMeshes} from '../../apps/web/native-sequence-render-order.mjs';
import {installNativeParticleMatrixBuffer,uploadNativeParticleMatrices} from '../../apps/web/native-effect-draw-order-v3.mjs';
import {installNativeEffectRenderState} from '../../apps/web/effect-render-state.mjs';
import {sharedNativeQuadMaterial} from '../../apps/web/native-quad-materials.mjs';

const vertex=`precision highp float;attribute vec3 position;attribute vec2 uv;
attribute vec4 world0;attribute vec4 world1;attribute vec4 world2;attribute vec4 world3;attribute vec4 fxColor;
uniform mat4 viewProjection;void main(){gl_Position=viewProjection*mat4(world0,world1,world2,world3)*vec4(position,1.);}`;
const fragment='precision highp float;void main(){gl_FragColor=vec4(1.,1.,1.,.5);}';

function setup(enabled=true){
  const engine=new NullEngine();engine.getCaps().instancedArrays=true;engine.setAlphaMode=Engine.prototype.setAlphaMode;
  const scene=new Scene(engine);scene.skipFrustumClipping=true;
  const camera=new FreeCamera('camera',new Vector3(0,0,10),scene);camera.setTarget(Vector3.Zero());
  scene.setRenderingOrder(0,null,null,compareNativeTransparentSubMeshes);
  const batches=[],draws=[],uploads=[];let active=null,throwOnDraw=false,throwAfterMergedUpload=false;
  function upload(batch,data){
    uploads.push({batch,data,count:data.count});
    installNativeParticleMatrixBuffer(batch.mesh,data.matrices);
    batch.mesh.thinInstanceSetBuffer('fxColor',data.colors,4,false);
    uploadNativeParticleMatrices(batch.mesh,data.count);
    if(throwAfterMergedUpload&&data.count>batch.count)throw Error('merged upload failure');
  }
  const batcher=enabled?createNativeQuadBatcher({scene,upload}):null;
  function material(name='native',src=770,dst=772){
    const m=new ShaderMaterial(name,scene,{vertexSource:vertex,fragmentSource:fragment},
      {attributes:['position','uv','world0','world1','world2','world3','fxColor'],uniforms:['viewProjection'],needAlphaBlending:true});
    m.alphaMode=Engine.ALPHA_COMBINE;m.backFaceCulling=false;m.disableDepthWrite=true;m.forceDepthWrite=false;
    installNativeEffectRenderState(m,engine,{sourceBlend:src,destBlend:dst,depthTest:false});return m;
  }
  function plane(name,m,layer=13){
    const mesh=MeshBuilder.CreatePlane(name,{size:1},scene);mesh.material=m;mesh.alphaIndex=layer;
    mesh.setVerticesData(VertexBuffer.UVKind,[0,1,1,1,1,0,0,0]);mesh.alwaysSelectAsActiveMesh=true;
    mesh.onBeforeRenderObservable.add(()=>{active=mesh;});return mesh;
  }
  function quad(name,m,{emitter=1,z=30,order=0,ids=[1],layer=13}={}){
    const mesh=plane(name,m,layer),matrices=new Float32Array(ids.length*16),colors=new Float32Array(ids.length*4);
    ids.forEach((id,i)=>{
      Matrix.Translation(id,0,z).copyToArray(matrices,i*16);colors.set([id/255,.25,.5,.75],i*4);
    });
    const batch={mesh,material:m,matrices,colors,count:ids.length};batches.push(batch);upload(batch,batch);
    setNativeSequenceRenderOrder([mesh],{emitterId:emitter,position:[0,0,-z*100],cameraPosition:[0,0,10],drawOrder:order});
    if(batcher)assert.equal(batcher.register(batch),true);return batch;
  }
  function ordinary(name,m,z=20,layer=13){const mesh=plane(name,m,layer);mesh.position.z=z;return mesh;}
  engine.drawElementsType=function(fill,indexStart,indexCount,instances){
    if(throwOnDraw)throw Error('draw failure');
    const instanced=active.hasThinInstances,count=instanced?instances:1;
    assert.ok(!instanced||count>0,'test executes the actual Babylon thin-instance draw path');
    const geometry={positions:Array.from(active.getVerticesData('position')),uv:Array.from(active.getVerticesData('uv')),
      indices:Array.from(active.getIndices()).slice(indexStart,indexStart+indexCount)};
    const primitives=[];
    for(let i=0;i<count;i++){
      const matrix=instanced?Array.from(active._thinInstanceDataStorage.matrixData.subarray(i*16,i*16+16)):Array.from(active.getWorldMatrix().m);
      const color=instanced?Array.from(active._userThinInstanceBuffersStorage.data.fxColor.subarray(i*4,i*4+4)):null;
      for(let triangle=0;triangle<geometry.indices.length;triangle+=3)primitives.push({
        object:instanced?'quad':active.name,material:active.material.name,layer:active.alphaIndex,matrix,color,
        triangle:geometry.indices.slice(triangle,triangle+3),positions:geometry.positions,uv:geometry.uv,
        blend:this.alphaState._blendFunctionParameters.slice(0,4),depthTest:this.getDepthBuffer(),depthWrite:this.getDepthWrite(),
      });
    }
    draws.push({name:active.name,count,primitives});
  };
  return {engine,scene,camera,batcher,batches,draws,uploads,upload,material,quad,ordinary,
    failDraw(value){throwOnDraw=value;},
    failMergedUpload(value){throwAfterMergedUpload=value;},
    async compile(){for(const mesh of scene.meshes)await mesh.material.forceCompilationAsync(mesh,{useInstances:mesh.hasThinInstances});},
    render(){draws.length=0;batcher?.beginFrame();scene.render();return draws.flatMap(d=>d.primitives);},
    dispose(){batcher?.dispose();scene.dispose();engine.dispose();},
  };
}

function fixture(s){
  const m=s.material(),add=s.material('add',1,1);
  // Whole texture-group repeats carry identical geometry/color, in group order.
  s.quad('far-group-pass0',m,{emitter:1,z:30,order:0,ids:[11,12]});
  s.quad('far-group-pass1',m,{emitter:1,z:30,order:1,ids:[11,12]});
  s.ordinary('map',s.material('map'),22);
  s.quad('middle0',m,{emitter:2,z:18,ids:[21]});s.quad('middle1',m,{emitter:3,z:17,ids:[22]});
  s.ordinary('actor',s.material('actor'),16);
  s.quad('near0',m,{emitter:4,z:15,ids:[31]});s.quad('near1',m,{emitter:5,z:14,ids:[32]});
  s.quad('different-blend',add,{emitter:6,z:13,ids:[41]});
  s.quad('other-layer',m,{emitter:7,z:40,ids:[51],layer:14});
}

test('different source templates with identical draw state merge without changing actual primitive order or blend',async()=>{
  const original=setup(false),shared=setup();try{
    for(const s of [original,shared])for(let i=0;i<3;i++){
      const template={name:'cue-'+i,kind:'particle',fields:{particleType:'PT_3D_PLANE',DestBlendMode:'D3DBLEND_INVSRCALPHA'}};
      const create=()=>s.material('same-source-shader');
      const material=s===original?create():sharedNativeQuadMaterial({scene:s.scene,template,assetBase:i===1?'/assets/rs/':'/assets/lk/',path:i===1?'../lk/fx/white.png':'fx/white.png',create});
      s.quad('cue-'+i,material,{emitter:i+1,z:30-i,ids:[i+1]});
    }
    await original.compile();await shared.compile();assert.deepEqual(shared.render(),original.render());
    assert.equal(original.draws.length,3);assert.equal(shared.draws.length,1);
    assert.equal(shared.batcher.performance().mergedDraws,2);
  }finally{original.dispose();shared.dispose();}
});

test('actual Babylon scene draws preserve every triangle, matrix, color, DrawCount repeat and map/actor barrier',async()=>{
  const original=setup(false),merged=setup();try{
    fixture(original);fixture(merged);await original.compile();await merged.compile();
    const expected=original.render(),actual=merged.render();assert.deepEqual(actual,expected);
    assert.deepEqual(merged.draws.map(d=>d.name),['far-group-pass0','map','middle0','actor','near0','different-blend','other-layer']);
    assert.equal(original.draws.length,10);assert.equal(merged.draws.length,7);
    assert.equal(merged.batcher.performance().mergedDraws,3);
    for(const b of merged.batches){
      assert.equal(b.mesh.thinInstanceCount,b.count);
      assert.strictEqual(b.mesh._thinInstanceDataStorage.matrixData,b.matrices);
      assert.strictEqual(b.mesh._userThinInstanceBuffersStorage.data.fxColor,b.colors);
    }
  }finally{original.dispose();merged.dispose();}
});

test('RF and LK renderers share one scene hook and still merge their own materials',async()=>{
  const s=setup(),second=createNativeQuadBatcher({scene:s.scene,upload:s.upload});
  try{
    const rf=s.material('rf'),lk=s.material('lk');
    s.quad('rf0',rf,{emitter:1,z:30});s.quad('rf1',rf,{emitter:2,z:29});
    for(let i=0;i<2;i++)second.register(s.quad('lk'+i,lk,{emitter:3+i,z:20-i}));
    await s.compile();second.beginFrame();s.render();
    assert.equal(s.draws.length,2,'both professions retain batching in the shared scene');
    assert.equal(s.batcher.performance().fallbacks,0);assert.equal(second.performance().fallbacks,0);
    second.dispose();s.render();
    assert.equal(s.draws.length,3,'disposing one owner does not remove the other owner hook');
    assert.notEqual(s.scene.renderingManager.getRenderingGroup(0).render,RenderingGroup.prototype.render);
  }finally{second.dispose();s.dispose();}
});

test('multiple cameras and maintained queues redraw original CPU data in each camera order and restore exact queues',async()=>{
  const original=setup(false),merged=setup();try{
    fixture(original);fixture(merged);await original.compile();await merged.compile();
    for(const s of [original,merged]){
      s.render();
      const second=new FreeCamera('second',new Vector3(0,0,50),s.scene);second.setTarget(Vector3.Zero());
      s.scene.activeCameras=[s.camera,second];s.scene.renderingManager.maintainStateBetweenFrames=true;
    }
    const queue=merged.scene.renderingManager.getRenderingGroup(0)._transparentSubMeshes;
    const snapshot=queue.data.slice(),length=queue.length;
    for(let frame=0;frame<3;frame++){
      // Native sequence metadata follows each active camera exactly as the
      // current comparator consumes it; original and merged share that input.
      assert.deepEqual(merged.render(),original.render());
      assert.equal(queue.length,length);assert.deepEqual(queue.data,snapshot);
      for(const b of merged.batches)assert.equal(b.mesh.thinInstanceCount,b.count);
    }
  }finally{original.dispose();merged.dispose();}
});

test('per-submesh clipping and changed Babylon sorting layouts fall back to all original draws',async()=>{
  const s=setup();try{
    const m=s.material();s.quad('a',m,{ids:[1]});s.quad('b',m,{emitter:2,ids:[2]});await s.compile();
    s.render();const group=s.scene.renderingManager.getRenderingGroup(0);
    group._transparentSortCompareFn=RenderingGroup.defaultTransparentSortCompare;
    s.render();assert.equal(s.draws.length,2);assert.equal(s.batcher.performance().mergedDraws,0);
    assert.equal(s.batcher.performance().fallbackReason,'unsupported-render-layout');
    group._transparentSortCompareFn=compareNativeTransparentSubMeshes;
    for(const b of s.batches)b.mesh.subMeshes[0].isInFrustum=()=>true;
    s.scene._activeMeshesFrozenButKeepClipping=true;
    s.render();assert.equal(s.draws.length,2);assert.equal(s.batcher.performance().mergedDraws,0);
    s.scene._activeMeshesFrozenButKeepClipping=false;
  }finally{s.dispose();}
});

test('canonical geometry, base transforms, source meshes and render-state boundaries cannot be merged',async()=>{
  const s=setup();try{
    const m=s.material();
    const a=s.quad('a',m,{ids:[1]}),b=s.quad('b',m,{emitter:2,ids:[2]});
    b.mesh.position.x=1;
    const c=s.quad('changed-source-uv',m,{emitter:3,ids:[3]});c.mesh.setVerticesData('uv',[0,0,1,0,1,1,0,1]);
    const d=s.quad('outline',m,{emitter:4,ids:[4]});d.mesh.renderOverlay=true;
    s.ordinary('unregistered-source-mesh',m,30);
    await s.compile();s.render();assert.equal(s.batcher.performance().mergedDraws,0);
    assert.equal(a.count,1);assert.equal(b.count,1);assert.equal(c.count,1);assert.equal(d.count,1);
    const invalid={...a,mesh:s.ordinary('invalid-register',m,30)};invalid.mesh.setVerticesData('uv',[0,0,1,0,1,1,0,1]);
    assert.equal(s.batcher.register(invalid),false);
  }finally{s.dispose();}
});

test('draw exceptions restore original queue/buffers and dispose reinstates Babylon methods',async()=>{
  const s=setup();try{
    const m=s.material();s.quad('a',m,{ids:[1]});s.quad('b',m,{emitter:2,ids:[2]});await s.compile();s.render();
    const group=s.scene.renderingManager.getRenderingGroup(0),queue=group._transparentSubMeshes;
    s.scene.renderingManager.maintainStateBetweenFrames=true;
    const snapshot=queue.data.slice(),length=queue.length;
    s.failDraw(true);assert.throws(()=>s.render(),/draw failure/);
    assert.equal(queue.length,length);assert.deepEqual(queue.data,snapshot);
    for(const b of s.batches){assert.equal(b.mesh.thinInstanceCount,b.count);assert.strictEqual(b.mesh._thinInstanceDataStorage.matrixData,b.matrices);}
    s.failDraw(false);s.batcher.dispose();assert.strictEqual(group.render,RenderingGroup.prototype.render);
    s.render();assert.equal(s.draws.length,2);
    // Clearing and refilling a frame does not retain a previously merged count.
    for(const b of s.batches){b.count=0;b.mesh.setEnabled(false);}s.scene.renderingManager.maintainStateBetweenFrames=false;
    s.render();assert.equal(s.draws.length,0);
  }finally{s.dispose();}
});

test('a failed merged upload restores partially changed GPU buffers and falls back to the original draw order',async()=>{
  const original=setup(false),s=setup();try{
    for(const view of [original,s]){const m=view.material();view.quad('a',m,{ids:[1]});view.quad('b',m,{emitter:2,ids:[2]});await view.compile();}
    s.failMergedUpload(true);assert.deepEqual(s.render(),original.render());
    assert.equal(s.draws.length,2);assert.equal(s.batcher.performance().fallbackReason,'merge-upload-failed');
    for(const b of s.batches)assert.equal(b.mesh.thinInstanceCount,b.count);
    s.failMergedUpload(false);assert.deepEqual(s.render(),original.render());assert.equal(s.draws.length,1);
  }finally{original.dispose();s.dispose();}
});

test('cleared and refilled frames use current active counts and replaced CPU buffers without stale merged instances',async()=>{
  const s=setup();try{
    const m=s.material(),a=s.quad('a',m,{ids:[1]}),b=s.quad('b',m,{emitter:2,ids:[2]});
    await s.compile();s.render();assert.equal(s.draws[0].count,2);
    for(const batch of s.batches){batch.count=0;batch.mesh.setEnabled(false);s.upload(batch,batch);}
    s.render();assert.equal(s.draws.length,0);assert.equal(s.batcher.performance().mergedDraws,0);
    for(const [batch,ids] of [[a,[8,9]],[b,[10]]]){
      batch.count=ids.length;batch.matrices=new Float32Array(ids.length*16);batch.colors=new Float32Array(ids.length*4);
      ids.forEach((id,i)=>{Matrix.Translation(id,0,30).copyToArray(batch.matrices,i*16);batch.colors.set([id/255,.25,.5,.75],i*4);});
      batch.mesh.setEnabled(true);s.upload(batch,batch);
    }
    const primitives=s.render();assert.equal(s.draws.length,1);assert.equal(s.draws[0].count,3);
    assert.deepEqual(primitives.map(row=>row.matrix[12]),[8,8,9,9,10,10]);
    assert.equal(a.count,2);assert.equal(b.count,1);assert.equal(a.mesh.thinInstanceCount,2);assert.equal(b.mesh.thinInstanceCount,1);
  }finally{s.dispose();}
});

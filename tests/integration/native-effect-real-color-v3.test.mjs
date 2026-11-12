import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,MeshBuilder,PBRMaterial,Color3} from '@babylonjs/core';
import {installNativeEffectMaterial} from '../../apps/web/native-effect-material.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const root=resolve(import.meta.dirname,'../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function setup(){
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=2048;
  const scene=new Scene(engine);scene.skipFrustumClipping=true;
  const camera=new FreeCamera('camera',new Vector3(0,0,-10),scene);camera.setTarget(Vector3.Zero());
  return {engine,scene,dispose(){scene.dispose();engine.dispose();}};
}

test('independent original shader and fixed source declare float REAL_COLOR without PBR or source material colour',async()=>{
  const shader=await readFile(resolve(root,'.cache/fx-realcolor-v3/XRenderer.fx'));
  assert.equal(hash(shader),'96b4bb61c56924a3427d6ab800631489471cd70538f30ad0919544ea2a244cc8');
  const text=shader.toString('latin1'),vertex=text.slice(text.indexOf('VS_REAL_COLOR_OUTPUT_NONFOG VertRealColor_NONFOG'),text.indexOf('VS_REAL_COLOR_OUTPUT VertRealColor'));
  assert.match(vertex,/o\.Diffuse\s*=\s*g_Color/);assert.doesNotMatch(vertex,/g_Material|pow\(|Light/);
  assert.match(text,/compile vs_1_1 VertRealColor_NONFOG\(\)/);
  const technique=text.slice(text.indexOf('technique REAL_COLOR'),text.indexOf('technique CARTOON_BLACK_EDGE'));
  for(const key of ['Color','Alpha']){
    assert.match(technique,new RegExp(key+'Op\\[0\\]\\s*=\\s*Modulate'));
    assert.match(technique,new RegExp(key+'Arg1\\[0\\]\\s*=\\s*Texture'));
    assert.match(technique,new RegExp(key+'Arg2\\[0\\]\\s*=\\s*Diffuse'));
  }
  const source=await readFile(resolve(root,'.cache/native-reference/KTDXLIB/KTDGXRenderer.cpp'));
  assert.equal(hash(source),'b3074301549d625ed1fbee6cafddb58d0f47002ba82107a506528861fdf97ae5');
  const setColor=source.toString('latin1').split('void CKTDGXRenderer::SetColor(')[1].split('}//CKTDGXRenderer::SetColor()')[0];
  assert.match(setColor,/SetVector\( EPHANDLE\( g_Color \), \(const D3DXVECTOR4\*\) &dxcInColor_ \)/);
  assert.doesNotMatch(setColor,/DWORD|0xFF|255|Gamma|gamma/);
  const player=await readFile(resolve(root,'.cache/fx-realcolor-v3/KTDGXMeshPlayer.h'));
  assert.equal(hash(player),'3da8130eccaa2aaf196ab815ad5eacf78c541e6be023e8587fb9ec57367c9ab0');
  assert.match(player.toString('latin1'),/renderType\s*= CKTDGXRenderer::RT_REAL_COLOR/);
});

test('actual repeated material draw uploads source floats while native fragment saturates before texture modulation',async()=>{
  const s=setup();try{
    const mesh=MeshBuilder.CreatePlane('mesh',{size:1},s.scene),material=new PBRMaterial('source',s.scene);
    material.alpha=.01;material.albedoColor=new Color3(.1,.2,.3);material.transparencyMode=PBRMaterial.PBRMATERIAL_OPAQUE;
    mesh.material=material;const native=installNativeEffectMaterial(material);
    assert.equal(installNativeEffectMaterial(material),native);
    assert.equal(material.transparencyMode,PBRMaterial.PBRMATERIAL_ALPHABLEND);assert.equal(material.alpha,1);
    const actual=[];const update=material._uniformBuffer.updateFloat4.bind(material._uniformBuffer);
    material._uniformBuffer.updateFloat4=(name,...values)=>{if(name==='nativeEffectColor')actual.push(values);return update(name,...values);};
    await material.forceCompilationAsync(mesh);
    for(const color of [[1,.3,0,100],[.10001,.01111,.33333,.6],[1,.6,0,1],[1,.3,0,1]]){
      actual.length=0;native.setColor(color);s.scene.render();
      assert.ok(actual.length>0);assert.deepEqual(actual.at(-1),color,'authored floats survive uniform upload without DWORD quantization');
      const shader=material.getEffect().fragmentSourceCode;
      assert.ok(shader.indexOf('nativeEffectTexel')>shader.lastIndexOf('applyImageProcessing(finalColor)'));
      assert.match(shader,/finalColor = nativeEffectTexel \* clamp\(nativeEffectColor, 0\.0, 1\.0\)/);
    }
    assert.throws(()=>native.setColor([1,1,NaN,1]),/four finite floats/);
  }finally{s.dispose();}
});

test('actual static explosion and animated 11-bone skill meshes retain geometry, skin palettes and vertex deformation',async()=>{
  for(const file of ['SCA_CRIMSON_BREAK_P01.glb','HA_RRF_Reckless_Fiste_HAND_R.glb']){
    const s=setup();try{
      const container=await loadPoseContainer(s.scene,resolve(root,'artifacts/rf/fx/meshes',file));
      container.addAllToScene();
      for(const group of container.animationGroups){group.start(false);group.goToFrame(Math.min(group.to,20));group.pause();}
      const meshes=container.meshes.filter(m=>m.getTotalVertices()>0);assert.ok(meshes.length>0);
      let boneDraws=0;
      for(const mesh of meshes){
        const positions=Array.from(mesh.getVerticesData('position')),
          indices=Array.from(mesh.getIndices()),weights=mesh.getVerticesData('matricesWeights')&&Array.from(mesh.getVerticesData('matricesWeights'));
        const material=new PBRMaterial('source-real-color',s.scene);material.unlit=true;mesh.material=material;
        await material.forceCompilationAsync(mesh);s.scene.render();
        const before=mesh.skeleton&&Array.from(mesh.skeleton.getTransformMatrices(mesh));
        const native=installNativeEffectMaterial(material,{particleType:mesh.skeleton?'PT_SKINMESH':'PT_MESH'});
        native.setColor([1,.3,0,1]);await material.forceCompilationAsync(mesh);s.scene.render();
        assert.deepEqual(Array.from(mesh.getVerticesData('position')),positions);assert.deepEqual(Array.from(mesh.getIndices()),indices);
        if(mesh.skeleton){
          boneDraws++;assert.equal(mesh.skeleton.bones.length,11);
          assert.deepEqual(Array.from(mesh.getVerticesData('matricesWeights')),weights);
          assert.deepEqual(Array.from(mesh.skeleton.getTransformMatrices(mesh)),before);
          const vertex=material.getEffect().vertexSourceCode;
          assert.match(vertex,/matricesWeights/);assert.match(vertex,/mBones/);
          assert.equal(native.getCustomCode('vertex'),null,'fragment-only plugin keeps Babylon original skinning shader');
        }
        assert.match(material.getEffect().fragmentSourceCode,/nativeEffectColor/);
      }
      assert.equal(boneDraws>0,file.startsWith('HA_'));
    }finally{s.dispose();}
  }
});

test('explicit cartoon effect retains its separate consumer and material pass',()=>{
  const s=setup();try{
    const m=new PBRMaterial('Raven_NasodBall',s.scene);m.alpha=.5;m.unlit=false;
    m.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHATEST;
    assert.equal(installNativeEffectMaterial(m,{RenderType:'RT_CARTOON_COLOR_EDGE'}),null);
    assert.equal(m.alpha,.5);assert.equal(m.unlit,false);assert.equal(m.transparencyMode,PBRMaterial.PBRMATERIAL_ALPHATEST);
  }finally{s.dispose();}
});

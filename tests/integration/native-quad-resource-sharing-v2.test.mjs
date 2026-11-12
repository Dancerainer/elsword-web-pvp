/** Real original VC flame closure, with controlled sampler I/O completion.
 * This verifies web readiness/diagnostics, not GPU image equivalence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,FreeCamera,Vector3,Texture,ShaderMaterial} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
const name='RVC_C_dashJumpX_hitGround_P07';
const source=JSON.parse(readFileSync(new URL('../../artifacts/vc/fx/index.json',import.meta.url)));
const template=source.templates[name],index={...source,templates:{[name]:template}};
const rf=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const profile={...rf,states:{},skillCatalog:[],effectSets:{},damageEffects:{},buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[name]};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function waitFor(predicate){
  const deadline=Date.now()+2000;
  while(!predicate()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(predicate(),'preparation did not reach the controlled resource boundary');
}
function fixture(t,{diagnoseGpu=false}={}){
  const engine=new NullEngine({textureSize:2}),scene=new Scene(engine),pending=[],views=[];
  new FreeCamera('shared-resource-camera',new Vector3(0,0,10),scene);
  const create=engine.createTexture.bind(engine);
  t.mock.method(engine,'createTexture',function(...args){
    const onLoad=args[5],onError=args[6];args[5]=null;
    const texture=create(...args);texture.isReady=false;pending.push({texture,onLoad,onError});return texture;
  });
  // Only the texture-read diagnostic is exercised; no WebGL draws are claimed.
  if(diagnoseGpu){
    engine._gl={};t.mock.method(Texture.prototype,'readPixels',async()=>new Uint8Array(16).fill(255));
    t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async function(){
      assert.ok(this.getActiveTextures().every(texture=>texture.isReady()),'shader preparation must wait for the actual shared sampler');
    });
  }
  t.after(()=>{for(const view of views)view.clear();scene.dispose();engine.dispose();});
  const make=base=>createEffectsView({scene,engine,index,profile,samplers:{},assetBase:base,diagnoseGpu}).then(view=>{views.push(view);return view;});
  return {engine,scene,pending,make};
}

test('two profession views await one canonical original sampler and retain complete diagnostics',async t=>{
  const {scene,pending,make}=fixture(t,{diagnoseGpu:true});let firstReady=false,secondReady=false;
  const first=make('/assets/vc/').then(view=>{firstReady=true;return view;});
  await waitFor(()=>pending.length===1);
  const second=make('/assets/rs/').then(view=>{secondReady=true;return view;});
  await waitFor(()=>scene.meshes.filter(mesh=>mesh.name.startsWith('native-particle:')).length===2);
  await turn();assert.equal(firstReady,false);assert.equal(secondReady,false);assert.equal(pending.length,1);
  pending[0].texture.isReady=true;pending[0].onLoad();const views=await Promise.all([first,second]);
  assert.equal(scene.textures.length,1,'one shared Texture wrapper and one original request');
  const materials=scene.materials.filter(material=>material.name.startsWith('native-particle-material:'));
  assert.equal(materials.length,1);assert.equal(materials[0].getActiveTextures().length,1);
  for(const view of views){
    const proof=view.proof();assert.equal(proof.textureStatus.requested,1);assert.equal(proof.textureStatus.ready,1);
    assert.deepEqual(proof.textureStatus.failures,[]);assert.equal(proof.gpuDiagnostics.textures.length,1);
    const texture=proof.gpuDiagnostics.textures[0];assert.equal(texture.path,Object.values(template.textures)[0].file);
    assert.equal(texture.error,undefined);assert.equal(texture.width,2);assert.equal(texture.height,2);assert.equal(texture.byteLength,16);
    await view.prewarmResources([]);
  }
  assert.equal(pending.length,1,'later roster preparation retains the same source closure');
});

test('a failed shared sampler rejects concurrent and later profession readiness before shader compilation',async t=>{
  const {scene,pending,make}=fixture(t);let compiled=0;
  t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async()=>{compiled++;});
  const first=assert.rejects(make('/assets/vc/'),/injected shared original texture failure/);
  await waitFor(()=>pending.length===1);
  const second=assert.rejects(make('/assets/rs/'),/injected shared original texture failure/);
  await waitFor(()=>scene.meshes.filter(mesh=>mesh.name.startsWith('native-particle:')).length===2);
  assert.equal(pending.length,1);pending[0].onError('injected shared original texture failure');
  await Promise.all([first,second]);assert.equal(compiled,0);
  await assert.rejects(make('/assets/lk/'),/injected shared original texture failure/);
  assert.equal(pending.length,1);assert.equal(compiled,0,'a failed original sampler must not enter Babylon readiness polling');
});

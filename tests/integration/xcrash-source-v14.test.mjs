import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {resolve} from 'node:path';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {make,visualIndex,profile,poses,fixtureRoot} from '../helpers/rf-passive-fixture-v12.mjs';

test('XCrash original four-bone burst reaches all twelve target particle emitters and retires',async t=>{
 const names=['Raven_RRF_SI_SA_X_Crash_Mesh03','RFF_X_Crash_Fire01_NEW','RFF_X_Crash_Smoke01_NEW','RFF_X_Crash_Fire02_NEW'];
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;
 t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,targetScene)=>loadPoseContainer(targetScene,resolve(fixtureRoot,'artifacts/rf',file)));
 new FreeCamera('xcrash-source-camera',new Vector3(0,0,10),scene);
 const s=await make({skillId:24010,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});
 const index={...visualIndex,templates:Object.fromEntries(names.map(n=>{assert.ok(visualIndex.templates[n],n);return [n,visualIndex.templates[n]];}))};
 const boundedProfile={...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
 const view=await createEffectsView({scene,engine,index,profile:boundedProfile,effectPoses:poses,
  samplers:{effectAnchorSampler:s.effectAnchorSampler,effectBoneSampler:s.effectBoneSampler}});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 s.drainEvents();let peak=0,requests=[],clockPackets=0;
 for(let i=0;i<300;i++){
  s.step(1/60,i===0?{pressed:['A'],held:['A']}:{},{snapshot:false});
  for(const e of s.drainEvents()){
   if(e.type==='effectTimedParticles'&&e.name==='RRF_X_CRASH_NODAMAGE')requests.push(...e.entries);
   // This bounded view exercises only the original X-shaped child chain.
   // Unrelated legacy skill parents have no assets in this fixture.
   if(e.name==='RRF_X_CRASH_NODAMAGE')view.event(e,s.state);
  }
  view.step(1/60,s.state);view.render();peak=Math.max(peak,view.count);
  const mesh=s.state.effects.find(e=>e.name==='RRF_X_CRASH_NODAMAGE');
  const visual=view.sourceMeshClocks().find(e=>e.name==='Raven_RRF_SI_SA_X_Crash_Mesh03');
  if(mesh?.active){assert.ok(visual);assert.equal(visual.animationTime,mesh.animationTime);assert.equal(visual.globalTime,mesh.elapsed);clockPackets++;}
  else assert.equal(visual,undefined,'main presentation mesh retires with original owner');
 }
 assert.equal(requests.length,12,'four bones each receive the three source particle templates');
 assert.ok(clockPackets>20,'actual presentation clock is checked across the complete source clip');
 const counts=view.proof().timedParticleEmitters;
 for(const name of names.slice(1))assert.equal(counts[name],4,name);
 assert.ok(peak>12,'real particle runtime emits more than its twelve emitter instances');
 assert.equal(view.count,0,'finite source meshes and child emitters retire');
 assert.equal(view.proof().activeEffectParents,0);
 assert.ok(!view.proof().unsupported.some(n=>/timed-particle-parent|attachment bone/.test(n)),JSON.stringify(view.proof().unsupported));
});

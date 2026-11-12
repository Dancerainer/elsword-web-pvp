/** Production mesh consumer, original converted geometry and ready test
 * textures. This validates transforms/lifecycle, not GPU pixels or client gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {elesisFixture} from '../helpers/elesis-skill-fixture.mjs';
import {ELESIS_SHADOW_LINK,tickElesisShadowLinks} from '../../packages/combat-core/elesis-shadow-edge.mjs';
const read=p=>JSON.parse(readFileSync(resolve('artifacts/ca',p)));
test('Shadow Edge real mesh changes length with both endpoints and original particles retire after break',async t=>{
 const {profile,make}=elesisFixture('CA'),sim=make(28215),a=sim.actor('elesis'),b=sim.actor('target');
 sim.step(1/60,{elesis:{pressed:['A'],held:['A']}},{snapshot:false});
 for(let i=0;i<120&&!sim.state.effects.some(e=>e.sourceElesisShadowLink);i++)sim.step(1/60,{}, {snapshot:false});
 sim.step(1/60,{}, {snapshot:false});const link=sim.state.effects.find(e=>e.sourceElesisShadowLink);assert.ok(link);
 const births=sim.drainEvents().filter(e=>e.type==='effectStarted'&&e.name===ELESIS_SHADOW_LINK);assert.equal(births.length,1);
 const full=read('fx/index.json'),names=['SCA_SHADOW_EDGE_Link',...Object.keys(full.templates).filter(n=>n.startsWith('SDK_LINK_'))],index={...full,templates:Object.fromEntries(names.map(n=>[n,full.templates[n]]))};
 const poses=Object.fromEntries(names.map(n=>index.templates[n].poseData).filter(Boolean).map(p=>[p,read(p)]));
 const selected={...profile,states:{},skillCatalog:[],buffTemplates:{},sourceLiteralResources:[],resourceOnlyTemplates:names,
  resourceOnlyEffectSets:[],effectSets:{},damageEffects:{[ELESIS_SHADOW_LINK]:profile.damageEffects[ELESIS_SHADOW_LINK]}};
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('shadow',new Vector3(0,30,10),scene);
 t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_base,file,s)=>loadPoseContainer(s,resolve('artifacts/ca',file)));
 const view=await createEffectsView({scene,engine,index,profile:selected,effectPoses:poses,loadout:[],samplers:{effectAnchorSampler:sim.effectAnchorSampler,effectBoneSampler:sim.effectBoneSampler}});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 for(const e of births)view.event(e,sim.state);
 sim.effectAnchorSampler=()=>null;
 function show(gap){b.x=a.x+gap;b.y=a.y;b.z=a.z;tickElesisShadowLinks(sim,.000001);view.step(.01,sim.state);view.render();
  return scene.transformNodes.filter(n=>n.name.startsWith('fx-SCA_SHADOW_EDGE_Link-')&&n.isEnabled()&&!n.parent);}
 const first=show(265);assert.equal(first.length,2,'original DrawCount2 retained');assert.ok(first.every(n=>Math.abs(n.scaling.x-.005)<1e-8));
 const second=show(530);assert.deepEqual(second,first);assert.ok(second.every(n=>Math.abs(n.scaling.x-.01)<1e-8));
 assert.ok(second.every(n=>Math.abs(n.scaling.y-.01)<1e-8),'absolute source link size cancels template1.6');
 for(let i=0;i<15;i++)view.step(1/60,sim.state);view.render();
 const proof=view.proof({includeDraws:true});assert.ok(proof.nativeParticleDraws.counts.SDK_LINK_P01>0&&proof.nativeParticleDraws.counts.SDK_LINK_P02>0,'original invisible emitter retains both visible TraceParticle children');
 b.x=a.x+1201;sim.tickEffects(.01);for(const e of sim.drainEvents())view.event(e,sim.state);
 for(let i=0;i<240;i++)view.step(1/60,sim.state);view.render();
 assert.equal(view.proof().activeEffectParents,0);assert.equal(view.proof().activeEmitters,0);assert.equal(view.count,0);assert.equal(view.performance().fxMeshesLive,0);
});

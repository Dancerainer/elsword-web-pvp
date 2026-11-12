import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {addPlayerFeedbackVisuals} from '../../packages/combat-assets/player-feedback-visuals-v45.mjs';
import {tryAddTimeRingRevive} from '../../packages/combat-core/add-systems.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8')),dt=1/60;
test('real SealOfTime cast creates the original recipient orbit model/blue trace and consumes its visual in the revive packet',async t=>{
 const {sim,a,b,profile}=originalAddFixture('DE',{skillId:29213});a.mp=a.mpMax;b.x=3000;
 const raw=addPlayerFeedbackVisuals(read('artifacts/de/fx/index.json'),'DE'),names=['Buff_Crest_of_Time_Time','Buff_Crest_of_Time_Time01'];
 const templates=Object.fromEntries(names.map(n=>[n,raw.templates[n]])),poses=Object.fromEntries(names.map(n=>templates[n].poseData).filter(Boolean).map(p=>[p,read('artifacts/de/'+p)]));
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('time-ring-v61',new Vector3(0,32,10),scene);
 const view=await createEffectsView({scene,engine,index:{...raw,templates},profile:{...profile,states:{},skillCatalog:[],damageEffects:{},buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]},
  effectPoses:poses,samplers:{effectAnchorSampler:sim.effectAnchorSampler,effectBoneSampler:sim.effectBoneSampler},loadContainer:(_,file)=>loadPoseContainer(scene,resolve(root,'artifacts/de',file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 const step=input=>{sim.step(dt,input??{}, {snapshot:false});view.step(dt,sim.state);view.render({actors:sim.state.actors});};
 step({add:{pressed:['A'],held:['A']}});for(let i=0;i<90&&!a.sourceTimeRing;i++)step();assert.ok(a.sourceTimeRing?.remaining>0,'actual source .342 input grant');
 const positions=[];let blue=false;
 for(let i=0;i<150;i++){step();const proof=view.proof({includeDraws:true}),ring=proof.nativeParticleDraws.samples.find(s=>s.name==='Buff_Crest_of_Time_Time');
  if(ring){assert.ok(ring.meshes.length>0);positions.push(ring.position);}
  blue ||= proof.nativeParticleDraws.batches.some(b=>b.name.includes('Buff_Crest_of_Time_Time01'));
 }
 assert.ok(positions.length>100,'actual original model remains throughout active grant');assert.ok(blue,'original blue TraceParticleList is rendered');
 assert.ok(new Set(positions.map(p=>p.map(n=>Math.round(n)).join(','))).size>40,'original Velocity/EventTimer produces the moving orbit, not a static UI badge');
 assert.equal(tryAddTimeRingRevive(sim,a,{damage:a.hp+1}),true);view.step(dt,sim.state);view.render({actors:sim.state.actors});
 assert.equal(view.proof().addTimeRing.actors,0);assert.ok(!view.proof({includeDraws:true}).nativeParticleDraws.samples.some(s=>s.name==='Buff_Crest_of_Time_Time'),'consumption removes 9999s main immediately');
});

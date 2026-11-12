import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {addPlayerFeedbackVisuals} from '../../packages/combat-assets/player-feedback-visuals-v45.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8')),dt=1/60,NAME='ADD_Shooting_Chaser_Projectile_01';
test('actual MM ShootingChaser input retains original particles and produces source-helper continuous textured geometry until owner retirement',async t=>{
 const {sim,a,b,profile}=originalAddFixture('MM',{skillId:29018});a.mp=a.mpMax;a.sourceAdd.dp=8000;b.x=500;const damage=structuredClone(profile.damageEffects.DamageEffect_AMM_Shooting_Chaser_Attacker.raw);
 const raw=addPlayerFeedbackVisuals(read('artifacts/mm/fx/index.json'),'MM'),names=[NAME,'ADD_Shooting_Chaser_Projectile_001','ADD_Rushing_Drone_Loop_01'];
 const templates=Object.fromEntries(names.map(n=>[n,raw.templates[n]])),poses=Object.fromEntries(names.map(n=>templates[n].poseData).filter(Boolean).map(p=>[p,read('artifacts/mm/'+p)]));
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('chaser-v61',new Vector3(0,32,10),scene);
 const view=await createEffectsView({scene,engine,index:{...raw,templates},profile:{...profile,states:{},skillCatalog:[],damageEffects:{DamageEffect_AMM_Shooting_Chaser_Attacker:profile.damageEffects.DamageEffect_AMM_Shooting_Chaser_Attacker},buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:names},
  effectPoses:poses,samplers:{effectAnchorSampler:sim.effectAnchorSampler,effectBoneSampler:sim.effectBoneSampler},effectQuality:{level:'high',particleDivisor:1},loadContainer:(_,file)=>loadPoseContainer(scene,resolve(root,'artifacts/mm',file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});let created=0,frames=0,ended=false;const ids=new Set();
 const step=input=>{sim.step(dt,input??{}, {snapshot:false});for(const event of sim.drainEvents()){
  if(event.type==='effectStarted'&&event.name==='DamageEffect_AMM_Shooting_Chaser_Attacker'){created++;ids.add(event.effectId);view.event(event,sim.state);}
  else if(ids.has(event.effectId)){view.event(event,sim.state);if(event.type==='effectEnded')ended=true;}
 }view.step(dt,sim.state);view.render({actors:sim.state.actors});const proof=view.proof().addChaserTrails;
  assert.ok(proof,'continuous source SlashTrace needs a production consumer');
  for(const row of proof.traces)if(row.visible){frames++;assert.ok(row.vertices>2&&row.vertices<=100);assert.ok(row.indices>0);assert.equal(row.drawCount,1);assert.equal(row.vertexLimit,100);assert.ok(row.endpoints.up.every(Number.isFinite));}
 };
 for(let i=0;i<180&&!sim.skillAvailability(a.id,0).available;i++)step();
 assert.equal(sim.skillAvailability(a.id,0).mode,'generator-select');
 step({add:{pressed:['A'],held:['A']}});assert.equal(a.sourceAdd.generator?.skillId,29018);
 for(let i=0;i<300&&!sim.skillAvailability(a.id,0).available;i++)step();
 assert.equal(sim.skillAvailability(a.id,0).mode,'generator-fire');
 step({add:{pressed:['A'],held:['A']}});for(let i=0;i<150;i++)step();assert.equal(created,1);assert.ok(frames>5,'continuous strip across successive real homing packets, not only separate sparse .1s shadows');
 assert.ok(ended);assert.equal(view.proof().addChaserTrails.channels,0);assert.deepEqual(profile.damageEffects.DamageEffect_AMM_Shooting_Chaser_Attacker.raw,damage);
 assert.equal(raw.templates.ADD_Shooting_Chaser_Projectile_001.fields.Emitrate,30);assert.equal(raw.templates.ADD_Shooting_Chaser_Projectile_001.fields.Lifetime,.1);assert.equal(raw.templates.ADD_Rushing_Drone_Loop_01.fields.Emitrate,70);
});

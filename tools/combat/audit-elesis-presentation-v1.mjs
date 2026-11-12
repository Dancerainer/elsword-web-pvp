/** Production NullEngine lifecycle probe. Real poses/meshes and source
 * particles; ready test textures do not establish browser/GPU pixel parity. */
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {loadPoseContainer} from '../../tests/helpers/babylon-assets.mjs';
import {createEffectsView} from '../../tests/helpers/effects-view-ready.mjs';
import {elesisFixture,elesisAssets} from '../../tests/helpers/elesis-fixture.mjs';
import {DEFAULT_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
const cases={unlimited:['GM',28030,200],phantom:['CA',28021,200],dance:['BH',28016,200],fate:['CA',28605,1000]};
const name=process.argv[2];if(!cases[name])throw new Error('Choose unlimited, phantom, dance, fate');
const [id,skillId,gap]=cases[name],assetRoot=resolve(process.env.ELESIS_ASSET_ROOT??'artifacts'),folder=id.toLowerCase();
const f=elesisFixture(id,{skillId,gap}),assets=elesisAssets(id),profile=assets.profile;
const index=JSON.parse(readFileSync(resolve(assetRoot,folder,'fx/index.json')));
const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('elesis-lifecycle',new Vector3(0,33,19),scene);
const originalLoader=SceneLoader.LoadAssetContainerAsync;
SceneLoader.LoadAssetContainerAsync=async(_url,file,target)=>loadPoseContainer(target,resolve(assetRoot,folder,file));
const skill=profile.skillCatalog.find(s=>s.skillId===skillId);
const bounded={...profile,states:Object.fromEntries((skill.states??[skill.state]).map(s=>[s,profile.states[s]])),skillCatalog:[skill],buffTemplates:{},sourceLiteralResources:[],resourceOnlyTemplates:[],resourceOnlyEffectSets:[]};
let view;const captures=[],started=new Map(),submitted=new Map(),requested=new Map();
try{
 view=await createEffectsView({scene,engine,index,profile:bounded,effectPoses:assets.effectPoses,loadout:[{skillId}],nativeRandom:f.native.effectRandom,
  effectQuality:DEFAULT_EFFECT_QUALITY,samplers:{effectAnchorSampler:f.sim.effectAnchorSampler,effectBoneSampler:f.sim.effectBoneSampler}});
 const sample=time=>{const proof=view.proof({includeDraws:true}),perf=view.performance();
  captures.push({time,actorState:f.a.state,liveBuffs:f.a.buffs.map(b=>b.templateId),particles:proof.activeParticles,emitters:proof.activeEmitters,
   parents:proof.activeEffectParents,meshes:perf.fxMeshesLive,drawCounts:proof.nativeParticleDraws.counts,sequences:proof.nativeParticleDraws.sequences,
   combatRecords:f.sim.state.effects.filter(e=>e.ownerId===f.a.id).map(e=>({id:e.id,name:e.name,damage:!!e.damage,buffTemplateId:e.buffTemplateId??null,combatRetired:e.combatRetired??false,viewParent:view.hasEffect(e.id)})),
   invisibleParticles:proof.activeInvisibleMeshParticles,projectedHits:proof.projectedHits,sourceClocks:view.sourceMeshClocks(),unsupported:proof.unsupported});};
 f.sim.processInput(f.a,{held:new Set(),pressed:new Set(['A'])});
 for(let frame=1;frame<=3600;frame++){
  f.sim.step(1/60,{}, {snapshot:false});
  const events=f.sim.drainEvents();view.beginEventBatch(f.sim.state);
  for(const event of events){
   if(event.type==='effectStarted')requested.set(event.name,(requested.get(event.name)??0)+1);
   view.event(event,f.sim.state);
  }view.endEventBatch();view.step(1/60,f.sim.state);view.render();
  const proof=view.proof({includeDraws:true});for(const [template,count]of Object.entries(proof.nativeParticleDraws.counts))if(count>0)started.set(template,(started.get(template)??0)+1);
  const drawn=new Set([...proof.nativeParticleDraws.samples.filter(s=>s.meshes.length>0&&s.color[3]>0).map(s=>s.name),
   ...proof.nativeParticleDraws.batches.filter(b=>b.instances>0).map(b=>b.name.slice('native-particle:'.length).split('|')[0])]);
  for(const template of drawn)submitted.set(template,(submitted.get(template)??0)+1);
  if([60,180,360,600,1200,3600].includes(frame))sample(frame/60);
 }
 const result={schemaVersion:1,evidenceClass:'current-web-production-view-nullengine-original-assets',targetClientMeasured:false,gpuPixelMeasured:false,
  case:name,profession:id,skillId,gap,quality:DEFAULT_EFFECT_QUALITY,
  inputSha256:Object.fromEntries([['profile','packages/combat-core/'+folder+'-profile.json'],['visualIndex',resolve(assetRoot,folder,'fx/index.json')],
   ['presentationQuality','packages/effect-runtime/presentation-quality.mjs'],['elesisDensity','contracts/elesis-effect-density-v1.json']].map(([key,path])=>[key,createHash('sha256').update(readFileSync(path)).digest('hex')])),
  requested:Object.fromEntries(requested),runtimeParticleFramesByTemplate:Object.fromEntries(started),submittedFramesByTemplate:Object.fromEntries(submitted),captures};
 const final=captures.at(-1);
 assert.deepEqual([final.particles,final.emitters,final.parents,final.meshes,final.projectedHits.active],[0,0,0,0,0],'All actual view lifecycles retire by 60 seconds');
 if(name==='unlimited')for(const template of ['EffectSet_ELK_Grand_Slash_Cast_P05','EffectSet_ELK_Grand_Slash_Cast_P01','EffectSet_ELK_Grand_Slash_Cast_P12',
  'A_ES_SWORD_WAVE_Projectile_P03','SA_EL_MEGA_BURSTER_M02','SI_A_SSK_CROSS_SLASH_P02','A_EL_INDURANCE_P05'])assert.ok(submitted.get(template)>0,template+' actually enters a draw batch or live mesh before retiring');
 if(name==='fate'){
  assert.ok(!final.unsupported.some(n=>n.endsWith(':birth')||n.endsWith(':geometry')),'Fate authored mesh attachments and screen geometry are resolved');
  for(const template of ['SCA_FA_SM_P0M','SCA_FATE_SMASHER_P04','SCA_FATE_SMASHER_P00M','SCA_FATE_SMASHER_PT00','SCA_FATE_SMASHER_L001','SCA_FATE_SMASHER_L002','SCA_FATE_SMASHER_L003','SCA_BRANDISH_BREAKER_PA00','SCA_BR_BR_PA01','SCA_BR_BR_PA02'])
   assert.ok(started.get(template)>0,template+' uses its original effect mesh target');
  assert.deepEqual(captures[0].projectedHits.screenTemplates,{SCA_FATE_SMASHER_L01:1,SCA_FATE_SMASHER_L02:1});
 }
 const output=resolve('reports/elesis-presentation-'+name+'-v1.json');writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({case:name,output,samples:captures.map(c=>({time:c.time,particles:c.particles,emitters:c.emitters,parents:c.parents,meshes:c.meshes,records:c.combatRecords.length,buffs:c.liveBuffs})),finalCounts:captures.at(-1).drawCounts,notes:captures.at(-1).unsupported}));
}finally{view?.clear();scene.dispose();engine.dispose();SceneLoader.LoadAssetContainerAsync=originalLoader;}

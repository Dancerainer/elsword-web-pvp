/** Original declarations / compiled producers define allocation expectations.
 * NullEngine results below are Web observations, not original client timing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {collectEffectMeshBudget,collectEffectTemplates} from '../../apps/web/effect-prewarm.mjs';
import {PROFESSION_PROFILES} from '../../packages/professions/profiles.mjs';
import {originalAddFixture,originalAddSamplers} from '../helpers/add-native-pose-fixture.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8')),dt=1/60;
const medium={level:'medium',particleDivisor:8},high={level:'high',particleDivisor:1};
const data=new Map();
function source(id){
 if(data.has(id))return data.get(id);
 const base='artifacts/'+id.toLowerCase()+'/',manifest=read(base+'manifest.json');
 const index={templates:Object.assign({},...[manifest.effectAssetIndex,...manifest.visualEffectIndexes].map(p=>read(base+p).templates))};
 const value={profile:PROFESSION_PROFILES[id],index,base};data.set(id,value);return value;
}
function budget(id,skills,quality=medium){const {profile,index}=source(id);return collectEffectMeshBudget(profile,index,skills.map(skillId=>({skillId})),{effectQuality:quality});}
test('Stardust original .1s stream reserves finite overlapping ball attachments and its distinct long-lived DIE children',()=>{
 const {profile,index}=source('DE'),skill=profile.skillCatalog.find(s=>s.skillId===29021),raw=profile.damageEffects.DamageEffect_ATT_Stardust_Shower_Ball.raw;
 assert.equal(skill.raw.SA_EFFECTIVE_TIME[skill.maxLevel],2.5);assert.equal(skill.raw.SA_DAMAGE_TIME[skill.maxLevel],.33);
 assert.equal(raw.MAIN_EFFECT_NAME,'ATT_Stardust_Shower_M01');
 assert.deepEqual(index.templates[raw.MAIN_EFFECT_NAME].fields.LifeTime,{random:[.6,.62]});
 assert.equal(index.templates.ATT_Stardust_Shower_M03_Small.fields.LifeTime,9);
 for(const quality of [medium,high]){
  const result=budget('DE',[29021],quality);
  // .62s carrier + .5/1s particle tail +2/60 boundary; initial carry.
  // ceil((.62+.5+2/60)/.1)+1=13; one final BigBall =>14.
  // ceil((.62+1+2/60)/.1)+1=18; one final BigBall =>19.
  assert.equal(result.demands.get('ATT_Stardust_Shower_Ball_P04').effectSetInstances,14);
  assert.equal(result.demands.get('ATT_Stardust_Shower_Ball_P05').effectSetInstances,19);
  assert.equal(result.demands.get('ATT_Stardust_Shower_Ball_P06').effectSetInstances,19);
  assert.equal(result.demands.get('ATT_Stardust_Shower_Ball_P07').effectSetInstances,13);
  // Three mutation points yield 2.5+3*.33=3.49s. Initial accumulator1
  // plus every .1 boundary is <=36 requests; 9s children may all coexist.
  assert.equal(result.demands.get('ATT_Stardust_Shower_M03_Small').effectSetInstances,36);
  assert.equal(result.demands.get('ATT_Stardust_Shower_Ball_P06').drawCount,3);
 }
 const result=budget('DE',[29021,29022]);
 assert.equal(result.demands.get('ATT_Stardust_Shower_Ball_P06').views,798);
 const maximum=budget('DE',[29022]);
 for(const [name,demand]of maximum.demands)if(/Maximum_Strike/.test(name))assert.deepEqual(result.demands.get(name),demand,'equipping Stardust retains existing Maximum Strike compiled burst');
});
test('Conqueror source normal12+c and alternative hyper c+1 reserve all seven original attachments without multiplying unequipped roots',()=>{
 const {profile}=source('LP'),raw=profile.damageEffects.DamageEffect_SA_APT_Conqueror_Projectile.raw;
 const names=Object.entries(raw).filter(([key])=>/^PASSIVE_PARTICLE\d+$/.test(key)).map(([,v])=>v.PARTICLE_NAME);
 assert.equal(names.length,7);
 const result=budget('LP',[29008,29205]),magnetron=budget('LP',[29205]);
 for(const name of ['ADD_QUAKE_BUSTER_LOOP01','ADD_QUAKE_BUSTER_LOOP07']){
  assert.equal(result.demands.get(name).effectSetInstances,15);assert.equal(result.demands.get(name).drawCount,3);
  assert.notEqual(budget('LP',[]).demands.get(name)?.effectSetInstances,15);
 }
 for(const [name,demand]of magnetron.demands)if(/Magnetron/.test(name))assert.deepEqual(result.demands.get(name),demand,'both compiled producers remain selected');
});
test('unknown Stardust duration is reported as a single-emitter lower bound, while uncertain direct tails retain a conservative finite total',()=>{
 const {profile,index}=source('DE'),p=structuredClone(profile),skill=p.skillCatalog.find(s=>s.skillId===29021);
 delete skill.raw.SA_EFFECTIVE_TIME;
 const result=collectEffectMeshBudget(p,index,[{skillId:29021}],{effectQuality:medium});
 assert.equal(result.demands.get('ATT_Stardust_Shower_Ball_P06').burstUpperBound,false);
 assert.equal(result.demands.get('ATT_Stardust_Shower_Ball_P06').effectSetInstances,1);
 assert.ok(result.unsupported.some(r=>r.name==='ATT_Stardust_Shower_Ball_P06'&&/compiled producer/.test(r.detail)));
 const changed=structuredClone(index);changed.templates.ATT_Stardust_Shower_Ball_P06.fields.TraceParticleList='unconfirmed-tail';
 const bounded=collectEffectMeshBudget(profile,changed,[{skillId:29021}],{effectQuality:medium});
 assert.equal(bounded.demands.get('ATT_Stardust_Shower_Ball_P06').effectSetInstances,37,'no short direct-tail inference through an unconfirmed child chain');
 const levels=structuredClone(profile),levelSkill=levels.skillCatalog.find(s=>s.skillId===29021);
 levelSkill.raw.SA_EFFECTIVE_TIME[1]=4;
 const acrossLevels=collectEffectMeshBudget(levels,index,[{skillId:29021}],{effectQuality:medium});
 assert.equal(acrossLevels.demands.get('ATT_Stardust_Shower_M03_Small').effectSetInstances,51,'boundary fixture: planner IDs must cover every supported level, not assume maxLevel is greatest');
});
async function display(t,id,skillId,sim){
 const {profile,index,base}=source(id);
 // Retain the equipped original skill closure; unrelated commands/resources
 // are outside this focused rendering case, and remain covered by neighbors.
 const p={...profile,states:{},skillCatalog:profile.skillCatalog.filter(s=>s.skillId===skillId),buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[],sourceLiteralResources:[]};
 const names=collectEffectTemplates(p,index,[{skillId}]);
 const focused={templates:Object.fromEntries([...names].map(name=>[name,index.templates[name]]))};
 const effectPoses=Object.fromEntries(Object.values(focused.templates).filter(v=>v.poseData).map(v=>[v.poseData,read(base+v.poseData)]));
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=2048;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('add-stream-prewarm-v57',new Vector3(0,35,50),scene);
 const before=process.memoryUsage(),began=performance.now();
 const view=await createEffectsView({scene,engine,index:focused,profile:p,effectPoses,loadout:[{skillId}],effectQuality:medium,
  assetBase:'/assets/'+id.toLowerCase()+'/',samplers:originalAddSamplers(id),loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(root,base,file))});
 await view.prewarmActors(sim.state.actors.filter(a=>a.id==='add'),{targetActors:sim.state.actors});
 const files=new Set(Object.values(focused.templates).map(v=>v.glb).filter(Boolean));
 const metrics={id,skillId,quality:'medium',preparedViews:view.proof().meshInstances,prewarmMs:performance.now()-began,
  uniqueSourceGlbBytes:[...files].reduce((sum,file)=>sum+statSync(resolve(root,base,file)).size,0),
  heapUsedDelta:process.memoryUsage().heapUsed-before.heapUsed,arrayBuffersDelta:process.memoryUsage().arrayBuffers-before.arrayBuffers};
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});return {view,metrics,scene};
}
for(const [id,skillId,formed]of [['DE',29021,false],['DE',29021,true],['LP',29008,false],['LP',29008,true]])
 test(`${id} ${skillId} actual ${formed?'formed maximum-mutation':'ordinary'} cast reuses original GLBs on every packet`,async t=>{
  const {sim,a,b}=originalAddFixture(id,{skillId});a.mp=a.mpMax;a.sourceAdd.dp=8000;b.x=2000;
  if(formed){
   sim.step(dt,{add:{pressed:['AWAKEN'],held:['AWAKEN']}},{snapshot:false});
   for(let i=0;i<240&&(!a.sourceAdd.formation||!sim.skillAvailability(a.id,0).available);i++)sim.step(dt,{}, {snapshot:false});
   assert.equal(a.sourceAdd.formation,true);assert.equal(sim.skillAvailability(a.id,0).available,true);
  }
  if(formed||id==='LP')a.sourceAdd.mutation=3;
  sim.drainEvents();const {view,metrics,scene}=await display(t,id,skillId,sim),prepared=view.proof().meshInstances,preparedQuads=view.proof().quadDrawSlots;
  const compiledQuads=new Set(budget(id,[skillId]).quadCopies.keys()),initialPlanes=new Set(scene.meshes.filter(m=>m.name.startsWith('native-particle:')).map(m=>m.name));
  const compiledPlaneCount=()=>scene.meshes.filter(m=>m.name.startsWith('native-particle:')&&compiledQuads.has(m.name.slice('native-particle:'.length).split('|')[0])).length;
  const preparedCompiledPlanes=compiledPlaneCount();
  let balls=0,projectiles=0,hyper=0,peak=0;const peaks={};
  for(let frame=0;frame<900;frame++){
   sim.step(dt,frame===0?{add:{pressed:['A'],held:['A']}}:{},{snapshot:false});
   for(const e of sim.drainEvents()){
    if(e.type==='effectStarted'&&e.name==='DamageEffect_ATT_Stardust_Shower_Ball')balls++;
    if(e.type==='effectStarted'&&e.name==='DamageEffect_SA_APT_Conqueror_Projectile')projectiles++;
    if(e.type==='effectStarted'&&e.name==='DamageEffect_SA_APT_Conqueror_Hyper')hyper++;
    view.event(e,sim.state);
   }
   view.step(dt,sim.state);view.render();const proof=view.proof({includeDraws:true});peak=Math.max(peak,proof.activeParticles);
   for(const [name,count]of Object.entries(proof.nativeParticleDraws.counts))peaks[name]=Math.max(peaks[name]??0,count);
   assert.equal(view.proof().meshInstances,prepared,`no synchronous original mesh clone at frame${frame}`);
   assert.equal(compiledPlaneCount(),preparedCompiledPlanes,`no synchronous compiled skill whole-sequence plane at frame${frame}`);
   if(!formed)assert.equal(view.proof().quadDrawSlots,preparedQuads,`no synchronous ordinary skill whole-sequence plane at frame${frame}`);
  }
  const outsideCompiledQuadGrowth={};for(const mesh of scene.meshes)if(mesh.name.startsWith('native-particle:')&&!initialPlanes.has(mesh.name)){
   const name=mesh.name.slice('native-particle:'.length).split('|')[0];outsideCompiledQuadGrowth[name]=(outsideCompiledQuadGrowth[name]??0)+1;
  }
  t.diagnostic(JSON.stringify({...metrics,preparedQuadSlots:preparedQuads,preparedCompiledPlanes,outsideCompiledQuadGrowth,formed,balls,projectiles,hyper,peakParticles:peak,meshParticlePeaks:Object.fromEntries(Object.entries(peaks).filter(([name])=>/Ball_P0[4567]|QUAKE_BUSTER_LOOP0[17]/.test(name))),runtimeMeshCreates:view.performance().fxRuntimeMeshCreates}));
  if(id==='DE'){assert.ok(balls>20&&balls<=36);assert.ok((peaks.ATT_Stardust_Shower_Ball_P06??0)>14);}
  else {assert.equal(projectiles,formed?3:15);assert.equal(hyper,formed?1:0);}
  assert.equal(view.performance().fxRuntimeMeshCreates,0);assert.deepEqual(view.proof().coldMeshTemplates,{});
  assert.ok(!sim.state.effects.some(e=>!e.dead&&e.skillId===skillId),'the actual skill-owned source effects expire');
  const stillShown=Object.entries(view.proof({includeDraws:true}).nativeParticleDraws.counts)
   .filter(([name,count])=>count>0&&/Stardust_Shower|Conqueror|QUAKE_BUSTER|PHASE_SHIFT_ATTACK/.test(name));
  assert.deepEqual(stillShown,[],'skill tails expire; formed-mode passive attachments keep their own original owner');
 });

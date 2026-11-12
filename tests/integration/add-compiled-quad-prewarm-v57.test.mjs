/** Original producer multiplicity sizes whole-sequence emitter slots. Particle
 * caps and the reported browser cold-allocation counts are not this oracle. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {collectEffectMeshBudget} from '../../apps/web/effect-prewarm.mjs';
import {PROFESSION_PROFILES} from '../../packages/professions/profiles.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const sources=new Map();
function source(id){
 if(!sources.has(id)){
  const base='artifacts/'+id.toLowerCase()+'/',manifest=read(base+'manifest.json');
  sources.set(id,{profile:PROFESSION_PROFILES[id],index:{templates:Object.assign({},...[manifest.effectAssetIndex,...manifest.visualEffectIndexes].map(p=>read(base+p).templates))}});
 }
 return sources.get(id);
}
const medium={level:'medium',particleDivisor:8},high={level:'high',particleDivisor:1};
test('Conqueror source15 carriers each create distinct HIT and DIE plane sequences, while unequipped/other Add skills do not gain a burst map',()=>{
 const {profile,index}=source('LP'),projectile=profile.damageEffects.DamageEffect_SA_APT_Conqueror_Projectile.raw;
 assert.equal(projectile.DAMAGE_TIME,1);
 assert.equal(projectile.HIT_DAMAGE_EFFECT0.DAMAGE_EFFECT_NAME,projectile.DIE_DAMAGE_EFFECT0.DAMAGE_EFFECT_NAME);
 for(const effectQuality of [medium,high])for(const targetCount of [1,3]){
  const budget=collectEffectMeshBudget(profile,index,[{skillId:29008}],{effectQuality,targetCount});
  for(const name of ['ADD_PHASE_SHIFT_ATTACK_05','ADD_PHASE_SHIFT_ATTACK_06','ADD_PHASE_SHIFT_ATTACK_04']){
   assert.equal(index.templates[name].fields.particleType,'PT_3D_PLANE');
   assert.equal(budget.quadCopies.get(name),15*(1+targetCount),'source12+3 shots times DIE1 plus finite target HIT1');
   assert.equal(budget.demands.has(name),false,'one emitter slot is distinct from each live mesh particle');
  }
 }
 assert.equal(collectEffectMeshBudget(profile,index,[],{effectQuality:medium}).quadCopies.size,0);
 assert.equal(collectEffectMeshBudget(profile,index,[{skillId:29205}],{effectQuality:medium}).quadCopies.size,0,'Magnetron is outside this precise new plane scope');
 const changed=structuredClone(profile);delete changed.damageEffects.DamageEffect_SA_APT_Conqueror_Projectile.raw.DAMAGE_TIME;
 const unknown=collectEffectMeshBudget(changed,index,[{skillId:29008}],{effectQuality:medium});
 assert.equal(unknown.quadCopies.get('ADD_PHASE_SHIFT_ATTACK_05'),1);
 assert.ok(unknown.unsupported.some(row=>row.name==='ADD_PHASE_SHIFT_ATTACK_05'&&row.detail.includes('Unconfirmed finite compiled producer')));
});
test('Stardust source .1 callback and confirmed lifetime window also bound its plane emitters, retaining source DrawCount separately',()=>{
 const {profile,index}=source('DE');
 for(const effectQuality of [medium,high]){
  const budget=collectEffectMeshBudget(profile,index,[{skillId:29021}],{effectQuality});
  // ceil((.62+.5+2/60)/float(.1))+1=13 live ball/tails;
  // End's one BigBall shares P01/P03, hence14 emitter slots, then DrawCount5.
  for(const name of ['ATT_Stardust_Shower_Ball_P01','ATT_Stardust_Shower_Ball_P03']){
   assert.equal(index.templates[name].fields.DrawCount,5);
   assert.equal(budget.quadCopies.get(name),14);
  }
  assert.equal(budget.quadCopies.get('ATT_Stardust_Shower_Ball_P02'),12,'shorter .3 second direct tail plus one BigBall');
 }
 const changed=structuredClone(profile);delete changed.skillCatalog.find(skill=>skill.skillId===29021).raw.SA_EFFECTIVE_TIME;
 const unknown=collectEffectMeshBudget(changed,index,[{skillId:29021}],{effectQuality:medium});
 assert.equal(unknown.quadCopies.get('ATT_Stardust_Shower_Ball_P01'),1);
 assert.ok(unknown.unsupported.some(row=>row.name==='ATT_Stardust_Shower_Ball_P01'&&row.detail.includes('Unconfirmed finite compiled producer')));
});
test('resource startup keeps one source plane copy, then frozen same-team owners sum their finite contact burst slots',async t=>{
 const {profile,index}=source('LP'),name='ADD_PHASE_SHIFT_ATTACK_05',template=index.templates[name];
 const focused={...profile,states:{},skillCatalog:profile.skillCatalog.filter(skill=>skill.skillId===29008),
  buffTemplates:{},resourceOnlyTemplates:[],resourceOnlyEffectSets:[],sourceLiteralResources:[]};
 const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('source-quad-roster-v57',new Vector3(0,0,10),scene);
 let preparation;
 const view=await createEffectsView({scene,engine,index:{templates:{[name]:template}},profile:focused,
  samplers:{},loadout:[{skillId:29008}],prepareResourcesOnly:true,effectQuality:medium,onPreparationProgress:value=>{preparation=value;}});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 const paths=Object.values(template.textures).length;
 assert.ok(paths>0);assert.equal(view.proof().quadDrawSlots,paths,'each original texture/draw compiled once at resource startup');
 const actors=[0,1].map(i=>({id:'owner'+i,team:0,professionId:'LP',loadout:[{skillId:29008}]})),enemy={id:'target',team:1,professionId:'DE',loadout:[]};
 await view.prewarmActors(actors,{targetActors:[...actors,enemy]});
 assert.equal(view.proof().quadDrawSlots,2*15*2*paths,'two owners × 15 shots × (HIT1+DIE1) × source texture passes');
 const prepared=view.proof().quadDrawSlots;
 await view.prewarmActors(actors,{targetActors:[...actors,enemy]});
 assert.equal(preparation.phase,'complete');assert.equal(preparation.requestedJobs,0,'completed pools skip all cached batch jobs on an unchanged loadout');
 await view.prewarmActors(actors.slice(0,1),{targetActors:[actors[0],enemy]});
 assert.equal(view.proof().quadDrawSlots,prepared,'later smaller roster reuses already prepared slots');
 assert.equal(preparation.requestedJobs,0,'smaller demand is already prepared');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {addPlayerFeedbackVisuals} from '../../packages/combat-assets/player-feedback-visuals-v45.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8')),dt=1/60;
test('real Stardust cast renders the original known terminal explosion layers at the fallen carrier instead of only passing static final-ball scale',async t=>{
 const {sim,a,b,profile}=originalAddFixture('DE',{skillId:29021});a.mp=a.mpMax;b.x=250;b.invincible=true;
 const raw=addPlayerFeedbackVisuals(read('artifacts/de/fx/index.json'),'DE'),BIG='DamageEffect_ATT_Stardust_Shower_Ball_Big',EXP='DamageEffect_ATT_Stardust_Shower_Ball_Explosion';
 const templates={},queue=[];for(const n of [BIG,EXP]){const d=profile.damageEffects[n].raw;queue.push(d.MAIN_EFFECT_NAME);for(const [k,v]of Object.entries(d))if(/^(?:PASSIVE|TIME)_PARTICLE\d+$/.test(k))queue.push(v.PARTICLE_NAME);}
 const unresolved=[];for(const name of queue){if(templates[name])continue;const template=raw.templates[name];if(!template){unresolved.push(name);continue;}templates[name]=template;for(const key of ['TraceParticleList','FinalParticleList'])queue.push(...(template.repeated?.[key]??(template.fields[key]?[template.fields[key]]:[])));}
 assert.deepEqual([...new Set(unresolved)],['ATT_Stardust_Shower_Explosion_P04'],'source P04 declaration is unavailable and must not be invented');
 const poses=Object.fromEntries(Object.values(templates).map(t=>t.poseData).filter(Boolean).map(p=>[p,read('artifacts/de/'+p)]));
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('stardust-terminal-v61',new Vector3(0,32,10),scene);
 const view=await createEffectsView({scene,engine,index:{...raw,templates},profile:{...profile,states:{},skillCatalog:[],damageEffects:{[BIG]:profile.damageEffects[BIG],[EXP]:profile.damageEffects[EXP]},buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:Object.keys(templates)},
  effectPoses:poses,samplers:{effectAnchorSampler:sim.effectAnchorSampler,effectBoneSampler:sim.effectBoneSampler},effectQuality:{level:'high',particleDivisor:1},loadContainer:(_,file)=>loadPoseContainer(scene,resolve(root,'artifacts/de',file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});const ids=new Set(),layers=new Set();let exp=null,hit=false;
 const step=input=>{sim.step(dt,input??{}, {snapshot:false});for(const event of sim.drainEvents()){
  if(event.type==='effectStarted'&&[BIG,EXP].includes(event.name)){ids.add(event.effectId);view.event(event,sim.state);if(event.name===BIG)b.invincible=false;if(event.name===EXP)exp=event;}
  else if(ids.has(event.effectId))view.event(event,sim.state);
  if(event.type==='hit'&&event.origin?.id===exp?.effectId&&event.amount>0)hit=true;
 }view.step(dt,sim.state);view.render({actors:sim.state.actors});
  for(const mesh of scene.meshes){const match=/^native-particle:(ATT_Stardust_Shower_Explosion_P0[1235])\|/.exec(mesh.name),colors=mesh._userThinInstanceBuffersStorage?.data?.fxColor;if(!match||!colors||!(mesh.thinInstanceCount>0))continue;
   if(Array.from({length:mesh.thinInstanceCount},(_,i)=>colors[i*4+3]).some(a=>a>0))layers.add(match[1]);}
 };
 step({add:{pressed:['A'],held:['A']}});for(let i=0;i<390;i++)step();
 assert.ok(exp&&hit,'full actual cast must reach the original damaging/staggering terminal explosion');
 assert.ok(exp.birthAnchor.position[1]<a.y+100,'display is anchored to original fallen DIE position, not initial Y+600');
 assert.deepEqual([...layers].sort(),['ATT_Stardust_Shower_Explosion_P01','ATT_Stardust_Shower_Explosion_P02','ATT_Stardust_Shower_Explosion_P03','ATT_Stardust_Shower_Explosion_P05']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {resolve} from 'node:path';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {make,visualIndex,profile,poses,fixtureRoot} from '../helpers/rf-passive-fixture-v12.mjs';

async function presentation(t,names,s){
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;
 t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,targetScene)=>loadPoseContainer(targetScene,resolve(fixtureRoot,'artifacts/rf',file)));
 new FreeCamera('source-fx-camera',new Vector3(0,0,10),scene);
 const index={...visualIndex,templates:Object.fromEntries(names.map(n=>{assert.ok(visualIndex.templates[n],n);return [n,visualIndex.templates[n]];}))};
 const presentationProfile={...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
 const view=await createEffectsView({scene,engine,index,profile:presentationProfile,effectPoses:poses,
  samplers:{effectAnchorSampler:s.effectAnchorSampler,effectBoneSampler:s.effectBoneSampler}});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 const frame=(input={})=>{s.step(1/60,input,{snapshot:false});const events=s.drainEvents();for(const e of events)view.event(e,s.state);view.step(1/60,s.state);view.render();return events;};
 return {view,frame,scene};
}

test('real keyboard XXX retains its zero-colour attack-box runtime and visible particles without duplicate old smoke / flare',async t=>{
 const oldNames=['Smoke_Raven_ComboX03','Smoke_Raven_ComboX01','Flare_Raven_ComboX02'];
 const raw=profile.damageEffects.DamageEffect_RF_XXX.raw,main=raw.MAIN_EFFECT_NAME;
 const particleNames=['Raven_Hand_FireSM',...Object.entries(raw).filter(([key])=>/^PASSIVE_PARTICLE\d+$/.test(key)).map(([,entry])=>entry.PARTICLE_NAME)];
 const names=new Set([main,...particleNames,...oldNames]);
 // Follow the actual source child names, including HandFire trace particles.
 for(const name of names){const template=visualIndex.templates[name];assert.ok(template,name);
  for(const child of template.repeated?.TraceParticleList??[])names.add(child);}
 const s=await make({passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]}),{view,frame,scene}=await presentation(t,[...names],s);
 assert.equal(visualIndex.templates[main].kind,'mesh');
 assert.deepEqual(visualIndex.templates[main].events.filter(event=>event.property==='Color').map(event=>event.value),[[0,0,0,0]]);
 s.drainEvents();let peak=0,meshDisplayed=false,auxiliaryAlive=false;const events=[],displayedParticles=new Set();
 for(let i=0;i<190;i++){
  events.push(...frame([0,12,26].includes(i)?{pressed:['X'],held:['X']}:{}));peak=Math.max(peak,view.count);
  auxiliaryAlive ||= (view.proof({includeDraws:true}).nativeParticleDraws.counts[main]??0)>0;
  meshDisplayed ||= scene.transformNodes.some(n=>n.name.startsWith('fx-'+main+'-')&&n.name.endsWith('-world')&&n.isEnabled()&&n.getChildMeshes().some(m=>m.getTotalVertices()>0));
  for(const name of particleNames){
   const displayed=visualIndex.templates[name].glb
    ?scene.transformNodes.some(n=>n.name.startsWith('fx-'+name+'-')&&n.name.endsWith('-world')&&n.isEnabled()&&n.getChildMeshes().some(m=>m.getTotalVertices()>0))
    :scene.meshes.some(m=>m.name.startsWith('native-particle:'+name+'|')&&m.isEnabled()&&m.thinInstanceCount>0);
   if(displayed)displayedParticles.add(name);
  }
 }
 const starts=events.filter(e=>e.type==='effectStarted'&&e.setName==='EffectSet_A_RF_XXX');
 assert.deepEqual(starts.map(e=>e.name),['Raven_Hand_FireSM','DamageEffect_RF_XXX']);
 assert.ok(starts.every(e=>e.sourceCandidate?.evidenceClass==='target2016-resource-owner-candidate-unverified'));
 assert.equal(events.filter(e=>e.type==='originalRecoveredParticle').length,0,'fixed-V5 smoke callback is suppressed');
 assert.ok(!scene.meshes.some(m=>oldNames.some(name=>m.name.startsWith('native-particle:'+name+'|'))),'old particle batches were never born');
 assert.equal(auxiliaryAlive,true,'the original attack-box runtime still owns its attachments and lifecycle');
 assert.equal(meshDisplayed,false,'the source zero-colour attack-box no longer clones or draws an invisible cube');
 assert.ok(view.proof().invisibleMeshTemplates.includes(main));
 assert.deepEqual([...displayedParticles].sort(),[...particleNames].sort(),'hand fire and every declared passive particle actually display');
 assert.ok(peak>3);assert.ok(view.proof().meshInstances>0);assert.equal(view.count,0);assert.equal(view.proof().activeEffectParents,0);
 assert.ok(!view.proof().unsupported.some(n=>/not present|bone cannot|attachment/.test(n)));
});

test('HA source power-stun icon expires at 3 seconds and also clears on manual removal, death and reset',async t=>{
 for(const reason of ['expiry','removed','death','reset']){
  const s=await make({passives:[]}),a=s.actor('rf'),b=s.actor('target'),{view,frame}=await presentation(t,['UnitStunA'],s);
  const factor=profile.damageEffects.DAMAGE_EFFECT_RRF_Infernal_Arms_Effect_Stun.raw.DAMAGE_DATA.BUFF_FACTOR;
  assert.equal(factor.BUFF_TEMPLET_ID,319);assert.equal(factor.FINALIZER.BFT_TIME.NORMAL_TIME['1'],3);
  const base=s.snapshot();s.grantBuff(a,b,factor);frame();
  assert.ok(b.buffs.some(buff=>buff.templateId===319));assert.ok(view.count>0,'actual UnitStunA particle is displayed');
  if(reason==='expiry'){for(let i=0;i<190;i++)frame();assert.ok(!b.buffs.some(buff=>buff.templateId===319));}
  else if(reason==='removed'){b.buffs=[];frame();}
  else if(reason==='death'){b.hp=0;frame();}
  else {s.restore(base);view.clear();frame();}
  assert.equal(view.count,0,reason+' leaves no long-lived icon particle');assert.equal(view.proof().activeEffectParents,0);
 }
});

test('Nuclear blackhole stays invisible by source while all twelve timed visual requests reach real original particle templates',async t=>{
 const raws=['DamageEffect_ROT_NUCLEAR_NEW_Missile','DamageEffect_ROT_NUCLEAR_NEW_EXPLOSION'].map(n=>profile.damageEffects[n].raw);
 const entries=raws.flatMap(raw=>Object.entries(raw).filter(([k])=>/^(?:START|TIME)_PARTICLE\d+$/.test(k)).map(([,v])=>v));
 const names=[...new Set(entries.map(e=>e.PARTICLE_NAME))],s=await make({skillId:24007,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});
 assert.equal(profile.effectTemplates.ROT_NUCLEAR_NEW_Missile_BLACK_HOLE.fields.DrawCount,0);
 assert.equal(profile.effectTemplates.ROT_NUCLEAR_NEW_Missile_BLACK_HOLE.fields.LifeTime,.7);
 const {view,frame}=await presentation(t,names,s);s.drainEvents();frame({pressed:['A'],held:['A']});
 let requests=0;for(let i=0;i<240;i++)requests+=frame().filter(e=>e.type==='effectTimedParticles'&&e.name.startsWith('DamageEffect_ROT_NUCLEAR_NEW')).flatMap(e=>e.entries).length;
 assert.equal(requests,12);
 const counts=view.proof().timedParticleEmitters;
 assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),12);assert.equal(counts.ROT_NUCLEAR_NEW09,2);
 assert.ok(!view.proof().unsupported.some(n=>/timed-particle-parent|attachment bone|not present in bounded/.test(n)));
 view.clear();assert.equal(view.count,0);
});

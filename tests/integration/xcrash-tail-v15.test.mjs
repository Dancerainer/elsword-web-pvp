import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {make,profile,visualIndex} from '../helpers/rf-passive-fixture-v12.mjs';

test('production XCrash FireDummy tail queries diagonal bones and detaches finite AutoDie sequences from an expired mesh',async t=>{
 const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
 new FreeCamera('xcrash-tail-camera',new Vector3(0,0,10),scene);
 const s=await make({skillId:24010,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});
 const names=['RRF_XCrash_FireDummy','Raven_Hand_Fire05'];
 const index={...visualIndex,templates:Object.fromEntries(names.map(name=>[name,visualIndex.templates[name]]))};
 const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
 const points=[];let retired=false,queriesAfterDeath=0;
 const view=await createEffectsView({scene,engine,index,profile:bounded,samplers:{
  effectAnchorSampler:s.effectAnchorSampler,effectBoneSampler:(e,a,bone)=>{
   if(retired)queriesAfterDeath++;const p=s.effectBoneSampler(e,a,bone);
   if(p&&bone!=='Dummy00')points.push({p,center:s.effectBoneSampler(e,a,'Dummy00'),bone});return p;
  }}});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 s.drainEvents();let peak=0,tailCount=0,endStep=null,previousCount=0;
 for(let i=0;i<300;i++){
  s.step(1/60,i===0?{pressed:['A'],held:['A']}:{},{snapshot:false});
  for(const ev of s.drainEvents())if(ev.name==='DamageEffect_SA_RRF_XCrash_Fire_FX'){
   if(ev.type==='effectEnded'){retired=true;endStep=i;tailCount=view.count;}
   view.event(ev,s.state);
  }
  if(retired){s.actor('rf').x+=100;s.actor('rf').facing*=-1;}
  view.step(1/60,s.state);view.render();peak=Math.max(peak,view.count);
  if(retired)assert.ok(view.count<=previousCount,'ended emitters never create new particles');
  previousCount=view.count;
 }
 assert.ok(peak>17&&tailCount>0&&endStep>0,'original fire tail survives finite AutoDie');
 assert.equal(queriesAfterDeath,0,'no post-destruction owner/mesh attachment sampling');
 assert.equal(view.proof().timedParticleEmitters.Raven_Hand_Fire05,17);
 assert.ok(points.length>100);for(const {p,center,bone} of points){
  assert.ok(Math.abs(Math.abs(p[0]-center[0])-Math.abs(p[1]-center[1]))<.001,bone+' uses X diagonal');
 }
 assert.equal(view.count,0);assert.equal(view.proof().activeEffectParents,0);
});

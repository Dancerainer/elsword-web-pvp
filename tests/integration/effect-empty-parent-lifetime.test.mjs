/** Native Web executor traces and real converted assets. These are resource
 * lifetime regressions, not original-client or GPU reference measurements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {make,visualIndex,profile,poses,fixtureRoot} from '../helpers/rf-passive-fixture-v12.mjs';

async function visual(t,s,names,{templates=visualIndex.templates,effectQuality}={}){
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;
  new FreeCamera('empty-parent-camera',new Vector3(0,0,10),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>loadPoseContainer(target,resolve(fixtureRoot,'artifacts/rf',file)));
  const index={...visualIndex,templates:Object.fromEntries(names.map(name=>[name,templates[name]]))};
  const presentationProfile={...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
  const view=await createEffectsView({scene,engine,index,profile:presentationProfile,effectPoses:poses,
    samplers:{effectAnchorSampler:s.effectAnchorSampler,effectBoneSampler:s.effectBoneSampler},effectQuality});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  return view;
}

test('repeated Wild Charge requests with an injected unsupported field leave no empty parents',async t=>{
  const name='SI_SA_RRF_WILD_CHARGE_Smoke',template={...visualIndex.templates[name],unsupported:[{line:'UnknownField = invalid()',reason:'test-only unsupported source'}]};
  assert.equal(profile.damageEffects[name],undefined,'this visual has no later damage-particle route');
  const s=await make({skillId:24009,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});
  const view=await visual(t,s,[name],{templates:{[name]:template}});s.drainEvents();let smokeRequests=0;
  for(let cycle=0;cycle<6;cycle++){
    const actor=s.actor('rf');actor.mp=300;actor.cooldowns={};actor.inputLock=0;
    s.enter(actor,'RSI_WAIT','independent-recast-fixture');
    for(let frame=0;frame<360;frame++){
      s.step(1/60,frame===0?{rf:{pressed:['A'],held:['A']}}:{},{snapshot:false});
      for(const event of s.drainEvents())if(event.type==='effectStarted'&&event.name===name){
        smokeRequests++;view.event(event,s.state);
      }
      view.step(1/60,s.state);
      assert.equal(view.proof().activeEffectParents,0,'an unsupported pure visual has no parent work to scan');
      assert.equal(view.count,0);
    }
  }
  assert.equal(smokeRequests,6,'each actual compiled cast requested its original smoke');
  assert.ok(view.proof().unsupported.includes(name+':dsl'),'unsupported source fields stay reported');
});

test('actual Wild Charge smoke emits at production medium quality and retires after each cast',async t=>{
  const name='SI_SA_RRF_WILD_CHARGE_Smoke',template=visualIndex.templates[name];
  assert.deepEqual(template.unsupported,[]);
  assert.equal(template.fields.BillBoardType,'BT_ALL');
  assert.equal(template.fields.Lifetime,.5);assert.equal(template.fields.TriggerTime,.5);
  assert.equal(template.fields.Emitrate,70);assert.equal(template.fields.NumParticles,70);
  const s=await make({skillId:24009,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});
  const view=await visual(t,s,[name],{effectQuality:{level:'medium',particleDivisor:8}});s.drainEvents();let smokeRequests=0,positiveFrames=0;
  for(let cycle=0;cycle<3;cycle++){
    const actor=s.actor('rf');actor.mp=300;actor.cooldowns={};actor.inputLock=0;
    s.enter(actor,'RSI_WAIT','independent-recast-fixture');
    for(let frame=0;frame<360;frame++){
      s.step(1/60,frame===0?{rf:{pressed:['A'],held:['A']}}:{},{snapshot:false});
      for(const event of s.drainEvents())if(event.type==='effectStarted'&&event.name===name){smokeRequests++;view.event(event,s.state);}
      view.step(1/60,s.state);if(view.count>0)positiveFrames++;
    }
    assert.equal(view.count,0);assert.equal(view.proof().activeEmitters,0);assert.equal(view.proof().activeEffectParents,0);
  }
  assert.equal(smokeRequests,3);assert.ok(positiveFrames>0,'source smoke now reaches presentation');
  assert.equal(view.proof().unsupported.includes(name+':dsl'),false);
});

test('an actual supported Wild Charge mesh keeps its independent sequence until the original play ends',async t=>{
  const name='SI_SA_RRF_WILD_CHARGE05',template=visualIndex.templates[name];
  assert.equal(template.fields.LifeType,'LT_PLAY_COUNT');assert.equal(template.fields.PlayCount,1);
  const s=await make({skillId:24009,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});
  const view=await visual(t,s,[name]);s.drainEvents();let started;
  for(let frame=0;frame<180&&!started;frame++){
    s.step(1/60,frame===0?{rf:{pressed:['A'],held:['A']}}:{},{snapshot:false});
    started=s.drainEvents().find(event=>event.type==='effectStarted'&&event.name===name);
  }
  assert.ok(started,'the compiled native skill requested the real mesh');
  view.event(started,s.state);
  assert.equal(view.count,1);assert.equal(view.proof().activeEffectParents,1);
  for(let frame=0;frame<180;frame++)view.step(1/60,s.state);
  assert.equal(view.count,0);assert.equal(view.proof().activeEmitters,0);assert.equal(view.proof().activeEffectParents,0);
});

test('finite source passive handles retire while a live damage parent still accepts later timed dispatches',async t=>{
  const name='RF_HitP03',engine=new NullEngine(),scene=new Scene(engine);
  new FreeCamera('passive-retirement',new Vector3(0,0,10),scene);
  // Small explicit lifecycle fixture using unmodified real particle bytes.
  // The invented parent ID is not an original-client behavior expectation.
  const entry={PARTICLE_NAME:name,POSITION_TYPE:3,TRACE:0,TRIGGER_COUNT:1};
  const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[],
    damageEffects:{fixture:{raw:{MAIN_EFFECT_NAME:'fixture-invisible-main',PASSIVE_PARTICLE0:entry}}}};
  const view=await createEffectsView({scene,engine,profile:bounded,index:{templates:{[name]:visualIndex.templates[name]}},samplers:{}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  const state={actors:[{id:'owner',x:0,y:0,z:0,hp:100,facing:1,awakening:{remaining:0}}],effects:[]};
  for(let cycle=0;cycle<50;cycle++){
    state.effects=[{id:cycle,ownerId:'owner'}];
    view.event({type:'effectStarted',actorId:'owner',effectId:cycle,name:'fixture',definition:{},birthAnchor:{position:[0,0,0],facing:1}},state);
    for(let i=0;i<120;i++)view.step(1/60,state);
    assert.equal(view.proof().activeEmitters,0);assert.equal(view.proof().activeEffectParents,1,'wait for later combat dispatch');
    view.event({type:'effectTimedParticles',effectId:cycle,time:2,entries:[{key:'TIME_PARTICLE0',entry}]},state);
    assert.equal(view.proof().activeEmitters,1,'late source dispatch retains its original parent');
    state.effects=[];for(let i=0;i<120;i++)view.step(1/60,state);
    assert.equal(view.proof().activeEffectParents,0,'no dead passive handles after a natural combat retirement');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createLandingEffects,airDownLandingState} from '../../apps/web/landing-effects.mjs';
import {DEFAULT_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';

const particle=name=>({name,kind:'particle',fields:{NumParticles:20,Emitrate:100,Lifetime:.3},events:[],repeated:{},unsupported:[],textures:{}});
const commonNames=['DamageImpact','DamageImpactCore','DamageImpactSlash'];
const actor=id=>({id,x:0,y:0,z:0,hp:100,facing:1,state:'RSI_WAIT',awakening:{remaining:0},landPosition:[0,0,0]});
function fixtureProfile(damageEffects={}){
  return {states:{},skillCatalog:[],buffTemplates:{},effectSets:{},damageEffects,components:{MAX_HYPER_MODE_TIME:30},resourceOnlyTemplates:commonNames};
}
const hit=(actorId,targetId,extra={})=>({type:'hit',actorId,targetId,data:{REACT_TYPE:1},origin:{id:999,kind:'character',skillId:24027,impactPoint:[10,20,30]},...extra});

test('medium uses the current local identity when the online roster begins with another player',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  const index={templates:Object.fromEntries(commonNames.map(name=>[name,particle(name)]))};
  const state={actors:['first','me','enemy','ally'].map(actor),effects:[]};
  let currentLocal='me';
  const view=await createEffectsView({scene,engine,index,profile:fixtureProfile(),samplers:{},
    effectQuality:DEFAULT_EFFECT_QUALITY,localActorId:()=>currentLocal});
  try{
    view.event(hit('first','enemy'),state);
    assert.deepEqual(view.proof().commonHits.triggers,{},'a player-first roster must not grant first-player effects to this browser');
    view.event(hit('me','enemy'),state);view.event(hit('enemy','me'),state);
    assert.deepEqual(view.proof().commonHits.triggers,Object.fromEntries(commonNames.map(name=>[name,2])),
      'both attacking and receiving local hits retain their original common sequence');
    view.clear();currentLocal='ally';
    view.event(hit('enemy','me'),state);
    assert.deepEqual(view.proof().commonHits.triggers,{},'identity is read at event time after returning to practice or changing ownership');
    view.event(hit('first','ally'),state);
    assert.deepEqual(view.proof().commonHits.triggers,Object.fromEntries(commonNames.map(name=>[name,1])));
    view.clear();currentLocal='enemy';
    view.event(hit('first','me'),state);assert.deepEqual(view.proof().commonHits.triggers,{});
    view.event(hit('ally','enemy'),state);
    assert.deepEqual(view.proof().commonHits.triggers,Object.fromEntries(commonNames.map(name=>[name,1])),
      'the third roster position also preserves only its own receiving hit');
  }finally{view.clear();scene.dispose();engine.dispose();}
});

test('production DamageEffect start, time and hit consumers apply SHOW_LEVEL independently of local hit suppression',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine),names=['high','medium','default'];
  const index={templates:Object.fromEntries(names.map(name=>[name,particle(name)]))};
  const entries=names.map((name,index)=>({PARTICLE_NAME:name,POSITION_TYPE:3,...(index===2?{}:{SHOW_LEVEL:index})}));
  const damage={MAIN_EFFECT_NAME:'pose-only-fixture',...Object.fromEntries(entries.map((entry,index)=>['HIT_PARTICLE'+index,{...entry,POSITION_TYPE:2}]))};
  const state={actors:['first','me','enemy','ally'].map(actor),effects:[]};
  const view=await createEffectsView({scene,engine,index,profile:fixtureProfile({sourceGateFixture:{raw:damage}}),samplers:{},
    effectQuality:DEFAULT_EFFECT_QUALITY,localActorId:'me'});
  try{
    view.event({type:'effectStarted',actorId:'enemy',effectId:73,name:'sourceGateFixture',definition:{},birthAnchor:{position:[1,2,3],facing:1}},state);
    view.event({type:'effectStartParticles',effectId:73,entries:entries.map(entry=>({entry})),mainAnchor:{position:[1,2,3],facing:1}},state);
    view.event({type:'effectTimedParticles',effectId:73,entries:entries.map(entry=>({entry}))},state);
    view.event(hit('enemy','ally',{origin:{id:73,kind:'effect',impactPoint:[10,20,30]}}),state);
    for(const field of ['startParticleEmitters','timedParticleEmitters','hitParticleEmitters'])
      assert.deepEqual(view.proof()[field],{medium:1,default:1},field+' preserves default LOW entries and only removes explicit HIGH');
    assert.deepEqual(view.proof().commonHits.triggers,{},'CEffect particles retain their own gate even for other players; they do not become GUUser common particles');
  }finally{view.clear();scene.dispose();engine.dispose();}
});

test('retained original landing sequences preserve their reduced trigger budgets through smoke and landing reuse',()=>{
  // Fixed-V5 landing call counts are GroundShockWave1/AirDownTick10/DownSmoke7.
  // Source live caps are 2/50/10; density is the independent user setting.
  const index={templates:{
    GroundShockWave:{...particle('GroundShockWave'),fields:{NumParticles:2,Lifetime:.3}},
    AirDownTick:{...particle('AirDownTick'),fields:{NumParticles:50,Lifetime:2}},
    DownSmoke:{...particle('DownSmoke'),fields:{NumParticles:10,Lifetime:1}},
  }};
  const runtime=createEffectRuntime({index,effectQuality:DEFAULT_EFFECT_QUALITY});
  const landing=createLandingEffects({runtime}),me=actor('me');me.state=airDownLandingState;me.stateSerial=1;me.animationTime=0;
  const state={actors:[me]};landing.step(state);
  const tick=[...runtime.emitters.values()].find(e=>e.name==='AirDownTick');
  assert.equal(tick.sourceLimit,10);assert.equal(tick.limit,2);
  me.animationTime=.03;landing.step(state);
  const smoke=[...runtime.emitters.values()].find(e=>e.name==='DownSmoke');
  assert.equal(smoke.sourceLimit,7);assert.equal(smoke.limit,1);
  runtime.step(.04,state);const prior={id:smoke.id,age:smoke.age,excess:smoke.excess,particles:[...smoke.particles]};
  me.animationTime=.46;landing.step(state);
  assert.equal(smoke.id,prior.id);assert.equal(smoke.age,prior.age);assert.equal(smoke.excess,prior.excess);
  assert.deepEqual([...smoke.particles],prior.particles,'retrigger retains the original live tail');
  assert.equal(smoke.sourceLimit,7);assert.equal(smoke.limit,1,'the second source smoke event must not restore the unscaled seven-birth limit');
  me.state='RSI_WAIT';landing.step(state);me.state=airDownLandingState;me.stateSerial=2;me.animationTime=0;landing.step(state);
  assert.equal(tick.sourceLimit,10);assert.equal(tick.limit,2,'a later landing retains the same presentation budget');
  landing.clear();assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
});

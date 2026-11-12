import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createCommonHitEffects} from '../../apps/web/common-hit-effects.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {make,visualIndex,profile,poses,fixtureRoot} from '../helpers/rf-passive-fixture-v12.mjs';

const commonNames=['DamageImpact','DamageImpactCore','DamageImpactSlash','DamageImpactRed','DamageImpactRingRed','DamageImpactCoreRed','DamageImpactSlashRed'];
const hit=(extra={})=>({type:'hit',actorId:'rf',targetId:'target',data:{REACT_TYPE:1},origin:{kind:'character',impactPoint:[10,20,30]},...extra});
function commonFixture(){const runtime=createEffectRuntime({index:visualIndex}),view=createCommonHitEffects({runtime});return {runtime,view};}

test('reference character sequence reset retains live particles, clock and fractional carry; original 20 cap is shared across hits',()=>{
  const {runtime,view}=commonFixture();view.event(hit());runtime.step(.017,{});
  const emitter=[...runtime.emitters.values()].find(e=>e.name==='DamageImpactCore');
  const prior={id:emitter.id,age:emitter.age,excess:emitter.excess,particles:[...emitter.particles]};
  assert.ok(prior.particles.length>0);view.event(hit({origin:{kind:'character',impactPoint:[100,200,300]}}));
  assert.equal(emitter.id,prior.id);assert.equal(emitter.age,prior.age);assert.equal(emitter.excess,prior.excess);
  assert.deepEqual([...emitter.particles],prior.particles);assert.equal(emitter.count,0);assert.equal(emitter.limit,10);
  assert.deepEqual(emitter.position,[100,200,300]);assert.equal(emitter.options.landPosition,200);
  assert.equal(emitter.options.drawCount,2);
  for(let i=0;i<100;i++){view.event(hit());runtime.step(.017,{});assert.ok(emitter.particles.size<=20);}
  assert.equal(runtime.emitters.size,3,'three retained common handles, rather than three new handles for every accepted hit');
  for(let i=0;i<100;i++)runtime.step(.017,{});
  assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,3,'SetTriggerWait keeps the source handles after their tails expire');
  view.event(hit());assert.equal([...runtime.emitters.values()].find(e=>e.name==='DamageImpactCore').id,prior.id);
  view.step({actors:[{id:'target'}]});assert.equal(runtime.emitters.size,0);
});

test('each attacker has independent common handles; two targets in one packet reset the same sequence rather than duplicate it',()=>{
  const {runtime,view}=commonFixture();view.event(hit());view.event(hit({targetId:'another',origin:{kind:'character',impactPoint:[40,50,60]}}));
  assert.equal(runtime.emitters.size,3);assert.ok([...runtime.emitters.values()].every(e=>e.position[0]===40));
  view.event(hit({actorId:'ally'}));assert.equal(runtime.emitters.size,6);
  view.clear();assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
});

test('CEffect and nasod-core consumers do not run GUUser common hit particles',()=>{
  const {runtime,view}=commonFixture();
  for(const kind of ['effect','core'])for(const react of [1,2,5,7])view.event(hit({data:{REACT_TYPE:react},origin:{kind,impactPoint:[10,20,30]}}));
  assert.equal(runtime.emitters.size,0);assert.deepEqual(view.proof().triggers,{});
});

test('production common draw override retains native two draws, and impact-point hit quads are independent of owner facing',async()=>{
  const names=[...commonNames,'RF_HitP01','RF_HitP02','RF_HitP03','RavenHandFireP01','RavenHandFireP02','RavenHandFireP03'];
  const index={...visualIndex,templates:Object.fromEntries(names.map(name=>[name,visualIndex.templates[name]]))};
  const presentationProfile={...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:names};
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('common-draw-camera',new Vector3(0,0,10),scene);
  const view=await createEffectsView({scene,engine,index,profile:presentationProfile,samplers:{}});
  const state={actors:[{id:'rf',x:0,y:0,z:0,hp:100,facing:1,state:'RSI_WAIT',awakening:{remaining:0}}],effects:[]};
  try{
    view.event(hit(),state);view.step(.017,state);view.render();
    const core=scene.meshes.filter(m=>m.name.startsWith('native-particle:DamageImpactCore|')&&m.thinInstanceCount>0);
    assert.equal(core.reduce((n,m)=>n+m.thinInstanceCount,0),2,'one original live core particle is drawn twice by Raven common sequence override');
    assert.equal(core.length,2,'the two whole-sequence passes retain separate draw units');
    const samples=[];
    for(const facing of [-1,1]){
      view.clear();state.actors[0].facing=facing;
      const raw={DAMAGE_DATA:{REACT_TYPE:2},HIT_PARTICLE0:{PARTICLE_NAME:'RF_HitP03',POSITION_TYPE:2}};
      // The only legal changed declaration here is a minimal damage owner that
      // references the actual unmodified RF_HitP03 source particle closure.
      presentationProfile.damageEffects={axisFixture:{raw}};
      view.event({type:'effectStarted',actorId:'rf',effectId:700,name:'axisFixture',definition:{},birthAnchor:{position:[10,20,30],facing}},state);
      view.event(hit({data:raw.DAMAGE_DATA,origin:{kind:'effect',id:700,impactPoint:[10,20,30]}}),state);
      const timeline=[];
      for(let frame=0;frame<10;frame++){
        view.step(1/60,state);view.render();
        const mesh=scene.meshes.find(m=>m.name.startsWith('native-particle:RF_HitP03|'));
        timeline.push(Array.from(mesh._thinInstanceDataStorage.matrixData.slice(0,mesh.thinInstanceCount*16)));
      }
      samples.push(timeline);
    }
    assert.deepEqual(samples[0],samples[1],'DEPT_IMPACT_POINT cannot inherit a left-facing owner yaw or rotate its original velocities');
  }finally{view.clear();scene.dispose();engine.dispose();}
});

test('actual XCrash, GuardianStrike and EnchantHand ordinary/awake hit callbacks render exactly their source HIT_PARTICLE closures',async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('hit-source-camera',new Vector3(0,0,10),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,targetScene)=>loadPoseContainer(targetScene,resolve(fixtureRoot,'artifacts/rf',file)));
  const boot=await make({passives:[]});
  const view=await createEffectsView({scene,engine,index:visualIndex,profile,effectPoses:poses,
    samplers:{effectAnchorSampler:boot.effectAnchorSampler,effectBoneSampler:boot.effectBoneSampler},loadout:[{skillId:24010},{skillId:24006},{skillId:24206}]});
  try{
    for(const skillId of [24010,24006,24206])for(const hyper of [false,true]){
      view.clear();const s=await make({skillId,passives:[],targetHp:8000000});s.drainEvents();
      if(hyper){s.actor('rf').awakening.remaining=99;s.actor('rf').awakening.pearls=3;}
      const expected={},seen=new Set(),seenEffectNames=new Map();let hitCount=0;
      for(let frame=0;frame<330;frame++){
        s.step(1/60,frame===0?{pressed:['A'],held:['A']}:{},{snapshot:false});
        const events=s.drainEvents();
        for(const event of events){
          if(event.type==='hit'&&['effect','core'].includes(event.origin.kind)){
            if(event.origin.kind==='effect')hitCount++;const effect=s.state.effects.find(e=>e.id===event.origin.id);
            const started=events.find(e=>e.type==='effectStarted'&&e.effectId===event.origin.id);
            const name=event.origin.kind==='core'?'RAVEN_NASOD_BALL':effect?.name??started?.name??seenEffectNames.get(event.origin.id);
            assert.ok(name,'actual source effect identity is retained for the accepted hit');
            for(const [key,entry]of Object.entries(profile.damageEffects[name]?.raw??{}))if(/^HIT_PARTICLE\d+$/.test(key))expected[entry.PARTICLE_NAME]=(expected[entry.PARTICLE_NAME]??0)+1;
          }
          if(event.type==='effectStarted')seenEffectNames.set(event.effectId,event.name);
          view.event(event,s.state);
        }
        view.step(1/60,s.state);view.render();
        for(const mesh of scene.meshes)if(mesh.name.startsWith('native-particle:')&&mesh.thinInstanceCount>0)seen.add(mesh.name.slice('native-particle:'.length).split('|')[0]);
      }
      assert.ok(hitCount>0,`${skillId}/${hyper} actual native input produces accepted target hits`);
      assert.deepEqual(view.proof().hitParticleEmitters,expected,`${skillId}/${hyper}: all original per-hit lists reach the production runtime`);
      assert.deepEqual(view.proof().commonHits.triggers,{},`${skillId}/${hyper}: no extra GUUser AttackResult branch`);
      for(const name of commonNames)assert.equal(seen.has(name),false,`${skillId}/${hyper}: ${name} is not part of this effect hit`);
      assert.ok(Object.keys(expected).length>=2);
      if(hyper){s.actor('rf').awakening.remaining=0;
        for(let i=0;i<120;i++){s.step(1/60,{}, {snapshot:false});for(const e of s.drainEvents())view.event(e,s.state);view.step(1/60,s.state);view.render();}}
      assert.equal(view.count,0,'source impact tails expire; awakened persistent aura is explicitly ended before this aggregate check');
      assert.ok(!view.proof().unsupported.some(n=>/not present|attachment bone|hit-point|parent unavailable/.test(n)));
      t.diagnostic(JSON.stringify({skillId,hyper,hitCount,sourceHitEmitters:expected,commonHitEmitters:0}));
    }
  }finally{view.clear();scene.dispose();engine.dispose();}
});

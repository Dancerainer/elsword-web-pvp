import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {collectEffectMeshBudget,effectNumberUpperBound} from '../../apps/web/effect-prewarm.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const root=new URL('../../',import.meta.url);
const index=JSON.parse(readFileSync(new URL('contracts/rf-fx-index.json',root)));
const profile=JSON.parse(readFileSync(new URL('packages/combat-core/rf-profile.json',root)));
const inventory=JSON.parse(readFileSync(new URL('reports/rf-full-skill-assets.json',root))).outputInventory;
const resource=file=>process.env.RF_EFFECT_ASSET_ROOT?pathToFileURL(process.env.RF_EFFECT_ASSET_ROOT+'/'+file):new URL('artifacts/rf/'+file,root);

test('actual 668XX source set requires two AP03 emitters/four draw instances and ten AM01 instances',()=>{
  const set=profile.effectSets.EffectSet_RRF_LandImpact.raw;
  assert.equal(set.EFFECT1.NAME,'LimitCrusherAP03');assert.equal(set.EFFECT2.NAME,'LimitCrusherAP03');
  assert.equal(set.EFFECT4.NAME,'LimitCrusherAM01');
  const a=index.templates.LimitCrusherAP03.fields,b=index.templates.LimitCrusherAM01.fields;
  assert.deepEqual([a.NumParticles,a.TriggerCount,a.DrawCount],[1,1,2]);
  assert.deepEqual([b.NumParticles,b.TriggerCount,b.Emitrate,b.Lifetime],[10,10,80,.3]);
  const result=collectEffectMeshBudget(profile,index,[]);
  assert.deepEqual(result.demands.get('LimitCrusherAP03'),{views:4,peakParticles:1,drawCount:2,effectSetInstances:2});
  assert.deepEqual(result.demands.get('LimitCrusherAM01'),{views:10,peakParticles:10,drawCount:1,effectSetInstances:1});
  assert.deepEqual(result.unsupported,[]);assert.equal(result.scope,'one-effectset-burst');
});

test('pool budget uses native interval upper bounds, emission/lifetime, count and cap instead of allocating every configured slot',()=>{
  assert.equal(effectNumberUpperBound({random:[5,1]}),9,'native reversed range starts at the first endpoint');
  assert.equal(effectNumberUpperBound({random:[2,2]}),2);assert.equal(effectNumberUpperBound('script()'),null);
  assert.equal(effectNumberUpperBound(1e100),null,'a finite JS number may overflow the native float');
  const fixture={states:{source:{raw:'bounded'}},skillCatalog:[]};
  const t={name:'bounded',kind:'particle',glb:'source.glb',fields:{NumParticles:500,Emitrate:{random:[10,20]},Lifetime:.1,DrawCount:2},events:[]};
  const result=collectEffectMeshBudget(fixture,{templates:{bounded:t}},[],{tickSeconds:1/60});
  const demand=result.demands.get('bounded');assert.ok(demand.peakParticles<=4);assert.equal(demand.views,demand.peakParticles*2);
  assert.ok(demand.peakParticles<500,'original emit cap is not a reason to prepare 500 meshes');
  t.fields.TriggerCount=1;assert.equal(collectEffectMeshBudget(fixture,{templates:{bounded:t}},[]).demands.get('bounded').views,2);
  t.fields.Emitrate='unknown-expression';const unknown=collectEffectMeshBudget(fixture,{templates:{bounded:t}},[]);
  assert.equal(unknown.demands.has('bounded'),false);assert.match(unknown.unsupported[0].detail,/Unconfirmed/);
  assert.throws(()=>collectEffectMeshBudget(fixture,{templates:{bounded:t}},[],{tickSeconds:0}),/fixed effect tick/);
});

test('medium prewarm retains actual 668XX high density and singleton passes while skill use stays medium',()=>{
  const result=collectEffectMeshBudget(profile,index,[],{effectQuality:{level:'medium',particleDivisor:8}});
  assert.deepEqual(result.demands.get('LimitCrusherAP03'),{views:4,peakParticles:1,drawCount:2,effectSetInstances:2});
  assert.deepEqual(result.demands.get('LimitCrusherAM01'),{views:10,peakParticles:10,drawCount:1,effectSetInstances:1});
  // The same real template in a skill-only binding must not be promoted by its name.
  const skillProfile={...profile,states:{SI_TEST_SKILL:{raw:'EffectSet_RRF_LandImpact'}},
    skillCatalog:[{skillId:900,states:['SI_TEST_SKILL']}],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
  const skillBudget=collectEffectMeshBudget(skillProfile,index,[{skillId:900}],{effectQuality:{level:'medium',particleDivisor:8}});
  assert.deepEqual(skillBudget.demands.get('LimitCrusherAM01'),{views:2,peakParticles:2,drawCount:1,effectSetInstances:1});
  assert.equal(index.templates.LimitCrusherAM01.fields.NumParticles,10);
});

test('real 668XX meshes are prepared before input and return to their pools across two landings',async t=>{
  const names=['LimitCrusherAP03','LimitCrusherAM01'];
  for(const name of names)for(const file of [index.templates[name].glb,index.templates[name].poseData]){
    const expected=inventory.find(row=>row.path==='artifacts/rf-full-skills/'+file);assert.ok(expected);
    const bytes=readFileSync(resource(file));assert.equal(bytes.length,expected.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256,'use independently inventoried real converted assets');
  }
  const selected={...index,templates:Object.fromEntries(names.map(name=>[name,index.templates[name]]))};
  // A minimal legal deferred-selection fixture starts with the actual AP03
  // template; selecting its state then exposes the actual landing EffectSet.
  // This also checks enlargement of an already warmed template's pool.
  const fixture={...profile,states:{source:{raw:'LimitCrusherAP03'},deferred:{raw:'EffectSet_RRF_LandImpact'}},
    skillCatalog:[{skillId:900,states:['deferred']}],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
  const poses=Object.fromEntries(names.map(name=>{const file=index.templates[name].poseData;return [file,JSON.parse(readFileSync(resource(file)))];}));
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('pool-test-camera',new Vector3(0,0,10),scene);
  // Read the actual GLBs, hierarchy, skin and keys through Babylon's loader.
  // Only material/texture IO is omitted by the shared headless loader. This
  // proves the production pool path without claiming GPU startup measurements.
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,targetScene)=>loadPoseContainer(targetScene,resource(file)));
  const view=await createEffectsView({scene,engine,index:selected,profile:fixture,effectPoses:poses,
    samplers:{effectAnchorSampler:(_parent,a)=>({position:[a.x,0,0]})}});
  try{
    assert.equal(view.proof().meshInstances,2,'one standalone AP03 emitter is prepared initially');
    await view.prewarm([{skillId:900}]);
    assert.equal(view.proof().meshInstances,14,'independently expected 2*1*2 + 1*10*1');
    assert.equal(view.proof().meshPoolBudgets.LimitCrusherAP03.views,4);
    assert.equal(view.proof().meshPoolBudgets.LimitCrusherAM01.views,10);
    const state={actors:[{id:1,x:0,hp:800000,facing:1,stateSerial:1,awakening:{remaining:0}}]};
    const set=profile.effectSets.EffectSet_RRF_LandImpact.raw;
    for(let round=0;round<2;round++){
      for(const [i,entry] of [set.EFFECT1,set.EFFECT2,set.EFFECT4].entries())view.event({type:'effectStarted',effectId:100+round*10+i,
        actorId:1,name:entry.NAME,definition:entry,birthAnchor:{position:[0,0,0],facing:1}},state);
      let peak=0;for(let frame=0;frame<60;frame++){view.step(1/60,state);peak=Math.max(peak,view.count);view.render();}
      assert.equal(peak,12,'two AP03 particles plus ten AM01 particles');assert.equal(view.count,0);
      assert.equal(view.proof().meshInstances,14,'input and second landing create no new model instances');
      assert.ok(scene.transformNodes.filter(node=>node.name.startsWith('fx-')&&node.name.endsWith('-world')).every(node=>!node.isEnabled()));
    }
    await view.prewarm([]);assert.equal(view.proof().meshInstances,14,'repeated prewarm retains the existing pool');
    assert.equal(view.proof().meshPoolBudgets.LimitCrusherAP03.effectSetInstances,2,'a smaller later request retains the larger prepared budget');
    const roster=Array.from({length:6},(_,i)=>({...state.actors[0],id:i+1,loadout:[{skillId:900}]}));
    state.actors=roster;await view.prewarmActors(roster);
    assert.equal(view.proof().meshInstances,84,'six simultaneous source bursts: 6*(4 AP03 views + 10 AM01 views)');
    for(let round=0;round<3;round++){
      for(const actor of roster)for(const [i,entry]of [set.EFFECT1,set.EFFECT2,set.EFFECT4].entries())view.event({type:'effectStarted',effectId:1000+round*100+actor.id*10+i,
        actorId:actor.id,name:entry.NAME,definition:entry,birthAnchor:{position:[0,0,0],facing:1}},state);
      let peak=0;for(let frame=0;frame<60;frame++){view.step(1/60,state);peak=Math.max(peak,view.count);view.render();}
      assert.equal(peak,72,'six real landings retain all 12 authored particles each');
      assert.equal(view.count,0);assert.equal(view.proof().activeEmitters,0);
      assert.equal(view.proof().meshInstances,84,'repeated six-player casts clone no models during combat');
    }
  }finally{view.clear();scene.dispose();engine.dispose();}
});

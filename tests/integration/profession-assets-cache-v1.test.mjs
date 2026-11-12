import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createProfessionAssetCache,loadProfessionAssets,prewarmAllProfessionSkills} from '../../apps/web/load-profession-assets.mjs';
import {createProfessionEffects} from '../../apps/web/profession-effects.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {FEEDBACK_FIXTURE_REFERENCE} from '../helpers/player-feedback-visual-fixture-v45.mjs';
import counterWait from '../../contracts/lk-counter-visual-v49.json' with {type:'json'};

const deferred=()=>{let resolve,reject;const promise=new Promise((ok,bad)=>{resolve=ok;reject=bad;});return {promise,resolve,reject};};
function fixture({failData,failImage,containerGate}={}) {
  const calls={data:[],containers:[],images:[]},disposed=[],imageObjects=[];
  let dataFailed=false,imageFailed=false;
  const options={data:async url=>{
    calls.data.push(url);if(url===failData&&!dataFailed){dataFailed=true;throw Error('injected JSON failure');}
    if(url.endsWith('/lk/counter-v49/index.json'))return counterWait;
    if(url.endsWith('catalog.json'))return {skills:[{id:1,icon:'shared.png'},{id:2,icon:'shared.png'}]};
    if(url.endsWith('manifest.json'))return {runtimeGlb:'body.glb',runtimePose:'pose.json',effectAssetIndex:'effect.json',visualEffectIndexes:['fx/index.json']};
    if(url.endsWith('pose.json'))return {schemaVersion:1,frames:[],clips:[],helpers:[]};
    return {schemaVersion:1,referenceVersion:FEEDBACK_FIXTURE_REFERENCE,templates:{}};
  },loadContainer:async(base,file)=>{calls.containers.push(base+file);await containerGate?.promise;
    return {dispose(){disposed.push(base+file);}};},loadImage:async url=>{
    calls.images.push(url);if(url===failImage&&!imageFailed){imageFailed=true;throw Error('injected image failure');}
    const value={src:url};imageObjects.push(value);return value;
  }};
  return {options,calls,disposed,imageObjects};
}

test('two profession requests and repeated switches fetch, decode and retain each input once per scene',async()=>{
  const f=fixture(),cache=createProfessionAssetCache(f.options);
  const [first,second]=await Promise.all([cache.loadAll(['RF','LK']),cache.loadAll(['RF','LK'])]);
  assert.equal(first.get('RF'),second.get('RF'));assert.equal(first.get('LK'),second.get('LK'));
  for(let i=0;i<40;i++)assert.equal(await cache.load(i%2?'RF':'LK'),first.get(i%2?'RF':'LK'));
  for(const category of Object.values(f.calls))assert.equal(category.length,new Set(category).size);
  assert.equal(f.calls.containers.length,2);assert.equal(f.calls.images.filter(url=>url.endsWith('shared.png')).length,1);
  for(const url of ['/assets/ui/r_fist_state.png','/assets/ui/raven_3_bg.png','/assets/ui/raven_3.png','/assets/lk/ui/portrait-state.png','/assets/ui/rage_bg.png','/assets/ui/rage_bead.png'])assert.equal(f.calls.images.filter(value=>value===url).length,1,url);
  assert.ok(first.get('RF').allSkillLoadout.length>=20);assert.ok(first.get('LK').allSkillLoadout.length>=20);
  const proof=cache.proof();proof.attempts.json=0;assert.ok(cache.proof().attempts.json>0);
  cache.dispose();cache.dispose();assert.equal(f.disposed.length,2);assert.ok(f.imageObjects.every(image=>image.src===''));
  assert.throws(()=>cache.load('RF'),/disposed/);
});

test('a failed JSON or image leaf retries without duplicating completed GLB decoders or successful leaves',async()=>{
  for(const failure of [{failData:'/assets/lk/pose.json'},{failImage:'/assets/lk/ui/portrait-party.png'}]){
    const f=fixture(failure),cache=createProfessionAssetCache(f.options);
    await assert.rejects(cache.load('LK'),/injected/);const assets=await cache.load('LK');assert.equal(assets.id,'LK');
    assert.equal(f.calls.containers.length,1,'successful partial GLB remains owned for retry');
    const target=failure.failData??failure.failImage,category=failure.failData?f.calls.data:f.calls.images;
    assert.equal(category.filter(url=>url===target).length,2);
    for(const url of new Set(category.filter(url=>url!==target)))assert.equal(category.filter(value=>value===url).length,1);
    cache.dispose();assert.equal(f.disposed.length,1);
  }
});

test('legacy direct loader waits for a late GLB before cleaning a failed partial load',async()=>{
  const gate=deferred(),f=fixture({failData:'/assets/lk/pose.json',containerGate:gate});let settled=false;
  const load=loadProfessionAssets({id:'LK',...f.options}).finally(()=>{settled=true;});
  await new Promise(ok=>setImmediate(ok));assert.equal(settled,false);assert.deepEqual(f.disposed,[]);
  gate.resolve();await assert.rejects(load,/injected/);assert.deepEqual(f.disposed,['/assets/lk/body.glb']);
});

test('disposing while a scene container is decoding releases its late result exactly once',async()=>{
  const gate=deferred(),f=fixture({containerGate:gate}),cache=createProfessionAssetCache(f.options);
  const pending=cache.load('LK');await new Promise(ok=>setImmediate(ok));cache.dispose();gate.resolve();
  await assert.rejects(pending,/disposed/);assert.deepEqual(f.disposed,['/assets/lk/body.glb']);
  assert.equal(cache.proof().containers,0);assert.equal(cache.proof().images,0);
});

test('canonical common-buff paths share the scene source container while private profession paths stay separate',async()=>{
  const f=fixture(),cache=createProfessionAssetCache(f.options);
  const [rfCommon,lkCommon,rfPrivate,lkPrivate]=await Promise.all([
    cache.loadContainer('/assets/rf/','../common-buffs/fx/shared.glb'),cache.loadContainer('/assets/lk/','../common-buffs/fx/shared.glb'),
    cache.loadContainer('/assets/rf/','fx/private.glb'),cache.loadContainer('/assets/lk/','fx/private.glb')]);
  assert.equal(rfCommon,lkCommon);assert.notEqual(rfPrivate,lkPrivate);assert.equal(f.calls.containers.length,3);
  cache.dispose();assert.equal(f.disposed.length,3);
});

test('full-skill material preparation coalesces calls and retries a rejected compile without inventing a roster',async()=>{
  const f=fixture(),cache=createProfessionAssetCache(f.options),assets=await cache.loadAll(['RF','LK']);
  const calls=[],counts={RF:0,LK:0};let fail=true;
  const views=Object.fromEntries(['RF','LK'].map(id=>[id,{async prewarmResources(loadout){counts[id]++;calls.push({id,loadout});if(id==='LK'&&fail){fail=false;throw Error('compile');}}}]));
  await assert.rejects(prewarmAllProfessionSkills(views,assets),/compile/);
  await Promise.all([prewarmAllProfessionSkills(views,assets),prewarmAllProfessionSkills(views,assets)]);
  await prewarmAllProfessionSkills(views,assets);assert.deepEqual(counts,{RF:1,LK:2});
  for(const {loadout}of calls){assert.ok(loadout.length>=20);assert.equal(new Set(loadout.map(slot=>slot.skillId)).size,loadout.length);}
  cache.dispose();
});

test('profession selection reuses existing effect views and preserves full mixed target routing',async()=>{
  const calls=[],view=id=>({prewarm:slots=>calls.push(['prewarm',id,slots]),prewarmActors:(actors,options)=>calls.push(['actors',id,actors,options]),
    proof:()=>({id}),performance:()=>({quality:id,particles:1})});
  const effects=createProfessionEffects({RF:view('RF'),LK:view('LK')});
  for(let i=0;i<20;i++){effects.setLocalProfession(i%2?'RF':'LK');effects.prewarm([i]);assert.equal(effects.proof().id,effects.localProfessionId);}
  assert.equal(calls.length,20);assert.throws(()=>effects.setLocalProfession('missing'),/Unavailable/);assert.equal(effects.localProfessionId,'RF');
  const actors=[{id:'one',professionId:'RF'},{id:'two',professionId:'LK'}];await effects.prewarmActors(actors);
  assert.equal(calls.at(-1)[3].targetActors,actors);assert.equal(calls.at(-2)[3].targetActors,actors);
});

test('actual RF/LK manifests, poses and GLBs decode once while every source skill icon is prepared',async t=>{
  const root=process.env.PROFESSION_ASSET_FIXTURE_ROOT??resolve(import.meta.dirname,'../..'),counts={json:new Map(),models:new Map(),images:new Map()};
  const path=url=>resolve(root,'artifacts',new URL(url,'http://fixture').pathname.replace(/^\/assets\//,''));
  const count=(kind,key)=>counts[kind].set(key,(counts[kind].get(key)??0)+1);
  const engine=new NullEngine(),scene=new Scene(engine);
  const cache=createProfessionAssetCache({data:async url=>{count('json',url);return JSON.parse(readFileSync(path(url)));},
    loadContainer:async(base,file)=>{count('models',base+file);return loadPoseContainer(scene,path(base+file));},
    loadImage:async url=>{count('images',url);assert.ok(existsSync(path(url)),url);return {src:url};}});
  t.after(()=>{cache.dispose();scene.dispose();engine.dispose();});
  const first=await cache.loadAll(['RF','LK']);const clones=scene.meshes.length;
  for(let i=0;i<20;i++){const again=await cache.load(i%2?'RF':'LK');assert.equal(again,first.get(again.id));}
  for(const map of Object.values(counts))assert.ok([...map.values()].every(value=>value===1));
  assert.equal(counts.models.size,3,'RF body/core and LK body are decoded once');assert.equal(scene.meshes.length,clones);
  for(const [id,assets]of first){assert.ok(assets.bodyContainer.meshes.length>0,id);assert.ok(assets.catalog.skills.length>=30,id);
    assert.ok(assets.allSkillLoadout.length>=20,id);for(const skill of assets.catalog.skills)if(skill.icon)assert.ok(counts.images.has('/assets/ui/skills/'+skill.icon));}
  t.diagnostic(JSON.stringify({json:counts.json.size,glbDecodes:counts.models.size,iconsAndPortraits:counts.images.size,repeatedSwitches:20,gpuMeasured:false}));
});

test('actual skill material preparation is bounded by authored draw passes and later roster demand grows reusable pools',async t=>{
  const root=process.env.PROFESSION_ASSET_FIXTURE_ROOT??resolve(import.meta.dirname,'../..');
  const read=file=>JSON.parse(readFileSync(resolve(root,file)));
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('resource-only',new Vector3(0,0,10),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(base,file,s)=>loadPoseContainer(s,resolve(root,'artifacts',base.replace('/assets/',''),file)));
  t.after(()=>{scene.dispose();engine.dispose();});
  for(const [id,name]of [['RF','RF_HitP04'],['LK','UnlimitedBlade_HyperP02']]){
    const base='/assets/'+id.toLowerCase()+'/',profile=read('packages/combat-core/'+id.toLowerCase()+'-profile.json');
    const template=read('artifacts/'+id.toLowerCase()+'/fx/index.json').templates[name];
    const only={...profile,states:{cast:{raw:{PARTICLE:name}}},skillCatalog:[{skillId:1,states:['cast']}],buffTemplates:{},resourceOnlyTemplates:[],resourceOnlyEffectSets:[]};
    let decodes=0;
    const view=await createEffectsView({scene,engine,profile:only,index:{templates:{[name]:template}},effectPoses:{[template.poseData]:read('artifacts/'+id.toLowerCase()+'/'+template.poseData)},samplers:{},assetBase:base,effectQuality:{level:'medium',particleDivisor:8},
      loadContainer:async(assetBase,file)=>{decodes++;return loadPoseContainer(scene,resolve(root,'artifacts',assetBase.replace('/assets/',''),file));}});
    const slots=[{skillId:1}];assert.equal(view.proof().meshInstances,0);
    await view.prewarmResources(slots);const minimal=view.proof().meshInstances;assert.equal(minimal,template.fields.DrawCount??1);
    await view.prewarmResources(slots);assert.equal(view.proof().meshInstances,minimal);
    const actors=[{id:'one',team:0,loadout:slots},{id:'two',team:1,loadout:slots}];
    await view.prewarmActors(actors);const full=view.proof().meshInstances;assert.ok(full>minimal);
    assert.notEqual(view.proof().meshPoolBudgets[name].budgetScope,'resource-materials-only');
    await view.prewarmResources(slots);await view.prewarmActors(actors);assert.equal(view.proof().meshInstances,full);
    assert.equal(view.proof().activeParticles,0);assert.equal(decodes,1);view.clear();
  }
});

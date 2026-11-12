import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {AssetContainer,Animation,AnimationGroup,Bone,Matrix,MeshBuilder,MorphTarget,MorphTargetManager,
  NullEngine,PBRMaterial,RenderTargetTexture,Scene,Skeleton,Texture,TransformNode,Vector3} from '@babylonjs/core';
import {createActorView,sampleAnimation} from '../../apps/web/actor-presentation.mjs';
import {createProfessionSwitch} from '../../apps/web/profession-switch.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const game=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
function sourceThroughClosing(startToken,closingToken){
  const start=game.indexOf(startToken),end=game.indexOf(closingToken,start);
  assert.ok(start>=0&&end>start,'actual game lifecycle source has a complete '+startToken+' boundary');
  return game.slice(start,end+closingToken.length);
}
// Stop at the production function's own closing indentation. UI asset loading
// and adjacent handlers can change without becoming part of this VM fixture.
const prepareSource=sourceThroughClosing('  onlineFactory.prepareViews=','\n  };');
const returnSource=sourceThroughClosing('function returnToLobby(){','\n}');
const modeGuardSource=game.match(/^const isPvpMode=.*;$/m)?.[0];
assert.ok(modeGuardSource,'exercise the actual online/practice2v2 mode guard');
const resources=scene=>Object.fromEntries(['meshes','transformNodes','skeletons','animationGroups','materials','multiMaterials','textures','morphTargetManagers','geometries'].map(key=>[key,scene[key].length]));

test('actual Babylon view disposal reclaims clone resources and preserves source/shared resources and another view',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const container=new AssetContainer(scene),root=new TransformNode('source-root',scene),boneNode=new TransformNode('Bip01',scene);
    boneNode.parent=root;
    const mesh=MeshBuilder.CreateBox('source-body',{},scene);mesh.parent=boneNode;
    const material=new PBRMaterial('source-material',scene),texture=new Texture(null,scene),sharedTarget=new RenderTargetTexture('source-shared-target',16,scene);
    material.albedoTexture=texture;material.reflectionTexture=sharedTarget;mesh.material=material;
    const skeleton=new Skeleton('source-skin','source-skin',scene),bone=new Bone('source-bone',skeleton,null,Matrix.Identity());
    bone.linkTransformNode(boneNode);mesh.skeleton=skeleton;
    const morphs=new MorphTargetManager(scene),target=MorphTarget.FromMesh(mesh,'source-morph');morphs.addTarget(target);mesh.morphTargetManager=morphs;
    const animation=new Animation('source-motion','position',60,Animation.ANIMATIONTYPE_VECTOR3);
    animation.setKeys([{frame:0,value:Vector3.Zero()},{frame:60,value:new Vector3(10,0,0)}]);
    const group=new AnimationGroup('Wait',scene);group.addTargetedAnimation(animation,boneNode);
    Object.assign(container,{rootNodes:[root],transformNodes:[root,boneNode],meshes:[mesh],skeletons:[skeleton],animationGroups:[group],
      materials:[material],textures:[texture,sharedTarget],morphTargetManagers:[morphs]});
    const sourceCounts=resources(scene),first=createActorView(container,scene,'first'),second=createActorView(container,scene,'second');
    assert.notEqual(first.meshes[0].material,material);
    assert.notEqual(first.meshes[0].material.albedoTexture,texture);
    assert.equal(first.meshes[0].material.reflectionTexture,sharedTarget,'render targets are shared by Babylon material cloning');
    assert.equal(first.meshes[0].geometry,mesh.geometry,'mesh clones share source geometry');
    const secondCounts=resources(scene),ownedCounts=Object.fromEntries(Object.keys(sourceCounts).map(k=>[k,(secondCounts[k]-sourceCounts[k])/2]));
    const secondMaterial=second.meshes[0].material,secondSkin=second.skeletons[0],secondGroup=second.groups[0];
    sampleAnimation(first,'Wait',.2);sampleAnimation(second,'Wait',.7);
    const cloneSkin=first.skeletons[0],cloneGroup=first.groups[0],cloneRoot=first.root;
    first.dispose();first.dispose();
    assert.ok(cloneRoot.isDisposed());assert.ok(first.disposed);assert.equal(first.meshes.length,0);assert.equal(first.clips.size,0);
    assert.ok(!scene.skeletons.includes(cloneSkin));assert.ok(!scene.animationGroups.includes(cloneGroup));
    for(const key of Object.keys(sourceCounts))assert.equal(resources(scene)[key],sourceCounts[key]+ownedCounts[key],key);
    assert.ok(!root.isDisposed());assert.ok(!mesh.isDisposed());assert.ok(!mesh.geometry.isDisposed());
    assert.ok(scene.materials.includes(material));assert.ok(scene.textures.includes(texture));assert.ok(scene.textures.includes(sharedTarget));
    assert.ok(scene.materials.includes(secondMaterial));assert.ok(scene.skeletons.includes(secondSkin));assert.ok(scene.animationGroups.includes(secondGroup));
    sampleAnimation(second,'Wait',.9);assert.equal(second.bip01.position.x,9);
    second.dispose();assert.deepEqual(resources(scene),sourceCounts);
    const third=createActorView(container,scene,'third');sampleAnimation(third,'Wait',.5);assert.equal(third.bip01.position.x,5);
    third.dispose();assert.deepEqual(resources(scene),sourceCounts,'source container remains usable after releasing prior clones');
  }finally{scene.dispose();engine.dispose();}
});

test('converted original RF and core clones return to practice resource counts across repeated matches',
  {skip:!existsSync(new URL('../../artifacts/rf/rf-runtime.glb',import.meta.url))},async()=>{
    const engine=new NullEngine(),scene=new Scene(engine);engine.getCaps().maxVertexUniformVectors=1024;
    try{
      const path=name=>new URL('../../artifacts/rf/'+name,import.meta.url);
      const body=await loadPoseContainer(scene,path('rf-runtime.glb'));
      const core=await loadPoseContainer(scene,path('effects/Motion_Raven_RageMode_Nasod.glb'));
      const pose=JSON.parse(gunzipSync(readFileSync(path('pose-tracks.json.gz'))));
      const corePose=JSON.parse(readFileSync(path('effects/Motion_Raven_RageMode_Nasod.pose.json')));
      const practice=createActorView(body,scene,'practice',.01,pose);practice.core=createActorView(core,scene,'practice-core',.01,corePose);
      const baseline=resources(scene),practiceSkeleton=practice.skeletons[0],practiceGroup=practice.groups[0];
      for(let round=0;round<3;round++){
        const online=Array.from({length:4},(_,i)=>{
          const view=createActorView(body,scene,'round-'+round+'-player-'+i,.01,pose);
          view.core=createActorView(core,scene,view.id+'-core',.01,corePose);return view;
        });
        for(const view of online){sampleAnimation(view,'Wait',.1,true);view.dispose();}
        assert.deepEqual(resources(scene),baseline,'no retained mesh/skeleton/group across round '+round);
        assert.ok(scene.skeletons.includes(practiceSkeleton));assert.ok(scene.animationGroups.includes(practiceGroup));
        assert.equal(sampleAnimation(practice,'Wait',.2,true),true);
      }
      practice.dispose();assert.equal(practice.core,null);
    }finally{scene.dispose();engine.dispose();}
  });

function fakeView(id,log=[]){return {id,root:{setEnabled(enabled){log.push([id,'enabled',enabled]);}},disposeCount:0,
  dispose(){this.disposeCount++;this.core?.dispose();log.push([id,'dispose']);}};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function preparation(createView,mode='online'){
  const state={views:new Map(),onlineMatch:{id:'first'},simulation:{id:'first'},mode,authoritativePvp:{phase:'intro'},
    practiceSnapshot:{actors:[{id:'practice'}]},effectsView:{async prewarmActors(){}},hitLighting:{async prewarm(){}},nameplates:{clear(){}},weaponTrails:{clear(){}},
    prepareActorCostume:async()=>null,publishCostume(){}};
  const fn=new Function('state','createView',`with(state){const onlineFactory={},bodyContainer={},coreContainer={},characterPose={},corePose={},professionId='RF',professionAssets=new Map([['RF',{bodyContainer,coreContainer,characterPose,corePose}]]),styleCharacter=()=>{},styleNasodCore=view=>view;${modeGuardSource}${prepareSource}return onlineFactory.prepareViews;}`)(state,createView);
  return {state,fn,context:()=>({match:state.onlineMatch,simulation:state.simulation})};
}

test('an invalidated body load is disposed before publication and never disposes a newer match/practice view with the same id',async()=>{
  const wait=deferred(),old=fakeView('old-body'),newer=fakeView('replacement');let calls=0;
  const {state,fn,context}=preparation(()=>{calls++;return wait.promise;});
  const promise=fn([{id:'reused'}],context());
  await Promise.resolve();
  state.onlineMatch={id:'new'};state.simulation={id:'new'};state.views.set('reused',newer);wait.resolve(old);
  assert.equal(await promise,false);assert.equal(calls,1,'do not begin a core load after the match changes');
  assert.equal(old.disposeCount,1);assert.equal(newer.disposeCount,0);assert.equal(state.views.get('reused'),newer);
});

test('returning to lobby during core load releases pending body/core and earlier actors without publication',async()=>{
  const wait=deferred(),first=fakeView('first'),firstCore=fakeView('first-core'),second=fakeView('second'),secondCore=fakeView('second-core');
  let calls=0;const {state,fn,context}=preparation(()=>[Promise.resolve(first),Promise.resolve(firstCore),Promise.resolve(second),wait.promise][calls++]);
  const promise=fn([{id:'a'},{id:'b'}],context());
  for(let n=0;calls<4&&n<20;n++)await Promise.resolve();assert.equal(calls,4,'view preparation reaches the deferred core load');
  assert.equal(state.views.size,0,'keep the batch private until all actor views are ready');
  state.mode='lobby';state.onlineMatch=null;wait.resolve(secondCore);
  assert.equal(await promise,false);
  for(const view of [first,firstCore,second,secondCore])assert.equal(view.disposeCount,1,view.id);
  assert.equal(state.views.size,0);
});

test('preparation failure cleans up its own batch; a valid batch reuses existing views and resolves duplicate publication safely',async()=>{
  const first=fakeView('first'),firstCore=fakeView('first-core'),second=fakeView('second');let calls=0;
  const {state,fn,context}=preparation(()=>{const view=[first,firstCore,second][calls++];return view?Promise.resolve(view):Promise.reject(new Error('core-load-failed'));});
  const existing=fakeView('practice');state.views.set('practice',existing);
  await assert.rejects(fn([{id:'practice'},{id:'a'},{id:'b'}],context()),/core-load-failed/);
  for(const view of [first,firstCore,second])assert.equal(view.disposeCount,1,view.id);
  assert.equal(existing.disposeCount,0);assert.deepEqual([...state.views.keys()],['practice']);
  const duplicate=fakeView('duplicate'),newCore=fakeView('duplicate-core'),winner=fakeView('published-by-other-loader');
  const good=preparation(async(_container,id)=>id.endsWith('-core')?newCore:duplicate);
  const pending=good.fn([{id:'a'}],good.context());await Promise.resolve();good.state.views.set('a',winner);
  assert.equal(await pending,true);assert.equal(good.state.views.get('a'),winner);assert.equal(winner.disposeCount,0);
  assert.equal(duplicate.disposeCount,1);assert.equal(newCore.disposeCount,1);
});

test('a guard after publication releases obsolete actors while preserving views reused by a newer match or practice',async()=>{
  const {state,fn,context}=preparation(async(_container,id)=>fakeView(id),'practice2v2');
  const lease=context();assert.equal(await fn([{id:'gone'},{id:'shared'},{id:'practice'}],lease),true);
  const obsolete=state.views.get('gone'),obsoleteCore=obsolete.core,shared=state.views.get('shared'),practice=state.views.get('practice');
  state.onlineMatch={id:'new',players:[{id:'shared'},{id:'newcomer'}]};state.simulation={id:'new'};
  lease.releaseUnusedViews();
  assert.equal(obsolete.disposeCount,1);assert.equal(obsoleteCore.disposeCount,1);
  assert.equal(shared.disposeCount,0);assert.equal(practice.disposeCount,0);
  assert.deepEqual([...state.views.keys()],['shared','practice']);
  lease.releaseUnusedViews();assert.equal(obsolete.disposeCount,1,'release is idempotent');
});

for(const rejected of [false,true])test(`a match canceled during hit shader preparation ${rejected?'rejects':'resolves'} without publishing readiness or releasing newer views`,async()=>{
  const wait=deferred(),{state,fn,context}=preparation(async(_container,id)=>fakeView(id));let started=false;
  state.hitLighting.prewarm=async actors=>{assert.deepEqual(actors.map(a=>a.id),['old']);started=true;await wait.promise;};
  const lease=context(),job=fn([{id:'old'}],lease);
  for(let i=0;!started&&i<30;i++)await Promise.resolve();assert.equal(started,true);
  const old=state.views.get('old'),newer=fakeView('newer');state.onlineMatch={id:'second',players:[{id:'newer'}]};state.simulation={id:'second'};state.views.set('newer',newer);
  if(rejected){wait.reject(Error('retired-shader-failed'));await assert.rejects(job,/retired-shader-failed/);}
  else{wait.resolve();assert.equal(await job,false,'obsolete prepared shaders cannot advance a later match');}
  lease.releaseUnusedViews();assert.equal(old.disposeCount,1);assert.equal(newer.disposeCount,0);assert.equal(state.views.get('newer'),newer);
});

test('returnToLobby clears dependent presentation first and keeps only practice actor views over repeated account sets',()=>{
  const log=[],practice=fakeView('practice',log),practiceCore=fakeView('practice-core',log);practice.core=practiceCore;
  const snapshot={actors:[{id:'practice',loadout:[]}]},sim={state:{actors:snapshot.actors},restore(){log.push(['restore']);},actor:()=>snapshot.actors[0]};
  const state={lobbyHandoff:null,views:new Map([['practice',practice]]),practiceSnapshot:snapshot,practiceSimulation:sim,simulation:sim,
    resultPresentation:{clear(){}},cameraHandoff:{reset(){}},spectatorCamera:{reset(){log.push(['spectator','clear']);}},spectatorHint:{hidden:false},cameraTargetId:'dead-player',cameraHeld:true,cameraTracking:{},
    matchEntry:{clear(){}},pendingLoadingState:null,
    practiceGeneration:0,pvpPractice:null,ownershipMode:'local-owner-v1',
    ownershipSync:{clear(){log.push(['ownership','clear']);}},ownedPresentation:{clear(){log.push(['owned-presentation','clear']);}},
    remotePackets:new Map(),remoteDevices:new Map(),remoteHeld:new Map(),prediction:{clear(){}},online:{clearMatch(){},api:()=>Promise.resolve({})},
    closeDiagnostics(){},inputBuffer:{clear(){}},keyTranslator:{releaseAll(){}},
    nameplates:{clear(){log.push(['nameplates','clear']);}},weaponTrails:{clear(){log.push(['trails','clear']);},setLocalActor(){}},
    effectsView:{clear(){log.push(['effects','clear']);}},worldColorView:{clear(){}},mapLoading:false,mapGeneration:0,damageNumbers:{clear(){log.push(['numbers','clear']);}},pvpHud:{clear(){}},
    currentMapVersions:{sceneId:'fixture-map'},lobby:{setPracticeMap(){},status(){},show(){},history(){},error(){}},updateModeControls(){},rebuildSlots(){},updateHud(){},actorsNow:()=>snapshot.actors,resetDisplayClock(){},say(){},
    onlineMatch:{},onlineTransportError:null,localPlayerId:'a',lastServerSequence:3,authoritativePvp:{},configurationLocked:true,mode:'online',paused:false,baselineSnapshot:{},loadout:[]};
  state.professionSwitch=createProfessionSwitch({current:()=> 'RF',canCommit:()=>false,commit:()=>assert.fail('no pending profession switch')});
  const run=new Function('state',`with(state){${returnSource}return returnToLobby;}`)(state);
  for(let round=0;round<3;round++){
    const body=fakeView('account-'+round,log),core=fakeView('account-'+round+'-core',log);body.core=core;
    state.mode=round%2?'practice2v2':'online';state.onlineMatch={id:'round-'+round};state.ownershipMode='local-owner-v1';
    state.pvpPractice={stop(){log.push(['pvp-practice','stop']);}};
    state.views.set(body.id,body);log.length=0;run();
    assert.deepEqual([...state.views.keys()],['practice']);assert.equal(practice.disposeCount,0);assert.equal(practiceCore.disposeCount,0);
    assert.equal(body.disposeCount,1);assert.equal(core.disposeCount,1);
    for(const kind of ['spectator','pvp-practice','ownership','owned-presentation','nameplates','trails','effects','numbers']){
      const cleared=log.findIndex(row=>row[0]===kind),disposed=log.findIndex(row=>row[1]==='dispose');
      assert.ok(cleared>=0&&cleared<disposed,kind+' must clear before actor disposal');
    }
    assert.equal(state.simulation,sim);assert.equal(state.onlineMatch,null);assert.equal(state.mode,'lobby');
    assert.equal(state.practiceGeneration,round+1);assert.equal(state.pvpPractice,null);assert.equal(state.ownershipMode,null);
    assert.equal(state.spectatorHint.hidden,true);assert.equal(state.cameraTargetId,null);assert.equal(state.cameraHeld,false);assert.equal(state.cameraTracking,null);
  }
});

test('a battle launched by the light lobby delegates to its map-only retirement transaction',()=>{
 const calls=[],state={lobbyHandoff:{intent:{kind:'practice'}},returnToLightLobby(){calls.push('retire-map-only');},location:{reload(){assert.fail('same document return');}}};
 const run=new Function('state',`with(state){${returnSource}return returnToLobby;}`)(state);
 run();assert.deepEqual(calls,['retire-map-only'],'normal lobby return delegates without accessing legacy retained fixture state');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createEffectRuntime,compileEvents,sampleEvents} from '../../packages/effect-runtime/index.mjs';
import {createAwakeningEffects,awakeningActorEligible,awakeningAttachmentsFor} from '../../apps/web/awakening-effects.mjs';
import {createVeteranOverheatIcons,veteranOverheatIconBirths} from '../../apps/web/vc-overheat-icons.mjs';
import {collectEffectTemplates} from '../../apps/web/effect-prewarm.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {writeNativeEffectBoneMatrix} from '../../apps/web/native-effect-bone-matrix.mjs';
import {activateVeteranOverheat} from '../../packages/combat-core/vc-skills.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {vcFixture,vcProfile,vcEffectPoses} from '../helpers/vc-fixture.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const vcEffectIndex=read('artifacts/vc/fx/index.json');

test('mixed profession views route Raven awakening to RF and VC exactly once',()=>{
  for(const [unitClass,professionId] of [[100,'LK'],[107,'RF'],[115,'VC']]){
    for(const actorProfession of ['LK','RF','VC'])assert.equal(
      awakeningActorEligible({target:{unitClass}},{professionId:actorProfession}),professionId===actorProfession);
  }
  assert.equal(awakeningActorEligible({target:{unitClass:107}},{}),true);
  assert.equal(awakeningActorEligible({target:{unitClass:115}},{}),false);
  assert.equal(awakeningActorEligible({target:{unitClass:999}},{professionId:'VC'}),false);
});

test('VC preloads both original minor Raven aura templates by shared RF texture reference',()=>{
  const source=read('contracts/rf-awakening-fx-index.json'),vc=read('artifacts/vc/fx/index.json');
  const wanted=collectEffectTemplates(vcProfile,vc,[]);
  for(const name of ['HyperBoostRightBlack','HyperBoostLeftBlack']){
    assert.ok(wanted.has(name));
    const a=vc.templates[name],b=source.templates[name];
    for(const key of ['fields','events','source','declarationSha256'])assert.deepEqual(a[key],b[key]);
    assert.equal(a.textures['Energy.dds'].file,'../rf/'+b.textures['Energy.dds'].file);
  }
});

test('actual VC bones sustain four awakening flames through attacks, facing changes and restore',()=>{
  const {sim,a}=vcFixture(),runtime=createEffectRuntime({index:vcEffectIndex}),aura=createAwakeningEffects({runtime,
    samplers:{effectAnchorSampler:sim.effectAnchorSampler},maxHyperModeTime:vcProfile.components.MAX_HYPER_MODE_TIME,
    eligibleActor:actor=>awakeningActorEligible(vcProfile,actor),attachments:awakeningAttachmentsFor(vcProfile)});
  a.awakening.remaining=60;const tick=()=>{aura.step(sim.state);runtime.step(1/60,sim.state);};
  for(let i=0;i<20;i++)tick();
  assert.equal(aura.proof().emitters,4);assert.ok(runtime.count>0);
  const handles=[...runtime.emitters.keys()];
  for(const facing of [-1,1])for(const state of ['RSI_WAIT','RSI_DASH_JUMP_COMBO_Z','RVC_SI_SA_IGNITION_CROW']){
    sim.enter(a,state,'test');a.facing=facing;tick();
    assert.deepEqual([...runtime.emitters.keys()],handles);
    for(const attachment of aura.proof().attachments)assert.deepEqual(attachment.position,
      sim.effectAnchorSampler({definition:{BONE_NAME:attachment.bone}},a).position);
  }
  aura.clear();assert.equal(runtime.count,0);tick();assert.equal(aura.proof().emitters,4);
  a.awakening.remaining=0;tick();assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
  assert.deepEqual([...runtime.notes],[]);
});

test('source overheat notice preserves original DDS, authored 250 to 150 size and half-second fade',()=>{
  const t=vcEffectIndex.templates.WeaponTaker_Overheat;
  assert.equal(t.textures['Raven_overheat.dds'].source.sha256,'50e8c25a9806d110b0ee3c87525859108f21b725f867eae279813af64387b94f');
  assert.equal(t.fields.Lifetime,.5);assert.equal(t.fields.TriggerCount,1);assert.equal(t.fields.NumParticles,1);
  const c=compileEvents(t,()=>.5);
  assert.deepEqual(sampleEvents(c,0).Size,[250,250,1]);
  assert.deepEqual(sampleEvents(c,.05).Size,[150,150,1]);assert.equal(sampleEvents(c,.5).Color[3],0);
  assert.deepEqual(veteranOverheatIconBirths({position:[10,20,30],direction:[.6,0,.8],size:2}),[
    {name:'WeaponTaker_Overheat',position:[10,20,30]},
    {name:'Overlap_EDT_Emoticon_2_OverHeat',position:[40,40,70]},
  ]);
  assert.equal(veteranOverheatIconBirths({position:[0,0,0],size:1}),null);
  assert.equal(veteranOverheatIconBirths({position:[0,0,Infinity],size:0}),null);
});

test('overheat notices replace old stages, ignore replay, expire and never grow across repeated casts',()=>{
  const runtime=createEffectRuntime({index:vcEffectIndex,effectQuality:{level:'low',particleDivisor:8}});
  const icons=createVeteranOverheatIcons({runtime}),actor={id:'vc',professionId:'VC',hp:1},state={actors:[actor]};
  const event=(id,size=0)=>({type:'overheatIcon',actorId:'vc',eventId:id,position:[10,20,30],direction:[1,0,0],size});
  const tick=n=>{for(let i=0;i<n;i++){icons.step(state);runtime.step(1/60,state);}};
  for(let i=1;i<=30;i++){
    icons.event(event(i,1+(i%3)),state);tick(3);
    assert.equal(runtime.count,2,'original one-shot notices survive global particle quality reduction');
    const ids=[...runtime.emitters.keys()];
    assert.equal(icons.event(event(i),state),false);assert.deepEqual([...runtime.emitters.keys()],ids);
    assert.equal(icons.proof().liveHandles,2);
  }
  tick(180);assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);assert.equal(icons.proof().liveHandles,0);
  icons.event(event(100,0),state);tick(3);assert.equal(runtime.count,1);
  actor.hp=0;icons.step(state);assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
  icons.clear();assert.equal(icons.proof().actors,0);assert.deepEqual([...runtime.notes],[]);
});

test('actual VC effect view draws aura, both arm flames and notice while full forearm matrix follows turns',async t=>{
  const f=vcFixture(),engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('vc-presentation',new Vector3(0,0,10),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>loadPoseContainer(target,resolve('artifacts/vc',file)));
  const names=['RVC_OverHeat_Object_Start','RVC_OverHeat_Object_End','RVC_OverHeat_Main_Effect',
    'RVC_buff_OverHit_P01','RVC_buff_OverHit_P02','HyperBoostRightBlack','HyperBoostLeftBlack','WeaponTaker_Overheat'];
  const profile={...vcProfile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:names};
  const view=await createEffectsView({scene,engine,profile,index:{...vcEffectIndex,templates:Object.fromEntries(names.map(n=>[n,vcEffectIndex.templates[n]]))},
    effectPoses:vcEffectPoses,samplers:{effectAnchorSampler:f.sim.effectAnchorSampler,effectBoneSampler:f.sim.effectBoneSampler}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  f.a.awakening.remaining=60;activateVeteranOverheat(f.sim,f.a);
  f.sim.step(1/60,{}, {snapshot:false});
  for(const e of f.sim.drainEvents())view.event(e,f.sim.state);
  let noticeId=10000;
  for(const facing of [-1,1]){
    f.a.facing=facing;f.a.animationTime=.2;
    view.event({type:'overheatIcon',actorId:'vc',eventId:noticeId++,position:[f.a.x,f.a.y+200,f.a.z],direction:[1,0,0],size:0},f.sim.state);
    for(let frame=0;frame<20;frame++){view.step(1/60,f.sim.state);view.render();}
    const proof=view.proof({includeDraws:true});
    assert.equal(proof.awakening.emitters,4);assert.ok(proof.awakening.activeParticles>0);
    assert.ok(proof.nativeParticleDraws.counts.RVC_buff_OverHit_P01>0,JSON.stringify({counts:proof.nativeParticleDraws.counts,notes:proof.unsupported,parents:proof.activeEffectParents}));
    assert.ok(proof.nativeParticleDraws.counts.RVC_buff_OverHit_P02>0);
    assert.equal(proof.nativeParticleDraws.counts.WeaponTaker_Overheat,1);
    const definition={BONE_NAME:'Bip01_L_Forearm',TRACE_MATRIX:1};
    const matrix=f.sim.effectAnchorSampler({definition},f.a).matrix;
    const expected=writeNativeEffectBoneMatrix(matrix,new Array(16));
    const rendered=scene.transformNodes.find(n=>n.name.startsWith('fx-RVC_OverHeat_Object_Start-')&&n.name.endsWith('-world')&&n.isEnabled());
    assert.ok(rendered);
    for(const [i,value]of rendered.computeWorldMatrix(true).asArray().entries())assert.ok(Math.abs(value-expected[i])<1e-5,'matrix '+i);
  }
});

test('late remote notices retain only their remaining lifetime while local notices keep the authored lifetime',()=>{
  const runtime=createEffectRuntime({index:vcEffectIndex}),icons=createVeteranOverheatIcons({runtime});
  const state={actors:[{id:'vc',professionId:'VC',hp:1}]};
  const event={type:'overheatIcon',actorId:'vc',eventId:1,position:[10,20,30],direction:[1,0,0],size:2,remaining:.2};
  const tick=n=>{for(let i=0;i<n;i++){icons.step(state,1/60);runtime.step(1/60,state);}};
  assert.equal(icons.event(event,state),true);tick(11);assert.equal(runtime.count,2);
  tick(1);assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
  assert.equal(icons.event(event,state),false,'expired event cannot be restored by replay');
  assert.equal(icons.event({...event,eventId:2,remaining:0},state),false);
  assert.equal(icons.event({...event,eventId:2,remaining:NaN},state),false);
  assert.equal(icons.event({...event,eventId:2,remaining:undefined,size:0},state),true);
  tick(20);assert.equal(runtime.count,1,'local notice still follows the original half-second sequence');
  tick(12);assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
});

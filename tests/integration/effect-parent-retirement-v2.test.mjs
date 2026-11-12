/** Actual target declarations/converted meshes; these assertions describe
 * current presentation ownership, not measured original-client timing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {singlePlayMeshPeriod} from '../../packages/combat-core/literal-mesh-clock.mjs';

const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p)));
const rf=read('packages/combat-core/rf-profile.json'),rfIndex=read('contracts/rf-fx-index.json');
const actor=()=>({id:'owner',professionId:'RF',x:0,y:0,z:0,hp:100,facing:1,stateSerial:1,awakening:{remaining:0}});
const bounded=profile=>({...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]});
function closure(index,names){
  const templates={},queue=[...names];
  for(const name of queue){if(templates[name])continue;const t=index.templates[name];assert.ok(t,name);templates[name]=t;
    for(const key of ['TraceParticleList','FinalParticleList'])queue.push(...(t.repeated?.[key]??(t.fields[key]?[t.fields[key]]:[])));
  }
  return {templates};
}
async function viewFor(t,{profile=rf,index=rfIndex,names,samplers={effectAnchorSampler:(_parent,a)=>({position:[a.x,a.y,a.z]})},effectPoses={},assetProfession='rs'}){
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('retirement-camera',new Vector3(0,0,10),scene);
  const view=await createEffectsView({scene,engine,profile:bounded(profile),index:closure(index,names),samplers,effectPoses,
    loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(root,'artifacts',assetProfession,file))});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});return {view,scene};
}
const birth=(name,id=1,definition={})=>({type:'effectStarted',actorId:'owner',effectId:id,name,definition,birthAnchor:{position:[0,0,0],facing:1}});

test('pinned destruction consumer deletes the damage main mesh independently of passive AutoDie tails',()=>{
  const bytes=readFileSync(resolve(root,'.cache/native-reference/X2Lib/X2DamageEffect.cpp'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'8a76540f2d6e318ce474cf6d63e1822be3d90b880f647bae480f26ea3d6afed8');
  const text=bytes.toString('latin1'),at=text.indexOf('CX2DamageEffect::CEffect::~CEffect()');
  const body=text.slice(at,at+3400);
  assert.match(body,/GetMajorXMeshPlayer\(\)->DestroyInstanceHandle\( m_hMeshInstHandle \)/);
  assert.match(body,/m_PassiveParticleDataList/);assert.match(body,/pParticleData->DestroyParticleSequence\(\)/);
  const particle=text.slice(text.indexOf('void CX2DamageEffect::ParticleData::DestroyParticleSequence()'));
  assert.match(particle,/if\( bForceDie == true \)/);assert.match(particle,/pSeq->SetAutoDie\(\)/);
});

test('finite main AutoDie tails detach before the owner enters a later movement/action',async t=>{
  const {view}=await viewFor(t,{names:['LimitCrusherAP05']}),state={actors:[actor()],effects:[]};
  view.event(birth('LimitCrusherAP05',1,{TRACE_MORE:1}),state);view.step(.05,state);
  assert.ok(view.count>0);
  const before=view.proof({includeDraws:true}).nativeParticleDraws.sequences.find(e=>e.name==='LimitCrusherAP05').position;
  view.event({type:'effectEnded',effectId:1,reason:'time-bound'},state);
  state.actors[0].x=1500;state.actors[0].stateSerial++;
  view.step(.01,state);
  const after=view.proof({includeDraws:true}).nativeParticleDraws.sequences.find(e=>e.name==='LimitCrusherAP05').position;
  assert.deepEqual(after,before,'stopped main sequence retains its last source position');
  assert.ok(view.count>0,'authored finite particles and Trace-child tails remain alive');
  for(let i=0;i<180;i++)view.step(1/60,state);
  assert.equal(view.count,0);assert.equal(view.performance().fxActiveParents,0);
});

test('completed independent main retires an orphan unbounded passive; a live combat parent still retains it',async t=>{
  const entry={PARTICLE_NAME:'EnchantHand_PM',POSITION_TYPE:3};
  assert.equal(rfIndex.templates[entry.PARTICLE_NAME].fields.TriggerTime,undefined);
  assert.equal(rfIndex.templates[entry.PARTICLE_NAME].fields.TriggerCount,undefined);
  const profile={...rf,damageEffects:{fixture:{raw:{MAIN_EFFECT_NAME:'LimitCrusherAP05',PASSIVE_PARTICLE0:entry}}}};
  const {view}=await viewFor(t,{profile,names:['LimitCrusherAP05','EnchantHand_PM']}),state={actors:[actor()],effects:[]};
  for(let cycle=0;cycle<30;cycle++){
    const id=cycle+1;state.effects=[{id,ownerId:'owner'}];view.event(birth('fixture',id),state);
    for(let i=0;i<120;i++)view.step(1/60,state);
    assert.equal(view.performance().fxActiveParents,1,'live combat parent retains later original particle routes');
    assert.ok(view.count>0,'the live original passive remains emitting');
    state.effects=[];view.step(1/60,state);
    assert.equal(view.performance().fxActiveParents,0,'ended independent main no longer drives an orphan passive');
    assert.ok(view.count>0,'AutoDie preserves existing source particle tails');
    for(let i=0;i<240;i++)view.step(1/60,state);
    assert.equal(view.count,0);assert.equal(view.performance().fxEmitters,0);
  }
});

for(const name of ['DamageEffect_SA_EMK_StromBladeCenter','DamageEffect_SA_EMK_StromBlade']){
  test(`late RS ${name} starts at its retained original mesh phase and stops once`,async t=>{
    const profile=read('packages/combat-core/rs-profile.json'),index=read('artifacts/rs/fx/index.json');
    const main=profile.damageEffects[name].raw.MAIN_EFFECT_NAME,template=index.templates[main];
    const period=singlePlayMeshPeriod(profile.effectTemplates[main]);assert.ok(period>0);assert.equal(template.fields.PlayCount,1);
    const effectPoses={[template.poseData]:read('artifacts/rs/'+template.poseData)};
    const {view,scene}=await viewFor(t,{profile,index,names:[main],effectPoses});
    const a={...actor(),professionId:'RS'},clock=Math.fround(period*.7),anchor={position:[400,200,0],facing:1,rotation:[0,0,0]};
    const current={id:1,ownerId:a.id,animationTime:clock,elapsed:clock,sourceMeshGlobalTime:clock,
      sourcePosedAnchor:anchor,currentAnchor:anchor,birthAnchor:anchor,definition:{TRACE:1}};
    const state={actors:[a],effects:[current]},before=structuredClone(state);
    view.event({...birth(name),birthAnchor:anchor,definition:current.definition},state);view.step(1/60,state);view.render();
    const sample=view.sourceMeshClocks().find(e=>e.name===main);assert.ok(sample);
    assert.equal(sample.animationTime,clock,'network age owns source animation instead of a fresh local period');
    assert.equal(sample.globalTime,clock);assert.deepEqual(state,before,'presentation never edits combat clocks');
    assert.ok(scene.transformNodes.some(n=>n.name.startsWith('fx-')&&n.isEnabled()));
    view.event({type:'effectEnded',effectId:1,reason:'network-owner-effect-ended'},state);
    assert.equal(view.count,0,'the ended source main cannot replay a remaining local animation');
    // The body snapshot that accompanied the end can still contain the old
    // record. It must not restore either its source clock or owner attachment.
    a.x+=1500;current.sourcePosedAnchor={...anchor,position:[1900,200,0]};current.currentAnchor=current.sourcePosedAnchor;
    for(let i=0;i<120;i++){view.step(1/60,state);view.render();}
    assert.equal(view.count,0);assert.equal(view.performance().fxActiveParents,0);assert.deepEqual(view.sourceMeshClocks(),[]);
    assert.equal(scene.transformNodes.some(n=>n.name.startsWith('fx-')&&n.isEnabled()),false);
  });
}

test('per-packet attachment lookup refreshes replaced effect lists on the same mutable state object',async t=>{
  const {view}=await viewFor(t,{names:['LimitCrusherAP05']}),a=actor(),state={actors:[a],effects:[]};
  const current=x=>({id:1,ownerId:a.id,sourcePosedAnchor:{position:[x,0,0]},definition:{TRACE:1}});
  state.effects=[current(40)];view.event(birth('LimitCrusherAP05',1,{TRACE_MORE:1}),state);view.step(.02,state);
  assert.deepEqual(view.proof({includeDraws:true}).nativeParticleDraws.sequences.find(e=>e.name==='LimitCrusherAP05').position,[40,0,0]);
  state.effects=[current(300)];view.step(.01,state);
  assert.deepEqual(view.proof({includeDraws:true}).nativeParticleDraws.sequences.find(e=>e.name==='LimitCrusherAP05').position,[300,0,0]);
});

test('real effect event batches build one lookup and refresh same-length actor replacements between bursts',async t=>{
  const {view}=await viewFor(t,{names:['LimitCrusherAP05']}),state={actors:[{...actor(),landPosition:[0,40,0]}],effects:[]};
  let actorsScanned=0,effectsScanned=0;
  const actorIterator=state.actors[Symbol.iterator],effectIterator=state.effects[Symbol.iterator];
  state.actors[Symbol.iterator]=function(){actorsScanned++;return actorIterator.call(this);};
  state.effects[Symbol.iterator]=function(){effectsScanned++;return effectIterator.call(this);};
  const dispatch=(first,count)=>{
    view.beginEventBatch(state);
    try{for(let i=first;i<first+count;i++)view.event(birth('LimitCrusherAP05',i),state);}
    finally{view.endEventBatch();}
  };
  dispatch(1,20);assert.equal(actorsScanned,1);assert.equal(effectsScanned,1);
  const first=view.proof({includeDraws:true}).nativeParticleDraws.sequences;assert.equal(first.length,20);
  assert.ok(first.every(sequence=>sequence.landPosition===40));
  state.actors[0]={...actor(),landPosition:[0,300,0]};dispatch(21,1);assert.equal(actorsScanned,2);assert.equal(effectsScanned,2);
  assert.equal(view.proof({includeDraws:true}).nativeParticleDraws.sequences.at(-1).landPosition,300);
  state.actors[0]={...actor(),landPosition:[0,600,0]};view.event(birth('LimitCrusherAP05',22),state);
  assert.equal(view.proof({includeDraws:true}).nativeParticleDraws.sequences.at(-1).landPosition,600,'unbatched dispatch keeps mutable-state compatibility');
});

test('actual Windmill LT_MANUAL owner-stop retires every cast and reuses one converted mesh pool',async t=>{
  const profile=read('packages/combat-core/lk-profile.json'),index=read('artifacts/lk/fx/index.json');
  const name='Elsword_SI_SA_WindMill_Mesh01',template=index.templates[name];assert.equal(template.fields.LifeType,'LT_MANUAL');
  const effectPoses={[template.poseData]:read('artifacts/lk/'+template.poseData)};
  const {view}=await viewFor(t,{profile,index,names:[name],effectPoses,assetProfession:'lk'});
  const state={actors:[{...actor(),professionId:'LK'}],effects:[]};let instances;
  for(let cycle=0;cycle<20;cycle++){
    const id=cycle+1;state.effects=[{id,ownerId:'owner'}];view.event(birth(name,id,{TRACE:1}),state);
    for(let i=0;i<30;i++)view.step(1/60,state);
    assert.equal(view.count,1);view.event({type:'effectEnded',effectId:id,reason:'lk-source-skill-end'},state);
    assert.equal(view.count,0);assert.equal(view.performance().fxMeshesLive,0);assert.equal(view.performance().fxActiveParents,0);
    if(instances!==undefined)assert.equal(view.performance().fxPoolInstances,instances,'later manual casts reuse the first original mesh');
    instances=view.performance().fxPoolInstances;state.effects=[];
  }
  assert.equal(instances,1);
});

test('actual Maelstrom damage owner-stop retires its 9999-second invisible main helper',async t=>{
  const profile=read('packages/combat-core/is-profile.json'),index=read('artifacts/is/fx/index.json'),main='ElswordMaelStromAttackBox';
  const name=Object.entries(profile.damageEffects).find(([,row])=>row.raw.MAIN_EFFECT_NAME===main)?.[0];assert.ok(name);
  assert.equal(index.templates[main].fields.LifeTime,9999);assert.equal(index.templates[main].fields.DrawCount,0);
  const {view}=await viewFor(t,{profile,index,names:[main],assetProfession:'is'}),state={actors:[{...actor(),professionId:'IS'}],effects:[]};
  for(let cycle=0;cycle<20;cycle++){
    const id=cycle+1;state.effects=[{id,ownerId:'owner'}];view.event(birth(name,id),state);view.step(1/60,state);
    assert.equal(view.proof().activeInvisibleMeshParticles,1,'invisible source main still has a finite owning record');
    view.event({type:'effectEnded',effectId:id,reason:'template-life-time'},state);
    assert.equal(view.count,0);assert.equal(view.performance().fxEmitters,0);assert.equal(view.performance().fxActiveParents,0);
    state.effects=[];
  }
  assert.equal(view.performance().fxPoolInstances,0,'zero-output helper never needs a cloned display model');
});

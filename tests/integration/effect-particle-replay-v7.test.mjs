import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {profile,visualIndex} from '../helpers/rf-passive-fixture-v12.mjs';
import {bmSampledFixture} from '../helpers/bm-sampled-commands-v2.mjs';
import {bmProfile} from '../helpers/bm-fixture.mjs';

const root=resolve(import.meta.dirname,'../..'),moduleUrl=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const wrapper=moduleUrl(`export * from ${JSON.stringify(import.meta.resolve('@babylonjs/core'))};
import {RawTexture,Engine} from ${JSON.stringify(import.meta.resolve('@babylonjs/core'))};
export class Texture extends RawTexture {constructor(path,scene,_noMipmap,_invertY,_samplingMode,onLoad){
 super(new Uint8Array([255,255,255,255]),1,1,Engine.TEXTUREFORMAT_RGBA,scene,false,false);
 // NullEngine's raw allocation does not mark the backing texture ready. This
 // fixture supplies completed pixels, so publish the same ready/load contract
 // as a finished browser image instead of bypassing production texture waits.
 this.url=path;this.getInternalTexture().isReady=true;queueMicrotask(()=>onLoad?.());
}}`);
const preparation=moduleUrl(`export {updateControlledEffectLookup,scheduleRenderPreparation} from ${JSON.stringify(pathToFileURL(resolve(root,'apps/web/render-preparation.mjs')).href)};
export function createRenderPreparationCache(){return async()=>{};}`);
// Keep the actual production event/render/prewarm consumers. Supply a ready
// one-pixel texture because this regression concerns dispatch identity and
// draw-slot construction, not browser image loading or pixel appearance.
const source=readFileSync(resolve(root,'apps/web/effects-view.mjs'),'utf8')
 .replace("from '@babylonjs/core'",'from '+JSON.stringify(wrapper))
 .replace("from './render-preparation.mjs'",'from '+JSON.stringify(preparation))
 .replace(/(import\s+(?:[^'";]+?\s+from\s+)?)(['"])([^'"]+)\2/g,(_all,start,quote,file)=>
   start+quote+(file.startsWith('.')?pathToFileURL(resolve(root,'apps/web',file)).href:file.startsWith('data:')?file:import.meta.resolve(file))+quote);
const {createEffectsView}=await import(moduleUrl(source));

test('BM real black-hole StopEffectSet immediately removes both long emitter tails at the source stop boundary',async()=>{
  const f=bmSampledFixture({passives:[],gap:4000}),engine=new NullEngine(),scene=new Scene(engine);
  new FreeCamera('bm-stop',new Vector3(0,0,10),scene);
  const names=['Condenselight_Raven_RSM_ComboZ4a_BlackHole01','Light_Raven_RSM_ComboZ4a_BlackHole01'];
  const visual=JSON.parse(readFileSync(resolve(root,'artifacts/bm/fx/index.json')));
  const bounded={...bmProfile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyTemplates:[],resourceOnlyEffectSets:[]};
  const view=await createEffectsView({scene,engine,index:{templates:Object.fromEntries(names.map(n=>[n,visual.templates[n]]))},profile:bounded,
    effectQuality:{level:'medium',particleDivisor:8},samplers:{effectAnchorSampler:f.sim.effectAnchorSampler,effectBoneSampler:f.sim.effectBoneSampler}});
  const ids=new Set(),ended=[],step=f.sim.step.bind(f.sim);let activeBeforeStop=0;
  f.sim.step=(...args)=>{
    const result=step(...args);
    for(const event of f.sim.drainEvents()){
      if(event.type==='effectStarted'&&names.includes(event.name)){ids.add(event.effectId);view.event(event,f.sim.state);}
      if(event.type==='effectEnded'&&ids.has(event.effectId)){
        activeBeforeStop=Math.max(activeBeforeStop,view.proof().activeParticles);
        assert.equal(event.reason,'original-stop-effect-set');ended.push(event);
        view.event(event,f.sim.state);
        if(ended.length===2){assert.equal(view.proof().activeEffectParents,0);assert.equal(view.proof().activeEmitters,0);assert.equal(view.proof().activeParticles,0);}
      }
    }
    view.step(1/60,f.sim.state);return result;
  };
  try{
    f.blackHole();f.wait('RBM_COMBO_ZZZX_EXPLOSION');f.wait('RSI_WAIT');
    assert.equal(ids.size,2);assert.equal(ended.length,2);assert.ok(activeBeforeStop>0,'authored 5.9-second emitters still contain live particles at stop');
    assert.equal(view.proof().activeParticles,0);assert.equal(view.proof().activeEmitters,0);
  }finally{view.clear();scene.dispose();engine.dispose();}
});

test('original BM geometry-free attack helper creates no display lifetime while damage child ownership remains',async()=>{
  const helper=JSON.parse(readFileSync(resolve(root,'artifacts/bm/fx/index.json'))).templates.BleedingSlicerAttackBox_Ground;
  assert.equal(helper.glb,null);assert.ok(helper.poseData);assert.equal(helper.fields.PlayCount,999999);
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('camera',new Vector3(0,0,10),scene);
  const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},damageEffects:{
    Damage:{raw:{MAIN_EFFECT_NAME:helper.name,TIME_PARTICLE0:{PARTICLE_NAME:'missing',EVENT_TIME:1}}}},
    resourceOnlyEffectSets:[],resourceOnlyTemplates:[],sourceLiteralResources:[]};
  const state={actors:[{id:'bm',hp:100,x:0,y:0,z:0,facing:1}],effects:[]};
  const view=await createEffectsView({scene,engine,index:{templates:{[helper.name]:helper}},profile:bounded,
    samplers:{effectAnchorSampler:()=>({position:[0,0,0]})}});
  try{
    const event={type:'effectStarted',actorId:'bm',effectId:1,name:helper.name,definition:{EFFECT_TYPE:4},birthAnchor:{position:[0,0,0],facing:1}};
    view.event(event,state);view.step(1/60,state);
    assert.equal(view.proof().activeParticles,0);assert.equal(view.proof().activeEmitters,0);assert.equal(view.proof().activeEffectParents,0);
    view.event({...event,effectId:2,name:'Damage',definition:{}},state);
    assert.equal(view.proof().activeEffectParents,1,'future damage child dispatch retains its owner without a display mesh');
    view.event({type:'effectEnded',effectId:2},state);assert.equal(view.proof().activeEffectParents,0);
  }finally{view.clear();scene.dispose();engine.dispose();}
});

test('costume UI-major particles are prewarmed and drawn by the production effect view, then cleared',{timeout:10000},async()=>{
  const index=JSON.parse(readFileSync(resolve(root,'artifacts/costumes/particles.json'),'utf8'));
  const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},damageEffects:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('costume-camera',new Vector3(0,0,10),scene);
  const bindings=[{template:'costume:Common_Event09_Eff',position:()=>[0,100,0]},{template:'costume:Common_Event09_Eff',position:()=>[20,100,0]}];
  const state={actors:[{id:'wearer',hp:100,x:0,y:0,z:0,facing:1}],effects:[]};
  const view=await createEffectsView({scene,engine,index,profile:bounded,samplers:{},costumeParticleSampler:()=>bindings});
  try{
    assert.equal(view.proof().textureStatus.ready,1);
    assert.equal(view.proof().quadDrawSlots,2,'original DrawCount is prepared without equipping a skill');
    for(let i=0;i<45;i++)view.step(1/60,state);
    view.render();const proof=view.proof({includeDraws:true});
    assert.equal(proof.costumes.sequences,2);assert.ok(proof.nativeParticleDraws.counts[bindings[0].template]>0);
    assert.ok(proof.nativeParticleDraws.batches.length>0);assert.deepEqual(proof.unsupported,[]);
    state.actors[0].hidden=true;view.step(1/60,state);view.render();
    assert.equal(view.proof({includeDraws:true}).nativeParticleDraws.batches.length,0);
    view.clear();assert.equal(view.proof().costumes.sequences,0);assert.equal(view.count,0);
  }finally{view.clear();scene.dispose();engine.dispose();}
});

test('source DrawCount slots are ready before a first cast; repeated START keeps distinct source keys and parents',{timeout:10000},async()=>{
  const helper={...visualIndex.templates.Raven_RRF_X_Crash3,name:'Helper'},puff={...visualIndex.templates.RWT_BARRAGE_ATTACK_Flame_Smoke01,name:'Puff'};
  assert.equal(puff.fields.DrawCount,2);
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('camera',new Vector3(0,0,10),scene);
  const entry={PARTICLE_NAME:'Puff',POSITION_TYPE:3},damage={MAIN_EFFECT_NAME:'Helper',START_PARTICLE0:entry,START_PARTICLE1:entry,TIME_PARTICLE0:entry};
  const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},damageEffects:{Test:{raw:damage}},
    resourceOnlyEffectSets:[],resourceOnlyTemplates:['Helper','Puff']};
  const state={actors:[{id:'rf',hp:100,x:0,y:0,z:0,facing:1,state:'RSI_WAIT',animationTime:0}],effects:[]};
  const view=await createEffectsView({scene,engine,index:{templates:{Helper:helper,Puff:puff}},profile:bounded,
    effectQuality:{level:'medium',particleDivisor:8},samplers:{effectAnchorSampler:()=>({position:[0,0,0]}),effectBoneSampler:()=>[0,0,0]}});
  try{
    assert.equal(view.proof().quadDrawSlots,Object.keys(puff.textures).length*2);
    assert.equal(view.proof().textureStatus.ready,Object.keys(puff.textures).length);
    assert.equal(view.proof().meshInstances,0,'constant zero-output helper does not create a model clone');
    const birth=effectId=>({type:'effectStarted',actorId:'rf',effectId,name:'Test',definition:{},birthAnchor:{position:[0,0,0],facing:1}});
    view.event(birth(1),state);
    const start={type:'effectStartParticles',actorId:'rf',effectId:1,entries:[{key:'START_PARTICLE0',entry},{key:'START_PARTICLE1',entry}],mainAnchor:{position:[0,0,0]}};
    for(let i=0;i<8;i++)view.event(structuredClone(start),state);
    assert.equal(view.proof().startParticleEmitters.Puff,2,'two original keys remain two births despite sharing a template');
    assert.equal(view.proof().activeEffectParents,1);assert.equal(view.proof().activeInvisibleMeshParticles,1);
    const timed={type:'effectTimedParticles',actorId:'rf',effectId:1,eventId:100,time:1,entries:[{key:'TIME_PARTICLE0',entry}],mainAnchor:{position:[0,0,0]}};
    for(let i=0;i<8;i++)view.event(structuredClone(timed),state);
    assert.equal(view.proof().timedParticleEmitters.Puff,1);
    view.event({...timed,eventId:99},state);assert.equal(view.proof().timedParticleEmitters.Puff,1,'an older dispatch replay is ignored');
    view.event({...timed,eventId:101,time:2},state);assert.equal(view.proof().timedParticleEmitters.Puff,2,'a later native cycle may use the same source key');
    view.event({...timed,eventId:102,time:2,entries:[{key:'TIME_PARTICLE1',entry},{key:'TIME_PARTICLE2',entry}]},state);
    assert.equal(view.proof().timedParticleEmitters.Puff,4,'same-template TIME source keys remain independent');
    view.event(birth(2),state);view.event({...start,effectId:2},state);
    assert.equal(view.proof().startParticleEmitters.Puff,4,'a new parent owns new START entries');
    view.clear();assert.equal(view.count,0);assert.equal(view.proof().activeEmitters,0);assert.equal(view.proof().activeEffectParents,0);
  }finally{view.clear();scene.dispose();engine.dispose();}
});

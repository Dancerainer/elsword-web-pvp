/** Actual original GLB/pose sequences under NullEngine. Texture I/O only is
 * replaced; no original GPU/pixel claim. End checks run in the END packet. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {originalAddFixture,originalAddSamplers} from '../helpers/add-native-pose-fixture.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8')),dt=1/60;
const manifest=read('artifacts/de/manifest.json'),all=Object.assign({},...[manifest.effectAssetIndex,...manifest.visualEffectIndexes].map(p=>read('artifacts/de/'+p).templates));
async function setup(t,skillId){
 const f=originalAddFixture('DE',{skillId}),{sim,a,b}=f,profile=sim.profileFor(a);a.mp=a.mpMax;b.x=2000;
 const templates={},queue=skillId===29023?['ATT_Void_Field_P09','ATT_Void_Field_M01']:['ADE_MOONLIGHT_P01'];
 if(skillId===29023)for(const [key,value]of Object.entries(profile.damageEffects.DamageEffect_ATT_Void_Field.raw))if(/^(?:PASSIVE|TIME)_PARTICLE\d+$/.test(key))queue.push(value.PARTICLE_NAME);
 for(const name of queue){if(templates[name])continue;const value=all[name];assert.ok(value,name);templates[name]=value;
  for(const key of ['TraceParticleList','FinalParticleList'])queue.push(...(value.repeated?.[key]??(value.fields[key]?[value.fields[key]]:[])));}
 const effectPoses=Object.fromEntries(Object.values(templates).filter(v=>v.poseData).map(v=>[v.poseData,read('artifacts/de/'+v.poseData)]));
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('de-retirement-v58',new Vector3(0,31,10),scene);
 const view=await createEffectsView({scene,engine,index:{templates},effectPoses,samplers:originalAddSamplers('DE'),
  profile:{...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]},
  effectQuality:{level:'high',particleDivisor:1},assetBase:'/assets/de/',loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(root,'artifacts/de',file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 const events=[],ids=new Set();
 function present(){for(const event of sim.drainEvents()){
  events.push(event);
  if(event.type==='effectStarted'&&(event.name==='DamageEffect_ATT_Void_Field'||event.name==='ATT_Void_Field_P09'||event.name==='ADE_MOONLIGHT_P01')){ids.add(event.effectId);view.event(event,sim.state);}
  else if(ids.has(event.effectId))view.event(event,sim.state);
 }view.step(dt,sim.state);view.render({actors:sim.state.actors});scene.render();}
 function step(input={}){sim.step(dt,input,{snapshot:false});present();}
 function until(predicate,input={},limit=240){for(let i=0;i<limit&&!predicate();i++)step(input);assert.ok(predicate(),'bounded real DE state reached');}
 const draws=()=>view.proof({includeDraws:true}).nativeParticleDraws.samples;
 return {...f,profile,scene,view,events,ids,present,step,until,draws};
}

test('Void early real release destroys P09 in the first END .01 packet while the distinct carrier keeps source .98/-.03 collapse',async t=>{
 const f=await setup(t,29023),{a,sim,step,until,draws}=f;
 step({add:{pressed:['A'],held:['A']}});until(()=>a.state.endsWith('_LOOP'),{add:{held:['A']}});
 for(let i=0;i<10;i++)step({add:{held:['A']}});
 const visual=sim.state.effects.find(e=>e.name==='ATT_Void_Field_P09'),carrier=sim.state.effects.find(e=>e.name==='DamageEffect_ATT_Void_Field');
 assert.ok(visual&&carrier);assert.ok(draws().some(s=>s.name==='ATT_Void_Field_P09'&&s.effectParentId===visual.id));
 assert.ok(a.stateTime<1,'release is before the native one-second LOOP admission gate');
 until(()=>f.events.some(e=>e.type==='effectEnded'&&e.effectId===visual.id&&e.reason==='add-void-handle-stop'));
 assert.ok(a.state.endsWith('_END'));
 assert.ok(!draws().some(s=>s.effectParentId===visual.id),'DestroyInstanceHandle removes the actual original P09 mesh sequence in this presentation packet');
 assert.ok(carrier.sourceAddVoidCollapse);assert.ok(!carrier.dead,'7398 is a separate shrinking carrier, not instant all-effect deletion');
 const scale=carrier.sourceAddVoidCollapse.scale,alpha=carrier.sourceAddVoidCollapse.alpha;
 step();assert.equal(carrier.sourceAddVoidCollapse.scale,Math.fround(scale*.9800000190734863));
 assert.equal(carrier.sourceAddVoidCollapse.alpha,Math.max(0,Math.fround(alpha+Math.fround(-.03))));
 for(let i=0;i<5;i++){step();assert.ok(!draws().some(s=>s.effectParentId===visual.id));}
});

test('Void non-END interruption also destroys its visual group in the current packet without erasing the separate carrier collapse',async t=>{
 const f=await setup(t,29023);f.step({add:{pressed:['A'],held:['A']}});f.until(()=>f.a.state.endsWith('_LOOP'),{add:{held:['A']}});
 for(let i=0;i<8;i++)f.step({add:{held:['A']}});
 const visual=f.sim.state.effects.find(e=>e.name==='ATT_Void_Field_P09'),carrier=f.sim.state.effects.find(e=>e.name==='DamageEffect_ATT_Void_Field');
 assert.ok(f.draws().some(s=>s.effectParentId===visual.id));
 f.sim.enter(f.a,'RSI_WAIT','current-web-interruption');f.step();
 assert.ok(!f.draws().some(s=>s.effectParentId===visual.id));assert.ok(carrier.sourceAddVoidCollapse&&!carrier.dead);
});

test('Moonlight original next-pulse destruction retires the previous two-second mesh before spawning the next aura',async t=>{
 const f=await setup(t,29024);f.step({add:{pressed:['A'],held:['A']}});
 f.until(()=>f.draws().some(s=>s.name==='ADE_MOONLIGHT_P01'));
 const first=f.draws().find(s=>s.name==='ADE_MOONLIGHT_P01'),id=first.effectParentId;
 assert.ok(first.meshes?.length>0,'actual converted original geometry is present');
 f.until(()=>f.events.some(e=>e.type==='effectEnded'&&e.effectId===id&&e.reason==='moonlight-next-pulse'));
 assert.ok(!f.draws().some(s=>s.effectParentId===id),'the next pulse stops the old original wave immediately instead of retaining its remaining two-second lifetime');
 // The new source emitter births at5/s. Retirement does not manufacture an
 // immediate replacement particle before that independent emission clock.
 f.until(()=>f.draws().some(s=>s.name==='ADE_MOONLIGHT_P01'&&s.effectParentId!==id),{},30);
 assert.equal(new Set(f.draws().filter(s=>s.name==='ADE_MOONLIGHT_P01').map(s=>s.effectParentId)).size,1);
});

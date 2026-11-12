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

test('Void actual early release fades every carrier ground mesh and quad list, independently of P09 and carrier natural lifetime',async t=>{
 const f=await setup(t,29023),{a,sim,scene,step,until}=f;
 step({add:{pressed:['A'],held:['A']}});until(()=>a.state.endsWith('_LOOP'),{add:{held:['A']}});
 for(let i=0;i<10;i++)step({add:{held:['A']}});
 const carrier=sim.state.effects.find(e=>e.name==='DamageEffect_ATT_Void_Field'),birth=carrier.elapsed;
 const ground=()=>scene.meshes.filter(m=>m.isEnabled()&&m.getTotalVertices()>0&&/^fx-ATT_Void_Field_(?!P09)/.test(m.name));
 const quads=()=>scene.meshes.filter(m=>m.isEnabled()&&m.thinInstanceCount>0&&m.name.includes('ATT_Void_Field_')&&m._userThinInstanceBuffersStorage?.data?.fxColor);
 assert.ok(ground().length>0,'real converted Jin/ground meshes must be drawn while held');assert.ok(quads().length>0,'real original ground quad batches must also be present');
 assert.ok(ground().some(m=>(m.material.pluginManager?.getPlugin('NativeEffectRealColor')?.color[3]??m.material.alpha)>0));
 until(()=>carrier.sourceAddVoidCollapse);
 for(let i=0;i<36;i++)step();
 assert.equal(carrier.sourceAddVoidCollapse.alpha,0);assert.ok(carrier.elapsed<7.75,'acceptance precedes natural source lifetime');
 assert.ok(carrier.elapsed>birth);assert.ok(ground().length>0,'preserve source live geometry and scale; fade its native color multiplier');
 for(const m of ground())assert.equal(m.material.pluginManager?.getPlugin('NativeEffectRealColor')?.color[3]??m.material.alpha,0,m.name+' ground display alpha');
 for(const m of quads()){const colors=m._userThinInstanceBuffersStorage.data.fxColor;
  for(let i=0;i<m.thinInstanceCount;i++)assert.equal(colors[i*4+3],0,m.name+' actual uploaded quad alpha');}
});

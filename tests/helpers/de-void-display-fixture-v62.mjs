/** Real converted Void GLBs/pose and production view under NullEngine.
 * Texture I/O and shader compilation are the only substitutes. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {originalAddFixture,originalAddSamplers} from './add-native-pose-fixture.mjs';
import {createEffectsView} from './effects-view-ready.mjs';
import {loadPoseContainer} from './babylon-assets.mjs';
export const VOID_CARRIER='DamageEffect_ATT_Void_Field',VOID_P09='ATT_Void_Field_P09',DT=1/60;
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const manifest=read('artifacts/de/manifest.json');
const all=Object.assign({},...[manifest.effectAssetIndex,...manifest.visualEffectIndexes].map(p=>read('artifacts/de/'+p).templates));
export async function voidDisplayFixture(t,fixture=originalAddFixture('DE',{skillId:29023})){
 const {sim,a,b}=fixture,profile=sim.profileFor(a);a.mp=a.mpMax;b.x=2000;
 const templates={},queue=['ATT_Void_Field_P09','ATT_Void_Field_M01'];
 for(const [key,value]of Object.entries(profile.damageEffects[VOID_CARRIER].raw))if(/^(?:PASSIVE|TIME)_PARTICLE\d+$/.test(key))queue.push(value.PARTICLE_NAME);
 for(const name of queue){if(templates[name])continue;const value=all[name];assert.ok(value,name);templates[name]=value;
  for(const key of ['TraceParticleList','FinalParticleList'])queue.push(...(value.repeated?.[key]??(value.fields[key]?[value.fields[key]]:[])));}
 const effectPoses=Object.fromEntries(Object.values(templates).filter(v=>v.poseData).map(v=>[v.poseData,read('artifacts/de/'+v.poseData)]));
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('void-tail-v62',new Vector3(0,31,10),scene);
 const view=await createEffectsView({scene,engine,index:{templates},effectPoses,samplers:originalAddSamplers('DE'),
  profile:{...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]},
  effectQuality:{level:'high',particleDivisor:1},assetBase:'/assets/de/',loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(root,'artifacts/de',file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 const events=[],ids=new Set();
 function present(batch=sim.drainEvents()){
  for(const event of batch){events.push(event);
   if(event.type==='effectStarted'&&[VOID_CARRIER,VOID_P09].includes(event.name)){ids.add(event.effectId);view.event(event,sim.state);}
   else if(ids.has(event.effectId))view.event(event,sim.state);
  }
  view.step(DT,sim.state);view.render({actors:sim.state.actors});scene.render();
 }
 function step(input={}){sim.step(DT,input,{snapshot:false});present();}
 function until(predicate,input={},limit=300){for(let i=0;i<limit&&!predicate();i++)step(input);assert.ok(predicate(),'bounded actual Void state reached');}
 function colorRows(){const rows=[];
  for(const m of scene.meshes){if(!m.isEnabled()||m.getTotalVertices()<=0||!m.name.includes('ATT_Void_Field_')||m.name.includes('P09'))continue;
   const colors=m._userThinInstanceBuffersStorage?.data?.fxColor;
   if(colors){for(let i=0;i<m.thinInstanceCount;i++)rows.push({kind:'quad',name:m.name,alpha:colors[i*4+3]});}
   else rows.push({kind:'mesh',name:m.name,alpha:m.material.pluginManager?.getPlugin('NativeEffectRealColor')?.color[3]??m.material.alpha});
  }return rows;
 }
 function rebuild(){view.clear();ids.clear();
  const starts=sim.state.effects.filter(e=>!e.dead&&[VOID_CARRIER,VOID_P09].includes(e.name)).map(e=>({
   ...e,type:'effectStarted',effectId:e.id,actorId:e.ownerId}));
  // A fresh presentation consumes the recorded real START/TIME dispatches,
  // rather than inventing entries or expecting wire-owned fired flags to
  // execute those once-only producers a second time in combat.
  const dispatches=events.filter(e=>['effectStartParticles','effectTimedParticles'].includes(e.type)).flatMap(e=>{
   const owner=starts.find(s=>s.effectId===e.effectId||s.networkId===e.effectId);
   return owner?[{...e,effectId:owner.effectId}]:[];
  });
  present([...starts,...dispatches]);
 }
 return {...fixture,profile,scene,view,events,ids,step,until,present,colorRows,rebuild};
}

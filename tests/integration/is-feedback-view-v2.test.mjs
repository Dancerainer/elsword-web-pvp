/** Real source meshes/particle dispatch, with explicit ready placeholder pixels
 * under NullEngine. Browser GPU appearance is recorded by a separate tool. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {make,profile,effectIndex,effectPoses} from '../fixtures/is-native-simulation.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
const root=resolve(import.meta.dirname,'../..'),moduleUrl=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const wrapper=moduleUrl(`export * from ${JSON.stringify(import.meta.resolve('@babylonjs/core'))};
import {RawTexture,Engine} from ${JSON.stringify(import.meta.resolve('@babylonjs/core'))};
export class Texture extends RawTexture {constructor(path,scene,_a,_b,_c,onLoad){super(new Uint8Array([255,255,255,255]),1,1,Engine.TEXTUREFORMAT_RGBA,scene,false,false);this.url=path;this.getInternalTexture().isReady=true;queueMicrotask(()=>onLoad?.());}}`);
const preparation=moduleUrl(`export {updateControlledEffectLookup,scheduleRenderPreparation} from ${JSON.stringify(pathToFileURL(resolve(root,'apps/web/render-preparation.mjs')).href)};export function createRenderPreparationCache(){return async()=>{};}`);
const source=readFileSync(resolve(root,'apps/web/effects-view.mjs'),'utf8')
 .replace("from '@babylonjs/core'",'from '+JSON.stringify(wrapper))
 .replace("from './render-preparation.mjs'",'from '+JSON.stringify(preparation))
 .replace(/(import\s+(?:[^'";]+?\s+from\s+)?)(['"])([^'"]+)\2/g,(_a,start,q,file)=>start+q+(file.startsWith('.')?pathToFileURL(resolve(root,'apps/web',file)).href:file.startsWith('data:')?file:import.meta.resolve(file))+q);
const {createEffectsView}=await import(moduleUrl(source));
async function fixture(t,sim,names,damageNames=[]){
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('IS-test',new Vector3(0,32,10),scene);
  const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},sourceLiteralResources:[],resourceOnlyTemplates:[],
    damageEffects:Object.fromEntries(damageNames.map(n=>[n,profile.damageEffects[n]]))};
  const view=await createEffectsView({scene,engine,index:{templates:Object.fromEntries(names.map(n=>[n,effectIndex.templates[n]]))},
    profile:bounded,effectPoses,samplers:{effectAnchorSampler:sim.effectAnchorSampler,effectBoneSampler:sim.effectBoneSampler},
    loadContainer:(base,file)=>loadPoseContainer(scene,resolve(root,'artifacts/is',file))});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  const feed=events=>{for(const e of events)view.event(e,sim.state);view.step(1/120,sim.state);view.render();};
  const tick=frames=>{const events=[];for(let i=0;i<frames;i++){sim.step(1/120,{}, {snapshot:false});const e=sim.drainEvents();events.push(...e);feed(e);}return events;};
  return {view,feed,tick};
}
for(const reason of ['natural','cancel','death','network-retirement'])test(`SecondBlade ${reason}: actual visible mesh is removed immediately, with no 99999s tail`,async t=>{
  const sim=make({target:false}),a=sim.actor('is'),f=await fixture(t,sim,['SecondBlade']);
  sim.enter(a,'ESSI_ETK_COMBO_ZZZZ','visual-sword');f.tick(8);assert.ok(f.view.proof().activeParticles>0);
  if(reason==='natural')f.tick(150);
  else if(reason==='death'){a.hp=0;f.tick(2);}
  else if(reason==='cancel'){sim.enter(a,'RSI_WAIT','cancel');f.tick(1);}
  else {const e=sim.state.effects.find(e=>e.name==='SecondBlade');f.feed([{type:'effectEnded',effectId:e.id,reason:'network-owner-effect-ended'}]);}
  assert.equal(f.view.proof().activeParticles,0);assert.equal(f.view.proof().activeEffectParents,0);
});
test('Shield five orbiting particles are drawn, survive ordinary contacts and disappear at hit limit',async t=>{
  const sim=make({skillId:21221,distance:1000}),f=await fixture(t,sim,['A_ETK_SWORD_SHIELD_P01','A_ETK_SWORD_SHIELD_ATTACKBOX'],['DAMAGE_EFFECT_SWORD_SHIELD_ULTIMATE']);
  sim.step(1/120,{is:{pressed:['A']}});f.feed(sim.drainEvents());f.tick(45);
  const count=()=>f.view.proof({includeDraws:true}).nativeParticleDraws.counts.A_ETK_SWORD_SHIELD_P01??0;
  assert.equal(count(),5);const shield=sim.state.effects.find(e=>e.name==='DAMAGE_EFFECT_SWORD_SHIELD_ULTIMATE');
  f.feed([{type:'hit',actorId:'is',targetId:'target',amount:1,origin:{kind:'effect',id:shield.id,impactPoint:[165,3120,0]},data:shield.damage.DAMAGE_DATA}]);
  assert.equal(count(),5,'one ordinary contact cannot delete FORCE_DIE_HIT before DAMAGE_TIME=3');
  f.feed([{type:'effectEnded',effectId:shield.id,reason:'hit-limit'}]);assert.equal(count(),4);
  sim.actor('is').hp=0;f.tick(2);assert.equal(count(),0);
});
test('Shield follows movement through the entire effective time, then releases all five sequences',async t=>{
  const sim=make({skillId:21221,target:false}),f=await fixture(t,sim,['A_ETK_SWORD_SHIELD_P01','A_ETK_SWORD_SHIELD_ATTACKBOX'],['DAMAGE_EFFECT_SWORD_SHIELD_ULTIMATE']);
  sim.step(1/120,{is:{pressed:['A']}});f.feed(sim.drainEvents());f.tick(50);
  assert.equal(f.view.proof({includeDraws:true}).nativeParticleDraws.counts.A_ETK_SWORD_SHIELD_P01,5);
  const before=f.view.proof({includeDraws:true}).nativeParticleDraws.sequences.filter(p=>p.name==='A_ETK_SWORD_SHIELD_P01');
  // Native trace meshes consume the preceding move-phase anchor. Compare
  // the ring's center after that one-frame phase; individual swords orbit.
  sim.actor('is').x+=200;f.tick(2);const draws=f.view.proof({includeDraws:true}).nativeParticleDraws.sequences.filter(p=>p.name==='A_ETK_SWORD_SHIELD_P01');
  assert.equal(draws.length,5);
  const center=rows=>rows.reduce((sum,p)=>sum+p.position[0],0)/rows.length;
  assert.ok(Math.abs(center(draws)-center(before)-200)<.1,JSON.stringify({before,draws}));
  f.tick(13*120);assert.equal(f.view.proof().activeParticles,0);assert.equal(f.view.proof().activeEffectParents,0);
});

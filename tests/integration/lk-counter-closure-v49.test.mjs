import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {NullEngine,Scene,FreeCamera,Vector3,ShaderMaterial} from '@babylonjs/core';
import {loadProfessionAssets} from '../../apps/web/load-profession-assets.mjs';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {collectEffectTemplates} from '../../apps/web/effect-prewarm.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPlayerFeedbackVisualIndexes} from '../../packages/combat-assets/player-feedback-visuals-v45.mjs';
import inventory from '../fixtures/evidence/lk-counter-assets-v49.json' with {type:'json'};
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),assetRoot=resolve(root,'artifacts');
const data=async url=>JSON.parse(readFileSync(resolve(assetRoot,url.replace(/^\/assets\//,''))));
async function actualLoad(id,t,requests=[]){
 const engine=new NullEngine(),scene=new Scene(engine);t.after(()=>{scene.dispose();engine.dispose();});
 return loadProfessionAssets({id,data:async url=>{requests.push(url);return data(url);},loadContainer:async(base,file)=>loadPoseContainer(scene,resolve(assetRoot,(base+file).replace(/^\/assets\//,'')))});
}
for(const id of ['LK','RS','IS'])test(`${id} browser loader reads the original shared minor index with the correct profession-relative texture`,async t=>{
 const requests=[],assets=await actualLoad(id,t,requests);
 assert.ok(requests.includes('/assets/lk/counter-v49/index.json'));assert.ok(assets.sourceIndexes.includes('/assets/lk/counter-v49/index.json'));
 const template=assets.fxIndex.templates.RevengeWait;assert.equal(template.source.sha256,'c94f61653d3aeb22f72252e2e5b596c55064f4963ff1a599197c5efcb7e83370');
 const file=resolve(assetRoot,id.toLowerCase(),template.textures['Revenge.dds'].file);assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),inventory.inventory[1].sha256);
 if(id==='LK')assert.ok(collectEffectTemplates(assets.profile,assets.fxIndex,[{skillId:21206}]).has('RevengeWait'));
 else assert.equal(assets.profile.skillCatalog.find(s=>s.skillId===21206),undefined,'do not invent LK skills for sibling classes');
});
test('server seals both new resources while all twelve professions remain loadable',async()=>{
 const assets=await loadServerCombatAssets({root,assetRoot});assert.equal(Object.values(assets.professions).filter(Boolean).length,12);
 for(const r of inventory.inventory){const path='assets/'+r.path.replace(/^artifacts\//,'');assert.deepEqual(assets.fingerprints.resources.files.find(f=>f.file===path),{file:path,bytes:r.bytes,sha256:r.sha256});}
});
test('a corrupted additive index fails before a renderer receives templates',async()=>{
 const index=await data('/assets/lk/counter-v49/index.json');index.templates.RevengeWait.fields.Lifetime=99;
 await assert.rejects(loadPlayerFeedbackVisualIndexes('LK',async()=>index),/source closure mismatch/);
});
test('LK draws then retires its actual Counter cue through effects-view without allocating cold planes',async t=>{
 t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async()=>{});
 for(const id of ['LK']){
  const assets=await actualLoad(id,t),engine=new NullEngine(),scene=new Scene(engine);
  new FreeCamera('counter-camera',new Vector3(0,0,10),scene);let view;
  try{
   const template=assets.fxIndex.templates.RevengeWait;
   view=await createEffectsView({scene,engine,index:{templates:{RevengeWait:{...template,textures:{},untexturedPlane:true}}},profile:assets.profile,samplers:{}});
   const actor={id:'counter',professionId:id,loadout:[{skillId:21206}],state:'ESSI_REVENGE_WAIT',stateSerial:1,hp:1,x:0,y:0,z:0,facing:1,awakening:{remaining:0}},state={time:0,actors:[actor],effects:[]};
   await view.prewarmActors([actor]);const slots=view.proof().quadDrawSlots;assert.ok(slots>0);
   view.event({type:'counterWaitVisual',actorId:actor.id,ownerStateSerial:1,position:[100,70,0],rotation:[0,70,0]},state);
   let peak=0;for(let i=0;i<90;i++){state.time+=1/60;view.step(1/60,state);view.render();peak=Math.max(peak,view.count);}
   assert.ok(peak>0);assert.equal(view.count,0);assert.equal(view.proof().counterWait.triggers,1);assert.equal(view.proof().quadDrawSlots,slots);
  }finally{view?.clear();scene.dispose();engine.dispose();}
 }
});

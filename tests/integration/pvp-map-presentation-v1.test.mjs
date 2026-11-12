import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {createMapUvScroll} from '../../apps/web/map-uv-scroll.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createMapEffects} from '../../apps/web/map-effects.mjs';
import {FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const root=new URL('../../',import.meta.url),json=file=>JSON.parse(readFileSync(new URL(file,root)));
const index=json('artifacts/map-mechanics/index.json');
const map=id=>({...json('artifacts/scene/'+id+'/manifest.json'),...json('artifacts/scene/'+id+'/collision.json')});
test('original map sequence overrides show both Sander winds and portal bursts once per observed serial',()=>{
  const runtime=createEffectRuntime({index,effectQuality:FULL_EFFECT_QUALITY});
  const controller=createMapEffects({runtime,index});controller.setMap(map('sander-villiage-pvpmap'));
  controller.step({actors:[]});runtime.step(.1,{actors:[]});
  assert.equal(controller.proof().ambient.length,4);
  for(const id of ['363','373','383','393']){
    const template=index.templates['sander-villiage-pvpmap:object-'+id];
    assert.equal(template.fields.particleType,'PT_3D_PLANE');
    assert.deepEqual(template.fields.Emitrate,{random:[20,40]});
    assert.ok([...runtime.particles.values()].some(p=>p.name===template.name));
  }
  runtime.clear();controller.clear();controller.setMap(map('peita-spiral-corridor-pvp'));
  const actor={id:'visitor',mapMechanics:{portalNotice:{serial:1,lineId:16,position:[-2008,2038,350],age:0}}};
  controller.step({actors:[actor]});controller.step({actors:[actor]});
  assert.equal(controller.proof().portalBursts,1);
  const names=[...runtime.emitters.values()].map(e=>e.name);
  assert.equal(names.filter(n=>n.endsWith('RespawnLanding_P04')).length,5);
  for(const n of index.portalTemplates)assert.ok(names.includes(n),n);
  actor.mapMechanics.portalNotice.serial=2;controller.step({actors:[actor]});
  assert.equal(controller.proof().portalBursts,2);
  actor.mapMechanics.portalNotice.serial=1;controller.step({actors:[actor]});
  assert.equal(controller.proof().portalBursts,2,'older owner snapshot cannot replay a portal burst');
});

test('native portal skin clocks and original plane/mesh resources reach actual display batches',async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);new FreeCamera('map',new Vector3(0,0,10),scene);
  const base=fileURLToPath(new URL('artifacts/map-mechanics/',root));
  const poses=Object.fromEntries(Object.values(index.templates).filter(v=>v.poseData).map(v=>[v.poseData,json('artifacts/map-mechanics/'+v.poseData)]));
  const names=[...index.portalTemplates,...Object.values(index.maps).flatMap(m=>m.ambient.map(o=>o.template))];
  const profile={target:{},components:{MAX_HYPER_MODE_TIME:0},states:{},skillCatalog:[],effectSets:{},damageEffects:{},resourceOnlyTemplates:names};
  const view=await createEffectsView({scene,engine,index,profile,samplers:{},effectPoses:poses,environment:true,
    assetBase:'/assets/map-mechanics/',loadContainer:(_base,file)=>loadPoseContainer(scene,base+file),effectQuality:FULL_EFFECT_QUALITY});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  view.setMap(map('sander-villiage-pvpmap'));
  for(let i=0;i<12;i++){view.step(1/60,{actors:[],effects:[]});view.render();}
  let proof=view.proof({includeDraws:true});
  for(const id of ['363','373','383','393'])
    assert.ok(proof.nativeParticleDraws.batches.some(b=>b.name.includes('object-'+id)),'actual wind plane batch '+id);
  view.clear();view.setMap(map('peita-spiral-corridor-pvp'));
  const actor={id:'visitor',mapMechanics:{portalNotice:{serial:1,lineId:16,position:[-2008,2038,350],age:0}}};
  const peak={};
  for(let i=0;i<18;i++){
    view.step(1/60,{actors:[actor],effects:[]});view.render();
    for(const [n,count]of Object.entries(view.proof({includeDraws:true}).nativeParticleDraws.counts))
      peak[n]=Math.max(peak[n]??0,count);
  }
  proof=view.proof({includeDraws:true});
  for(const name of index.portalTemplates)assert.ok(peak[name]>0,'actual portal resource '+name);
  for(const name of ['RespawnLanding01','RespawnLanding02'])
    assert.equal(index.templates['g_pMinorParticle:'+name].animationClips[0].ticksPerSecond,4800);
  assert.equal(proof.unsupported.length,0,JSON.stringify(proof.unsupported));
  assert.ok(proof.nativeParticleDraws.samples.some(s=>s.name.includes('RespawnLanding01')));
  // Six simultaneous entrants still have live entry skins when all six exit
  // .7 seconds later. A four-player pool would drop four of these skins.
  view.clear();await view.prewarmMap();view.setMap(map('peita-spiral-corridor-pvp'));
  const visitors=Array.from({length:6},(_,i)=>({id:'visitor-'+i,
    mapMechanics:{portalNotice:{serial:1,lineId:16,position:[-2008,2038,350],age:0}}}));
  for(let i=0;i<42;i++){view.step(1/60,{actors:visitors,effects:[]});view.render();}
  for(const visitor of visitors)visitor.mapMechanics.portalNotice={serial:2,lineId:33,position:[-1959,2077,2842],age:0};
  view.step(1/60,{actors:visitors,effects:[]});view.render();
  proof=view.proof({includeDraws:true});
  for(const name of ['RespawnLanding01','RespawnLanding02'])
    assert.equal(proof.nativeParticleDraws.counts['g_pMinorParticle:'+name],12,'all six entry and exit skins render');
  assert.deepEqual(proof.unsupported,[]);
});

test('original map UV speeds advance by elapsed seconds and shared texture copies remain independent',()=>{
  const ship=map('besma-air-ship-pvpmap'),created=[];
  const texture={uOffset:0,vOffset:0,clone(){const t={...this,dispose(){this.disposed=true;}};created.push(t);return t;}};
  const material={uniqueId:1,albedoTexture:texture,clone(){return {...this,dispose(){}};}};
  const meshes=['object-8','object-20','unscrolled'].map(name=>({name,material}));
  const scroll=createMapUvScroll(meshes,ship);scroll.step(.25);scroll.step(.75);
  assert.equal(meshes[0].material.albedoTexture.uOffset,-.6);
  assert.equal(meshes[1].material.albedoTexture.uOffset,.25);
  assert.equal(meshes[2].material.albedoTexture.uOffset,0);
  scroll.step(3);assert.equal(meshes[0].material.albedoTexture.uOffset,-2.4);
  assert.equal(meshes[1].material.albedoTexture.uOffset,1);
  assert.equal(scroll.proof().objects.length,2);
  scroll.dispose();assert.ok(created.every(t=>t.disposed));
});

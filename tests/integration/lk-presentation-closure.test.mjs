import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const root=new URL('../../',import.meta.url),json=file=>JSON.parse(readFileSync(new URL(file,root)));
const complete=json('contracts/lk-fx-index.json'),roots=json('contracts/lk-presentation-roots.json').roots;
const assetRoot=process.env.LK_PRESENTATION_ASSET_ROOT??fileURLToPath(new URL('artifacts/lk/',root));
const profile=json('packages/combat-core/lk-profile.json');
test('all LK texture references use exact emitted case, including original Smoke and Arme_ring2 aliases',()=>{
  const directories=new Map();
  for(const template of Object.values(complete.templates))for(const texture of Object.values(template.textures??{})){
    let directory=assetRoot;
    for(const component of texture.file.split('/')){
      if(!directories.has(directory))directories.set(directory,new Set(readdirSync(directory)));
      assert.ok(directories.get(directory).has(component),`${template.name}: case-sensitive asset missing ${texture.file}`);
      directory=resolve(directory,component);
    }
  }
  assert.equal(complete.templates.DownSmoke.textures['smoke.dds'].file,'fx/textures/Smoke-cd0af4fdbd.png');
  assert.equal(complete.templates.A_ALD_REFLECTION_P03.textures['Arme_ring2.dds'].file,'fx/textures/Arme_Ring2-9fa65a5787.png');
  const runtime=JSON.parse(readFileSync(resolve(assetRoot,'fx/index.json')));
  assert.deepEqual(runtime.templates,complete.templates);
});
async function fixture(t){
  const templates=Object.fromEntries(roots.map(name=>[name,complete.templates[name]]));
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);new FreeCamera('LK-common-display-camera',new Vector3(0,0,10),scene);
  const poses=Object.fromEntries(Object.values(templates).filter(r=>r.poseData).map(r=>[r.poseData,JSON.parse(readFileSync(resolve(assetRoot,r.poseData)))]));
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_base,file,targetScene)=>loadPoseContainer(targetScene,resolve(assetRoot,file)));
  const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},damageEffects:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:roots};
  const view=await createEffectsView({scene,engine,index:{...complete,templates},profile:bounded,effectPoses:poses,samplers:{},
    assetBase:'/assets/lk/',sourceIndexes:['/assets/lk/fx/index.json'],effectQuality:FULL_EFFECT_QUALITY});
  const actor={id:'LK',professionId:'lk',unitClass:100,hp:100,x:0,y:0,z:0,facing:1,state:'RSI_WAIT',stateSerial:0,
    animationTime:0,animationName:'Wait',awakening:{remaining:0},landPosition:[0,0,0]};
  const state={actors:[actor],effects:[]};
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});return {view,state,actor};
}

test('LK original small-reaction and critical roots produce actual display batches without unknown templates',async t=>{
  const {view,state}=await fixture(t),peak={};
  view.event({type:'hit',actorId:'LK',targetId:'victim',data:{REACT_TYPE:1},origin:{kind:'character',impactPoint:[0,0,0]},
    criticalFx:{name:'CriticalHit01',position:[0,0,0]}},state);
  for(let i=0;i<18;i++){
    view.step(1/60,state);view.render();
    for(const [name,count]of Object.entries(view.proof({includeDraws:true}).nativeParticleDraws.counts))peak[name]=Math.max(peak[name]??0,count);
  }
  const proof=view.proof();
  assert.deepEqual(proof.commonHits.triggers,{DamageImpact:1,DamageImpactCore:1,DamageImpactSlash:1});
  for(const name of ['DamageImpact','DamageImpactCore','DamageImpactSlash','CriticalHit01'])assert.ok(peak[name]>0,name+' actual original quad appears');
  assert.ok(!proof.unsupported.some(note=>String(note).includes('unknown-template')),JSON.stringify(proof.unsupported));
  assert.deepEqual(proof.indexes,['/assets/lk/fx/index.json']);
});

test('LK air-down callbacks prewarm measured original DropDown and show all three original minor sequences',async t=>{
  const {view,state,actor}=await fixture(t),peak={};
  const before=view.proof();assert.ok(before.meshPoolBudgets.DropDown?.views>0);assert.ok(before.meshInstances>0);
  assert.ok(!before.unsupported.includes('DropDown:animation-rate'),'measured original 4800 tick rate remains confirmed');
  view.step(1/60,state);actor.state='RSI_DAMAGE_AIR_DOWN_LANDING';actor.stateSerial=1;
  for(let i=0;i<36;i++){
    actor.animationTime=i/60;view.step(1/60,state);view.render();
    for(const [name,count]of Object.entries(view.proof({includeDraws:true}).nativeParticleDraws.counts))peak[name]=Math.max(peak[name]??0,count);
  }
  const proof=view.proof();assert.deepEqual(proof.landing.triggers,{DropDown:1,GroundShockWave:1,AirDownTick:1,DownSmoke:2});
  for(const name of ['GroundShockWave','AirDownTick','DownSmoke'])assert.ok(peak[name]>0,name+' original sequence renders');
  assert.ok(!proof.unsupported.some(note=>String(note).includes('unknown-template')),JSON.stringify(proof.unsupported));
  assert.equal(complete.templates.DropDown.animationClips[0].ticksPerSecond,4800);
});

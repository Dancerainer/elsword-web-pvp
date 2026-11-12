import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {NullEngine,Scene,SceneLoader,FreeCamera,Vector3} from '@babylonjs/core';
import {installCommonBuffs} from '../../packages/combat-core/buffs.mjs';
import {collectEffectMeshBudget} from '../../apps/web/effect-prewarm.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadProfessionAssets} from '../../apps/web/load-profession-assets.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const root=new URL('../../',import.meta.url),json=file=>JSON.parse(readFileSync(new URL(file,root)));
const catalog=json('contracts/common-buff-catalog.json'),index=json('contracts/common-buff-display-fx-index.json');
const assetRoot=process.env.PROFESSION_ASSET_ROOT??fileURLToPath(new URL('artifacts/',root));
const assetPath=url=>resolve(assetRoot,new URL(url,'http://asset.local').pathname.replace(/^\/assets\//,''));

test('actual foreign buff DISPLAYER roots enter RF/LK prewarm budgets without mutating frozen profession attacks',()=>{
  for(const [id,foreign] of [['rf',[38,78,322]],['lk',[31,48]]]){
    const original=json('packages/combat-core/'+id+'-profile.json'),before=structuredClone(original);
    const plain=collectEffectMeshBudget(original,index,[],{effectQuality:FULL_EFFECT_QUALITY});
    const prepared=installCommonBuffs(structuredClone(original),catalog);
    const budget=collectEffectMeshBudget(prepared,index,[],{effectQuality:FULL_EFFECT_QUALITY});
    for(const buffId of foreign){
      assert.equal(original.buffTemplates[buffId],undefined,'foreign source template is absent from the frozen profession');
      for(const setName of Object.values(catalog.buffTemplates[buffId].raw.DISPLAYER.BDT_EFFECT_SET)){
        for(const [key,entry]of Object.entries(catalog.effectSets[setName].raw))if(/^EFFECT\d+$/.test(key)&&entry.NAME){
          assert.ok(index.templates[entry.NAME],'expectation is an actual original display name');
          assert.ok(!plain.templates.has(entry.NAME),entry.NAME+' originally missing from recipient preparation');
          assert.ok(budget.templates.has(entry.NAME),entry.NAME+' must be prepared for a foreign buff');
          if(index.templates[entry.NAME].glb)assert.ok(budget.demands.get(entry.NAME)?.views>0,'actual foreign mesh burst has a positive reserved pool');
        }
      }
    }
    assert.deepEqual(original,before,'static profession profile stays frozen');
    assert.deepEqual(prepared.states,original.states);assert.deepEqual(prepared.skillCatalog,original.skillCatalog);
    assert.deepEqual(prepared.damageEffects,original.damageEffects,'no offensive catalog enters a recipient');
  }
});

test('BM bleeding three stack displays are prepared for RF/LK/VC recipients from the shared original catalog',()=>{
  const raw=catalog.buffTemplates['99'].raw;
  assert.equal(raw.ACCUMULATION_LIMIT,3);
  assert.deepEqual(Object.values(raw.DISPLAYER.BDT_EFFECT_SET),[1,2,3].map(i=>`EffectSet_DEBUFF_BLEEDING_0${i}`));
  for(const id of ['rf','lk','vc']){
    const original=json('packages/combat-core/'+id+'-profile.json'),prepared=installCommonBuffs(structuredClone(original),catalog);
    assert.equal(original.buffTemplates[99],undefined);
    assert.deepEqual(prepared.buffTemplates[99].raw,raw);
    const budget=collectEffectMeshBudget(prepared,index,[],{effectQuality:FULL_EFFECT_QUALITY});
    for(const setName of Object.values(raw.DISPLAYER.BDT_EFFECT_SET)){
      assert.deepEqual(prepared.effectSets[setName].raw,catalog.effectSets[setName].raw);
      for(const [key,entry]of Object.entries(catalog.effectSets[setName].raw))if(/^EFFECT\d+$/.test(key)){
        assert.ok(index.templates[entry.NAME],entry.NAME+' original visual exists');
        assert.ok(budget.templates.has(entry.NAME),entry.NAME+' is ready before a foreign bleeding hit');
      }
    }
    assert.deepEqual(prepared.damageEffects,original.damageEffects,'shared display introduces no foreign attack');
  }
});

test('actual foreign Armageddon display and original measured animated sword are reserved before RF input',async t=>{
  const original=json('packages/combat-core/rf-profile.json');
  const prepared=installCommonBuffs(structuredClone(original),catalog),setName=Object.values(catalog.buffTemplates['322'].raw.DISPLAYER.BDT_EFFECT_SET)[0];
  const names=Object.entries(catalog.effectSets[setName].raw).filter(([key,entry])=>/^EFFECT\d+$/.test(key)&&index.templates[entry.NAME]?.glb).map(([,entry])=>entry.NAME);
  const templates=Object.fromEntries(names.map(name=>[name,index.templates[name]]));
  const bounded={...prepared,states:{},skillCatalog:[],buffTemplates:{322:prepared.buffTemplates['322']},effectSets:{[setName]:prepared.effectSets[setName]},resourceOnlyTemplates:[],resourceOnlyEffectSets:[]};
  const poses=Object.fromEntries(names.map(name=>[templates[name].poseData,JSON.parse(readFileSync(assetPath('/assets/common-buffs/'+templates[name].poseData)))]));
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('foreign-buff-budget',new Vector3(0,0,10),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_base,file,targetScene)=>loadPoseContainer(targetScene,assetPath('/assets/common-buffs/'+file)));
  const view=await createEffectsView({scene,engine,index:{...index,templates},profile:bounded,effectPoses:poses,samplers:{},assetBase:'/assets/common-buffs/',effectQuality:FULL_EFFECT_QUALITY});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  const proof=view.proof(),animated='ELK_ArmagedonBladeM',staticName=names.find(name=>name!==animated);
  assert.ok(names.includes(animated)&&staticName,'source contains both original animated and static display meshes');
  assert.ok(proof.meshPoolBudgets[staticName]?.views>0);assert.ok(proof.meshInstances>0,'real original static GLB cloned before any buff is applied');
  assert.ok(proof.meshPoolBudgets[animated]?.views>0);assert.ok(!proof.unsupported.includes(animated+':animation-rate'));
  assert.equal(proof.activeParticles,0,'resource preparation creates no gameplay buff or active display');
});

test('LK proof indexes are exactly the profession and common manifest paths actually loaded',async t=>{
  const requested=[],data=async url=>{requested.push(url);return JSON.parse(readFileSync(assetPath(url)));};
  const commonManifest=await data('/assets/common-buffs/manifest.json');
  const commonPaths=commonManifest.visualEffectIndexes.map(file=>'/assets/common-buffs/'+file);
  const commonVisuals=mergeVisualEffectIndexes(...await Promise.all(commonPaths.map(data)));
  const assets=await loadProfessionAssets({id:'LK',data,loadContainer:async()=>({}),commonBuffVisuals:commonVisuals,commonBuffSourceIndexes:commonPaths});
  const expected=[...assets.manifest.visualEffectIndexes.map(file=>assets.base+file),'/assets/lk/counter-v49/index.json',...commonPaths];
  assert.deepEqual(assets.sourceIndexes,expected);for(const path of expected)assert.ok(requested.includes(path));
  assert.ok(expected.every(path=>!path.includes('/rf/')),'LK evidence cannot claim RF resource indexes');
  const engine=new NullEngine(),scene=new Scene(engine),bounded={...assets.profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyTemplates:[],resourceOnlyEffectSets:[]};
  const supplied=[...assets.sourceIndexes];
  const view=await createEffectsView({scene,engine,index:{...assets.fxIndex,templates:{}},profile:bounded,samplers:{},sourceIndexes:supplied});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  supplied.push('/assets/guessed/index.json');assert.deepEqual(view.proof().indexes,expected,'caller cannot change the frozen evidence list');
  view.proof().indexes.length=0;assert.deepEqual(view.proof().indexes,expected,'returned diagnostics do not expose mutable source state');
});

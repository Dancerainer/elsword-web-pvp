import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {NullEngine,Scene} from '@babylonjs/core';
import {createProfessionAssetCache} from '../../apps/web/load-profession-assets.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {skillDescription,traitDescription} from '../../packages/localization/skills.mjs';
import {getProfessionProfile} from '../../packages/professions/profiles.mjs';
import {PROFESSION_IDS} from '../../packages/professions/catalog.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p)));
test('all retained VC pose tracks exactly match full original conversion, including RF shared keys',()=>{
  const packed=read('artifacts/vc/runtime-pose.json'),rf=read('artifacts/rf/runtime-pose.json');
  const full=JSON.parse(gunzipSync(readFileSync(resolve(root,'artifacts/vc/source-proof/runtime-pose-full.json.gz'))));
  const composed=composeCharacterPose(packed,rf),originals=new Map(full.clips.map(c=>[c.name,c]));
  assert.ok(packed.sharedClips.includes('Fatal'));assert.ok(packed.sharedClips.includes('DamageRevenge'));
  assert.equal(packed.sharedClips.length,70);assert.equal(composed.clips.length,124);
  assert.deepEqual(composed.frames,full.frames);assert.deepEqual(composed.helpers,full.helpers);
  const addedShared=new Set(['SI_A_RF_GET_CHANCE_FRONT','SI_A_RF_GET_CHANCE_BACK']);
  const frameNames=new Set(composed.frames.map(f=>f.name));
  for(const clip of composed.clips){
    const source=addedShared.has(clip.name)?rf.clips.find(c=>c.name===clip.name):originals.get(clip.name);
    assert.ok(source,clip.name+' original converted source');
    assert.deepEqual(clip,addedShared.has(clip.name)?{...source,tracks:source.tracks.filter(t=>frameNames.has(t.frame_name))}:source,clip.name);
  }
  assert.throws(()=>composeCharacterPose(packed,{clips:[]}),/Invalid shared/);
  for(const state of Object.values(getProfessionProfile('VC').states))assert.ok(composed.clips.some(c=>c.name===state.animationName),state.animationName);
});
test('RF LK VC RS BM share source containers across repeated switching and VC clone retains124 animations including non-down rise, Fatal and counter surprise',async t=>{
  const counts=new Map(),engine=new NullEngine(),scene=new Scene(engine);
  const path=url=>resolve(root,'artifacts',new URL(url,'http://test').pathname.replace(/^\/assets\//,''));
  const cache=createProfessionAssetCache({data:async url=>readFileSync(path(url),'utf8')&&JSON.parse(readFileSync(path(url),'utf8')),
    loadContainer:async(base,file)=>{const p=path(base+file);counts.set(p,(counts.get(p)??0)+1);return loadPoseContainer(scene,p);},
    loadImage:async url=>{assert.ok(existsSync(path(url)),url);return{src:url};}});
  t.after(()=>{cache.dispose();scene.dispose();engine.dispose();});
  const assets=await cache.loadAll();assert.deepEqual([...assets.keys()],PROFESSION_IDS);
  assert.equal(assets.get('RF').coreContainer,assets.get('VC').coreContainer);
  assert.equal(assets.get('RF').coreContainer,assets.get('BM').coreContainer);assert.equal(counts.size,PROFESSION_IDS.length+1);
  for(const count of counts.values())assert.equal(count,1);
  const vc=assets.get('VC'),clone=vc.bodyContainer.instantiateModelsToScene(n=>'vc-test-'+n,true,{doNotInstantiate:true});
  t.after(()=>clone.dispose());assert.equal(clone.animationGroups.length,124);
  for(const name of ['Fatal','DamageRevenge','SI_A_RF_GET_CHANCE_FRONT','SI_A_RF_GET_CHANCE_BACK'])assert.ok(clone.animationGroups.some(group=>group.name==='vc-test-'+name));
  for(const g of clone.animationGroups)assert.ok(g.targetedAnimations.every(t=>t.target.name.startsWith('vc-test-')),'per-actor retargeting');
  for(let i=0;i<40;i++)assert.equal(await cache.load(['RF','LK','VC','RS','BM','IS'][i%6]),assets.get(['RF','LK','VC','RS','BM','IS'][i%6]));
  assert.equal(counts.size,PROFESSION_IDS.length+1);assert.deepEqual(cache.proof().failures,{json:0,containers:0,images:0});
});
test('VC highest active/passive and trait descriptions are Chinese and contain no undefined numeric placeholders',()=>{
  const profile=getProfessionProfile('VC');
  for(const s of profile.skillCatalog.filter(s=>s.topTier)){
    const text=skillDescription(s);assert.ok(/[a-z]/iu.test(text));assert.ok(!/undefined|NaN|values.*unavailable/.test(text),s.skillId+': '+text);
    for(const b of s.branches){const text=traitDescription(b);assert.ok(/[a-z]/iu.test(text));assert.ok(!/undefined|NaN/.test(text),s.skillId+': '+text);}
  }
});

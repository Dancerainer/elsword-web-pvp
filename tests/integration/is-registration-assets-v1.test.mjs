/** Actual converted resource reuse and browser-loader integration; no GPU or original-client claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene} from '@babylonjs/core';
import {createProfessionAssetCache} from '../../apps/web/load-profession-assets.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {PROFESSION_IDS} from '../../packages/professions/catalog.mjs';
import {awakeningAttachmentsFor} from '../../apps/web/awakening-effects.mjs';
import {collectEffectTemplates} from '../../apps/web/effect-prewarm.mjs';

const root=resolve(import.meta.dirname,'../..');
const path=url=>resolve(root,'artifacts',new URL(url,'http://fixture').pathname.replace(/^\/assets\//,''));
test('all professions decode shared LK animations once and preload IS portraits, skills and Elsword awakening before repeated switches',async t=>{
  const engine=new NullEngine(),scene=new Scene(engine),counts={json:new Map(),containers:new Map(),images:new Map()};
  const mark=(kind,url)=>{const file=path(url);counts[kind].set(file,(counts[kind].get(file)??0)+1);return file;};
  const cache=createProfessionAssetCache({data:async url=>JSON.parse(readFileSync(mark('json',url),'utf8')),
    loadContainer:async(base,file)=>loadPoseContainer(scene,mark('containers',base+file)),
    loadImage:async url=>{assert.ok(existsSync(mark('images',url)),url);return {src:url};}});
  t.after(()=>{cache.dispose();scene.dispose();engine.dispose();});
  const assets=await cache.loadAll();assert.deepEqual([...assets.keys()],PROFESSION_IDS);
  const is=assets.get('IS'),lk=assets.get('LK');assert.equal(is.profile.target.unitClass,112);
  assert.equal(is.coreContainer,null,'Elsword has no Raven Nasod core');
  assert.ok(is.manifest.sharedCharacterAnimations.clips.length>0,'shared source motions must be reused');
  assert.equal(path(is.base+is.manifest.sharedCharacterAnimations.glb),path(lk.base+(lk.manifest.runtimeGlb??lk.manifest.glb)));
  assert.ok(assets.get('MM').summons.apocalypse.bodyContainer,'actual original Apocalypse container is a separate NPC');
  assert.equal(counts.containers.get(path(assets.get('MM').summons.apocalypse.base+assets.get('MM').summons.apocalypse.manifest.runtimeGlb)),1);
  assert.equal(counts.containers.size,PROFESSION_IDS.length+2,'one body per profession, one shared Raven core and the original Apocalypse NPC');
  assert.equal(assets.get('RF').coreContainer,assets.get('VC').coreContainer);
  const animations=new Set(is.bodyContainer.animationGroups.map(group=>group.name));
  for(const state of Object.values(is.profile.states))assert.ok(animations.has(state.animationName),state.animationName);
  assert.ok(counts.images.has(path('/assets/is/ui/portrait-party.png')));assert.ok(counts.images.has(path('/assets/is/ui/portrait-state.png')));
  for(const skill of is.catalog.skills)if(skill.icon)assert.ok(counts.images.has(path('/assets/ui/skills/'+skill.icon)),skill.id);
  const templates=collectEffectTemplates(is.profile,is.fxIndex,[]);
  for(const attachment of awakeningAttachmentsFor(is.profile))assert.ok(templates.has(attachment.template),attachment.template);
  const before=cache.proof();
  for(let i=0;i<40;i++){const id=PROFESSION_IDS[i%PROFESSION_IDS.length];assert.equal(await cache.load(id),assets.get(id));}
  assert.deepEqual(cache.proof(),before);assert.deepEqual(before.failures,{json:0,containers:0,images:0});
  for(const category of Object.values(counts))assert.ok([...category.values()].every(count=>count===1));
  t.diagnostic(JSON.stringify({professionCount:assets.size,decodedContainers:counts.containers.size,sharedISAnimations:is.manifest.sharedCharacterAnimations.clips.length,
    ISAnimations:animations.size,iconsAndPortraits:counts.images.size,repeatedSwitches:40,gpuMeasured:false}));
});

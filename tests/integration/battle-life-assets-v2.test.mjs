import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene} from '@babylonjs/core';
import {loadProfessionAssets} from '../../apps/web/load-profession-assets.mjs';
import {collectEffectMeshBudget} from '../../apps/web/effect-prewarm.mjs';
import {FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';

const root=resolve(import.meta.dirname,'../..');
const read=url=>JSON.parse(readFileSync(resolve(root,'artifacts',new URL(url,'http://asset.local').pathname.replace(/^\/assets\//,''))));
const lifeManifest=read('/assets/battle-life/manifest.json');
const lifeFile='/assets/battle-life/'+lifeManifest.visualEffectIndexes[0];
const life=read(lifeFile);
const commonManifest=read('/assets/common-buffs/manifest.json');
const commonFiles=commonManifest.visualEffectIndexes.map(file=>'/assets/common-buffs/'+file);
const common=mergeVisualEffectIndexes(...commonFiles.map(read));

test('restored original battle-life declarations and measured poses coexist with all six current profession indexes and prewarm pools',async t=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  t.after(()=>{scene.dispose();engine.dispose();});
  assert.equal(Object.keys(life.templates).length,14);
  for(const id of ['RF','LK','VC','RS','BM','IS']){
    const assets=await loadProfessionAssets({id,data:async url=>read(url),map:()=>null,
      commonBuffVisuals:common,commonBuffSourceIndexes:commonFiles,battleLifeVisuals:life,battleLifeSourceIndexes:[lifeFile],
      loadContainer:(base,file)=>loadPoseContainer(scene,resolve(root,'artifacts',new URL(base+file,'http://asset.local').pathname.replace(/^\/assets\//,'')))});
    assert.equal(assets.fxIndex.battleLife,life,id);
    assert.ok(assets.sourceIndexes.includes(lifeFile),id);
    const budget=collectEffectMeshBudget(assets.profile,assets.fxIndex,[],{effectQuality:FULL_EFFECT_QUALITY});
    for(const [name,row]of Object.entries(life.templates)){
      assert.ok(budget.templates.has(name),id+': '+name);
      if(row.poseData)assert.ok(assets.effectPoses[assets.fxIndex.templates[name].poseData],id+': original pose '+name);
      if(row.glb)assert.ok(budget.demands.get(name)?.views>0,id+': reserved original mesh '+name);
    }
    assets.bodyContainer.dispose();assets.coreContainer?.dispose();
  }
  t.diagnostic('Real original pose/GLB decoding and resource closure; no browser GPU or original-client execution claimed.');
});

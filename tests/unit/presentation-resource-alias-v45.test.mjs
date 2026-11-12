import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfessionAssetCache} from '../../apps/web/load-profession-assets.mjs';
test('all professions share one canonical DE source container rather than duplicating cross-profession aliases',async()=>{
 const requests=[],container={dispose(){}},cache=createProfessionAssetCache({data:async()=>{},loadContainer:async(base,file)=>{requests.push(base+file);return container;}});
 const aliases=[['/assets/de/','fx/meshes/ADD_MM_tech001.glb'],...['rf','lk','vc','rs','bm','is','gm','bh','ca','lp','mm'].map(id=>['/assets/'+id+'/','../de/fx/meshes/ADD_MM_tech001.glb'])];
 const results=await Promise.all(aliases.map(([base,file])=>cache.loadContainer(base,file)));
 assert.ok(results.every(value=>value===container));assert.equal(requests.length,1);
 assert.equal(cache.proof().attempts.containers,1);assert.equal(cache.proof().containers,1);cache.dispose();
});

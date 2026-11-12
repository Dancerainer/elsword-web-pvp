import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattleResourcePrefetch,battleBootstrapUrls} from '../../apps/web/battle-resource-prefetch.mjs';
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('independent bootstrap reads overlap within a fixed limit and duplicate consumers share the value',async()=>{
  const started=[],releases=new Map();let live=0,peak=0;
  const cache=createBattleResourcePrefetch({urls:['a','b','c','d'],concurrency:2,load:url=>{
    started.push(url);peak=Math.max(peak,++live);return new Promise(resolve=>releases.set(url,value=>{live--;resolve(value);}));
  }});
  const a=cache.read('a');assert.equal(cache.read('a'),a);await turn();assert.deepEqual(started,['a','b']);
  const object={source:'a'};releases.get('a')(object);assert.equal(await a,object);await turn();assert.deepEqual(started,['a','b','c']);
  releases.get('b')('B');await turn();assert.deepEqual(started,['a','b','c','d']);
  releases.get('c')('C');releases.get('d')('D');assert.deepEqual(await Promise.all(['b','c','d'].map(cache.read)),['B','C','D']);
  assert.equal(peak,2);assert.equal(await cache.read('a'),object);cache.close();
});

test('early rejection is observed immediately but still fails its eventual consumer',async()=>{
  const failure=Error('HTTP 404'),cache=createBattleResourcePrefetch({urls:['missing','valid'],load:async url=>{if(url==='missing')throw failure;return 42;}});
  await turn();assert.equal(await cache.read('valid'),42);await assert.rejects(cache.read('missing'),error=>error===failure);cache.close();
});

test('failure cleanup aborts active reads and never starts queued work or retains reusable ownership',async()=>{
  const started=[];
  const cache=createBattleResourcePrefetch({urls:['active','queued'],concurrency:1,load:(url,signal)=>{
    started.push(url);return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
  }});
  const active=cache.read('active'),queued=cache.read('queued');await turn();cache.close();cache.close();
  await assert.rejects(active,/aborted/);await assert.rejects(queued,/closed/);await assert.rejects(cache.read('new'),/closed/);
  assert.deepEqual(started,['active']);
});

test('optional bootstrap inventory is gated by the deployment and does not preload unrelated professions',()=>{
  const baseline=battleBootstrapUrls(),withOptional=battleBootstrapUrls({'common-buffs/manifest.json':'a','cast-display/manifest.json':'b'});
  assert.equal(new Set(baseline).size,baseline.length);
  assert.deepEqual(withOptional.slice(baseline.length),['/assets/common-buffs/manifest.json','/assets/cast-display/manifest.json']);
  assert.ok(baseline.every(url=>!/^\/assets\/(?:rf|lk|rs|is|vc|bm|lp|mm|de|gm|bh|ca)\//.test(url)));
});

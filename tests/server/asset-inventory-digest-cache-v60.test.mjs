import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,utimes,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createAssetVersionInventory} from '../../apps/server/asset-versions.mjs';
import {StaticResourceCache,staticResourceRevision} from '../../apps/server/static-resource-cache.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function fixture(t,{metadataLimit=2,digestCacheLimit}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'rf-inventory-digest-v60-'));
 t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
 const cache=new StaticResourceCache({metadataLimit}),put=(name,bytes)=>writeFile(path.join(root,name),bytes);
 for(const name of ['a.json','b.json','c.json','d.json'])await put(name,name.repeat(32));
 const inventory=createAssetVersionInventory(root,cache,digestCacheLimit===undefined?undefined:{digestCacheLimit});
 const evictHttp=()=>{for(const filename of [...cache.records.keys()])cache.remove(filename);};
 return {root,cache,put,inventory,evictHttp};
}

test('an inventory larger than the HTTP LRU reuses hashes without evicting a warm compressed response',async t=>{
 const f=await fixture(t),first=await f.inventory();assert.equal(Object.keys(first.files).length,4);assert.equal(f.cache.stats.hashReads,4);
 const filename=path.join(f.root,'a.json'),entry=f.cache.record(filename,await stat(filename));await f.cache.compressed(entry);
 const resident=[...f.cache.records.keys()],bytes=f.cache.bytes,compressed=entry.gzip;
 assert.ok(compressed);assert.equal(f.cache.records.size,2);
 const second=await f.inventory();assert.deepEqual(second,first);assert.equal(f.cache.stats.hashReads,4);
 assert.deepEqual([...f.cache.records.keys()],resident);assert.equal(f.cache.bytes,bytes);assert.equal(entry.gzip,compressed);
});

test('same-size content replacement with restored mtime is invalidated by the shared ctime signature',async t=>{
 const f=await fixture(t),filename=path.join(f.root,'a.json'),fixed=new Date('2001-01-01T00:00:00.000Z');
 await utimes(filename,fixed,fixed);const beforeStat=await stat(filename),first=await f.inventory();
 // Ensure even millisecond-resolution filesystems expose a distinct ctime.
 await new Promise(resolve=>setTimeout(resolve,20));
 const changed=Buffer.alloc(beforeStat.size,120);await writeFile(filename,changed);await utimes(filename,fixed,fixed);
 const afterStat=await stat(filename);
 assert.equal(afterStat.size,beforeStat.size);assert.equal(afterStat.mtimeMs,beforeStat.mtimeMs);assert.notEqual(afterStat.ctimeMs,beforeStat.ctimeMs);
 assert.notEqual(staticResourceRevision(beforeStat),staticResourceRevision(afterStat));
 const second=await f.inventory();assert.equal(second.files['a.json'],sha(changed));assert.notEqual(second.files['a.json'],first.files['a.json']);
 for(const name of ['b.json','c.json','d.json'])assert.equal(second.files[name],first.files[name]);
 assert.equal(f.cache.stats.hashReads,5,'only the changed file is read again');
});

test('each walk discovers added and deleted files without retaining deleted names in the published inventory',async t=>{
 const f=await fixture(t),first=await f.inventory();await rm(path.join(f.root,'b.json'));await f.put('new.png','new runtime bytes');
 const second=await f.inventory();assert.equal(Object.hasOwn(second.files,'b.json'),false);assert.equal(second.files['new.png'],sha('new runtime bytes'));
 assert.equal(f.cache.stats.hashReads,5);
 for(const name of ['a.json','c.json','d.json'])assert.equal(second.files[name],first.files[name]);
 await f.put('b.json','replacement');const third=await f.inventory();assert.equal(third.files['b.json'],sha('replacement'));assert.equal(f.cache.stats.hashReads,6);
});

test('concurrent inventory callers share one in-flight walk and the same completed response',async t=>{
 const f=await fixture(t),entered=deferred(),release=deferred(),etag=f.cache.etag.bind(f.cache);let calls=0;
 f.cache.etag=async(...args)=>{if(++calls===1){entered.resolve();await release.promise;}return etag(...args);};
 const first=f.inventory();await entered.promise;const second=f.inventory();release.resolve();
 const [a,b]=await Promise.all([first,second]);assert.equal(a,b);assert.equal(calls,4);assert.equal(f.cache.stats.hashReads,4);
});

test('a hash failure rejects the entire shared walk and retries without publishing its partial digest cache',async t=>{
 const f=await fixture(t,{metadataLimit:1}),etag=f.cache.etag.bind(f.cache);let calls=0,fail=true;
 f.cache.etag=async(...args)=>{if(fail&&++calls===2)throw Error('controlled-inventory-hash-failure');return etag(...args);};
 const result=await Promise.allSettled([f.inventory(),f.inventory()]);
 for(const row of result){assert.equal(row.status,'rejected');assert.match(row.reason.message,/controlled-inventory-hash-failure/);}
 assert.equal(f.cache.stats.hashReads,1);fail=false;f.evictHttp();
 const retried=await f.inventory();assert.equal(Object.keys(retried.files).length,4);assert.equal(f.cache.stats.hashReads,5,'the earlier partial generation was not retained');
 const again=await f.inventory();assert.deepEqual(again,retried);assert.equal(f.cache.stats.hashReads,5);
});

test('failed refresh preserves only the last complete cache, not partially updated digests',async t=>{
 const f=await fixture(t,{metadataLimit:1});await f.inventory();
 for(const name of ['a.json','b.json','c.json','d.json'])await f.put(name,'new '+name);
 const etag=f.cache.etag.bind(f.cache);let calls=0,fail=true;
 f.cache.etag=async(...args)=>{if(fail&&++calls===2)throw Error('controlled-refresh-failure');return etag(...args);};
 await assert.rejects(f.inventory(),/controlled-refresh-failure/);assert.equal(f.cache.stats.hashReads,5);
 fail=false;f.evictHttp();const next=await f.inventory();assert.equal(f.cache.stats.hashReads,9);
 for(const name of ['a.json','b.json','c.json','d.json'])assert.equal(next.files[name],sha(await readFile(path.join(f.root,name))));
});

test('digest cache capacity bounds retained metadata while uncached overflow remains correct and retryable',async t=>{
 const f=await fixture(t,{metadataLimit:1,digestCacheLimit:2}),first=await f.inventory();assert.equal(f.cache.stats.hashReads,4);
 f.evictHttp();const second=await f.inventory();assert.deepEqual(second,first);assert.equal(f.cache.stats.hashReads,6,'exactly two overflow files require hashing after HTTP eviction');
 for(const name of Object.keys(first.files))assert.equal(second.files[name],sha(await readFile(path.join(f.root,name))));
 for(const limit of [-1,1.5,Infinity,16_385])assert.throws(()=>createAssetVersionInventory(f.root,f.cache,{digestCacheLimit:limit}),/Invalid inventory digest cache limit/);
});

test('inventory can disable digest retention without skipping hashes or changing its response',async t=>{
 const f=await fixture(t,{digestCacheLimit:0}),first=await f.inventory();f.evictHttp();const second=await f.inventory();
 assert.deepEqual(second,first);assert.equal(f.cache.stats.hashReads,8);
});

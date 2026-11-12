import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,stat,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {StaticResourceCache} from '../../apps/server/static-resource-cache.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';

const publicOrigin='https://fixture.trycloudflare.com',credentials={username:'fixture',password:'fixture-secret'};
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t,publicMode=false){
  const root=await mkdtemp(path.join(os.tmpdir(),'rf-cache-v16-'));
  for(const folder of ['artifacts','dist','apps/web'])await mkdir(path.join(root,folder),{recursive:true});
  const text=JSON.stringify({description:'\uac11\uac0e\uac04\uac23\uac21'.repeat(1000),version:1});
  await writeFile(path.join(root,'artifacts/sample.json'),text);await writeFile(path.join(root,'dist/game.js'),'// original literal build\n');
  await writeFile(path.join(root,'apps/web/index.html'),'LOGIN');
  const app=await createDevServer({root,credentials,publicOrigin:publicMode?publicOrigin:null});
  await listenLoopback(app.server);
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));assert.ok(root.startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port,origin=publicMode?publicOrigin:base;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:origin},body:JSON.stringify(credentials)});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const request=(resource,headers={},method='GET')=>new Promise((resolve,reject)=>{
    const req=http.request(base+resource,{method,headers:{Cookie:cookie,...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);});req.on('error',reject);req.end();
  });
  return {...app,root,base,origin,cookie,text,request};
}

test('unchanged authenticated resources revalidate without a body or a second hash read',async t=>{
  const f=await fixture(t),first=await f.request('/assets/sample.json');
  assert.equal(first.status,200);assert.equal(first.body.toString(),f.text);assert.match(first.headers['cache-control'],/private.*no-cache.*must-revalidate/);
  assert.equal(first.headers.etag,'"sha256-'+hash(Buffer.from(f.text))+'"');assert.ok(!first.headers['cache-control'].includes('no-store'));
  const count=f.staticCache.stats.hashReads;
  for(const validator of [first.headers.etag,'W/'+first.headers.etag,'"obsolete", '+first.headers.etag,'*']){
    const next=await f.request('/assets/sample.json',{'If-None-Match':validator});assert.equal(next.status,304);assert.equal(next.body.length,0);assert.equal(next.headers.etag,first.headers.etag);
  }
  assert.equal(f.staticCache.stats.hashReads,count);
});

test('resource-only version changes replace the cached bytes even when the game build is unchanged',async t=>{
  const f=await fixture(t),first=await f.request('/assets/sample.json'),before=(await (await fetch(f.base+'/api/session',{headers:{Cookie:f.cookie}})).json()).buildVersion;
  const revised=JSON.stringify({description:'\uac25\uac2f\uac3b\uac2d'.repeat(1001),version:2});await writeFile(path.join(f.root,'artifacts/sample.json'),revised);
  const next=await f.request('/assets/sample.json',{'If-None-Match':first.headers.etag});assert.equal(next.status,200);assert.equal(next.body.toString(),revised);assert.notEqual(next.headers.etag,first.headers.etag);
  const after=(await (await fetch(f.base+'/api/session',{headers:{Cookie:f.cookie}})).json()).buildVersion;assert.equal(before,after);
  assert.equal((await f.request('/assets/sample.json',{'If-None-Match':next.headers.etag})).status,304);
});

test('validators never bypass logout, expired or missing authentication',async t=>{
  const f=await fixture(t),first=await f.request('/assets/sample.json');
  const missing=await f.request('/assets/sample.json',{'Cookie':'','If-None-Match':first.headers.etag});assert.equal(missing.status,401);assert.equal(missing.headers.etag,undefined);assert.match(missing.headers['cache-control'],/no-store/);
  f.sessions.values().next().value.expires=Date.now()-1;
  assert.equal((await f.request('/assets/sample.json',{'If-None-Match':'*'})).status,401);
  const login=await fetch(f.base+'/api/login',{method:'POST',headers:{Origin:f.origin},body:JSON.stringify(credentials)}),cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(f.base+'/api/logout',{method:'POST',headers:{Origin:f.origin,Cookie:cookie}})).status,200);
  assert.equal((await f.request('/assets/sample.json',{Cookie:cookie,'If-None-Match':first.headers.etag})).status,401);
});

test('gzip representations are byte-equivalent, single-flight, bounded, and independently validated',async t=>{
  const f=await fixture(t,true),responses=await Promise.all(Array.from({length:6},()=>f.request('/assets/sample.json',{'Accept-Encoding':'gzip'})));
  assert.equal(f.staticCache.stats.gzipBuilds,1);assert.equal(f.staticCache.stats.hashReads,1);
  for(const response of responses){assert.equal(response.status,200);assert.equal(gunzipSync(response.body).toString(),f.text);assert.equal(response.headers.vary,'Accept-Encoding');assert.match(response.headers.etag,/^W\//);}
  const gzTag=responses[0].headers.etag,before={...f.staticCache.stats};
  const gz=await f.request('/assets/sample.json',{'Accept-Encoding':'gzip','If-None-Match':gzTag});assert.equal(gz.status,304);assert.equal(gz.body.length,0);assert.equal(f.staticCache.stats.gzipBuilds,before.gzipBuilds);
  const plain=await f.request('/assets/sample.json',{'Accept-Encoding':'gzip;q=0','If-None-Match':gzTag});assert.equal(plain.status,200);assert.equal(plain.body.toString(),f.text);assert.notEqual(plain.headers.etag,gzTag);
  const revised='updated '+f.text;await writeFile(path.join(f.root,'artifacts/sample.json'),revised);
  const newGzip=await f.request('/assets/sample.json',{'Accept-Encoding':'gzip','If-None-Match':gzTag});assert.equal(newGzip.status,200);assert.equal(gunzipSync(newGzip.body).toString(),revised);assert.notEqual(newGzip.headers.etag,gzTag);
  assert.ok(f.staticCache.bytes<=f.staticCache.limits.byteLimit);
});

test('HEAD and game version queries carry validators without loading a compressed body',async t=>{
  const f=await fixture(t,true),head=await f.request('/assets/sample.json',{'Accept-Encoding':'gzip'},'HEAD');
  assert.equal(head.status,200);assert.equal(head.body.length,0);assert.ok(head.headers.etag);assert.equal(f.staticCache.stats.gzipBuilds,0);
  const first=await f.request('/game/game.js?v=first'),unchanged=await f.request('/game/game.js?v=first',{'If-None-Match':first.headers.etag});assert.equal(unchanged.status,304);
  await writeFile(path.join(f.root,'dist/game.js'),'// new literal build\n');
  const update=await f.request('/game/game.js?v=second',{'If-None-Match':first.headers.etag});assert.equal(update.status,200);assert.equal(update.body.toString(),'// new literal build\n');assert.notEqual(update.headers.etag,first.headers.etag);
});

test('bounded compression eviction and failed reads do not retain stale or poisoned entries',async t=>{
  const f=await fixture(t),cache=new StaticResourceCache({byteLimit:100,entryLimit:90,metadataLimit:2});
  const paths=[];for(let i=0;i<4;i++){const p=path.join(f.root,'artifacts','file'+i+'.json');await writeFile(p,String(i).repeat(300));paths.push(p);const e=cache.record(p,await stat(p));const b=await cache.compressed(e);assert.equal(gunzipSync(b).toString(),String(i).repeat(300));assert.ok(cache.bytes<=100);assert.ok(cache.records.size<=2);}
  const oversize=path.join(f.root,'artifacts/random.bin');await writeFile(oversize,Buffer.from(Array.from({length:300},(_,i)=>i%251)));
  assert.equal(await cache.compressed(cache.record(oversize,await stat(oversize))),null);assert.ok(cache.bytes<=100);
  const p=paths.at(-1),e=cache.record(p,await stat(p));await rm(p);await assert.rejects(cache.etag(e,false),/ENOENT/);assert.equal(e.digest,null);
  await writeFile(p,'RECOVERED');const recovered=cache.record(p,await stat(p));assert.equal(await cache.etag(recovered,false),'"sha256-'+hash(Buffer.from('RECOVERED'))+'"');
});

test('an asset replaced between hashing and compression cannot pair new bytes with the old validator',async t=>{
  const f=await fixture(t,true),revised='NEW RESOURCE '+f.text,original=f.staticCache.compressed.bind(f.staticCache);let changed=false;
  f.staticCache.compressed=async entry=>{if(!changed){changed=true;await writeFile(path.join(f.root,'artifacts/sample.json'),revised);}return original(entry);};
  const response=await f.request('/assets/sample.json',{'Accept-Encoding':'gzip'});
  assert.equal(response.status,200);assert.equal(gunzipSync(response.body).toString(),revised);assert.equal(response.headers.etag,'W/"sha256-'+hash(Buffer.from(revised))+'-gzip"');
  assert.equal((await f.request('/assets/sample.json',{'Accept-Encoding':'gzip','If-None-Match':response.headers.etag})).status,304);
});

test('identity streaming retries a revision changed after hashing and before publishing headers',async t=>{
  const f=await fixture(t),revised='REPLACED '+f.text,original=f.staticCache.etag.bind(f.staticCache);let changed=false;
  f.staticCache.etag=async(entry,compressed)=>{const tag=await original(entry,compressed);if(!changed){changed=true;await writeFile(path.join(f.root,'artifacts/sample.json'),revised);}return tag;};
  const response=await f.request('/assets/sample.json');assert.equal(response.status,200);assert.equal(response.body.toString(),revised);assert.equal(response.headers.etag,'"sha256-'+hash(Buffer.from(revised))+'"');
});

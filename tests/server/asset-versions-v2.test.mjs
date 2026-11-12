import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {StaticResourceCache,createVerifiedResourceStream} from '../../apps/server/static-resource-cache.mjs';
import {Readable} from 'node:stream';
import {gunzipSync} from 'node:zlib';
import {createAssetVersionInventory} from '../../apps/server/asset-versions.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rf-asset-versions-'));
  for(const folder of ['artifacts','dist','apps/web'])await fs.mkdir(path.join(root,folder),{recursive:true});
  const assetRoot=path.join(root,'artifacts'),bytes=Buffer.from('original cache fixture '.repeat(64));
  await fs.writeFile(path.join(assetRoot,'sample.json'),bytes);await fs.writeFile(path.join(root,'dist/game.js'),'fixture-build');
  const credentials={username:'cache-fixture',password:'temporary-test-secret'};
  const app=await createDevServer({root,assetRoot,credentials,driverFactory:null});
  const origin='http://127.0.0.1:'+await listenLoopback(app.server);
  t.after(async()=>{app.closeStreams();await new Promise(resolve=>app.server.close(resolve));assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin},body:JSON.stringify(credentials)});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];await login.json();
  const request=(route,{headers={},method='GET',authenticated=true}={})=>new Promise((resolve,reject)=>{
    const req=http.request(origin+route,{method,headers:{...(authenticated?{Cookie:cookie}:{}),...headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)}));res.on('error',reject);
    });req.on('error',reject);req.end();
  });
  return {root,assetRoot,bytes,request,app,cookie,origin};
}
test('authenticated asset inventory returns byte SHA and no-store; unauthenticated request cannot access inventory or validator shortcut',async t=>{
  const f=await fixture(t),response=await f.request('/api/asset-versions');
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  const value=JSON.parse(response.bytes);assert.equal(value.schemaVersion,1);assert.equal(value.files['sample.json'],sha(f.bytes));
  const first=await f.request('/assets/sample.json?v='+sha(f.bytes));
  assert.equal((await f.request('/api/asset-versions',{authenticated:false})).status,401);
  const unauth=await f.request('/assets/sample.json?v='+sha(f.bytes),{authenticated:false,headers:{'If-None-Match':first.headers.etag}});
  assert.equal(unauth.status,401);assert.equal(unauth.headers['cache-control'],'no-store');
});
test('matching content-addressed asset is immutable for one year, HEAD is empty, wrong version fails before 304',async t=>{
  const f=await fixture(t),url='/assets/sample.json?v='+sha(f.bytes),first=await f.request(url);
  assert.equal(first.status,200);assert.deepEqual(first.bytes,f.bytes);assert.equal(first.headers['cache-control'],'private, max-age=31536000, immutable');
  const head=await f.request(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.bytes.length,0);
  const conditional=await f.request(url,{headers:{'If-None-Match':first.headers.etag}});assert.equal(conditional.status,304);assert.equal(conditional.bytes.length,0);
  const mismatch=await f.request('/assets/sample.json?v='+'0'.repeat(64),{headers:{'If-None-Match':first.headers.etag}});
  assert.equal(mismatch.status,409);assert.equal(mismatch.headers['cache-control'],'no-store');assert.equal(JSON.parse(mismatch.bytes).error,'asset-version-mismatch');
  const plain=await f.request('/assets/sample.json');assert.match(plain.headers['cache-control'],/must-revalidate/);
  const unchanged=await f.request('/assets/sample.json',{headers:{'If-None-Match':plain.headers.etag}});assert.equal(unchanged.status,304);assert.equal(unchanged.bytes.length,0);
});
test('asset-only rebuild changes its hash URL while unchanged neighboring resource stays reusable',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.assetRoot,'neighbor.png'),Buffer.from([1,2,3]));
  const old=JSON.parse((await f.request('/api/asset-versions')).bytes).files;
  await fs.writeFile(path.join(f.assetRoot,'sample.json'),Buffer.concat([f.bytes,Buffer.from('changed')]));
  const current=JSON.parse((await f.request('/api/asset-versions')).bytes).files;
  assert.notEqual(current['sample.json'],old['sample.json']);assert.equal(current['neighbor.png'],old['neighbor.png']);
  assert.equal((await f.request('/assets/sample.json?v='+old['sample.json'])).status,409);
  const rebuilt=await f.request('/assets/sample.json?v='+current['sample.json']);assert.equal(rebuilt.status,200);assert.match(rebuilt.headers['cache-control'],/immutable/);
});
test('direct HTTP cloud origin compresses versioned resources, varies by encoding and preserves zero-body validators',async t=>{
  const f=await fixture(t),url='/assets/sample.json?v='+sha(f.bytes);
  const zipped=await f.request(url,{headers:{'Accept-Encoding':'gzip'}});
  assert.equal(zipped.status,200);assert.equal(zipped.headers['content-encoding'],'gzip');assert.equal(zipped.headers.vary,'Accept-Encoding');
  assert.match(zipped.headers.etag,/^W\//);assert.deepEqual(gunzipSync(zipped.bytes),f.bytes);assert.ok(zipped.bytes.length<f.bytes.length);
  const repeat=await f.request(url,{headers:{'Accept-Encoding':'gzip','If-None-Match':zipped.headers.etag}});
  assert.equal(repeat.status,304);assert.equal(repeat.bytes.length,0);assert.match(repeat.headers['cache-control'],/immutable/);
  const plain=await f.request(url,{headers:{'Accept-Encoding':'gzip;q=0'}});assert.equal(plain.headers['content-encoding'],undefined);assert.deepEqual(plain.bytes,f.bytes);
});
test('inventory ignores proof directories and raw source while concurrent callers share one walk',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rf-asset-inventory-'));
  t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
  for(const directory of ['proofs','native','rf'])await fs.mkdir(path.join(root,directory));
  await fs.writeFile(path.join(root,'proofs','private.json'),'excluded');await fs.writeFile(path.join(root,'raw.cpp'),'excluded');
  await fs.writeFile(path.join(root,'.private.json'),'excluded');await fs.writeFile(path.join(root,'rf','pose.json.gz'),'gz fixture');
  await fs.writeFile(path.join(root,'native','geometry.wasm'),'module fixture');
  const inventory=createAssetVersionInventory(root,new StaticResourceCache());const [a,b]=await Promise.all([inventory(),inventory()]);
  assert.equal(a,b);assert.deepEqual(Object.keys(a.files).sort(),['native/geometry.wasm','rf/pose.json.gz']);
});
test('metadata transfer validation skips a digest pass while still enforcing exact byte length; strict mode remains available',async()=>{
  const payload=Buffer.from('initial metadata-only fixture');
  const consume=async(expectedSize,verifyDigest)=>{
    const stream=createVerifiedResourceStream('0'.repeat(64),expectedSize,{verifyDigest});
    const source=Readable.from([payload.subarray(0,8),payload.subarray(8)]);source.pipe(stream);
    const chunks=[];try{for await(const chunk of stream)chunks.push(chunk);return Buffer.concat(chunks);}finally{source.destroy();stream.destroy();}
  };
  assert.deepEqual(await consume(payload.length,false),payload);
  await assert.rejects(consume(payload.length,true),/static-resource-revision-changed/);
  for(const verifyDigest of [false,true])for(const wrongSize of [payload.length-1,payload.length+1])await assert.rejects(consume(wrongSize,verifyDigest),/static-resource-revision-changed/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,open,rm} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {listenLoopback} from '../helpers/listen-loopback.mjs';

// Allows independent branch verification against the integrating production
// export without copying/staging server source. Normal runs use this checkout.
const serverModule=process.env.RF_STREAM_SERVER_MODULE
  ?pathToFileURL(path.resolve(process.env.RF_STREAM_SERVER_MODULE)).href
  :new URL('../../apps/server/dev-server.mjs',import.meta.url).href;
const {createDevServer}=await import(serverModule);
const origin='https://stream-fixture.trycloudflare.com';
const original=Buffer.alloc(256*1024,0x41);
const tag=(body,gzip)=>`${gzip?'W/':''}"sha256-${createHash('sha256').update(body).digest('hex')}${gzip?'-gzip':''}"`;

async function fixture(t,publicMode){
  const root=await mkdtemp(path.join(os.tmpdir(),'rf-stream-integrity-v16-'));
  for(const folder of ['dist','artifacts'])await mkdir(path.join(root,folder));
  const file=path.join(root,'artifacts/sample.json');await writeFile(file,original);
  await writeFile(path.join(root,'dist/game.js'),'// isolated stream fixture\n');
  const credentials={username:'fixture',password:'fixture-secret'};
  const app=await createDevServer({root,credentials,publicOrigin:publicMode?origin:null,resourceValidation:'digest'});
  await listenLoopback(app.server);
  t.after(async()=>{
    app.server.closeIdleConnections?.();await new Promise(resolve=>app.server.close(resolve));
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    assert.ok(path.basename(root).startsWith('rf-stream-integrity-v16-'));
    await rm(root,{recursive:true,force:true});
  });
  const base='http://127.0.0.1:'+app.server.address().port;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:publicMode?origin:base},body:JSON.stringify(credentials)});
  assert.equal(login.status,200);await login.json();
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const request=(gzip=false)=>new Promise(resolve=>{
    let response,settled=false;const chunks=[];
    const finish=(kind,error)=>{
      if(settled)return;settled=true;
      resolve({kind,error,complete:response?.complete??false,status:response?.statusCode,
        headers:response?.headers??{},body:Buffer.concat(chunks)});
    };
    const req=http.request(base+'/assets/sample.json',{agent:false,headers:{Cookie:cookie,'Accept-Encoding':gzip?'gzip':'identity'}},res=>{
      response=res;res.on('data',chunk=>chunks.push(chunk));
      res.once('end',()=>finish('end'));res.once('aborted',()=>finish('aborted'));
      res.once('error',error=>finish('response-error',error));
    });
    req.once('error',error=>finish(error.code==='TEST_REQUEST_TIMEOUT'?'timeout':'request-error',error));
    req.setTimeout(5000,()=>req.destroy(Object.assign(Error('stream fixture timed out'),{code:'TEST_REQUEST_TIMEOUT'})));
    req.end();
  });
  return {...app,file,request};
}

for(const change of [
  {name:'same length and different bytes',replacement:Buffer.alloc(original.length,0x42)},
  {name:'shorter file',replacement:Buffer.alloc(original.length-64*1024,0x42)},
  {name:'longer file',replacement:Buffer.alloc(original.length+64*1024,0x42)},
  {name:'public oversized gzip fallback',replacement:Buffer.alloc(original.length,0x42),gzip:true},
])test(`resource stream cannot complete normally after late in-place replacement: ${change.name}`,{timeout:15000},async t=>{
  const f=await fixture(t,change.gzip===true);
  if(change.gzip){
    // Exercise the real compressed-entry overflow/fallback with a small legal
    // sample; no 16MB incompressible payload is needed to reach this branch.
    f.staticCache.limits.entryLimit=8;
  }
  const before=await f.request();assert.equal(before.kind,'end');assert.equal(before.complete,true);
  assert.equal(before.status,200);assert.deepEqual(before.body,original);assert.equal(before.headers.etag,tag(original,false));

  const probe=await open(f.file,'r'),prototype=Object.getPrototypeOf(probe);
  await probe.close();const createReadStream=prototype.createReadStream;let changed=false;
  t.mock.method(prototype,'createReadStream',function(...args){
    // The production handler reaches this call only after its final revision
    // verification and writeHead. Change the same inode before reading bytes.
    if(!changed){changed=true;writeFileSync(f.file,change.replacement);}
    return createReadStream.apply(this,args);
  });
  const broken=await f.request(change.gzip===true);
  assert.equal(changed,true,'the late stream gate must actually run');
  assert.notEqual(broken.kind,'timeout','a hung connection is not a successful rejection');
  assert.notEqual(broken.kind,'end','changed bytes must not finish an HTTP representation');
  assert.equal(broken.complete,false,'the client must not accept the old validator with changed bytes');
  if(!change.gzip)assert.ok(broken.body.length<original.length,'the held tail prevents original Content-Length completion');
  else {assert.ok(f.staticCache.stats.gzipBuilds>=1);assert.equal(f.staticCache.bytes,0);}

  // A failed stream must close cleanly and allow a new request to observe the
  // complete updated revision, including a valid footer for gzip fallback.
  const recovered=await f.request(change.gzip===true);
  assert.equal(recovered.kind,'end');assert.equal(recovered.complete,true);assert.equal(recovered.status,200);
  const decoded=change.gzip?gunzipSync(recovered.body):recovered.body;
  assert.deepEqual(decoded,change.replacement);assert.equal(recovered.headers.etag,tag(decoded,change.gzip===true));
  if(change.gzip){assert.equal(recovered.headers['content-encoding'],'gzip');assert.equal(f.staticCache.bytes,0);}
});

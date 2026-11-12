import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {createResourceDeliveryStore} from '../../apps/server/resource-delivery.mjs';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'resource-delivery-'));
  await fs.mkdir(path.join(root,'artifacts'));await fs.writeFile(path.join(root,'artifacts/fixture.json'),'{}');
  const options={root,credentials:{username:'fixture-gm', role:'gm',password:'fixture-gm'},additionalCredentials:[{username:'player',password:'fixture-player'}],driverFactory:null,resourceDeliveryEnabled:false};
  let app;
  async function start(){app=await createDevServer(options);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${app.server.address().port}`;}
  const origin=await start();
  t.after(async()=>{app.closeStreams();await new Promise(resolve=>app.server.close(resolve));assert.ok(root.startsWith(os.tmpdir()+path.sep));await fs.rm(root,{recursive:true,force:true});});
  const login=async username=>{const result=await fetch(origin+'/api/login',{method:'POST',body:JSON.stringify({username,password:username==='fixture-gm'?'fixture-gm':'fixture-player'})});assert.equal(result.status,200);return result.headers.get('set-cookie').split(';')[0];};
  return {root,origin,login,restart:async()=>{app.closeStreams();await new Promise(resolve=>app.server.close(resolve));return start();}};
}
test('disabled server refuses resource GET, HEAD and conditional requests for GM and players while keeping APIs available',async t=>{
  const f=await fixture(t),gm=await f.login('fixture-gm'),player=await f.login('player');
  for(const cookie of [gm,player])for(const method of ['GET','HEAD']){
    const result=await fetch(f.origin+'/assets/fixture.json?v=bad',{method,headers:{cookie,'if-none-match':'*'}});
    assert.equal(result.status,503);assert.equal(result.headers.get('cache-control'),'no-store');
  }
  assert.equal((await fetch(f.origin+'/assets/fixture.json')).status,401);
  for(const route of ['/api/session','/api/asset-versions','/api/online/status'])assert.equal((await fetch(f.origin+route,{headers:{cookie:player}})).status,200);
  assert.equal((await (await fetch(f.origin+'/api/resource-delivery')).json()).enabled,false);
});
test('only GM can save strict settings; enabling serves resources, disabling persists across restart',async t=>{
  const f=await fixture(t),gm=await f.login('fixture-gm'),player=await f.login('player');
  const set=(cookie,body,origin)=>fetch(f.origin+'/api/admin/resource-delivery',{method:'POST',headers:{...(cookie?{cookie}:{}),...(origin?{origin}:{})},body:JSON.stringify(body)});
  assert.equal((await set(null,{enabled:true})).status,401);assert.equal((await set(player,{enabled:true})).status,403);
  assert.equal((await set(gm,{enabled:true},'http://foreign.invalid')).status,403);
  for(const value of [null,[],{enabled:1},{enabled:true,extra:true}])assert.equal((await set(gm,value)).status,400);
  assert.equal((await set(gm,{enabled:true})).status,200);
  const resource=await fetch(f.origin+'/assets/fixture.json',{headers:{cookie:player}});assert.equal(resource.status,200);
  assert.equal((await set(gm,{enabled:false})).status,200);
  assert.equal((await fetch(f.origin+'/assets/fixture.json',{headers:{cookie:player,'if-none-match':resource.headers.get('etag')}})).status,503);
  const next=await f.restart();assert.deepEqual(await(await fetch(next+'/api/resource-delivery')).json(),{schemaVersion:1,revision:2,enabled:false});
});
test('serialized durable writes survive errors without changing the last setting or unrelated data',async t=>{
  const f=await fixture(t);let fail=false;
  const store=createResourceDeliveryStore({accountRoot:f.root,fileSystem:{...fs,rename:async(...args)=>{if(fail)throw Error('disk-error');return fs.rename(...args);}}});
  await store.initialize();assert.equal(store.status().enabled,false);
  await Promise.all([store.save(true),store.save(false)]);assert.equal(store.status().revision,2);
  fail=true;await assert.rejects(store.save(true),/disk-error/);assert.deepEqual(store.status(),{schemaVersion:1,revision:2,enabled:false});
  assert.equal((await fs.readdir(f.root)).some(name=>name.endsWith('.tmp')),false);
  const next=createResourceDeliveryStore({accountRoot:f.root,enabled:true});await next.initialize();assert.equal(next.status().enabled,false);
});
test('corrupt settings fail instead of reopening delivery',async t=>{
  const f=await fixture(t);
  for(const data of ['{bad',JSON.stringify({schemaVersion:1,revision:0,enabled:'false'}),JSON.stringify({schemaVersion:1,revision:-1,enabled:false})]){
    await fs.writeFile(path.join(f.root,'resource-delivery.json'),data);
    await assert.rejects(createResourceDeliveryStore({accountRoot:f.root}).initialize());
  }
});

test('GM shutdown interrupts an already backpressured resource download', {timeout:10000},async t=>{
  const f=await fixture(t),cookie=await f.login('fixture-gm');
  await fs.writeFile(path.join(f.root,'artifacts/large.png'),Buffer.alloc(16*1024*1024,7));
  const set=enabled=>fetch(f.origin+'/api/admin/resource-delivery',{method:'POST',headers:{cookie},body:JSON.stringify({enabled})});
  await set(true);
  const response=await new Promise((resolve,reject)=>{const request=http.get(f.origin+'/assets/large.png',{headers:{cookie}},resolve);request.on('error',reject);});
  assert.equal(response.statusCode,200);response.pause();
  const aborted=new Promise(resolve=>response.once('aborted',resolve));response.on('error',()=>{});
  assert.equal((await set(false)).status,200);response.resume();await aborted;assert.equal(response.complete,false);
});

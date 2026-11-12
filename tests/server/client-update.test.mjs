import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {gzipSync} from 'node:zlib';
import {sha,UPDATE_LIMIT,updatePlan} from '../../apps/local-client/update-contract.mjs';
import {updateLocalClient,recoverClientUpdate} from '../../apps/local-client/updater.mjs';
import {verifyClientFiles,createLocalClient} from '../../apps/local-client/client.mjs';
import {createClientUpdateDelivery} from '../../apps/server/client-update.mjs';
import {createDevServer} from '../../apps/server/dev-server.mjs';
const id=value=>sha(Buffer.from(JSON.stringify(value)));
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'client-online-')),pack=path.join(root,'pack'),delivery=path.join(root,'delivery');
  const requests=[];let handler;
  const server=http.createServer(async(req,res)=>{requests.push(req.url);await handler.handle(req,res,new URL(req.url,'http://local'));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const before={'dist/game.js':'old code','assets/fixture.json':'old resource','apps/web/index.html':'page','runtime/node.exe':'same runtime'},after={...before,'dist/game.js':'new code','assets/fixture.json':'new resource','dist/chunk-new.js':'new chunk'};
  await fs.mkdir(pack);
  await fs.writeFile(path.join(pack,'server-config.json'),JSON.stringify({serverUrl:origin}));
  const manifest=files=>({schemaVersion:1,buildSha256:sha(files['dist/game.js']),files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,sha(bytes)])),assets:{'fixture.json':sha(files['assets/fixture.json'])}});
  const base=manifest(before),target=manifest(after),baseId=id(base),releaseId=id(target),transport={};
  for(const [name,bytes]of Object.entries(before)){await fs.mkdir(path.dirname(path.join(pack,name)),{recursive:true});await fs.writeFile(path.join(pack,name),bytes);}
  await fs.writeFile(path.join(pack,'client-manifest.json'),JSON.stringify(base));
  await fs.mkdir(path.join(delivery,releaseId,'blobs'),{recursive:true});await fs.mkdir(path.join(delivery,baseId),{recursive:true});
  for(const [name,bytes]of Object.entries(after)){
    if(base.files[name]===target.files[name])continue;
    const compressed=gzipSync(bytes);transport[name]={bytes:Buffer.byteLength(bytes),gzipBytes:compressed.length,gzipSha256:sha(compressed)};
    await fs.writeFile(path.join(delivery,releaseId,'blobs',sha(compressed)+'.gz'),compressed);
  }
  const catalog={schemaVersion:1,releaseId,manifest:target,transport};
  await fs.writeFile(path.join(delivery,baseId,'catalog.json'),JSON.stringify({manifest:base}));await fs.writeFile(path.join(delivery,releaseId,'catalog.json'),JSON.stringify(catalog));
  await fs.writeFile(path.join(delivery,'current.json'),JSON.stringify({releaseId,buildSha256:target.buildSha256}));
  handler=createClientUpdateDelivery({root:delivery,buildVersion:target.buildSha256});
  t.after(async()=>{handler.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.ok(root.startsWith(os.tmpdir()+path.sep));await fs.rm(root,{recursive:true,force:true});});
  return {root,pack,delivery,origin,base,target,baseId,releaseId,catalog,requests};
}
test('real HTTP online update writes code, resources and new chunks, commits manifest and survives a new verifier',async t=>{
  const f=await fixture(t),result=await updateLocalClient({root:f.pack,log:()=>{}});
  assert.equal(result.status,'updated');assert.equal(result.files,3);assert.ok(result.bytes<UPDATE_LIMIT);
  assert.equal(await fs.readFile(path.join(f.pack,'assets/fixture.json'),'utf8'),'new resource');
  assert.equal(await fs.readFile(path.join(f.pack,'dist/game.js'),'utf8'),'new code');
  assert.equal(await fs.readFile(path.join(f.pack,'dist/chunk-new.js'),'utf8'),'new chunk');
  await verifyClientFiles(f.pack,f.target);
  assert.equal((await updateLocalClient({root:f.pack,log:()=>{}})).status,'current');
  assert.equal(f.requests.filter(url=>url.startsWith('/api/client-update/file')).length,3);
  await assert.rejects(fs.stat(path.join(f.pack,'.client-update')),error=>error.code==='ENOENT');
});
test('server admits an update above the former 50 MB cap',async t=>{
  const f=await fixture(t),name='dist/game.js',catalog=structuredClone(f.catalog);
  assert.equal(UPDATE_LIMIT,100_000_000);
  catalog.transport[name].gzipBytes=75_000_000;
  await fs.writeFile(path.join(f.delivery,f.releaseId,'catalog.json'),JSON.stringify(catalog));
  const admitted=await(await fetch(f.origin+'/api/client-update/plan',{method:'POST',body:JSON.stringify({baseReleaseId:f.baseId})})).json();
  assert.equal(admitted.status,'update-available');assert.equal(admitted.limitBytes,100_000_000);
  assert.ok(admitted.bytes>75_000_000&&admitted.bytes<100_000_000);
});

test('server caps complete transfer including metadata at exactly 100 MB and denies unknown bases and unrelated downloads',async t=>{
  const f=await fixture(t),name='dist/game.js',catalog=structuredClone(f.catalog);
  for(let i=0;i<5;i++)catalog.transport[name].gzipBytes+=UPDATE_LIMIT-updatePlan(f.base,catalog).bytes;
  assert.equal(updatePlan(f.base,catalog).status,'update-available');
  assert.equal(updatePlan(f.base,catalog).bytes,100_000_000);
  catalog.transport[name].gzipBytes++;
  assert.equal(updatePlan(f.base,catalog).status,'full-client-required');
  await fs.writeFile(path.join(f.delivery,f.releaseId,'catalog.json'),JSON.stringify(catalog));
  const plan=await(await fetch(f.origin+'/api/client-update/plan',{method:'POST',body:JSON.stringify({baseReleaseId:f.baseId})})).json();assert.equal(plan.reason,'over-limit');
  const denied=await fetch(f.origin+'/api/client-update/file?'+new URLSearchParams({base:f.baseId,release:f.releaseId,file:name}));assert.equal(denied.status,409);
  const unknown=await(await fetch(f.origin+'/api/client-update/plan',{method:'POST',body:JSON.stringify({baseReleaseId:'0'.repeat(64)})})).json();assert.equal(unknown.reason,'unknown-base');
  const partial=await fetch(f.origin+'/api/client-update/plan',{method:'POST',body:JSON.stringify({baseReleaseId:f.baseId,files:[name]})});assert.equal(partial.status,400);
  const full=await fetch(f.origin+'/api/client-update/file?'+new URLSearchParams({base:f.releaseId,release:f.releaseId,file:'runtime/node.exe'}));assert.equal(full.status,409);
});
test('over-limit client never downloads any payload or changes a file even if server falsely offers it',async t=>{
  const f=await fixture(t),plan=updatePlan(f.base,f.catalog);plan.changed[0].gzipBytes=UPDATE_LIMIT+1;plan.bytes=1;let calls=0;
  const result=await updateLocalClient({root:f.pack,log:()=>{},request:async()=>{calls++;return {status:200,bytes:Buffer.from(JSON.stringify(plan))};}});
  assert.equal(result.status,'full-client-required');assert.equal(calls,1);await verifyClientFiles(f.pack,f.base);
});
test('corrupt download leaves old package intact; commit failure rolls all replacements and additions back',async t=>{
  const f=await fixture(t),row=Object.values(f.catalog.transport)[0],blob=path.join(f.delivery,f.releaseId,'blobs',row.gzipSha256+'.gz'),good=await fs.readFile(blob);
  await fs.writeFile(blob,'corrupt');await assert.rejects(updateLocalClient({root:f.pack,log:()=>{}}),/update-release-changed/);await verifyClientFiles(f.pack,f.base);
  await fs.writeFile(blob,good);let replaced=0;
  await assert.rejects(updateLocalClient({root:f.pack,log:()=>{},hooks:{afterReplace(){if(++replaced===3)throw Error('simulated-disk-error');}}}),/simulated-disk-error/);
  await verifyClientFiles(f.pack,f.base);await assert.rejects(fs.stat(path.join(f.pack,'dist/chunk-new.js')),error=>error.code==='ENOENT');
  assert.equal((await updateLocalClient({root:f.pack,log:()=>{}})).status,'updated');
});
test('startup recovers an interrupted replacement from a write-ahead journal',async t=>{
  const f=await fixture(t),work=path.join(f.pack,'.client-update'),name='dist/game.js';
  await fs.mkdir(path.join(work,'backup/dist'),{recursive:true});await fs.copyFile(path.join(f.pack,'client-manifest.json'),path.join(work,'manifest.before'));
  await fs.writeFile(path.join(work,'journal.json'),JSON.stringify({targetId:f.releaseId,files:[{file:name,existed:true},{file:'dist/added.js',existed:false}]}));
  await fs.rename(path.join(f.pack,name),path.join(work,'backup',name));await fs.writeFile(path.join(f.pack,name),'partly replaced');await fs.writeFile(path.join(f.pack,'dist/added.js'),'uncommitted');
  assert.equal(await recoverClientUpdate(f.pack),true);await verifyClientFiles(f.pack,f.base);await assert.rejects(fs.stat(path.join(f.pack,'dist/added.js')),error=>error.code==='ENOENT');
});
test('foreign paths, symlinks, incomplete plans and changed origins cannot mutate client files',async t=>{
  const f=await fixture(t),plan=updatePlan(f.base,f.catalog);plan.changed.pop();
  await assert.rejects(updateLocalClient({root:f.pack,request:async()=>({status:200,bytes:Buffer.from(JSON.stringify(plan))})}),/incomplete-update-plan/);await verifyClientFiles(f.pack,f.base);
  plan.changed.push({file:'../outside',sha256:sha('x'),gzipSha256:sha('x'),gzipBytes:1,bytes:1});
  await assert.rejects(updateLocalClient({root:f.pack,request:async()=>({status:200,bytes:Buffer.from(JSON.stringify(plan))})}),/invalid-update-file/);
  const changed=structuredClone(f.catalog);changed.manifest.remoteOrigin='https://foreign.invalid';assert.throws(()=>updatePlan(f.base,changed),/origin-changed/);
});
test('full-package-required opens an explanatory page and blocks login and oversized game fallback',async t=>{
  const f=await fixture(t),client=await createLocalClient({root:f.pack,manifest:f.base,updateState:{status:'full-client-required'}});
  await new Promise(resolve=>client.server.listen(0,'127.0.0.1',resolve));t.after(()=>client.close());const origin='http://127.0.0.1:'+client.server.address().port;
  assert.match(await(await fetch(origin+'/')).text(),/full client package/);assert.equal((await fetch(origin+'/api/login',{method:'POST',body:'{}'})).status,409);
  assert.equal((await fetch(origin+'/game/game.js?v=new')).status,409);assert.equal(f.requests.length,0);
});

test('real game server keeps full resource downloads closed while admitting sealed online updates before login',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.root,'dist'));await fs.writeFile(path.join(f.root,'dist/game.js'),'new code');
  await fs.mkdir(path.join(f.root,'artifacts'));await fs.writeFile(path.join(f.root,'artifacts/fixture.json'),'game asset');
  const app=await createDevServer({root:f.root,credentials:{username:'fixture-user',password:'fixture-only'},driverFactory:null,resourceDeliveryEnabled:false,clientUpdateRoot:f.delivery});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{app.closeStreams();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});const origin='http://127.0.0.1:'+app.server.address().port;
  assert.equal((await fetch(origin+'/api/client-update')).status,200);
  const plan=await(await fetch(origin+'/api/client-update/plan',{method:'POST',headers:{origin},body:JSON.stringify({baseReleaseId:f.baseId})})).json();assert.equal(plan.status,'update-available');
  assert.equal((await fetch(origin+'/api/client-update/file?'+new URLSearchParams({base:f.baseId,release:f.releaseId,file:'assets/fixture.json'}))).status,200);
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{origin},body:JSON.stringify({username:'fixture-user',password:'fixture-only'})}),cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(origin+'/assets/fixture.json',{headers:{cookie}})).status,503);
  assert.equal((await(await fetch(origin+'/api/resource-delivery')).json()).enabled,false);
});

test('an interrupted download and concurrent launches leave the old package verifiable',async t=>{
  const f=await fixture(t),plan=updatePlan(f.base,f.catalog);let downloads=0;
  await assert.rejects(updateLocalClient({root:f.pack,log:()=>{},request:async(origin,url)=>{
    if(url.endsWith('/plan'))return {status:200,bytes:Buffer.from(JSON.stringify(plan))};
    if(++downloads===2)throw Error('simulated-network-disconnect');
    return {status:200,bytes:await fs.readFile(path.join(f.delivery,f.releaseId,'blobs',plan.changed[0].gzipSha256+'.gz'))};
  }}),/simulated-network-disconnect/);await verifyClientFiles(f.pack,f.base);
  await fs.writeFile(path.join(f.pack,'.client-update.lock'),JSON.stringify({pid:process.pid}));
  await assert.rejects(updateLocalClient({root:f.pack}),/client-already-updating/);await verifyClientFiles(f.pack,f.base);
});

for(const phase of ['missing-pointer','previous-build-pointer'])test(`the same live delivery handler retries ${phase} after current version registration`,async t=>{
  const f=await fixture(t),pointer=path.join(f.delivery,'current.json'),registered=await fs.readFile(pointer);
  const warm=await fetch(f.origin+'/api/client-update');assert.equal(warm.status,200);await warm.arrayBuffer();
  if(phase==='missing-pointer')await fs.unlink(pointer);
  else await fs.writeFile(pointer,JSON.stringify({releaseId:f.baseId,buildSha256:f.base.buildSha256}));
  const early=await Promise.all(Array.from({length:3},()=>fetch(f.origin+'/api/client-update')));
  for(const response of early){assert.equal(response.status,404);assert.equal((await response.json()).status,'unavailable');}
  await fs.writeFile(pointer,registered);
  const available=await fetch(f.origin+'/api/client-update');assert.equal(available.status,200);assert.equal((await available.json()).releaseId,f.releaseId);
  assert.equal((await updateLocalClient({root:f.pack,log:()=>{}})).status,'updated');await verifyClientFiles(f.pack,f.target);
});

test('a failed catalog load is not cached and the same live handler recovers after registration completes',async t=>{
  const f=await fixture(t),catalog=path.join(f.delivery,f.releaseId,'catalog.json'),registered=await fs.readFile(catalog);
  await fs.unlink(catalog);
  for(const response of await Promise.all(Array.from({length:3},()=>fetch(f.origin+'/api/client-update')))){
    assert.equal(response.status,503);assert.equal((await response.json()).error,'client-update-unavailable');
  }
  await fs.writeFile(catalog,registered);
  const available=await fetch(f.origin+'/api/client-update');assert.equal(available.status,200);assert.equal((await available.json()).releaseId,f.releaseId);
  assert.equal((await updateLocalClient({root:f.pack,log:()=>{}})).status,'updated');await verifyClientFiles(f.pack,f.target);
});

test('same-build resource and guide publication switches a live handler to the new release and refuses stale file requests',async t=>{
  const f=await fixture(t);assert.equal((await updateLocalClient({root:f.pack,log:()=>{}})).status,'updated');
  const manifest=structuredClone(f.target),changed={'assets/fixture.json':'revised resource without a JS rebuild','PLAYER-GUIDE.txt':'revised local guide'};
  for(const[name,bytes]of Object.entries(changed)){manifest.files[name]=sha(bytes);if(name.startsWith('assets/'))manifest.assets[name.slice(7)]=sha(bytes);}
  assert.equal(manifest.buildSha256,f.target.buildSha256);
  const releaseId=id(manifest),folder=path.join(f.delivery,releaseId),transport=structuredClone(f.catalog.transport);
  await fs.mkdir(path.join(folder,'blobs'),{recursive:true});
  for(const[name,row]of Object.entries(transport))if(!Object.hasOwn(changed,name))
    await fs.copyFile(path.join(f.delivery,f.releaseId,'blobs',row.gzipSha256+'.gz'),path.join(folder,'blobs',row.gzipSha256+'.gz'));
  for(const[name,bytes]of Object.entries(changed)){
    const encoded=gzipSync(bytes);transport[name]={bytes:Buffer.byteLength(bytes),gzipBytes:encoded.length,gzipSha256:sha(encoded)};
    await fs.writeFile(path.join(folder,'blobs',sha(encoded)+'.gz'),encoded);
  }
  await fs.writeFile(path.join(folder,'catalog.json'),JSON.stringify({schemaVersion:1,releaseId,manifest,transport}));
  await fs.writeFile(path.join(f.delivery,'current.json'),JSON.stringify({releaseId,buildSha256:manifest.buildSha256}));
  for(const response of await Promise.all(Array.from({length:4},()=>fetch(f.origin+'/api/client-update')))){
    assert.equal(response.status,200);assert.equal((await response.json()).releaseId,releaseId);
  }
  const plan=await(await fetch(f.origin+'/api/client-update/plan',{method:'POST',body:JSON.stringify({baseReleaseId:f.releaseId})})).json();
  assert.equal(plan.releaseId,releaseId);assert.deepEqual(plan.changed.map(row=>row.file).sort(),Object.keys(changed).sort());
  const stale=await fetch(f.origin+'/api/client-update/file?'+new URLSearchParams({base:f.baseId,release:f.releaseId,file:'assets/fixture.json'}));
  assert.equal(stale.status,409);assert.equal((await stale.json()).error,'update-not-allowed');
  const result=await updateLocalClient({root:f.pack,log:()=>{}});assert.equal(result.status,'updated');assert.equal(result.files,2);assert.equal(result.releaseId,releaseId);
  await verifyClientFiles(f.pack,manifest);assert.equal((await updateLocalClient({root:f.pack,log:()=>{}})).status,'current');
});

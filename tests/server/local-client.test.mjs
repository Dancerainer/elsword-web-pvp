import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createLocalClient,verifyClientFiles} from '../../apps/local-client/client.mjs';
import {resolveServerOrigin} from '../../apps/local-client/server-config.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
test('server settings take precedence over legacy defaults and invalid overrides fail closed',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'web-pvp-settings-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const configPath=path.join(dir,'server-config.json');
  const settings={configPath,manifest:{remoteOrigin:'https://legacy.example'},env:{}};
  assert.equal(await resolveServerOrigin(settings),'https://legacy.example');
  await fs.writeFile(configPath,JSON.stringify({serverUrl:'https://game.example:8443/'}));
  assert.equal(await resolveServerOrigin(settings),'https://game.example:8443');
  assert.equal(await resolveServerOrigin({...settings,env:{WEB_PVP_SERVER_URL:'http://[::1]:8080'}}),'http://[::1]:8080');
  for(const value of ['','file:///game','https://user@game.example','https://game.example/path','https://game.example?query','https://game.example#fragment']){
    await assert.rejects(resolveServerOrigin({...settings,env:{WEB_PVP_SERVER_URL:value}}),/serverUrl/);
  }
  await fs.writeFile(configPath,'{}');
  await assert.rejects(resolveServerOrigin(settings),/serverUrl/);
});
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'local-client-')),requests=[];
  const data={'assets/fixture.json':'LOCAL_RESOURCE','dist/game.js':'LOCAL_CODE','apps/web/index.html':'LOCAL_INDEX'};
  for(const [file,bytes]of Object.entries(data)){await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),bytes);}
  const manifest={schemaVersion:1,buildSha256:sha('LOCAL_CODE'),assets:{'fixture.json':sha('LOCAL_RESOURCE')},files:Object.fromEntries(Object.entries(data).map(([file,bytes])=>[file,sha(bytes)]))};
  let inventory=manifest.assets;
  const remote=http.createServer((req,res)=>{
    requests.push({url:req.url,origin:req.headers.origin,host:req.headers.host,cookie:req.headers.cookie});
    if(req.url.startsWith('/assets/')){res.writeHead(503);return res.end('REMOTE_DISABLED');}
    if(req.url==='/api/session'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({buildVersion:manifest.buildSha256,resourceDelivery:{enabled:false}}));}
    if(req.url==='/api/asset-versions'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({schemaVersion:1,files:inventory}));}
    if(req.url==='/api/login'){res.setHeader('Set-Cookie','rf_session=fixture; HttpOnly; SameSite=Strict; Path=/; Secure; Domain=example.test');return res.end('{}');}
    if(req.url==='/api/online/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('event: status\ndata: {"ready":true}\n\n');return;}
    res.end('REMOTE_CODE');
  });
  const peers=new Set();remote.on('upgrade',(req,socket,head)=>{
    requests.push({url:req.url,origin:req.headers.origin,host:req.headers.host});peers.add(socket);socket.once('close',()=>peers.delete(socket));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nHELLO');
    if(head.length)socket.write(head);socket.on('data',chunk=>socket.write(chunk));socket.on('error',()=>{});
  });
  await new Promise(resolve=>remote.listen(0,'127.0.0.1',resolve));
  const remoteOrigin=`http://127.0.0.1:${remote.address().port}`;
  await fs.writeFile(path.join(root,'server-config.json'),JSON.stringify({serverUrl: remoteOrigin}));
  const client=await createLocalClient({root,manifest});await new Promise(resolve=>client.server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${client.server.address().port}`;
  t.after(async()=>{await client.close();for(const socket of peers)socket.destroy();remote.closeAllConnections();await new Promise(resolve=>remote.close(resolve));assert.ok(root.startsWith(os.tmpdir()+path.sep));await fs.rm(root,{recursive:true,force:true});});
  const login=await fetch(origin+'/api/login',{method:'POST'});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  return {root,manifest,client,origin,remoteOrigin,requests,headers:{cookie},stale:()=>{inventory={'fixture.json':sha('NEW_RESOURCE')};}};
}
test('local resource bytes work with remote downloads closed, never fall back, and stale inventory is refused',async t=>{
  const f=await fixture(t);
  const session=await(await fetch(f.origin+'/api/session',{headers:f.headers})).json();assert.equal(session.localResourceClient,true);assert.equal(session.traceExport,'download');
  assert.equal((await fetch(f.origin+'/api/asset-versions',{headers:f.headers})).status,200);
  assert.equal(await(await fetch(f.origin+'/assets/fixture.json?v='+f.manifest.assets['fixture.json'],{headers:f.headers})).text(),'LOCAL_RESOURCE');
  assert.equal((await fetch(f.origin+'/assets/missing.glb',{headers:f.headers})).status,404);
  assert.equal((await fetch(f.origin+'/assets/fixture.json?v=wrong',{headers:f.headers})).status,409);
  assert.equal(f.requests.some(row=>row.url.startsWith('/assets/')),false);
  f.stale();assert.equal((await fetch(f.origin+'/api/asset-versions',{headers:f.headers})).status,409);
  assert.equal((await fetch(f.origin+'/assets/fixture.json',{headers:f.headers})).status,409);
});
test('local origin restrictions, cookie rewriting, and bounded update policy keep upstream pinned',async t=>{
  const f=await fixture(t);
  const login=await fetch(f.origin+'/api/login',{method:'POST',headers:{origin:f.origin},body:'{}'});
  assert.equal(login.status,200);assert.doesNotMatch(login.headers.get('set-cookie'),/Secure|Domain/);assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  assert.equal(f.requests.at(-1).origin,f.remoteOrigin);assert.equal(f.requests.at(-1).host,new URL(f.remoteOrigin).host);
  assert.equal((await fetch(f.origin+'/api/login',{method:'POST',headers:{origin:'http://foreign.invalid'},body:'{}'})).status,403);
  const foreignHost=await new Promise((resolve,reject)=>{const request=http.get(f.origin+'/api/session',{headers:{host:'foreign.invalid'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});
  assert.equal(foreignHost,403);
  assert.equal(await(await fetch(f.origin+'/game/game.js?v='+f.manifest.buildSha256)).text(),'LOCAL_CODE');
  assert.equal((await fetch(f.origin+'/game/game.js?v=new-build')).status,409);
  assert.equal(f.requests.some(row=>row.url.startsWith('/game/')),false);
});
test('switching servers does not forward the session cookie of the previous server',async t=>{
  const first=await fixture(t),second=await fixture(t);
  assert.notEqual(first.headers.cookie,second.headers.cookie);
  await fetch(second.origin+'/api/session',{headers:first.headers});
  assert.equal(second.requests.at(-1).cookie,undefined);
  await fetch(second.origin+'/api/session',{headers:{cookie:first.headers.cookie+'; '+second.headers.cookie}});
  assert.equal(second.requests.at(-1).cookie,'rf_session=fixture');
});
test('SSE arrives immediately and WebSocket upgrade relays both directions through rewritten origin',async t=>{
  const f=await fixture(t),abort=new AbortController();
  const events=await fetch(f.origin+'/api/online/events',{signal:abort.signal});const reader=events.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value),/ready/);abort.abort();
  const socket=net.connect(f.client.server.address().port,'127.0.0.1');t.after(()=>socket.destroy());
  const output=await new Promise((resolve,reject)=>{
    let text='';socket.on('error',reject);socket.on('data',chunk=>{text+=chunk;if(text.includes('PING'))resolve(text);});
    socket.on('connect',()=>socket.write(`GET /api/online/socket HTTP/1.1\r\nHost: 127.0.0.1:${f.client.server.address().port}\r\nOrigin: ${f.origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nPING`));
  });assert.match(output,/101 Switching Protocols/);assert.match(output,/HELLO/);assert.match(output,/PING/);
  assert.equal(f.requests.find(row=>row.url==='/api/online/socket').origin,f.remoteOrigin);
});
test('whole-package verification catches corruption and escaping inventory paths',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'assets/fixture.json'),'CORRUPT');
  await assert.rejects(verifyClientFiles(f.root,f.manifest),/Client file damaged/);
  await assert.rejects(verifyClientFiles(f.root,{...f.manifest,files:{'../secret':sha('x')}}),/invalid-client-file/);
});

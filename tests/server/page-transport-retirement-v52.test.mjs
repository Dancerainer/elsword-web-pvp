/** Actual HTTP/SSE/poll/WebSocket page replacement; no battle fixture. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';
import {createNodeOnlineSocketClass} from '../../tools/node-online-socket.mjs';
async function fixture(t){
 const root=await mkdtemp(path.join(tmpdir(),'webpvp-page-transport-'));
 await mkdir(path.join(root,'dist'));await writeFile(path.join(root,'dist/game.js'),'fixture');
 const account={username:'page-player',password:'isolated-page-password',role:'player'};
 const app=await createDevServer({root,credentials:account}),origin='http://127.0.0.1:'+await listenLoopback(app.server);
 let cookie;
 const request=(route,{method='GET',body,headers={}}={})=>fetch(origin+route,{method,
  headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const login=await request('/api/login',{method:'POST',body:account});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 t.after(async()=>{app.closeStreams();app.server.closeAllConnections();await new Promise(done=>app.server.close(done));
  assert.ok(root.startsWith(path.resolve(tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
 const identify=token=>request('/api/session',{headers:{'X-RF-Page-Init':token}});
 async function downstream(token,transport){
  if(transport==='sse'){
   const response=await request('/api/online/events?pageInitToken='+token);assert.equal(response.status,200);
   const reader=response.body.getReader();await reader.read();t.after(()=>reader.cancel().catch(()=>{}));
  }else{
   const response=await request('/api/online/poll/open',{method:'POST',body:{},headers:{'X-RF-Page-Init':token}});assert.equal(response.status,200);await response.json();
  }
 }
 async function upload(token){
  const Socket=createNodeOnlineSocketClass({base:origin,cookie:()=>cookie}),socket=new Socket('/api/online/socket?pageInitToken='+token,'rf-online-gzip-v1');
  t.after(()=>socket.close());await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=()=>reject(Error('WebSocket rejected'));});return socket;
 }
 return {app,request,identify,downstream,upload};
}
for(const transport of ['sse','poll'])test(`fresh identified ${transport} page retires a still-open old upload before battle handoff`,async t=>{
 const f=await fixture(t),old='old-live-page-transport-v52',current='new-live-page-transport-v52';
 assert.equal((await f.identify(old)).status,200);await f.downstream(old,transport);await f.upload(old);
 assert.equal((await f.identify(current)).status,200);await f.downstream(current,transport);
 assert.equal((await f.request('/api/heartbeat',{method:'POST',headers:{'X-RF-Page-Init':old}})).status,409);
 assert.equal((await f.request('/api/heartbeat',{method:'POST',headers:{'X-RF-Page-Init':current}})).status,200);
 const handoff=await f.request('/api/online/handoff',{method:'POST',body:{pageInitToken:current}}),ack=await handoff.json();
 assert.equal(handoff.status,200,JSON.stringify(ack));assert.notEqual(ack.pageInitToken,current);
 assert.equal((await f.identify(old)).status,409,'retired page cannot reacquire identity');
 await f.downstream(ack.pageInitToken,transport);await f.upload(ack.pageInitToken);
});
test('ordinary status reads and invalid page IDs preserve the live upload',async t=>{
 const f=await fixture(t),token='same-live-page-transport-v52';assert.equal((await f.identify(token)).status,200);
 await f.downstream(token,'sse');await f.upload(token);
 const before=f.app.transportDiagnostics().sockets.length;
 assert.equal((await f.request('/api/session')).status,200);assert.equal((await f.identify('bad')).status,400);
 assert.equal(f.app.transportDiagnostics().sockets.length,before);
 assert.equal((await f.request('/api/online/handoff',{method:'POST',body:{pageInitToken:token}})).status,200);
});

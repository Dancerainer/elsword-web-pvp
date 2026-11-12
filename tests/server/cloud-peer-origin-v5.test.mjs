/** Real loopback HTTP/TCP/WS regression; no SSH or native battle simulation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer,connect} from 'node:net';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {ONLINE_SOCKET_PROTOCOL} from '../../apps/server/websocket-stream.mjs';
import {createNodeOnlineSocketClass} from '../../tools/node-online-socket.mjs';

test('transparent forwarding requires local URL Origin for fetch login, heartbeat, SSE and WebSocket',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'cloud-origin-v5-')),
  credentials={username:'isolated-origin-player',password:'synthetic-password-only',role:'player'},connections=new Set(),observed=[];
 const ctx=await createDevServer({root,accountRoot:path.join(root,'accounts'),driverFactory:null,roomWorkers:false,
  credentials,additionalCredentials:[],createPlayerAccount:false});
 let socket,reader;const controller=new AbortController();
 await new Promise(resolve=>ctx.server.listen(0,'127.0.0.1',resolve));
 ctx.server.prependListener('request',req=>observed.push({path:req.url,host:req.headers.host,origin:req.headers.origin}));
 const proxy=createServer(local=>{
  const upstream=connect(ctx.server.address().port,'127.0.0.1');
  for(const stream of [local,upstream]){connections.add(stream);stream.on('error',()=>{local.destroy();upstream.destroy();});stream.once('close',()=>connections.delete(stream));}
  local.pipe(upstream);upstream.pipe(local);
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{
  socket?.close();controller.abort();await reader?.cancel().catch(()=>{});ctx.closeStreams();ctx.online.close();
  for(const stream of connections)stream.destroy();
  await new Promise(resolve=>proxy.close(resolve));ctx.server.closeAllConnections();
  await new Promise(resolve=>ctx.server.close(resolve));
  assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('cloud-origin-v5-'));
  await rm(root,{recursive:true,force:true});
 });
 const base='http://127.0.0.1:'+proxy.address().port,remote='http://127.0.0.1:'+ctx.server.address().port;
 assert.notEqual(base,remote);
 // This is the old harness's exact fetch header arrangement. Undici selects
 // the URL Host, so the destination-port Origin must still be rejected.
 const rejected=await fetch(base+'/api/login',{method:'POST',headers:{Origin:remote,Host:new URL(remote).host,
  'Content-Type':'application/json'},body:JSON.stringify(credentials),signal:AbortSignal.timeout(3000)});
 assert.equal(rejected.status,403);assert.equal((await rejected.json()).error,'origin-denied');
 assert.equal(observed.at(-1).host,new URL(base).host);assert.equal(observed.at(-1).origin,remote);
 let cookie;
 const request=async(relative,{method='GET',body,signal,origin=base}={})=>{
  const response=await fetch(base+relative,{method,headers:{Origin:origin,Host:new URL(origin).host,
   ...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),signal:signal??AbortSignal.timeout(3000)});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;
 };
 const login=await request('/api/login',{method:'POST',body:credentials});assert.equal(login.status,200);
 assert.equal((await login.json()).username,credentials.username);
 assert.equal((await request('/api/heartbeat',{method:'POST'})).status,200);
 assert.equal((await request('/api/heartbeat',{method:'POST',origin:remote})).status,403,'production origin guard remains enforced');
 assert.equal((await request('/api/session')).status,200);
 const stream=await request('/api/online/events',{signal:controller.signal});assert.equal(stream.status,200);
 reader=stream.body.getReader();let text='';
 while(!text.includes('event: status')){const part=await reader.read();assert.equal(part.done,false);text+=new TextDecoder().decode(part.value);}
 const Socket=createNodeOnlineSocketClass({base,origin:base,cookie:()=>cookie});
 const transport=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('loopback socket deadline')),3000);
  const finish=(error,value)=>{clearTimeout(timer);error?reject(error):resolve(value);};
  socket=new Socket('/api/online/socket?textAck=1&ownedDelta=3',ONLINE_SOCKET_PROTOCOL);
  socket.onerror=()=>finish(Error('loopback socket failed'));
  socket.onmessage=event=>{try{finish(null,JSON.parse(event.data));}catch(error){finish(error);}};
 });
 assert.equal(transport.type,'transport');assert.equal(transport.data.connected,true);
 assert.equal((await request('/api/logout',{method:'POST'})).status,200);
 assert.equal(ctx.sessions.size,0);assert.equal(ctx.transportDiagnostics().socketOpened,1);
});

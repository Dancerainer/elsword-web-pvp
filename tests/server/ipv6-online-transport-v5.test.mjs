import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {createNodeOnlineSocketClass} from '../../tools/node-online-socket.mjs';

test('IPv6 literal origin supports authenticated session, gzip SSE and negotiated WebSocket',async t=>{
  const root=fileURLToPath(new URL('../../',import.meta.url)),runtime=path.join(root,'runtime');
  await mkdir(runtime,{recursive:true});const accountRoot=await mkdtemp(path.join(runtime,'ipv6-transport-v5-'));
  const credential={username:'ipv6-fixture-player',password:'fixture-only-secret',role:'player'};
  const ctx=await createDevServer({root,accountRoot,credentials:credential,driverFactory:null,createPlayerAccount:false});
  let socket;const abort=new AbortController();
  t.after(async()=>{socket?.close();abort.abort();ctx.closeStreams();ctx.online.close();ctx.server.closeAllConnections();
    await new Promise(resolve=>ctx.server.close(resolve));assert.ok(accountRoot.startsWith(runtime+path.sep));
    await rm(accountRoot,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{ctx.server.once('error',reject);ctx.server.listen(0,'::1',resolve);});
  const base=`http://[::1]:${ctx.server.address().port}`;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(credential)});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const headers={Origin:base,Cookie:cookie};
  assert.equal((await fetch(base+'/api/session',{headers})).status,200);
  assert.equal((await fetch(base+'/api/logout',{method:'POST',headers:{...headers,Origin:'http://[::2]'}})).status,403);
  const events=await fetch(base+'/api/online/events',{headers:{...headers,'Accept-Encoding':'gzip'},signal:abort.signal});
  assert.equal(events.status,200);assert.equal(events.headers.get('content-encoding'),'gzip');
  const reader=events.body.getReader(),first=await reader.read();assert.match(new TextDecoder().decode(first.value),/event: status/);
  const Socket=createNodeOnlineSocketClass({base,cookie:()=>cookie});
  const transport=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('IPv6 WebSocket transport timeout')),4000);
    socket=new Socket('/api/online/socket?textAck=1&ownedDelta=3','rf-online-gzip-v1');
    socket.onerror=()=>{clearTimeout(timeout);reject(Error('IPv6 WebSocket failed'));};
    socket.onmessage=event=>{clearTimeout(timeout);resolve(event.data);};
  });
  assert.equal(typeof transport,'string');assert.equal(JSON.parse(transport).type,'transport');
  socket.close();abort.abort();assert.equal((await fetch(base+'/api/logout',{method:'POST',headers})).status,200);
});

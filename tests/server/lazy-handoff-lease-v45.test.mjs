/** Real HTTP same-page lobby -> battle lease boundaries. The injected driver
 * supplies lifecycle only; it makes no claim about original combat. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';
import http from 'node:http';
import {createNodeOnlineSocketClass} from '../../tools/node-online-socket.mjs';
const accounts=Array.from({length:4},(_,i)=>({username:'lazy-lease-'+i,password:'test-lease-password-'+i,role:'player'}));
function timers(){const pending=new Set();return {pending,setTimeout(callback,delay){const t={callback,delay,unref(){}};pending.add(t);return t;},clearTimeout(t){pending.delete(t);}};}
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'webpvp-lazy-lease-'));await mkdir(path.join(root,'dist'));await writeFile(path.join(root,'dist/game.js'),'fixture');
 let clock=100000;const disconnectTimers=timers(),pollTimers=timers(),drivers=[];
 const instance=await createDevServer({root,credentials:accounts[0],additionalCredentials:accounts.slice(1),now:()=>clock,disconnectTimers,pollTimers,
  driverFactory(args){const driver={...args,disconnected:[],snapshot:()=>null,submitInput(){},ready(){return {ok:true};},disconnect(id){this.disconnected.push(id);},stop(){}};drivers.push(driver);return driver;}});
 const base='http://127.0.0.1:'+await listenLoopback(instance.server);
 t.after(async()=>{instance.closeStreams();await new Promise(resolve=>instance.server.close(resolve));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
 const request=(route,cookie,{method='GET',body,signal,headers={}}={})=>fetch(base+route,{method,signal,
  headers:{'Content-Type':'application/json',...(cookie?{cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const players=[];
 for(const [i,account]of accounts.entries()){
  const response=await request('/api/login',null,{method:'POST',body:account});assert.equal(response.status,200);await response.json();
  const cookie=response.headers.get('set-cookie').split(';')[0],token='same-page-lazy-'+i;
  assert.equal((await request('/api/session',cookie,{headers:{'X-RF-Page-Init':token}})).status,200);players.push({cookie,token});
 }
 const openPoll=async p=>{const response=await request('/api/online/poll/open',p.cookie,{method:'POST',body:{},headers:{'X-RF-Page-Init':p.token}});assert.equal(response.status,200);return response.json();};
 const poll=(p,lease,after=lease.cursor,extra={})=>request('/api/online/poll?connectionId='+lease.connectionId+'&after='+after,p.cookie,extra);
 for(const p of players){p.lease=await openPoll(p);p.seed=await(await poll(p,p.lease)).json();}
 for(const p of players)assert.equal((await request('/api/online/queue',p.cookie,{method:'POST',body:{mode:'2v2'}})).status,200);
 clock+=11000;await instance.online.tick();assert.equal(drivers.length,1);
 return {instance,drivers,players,request,openPoll,poll,disconnectTimers,base,
  closePoll:(p,lease)=>request('/api/online/poll/close',p.cookie,{method:'POST',body:{connectionId:lease.connectionId}}),
  async pendingPoll(p,lease,after){
   const controller=new AbortController();let observer;
   const seen=new Promise(resolve=>{observer=(req,res)=>{if(!req.url.startsWith('/api/online/poll?')||req.headers.cookie!==p.cookie)return;
    instance.server.off('request',observer);resolve(res);};instance.server.on('request',observer);});
   const response=poll(p,lease,after,{signal:controller.signal}).catch(()=>null),res=await seen;
   const closed=new Promise(resolve=>res.once('close',resolve));t.after(()=>{controller.abort();instance.server.off('request',observer);});
   return {response,closed,abort:()=>controller.abort()};
  }};
}

const handoff=(f,p,token=p.token)=>f.request('/api/online/handoff',p.cookie,{method:'POST',body:{pageInitToken:token}});
async function slowPost(t,f,p,route,body,headers={}){
 const bytes=JSON.stringify(body);let begin;
 const admitted=new Promise(resolve=>{begin=req=>{if(req.url===route&&req.headers.cookie===p.cookie){f.instance.server.off('request',begin);resolve();}};f.instance.server.on('request',begin);});
 let request;
 const response=new Promise((resolve,reject)=>{
  request=http.request(f.base+route,{method:'POST',headers:{Cookie:p.cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(bytes),...headers}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks))}));});
  request.once('error',reject);request.flushHeaders();request.write(bytes.slice(0,1));
 });
 t.after(()=>{request.destroy();f.instance.server.off('request',begin);});await admitted;
 return {finish(){request.end(bytes.slice(1));return response;}};
}
function openSocket(t,f,p){
 const Socket=createNodeOnlineSocketClass({base:f.base,cookie:()=>p.cookie}),socket=new Socket('/api/online/socket?pageInitToken='+encodeURIComponent(p.token),'rf-online-gzip-v1');
 const opened=new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=()=>reject(Error('fixture WebSocket rejected'));});
 const closed=new Promise(resolve=>{socket.onclose=resolve;});t.after(()=>socket.close());return {socket,opened,closed};
}

test('handoff atomically retires pending poll and rotates page identity; old reconnects reject before replacement opens',async t=>{
 const f=await fixture(t),p=f.players[0],batch=await(await f.poll(p,p.lease,p.seed.cursor)).json(),old=await f.pendingPoll(p,p.lease,batch.cursor);
 const session=[...f.instance.sessions.values()].find(s=>s.username===accounts[0].username),generation=session.pageGeneration,oldToken=p.token;
 const reply=await handoff(f,p);assert.equal(reply.status,200);const ack=await reply.json();
 assert.match(ack.pageInitToken,/^[A-Za-z0-9_-]{8,100}$/);assert.notEqual(ack.pageInitToken,oldToken);
 assert.equal(session.pageGeneration,generation+1);assert.equal(session.pageInitToken,ack.pageInitToken);await old.closed;await old.response;
 for(const route of ['/api/online/events?pageInitToken='+oldToken,'/api/online/poll/open']){
  const stale=await f.request(route,p.cookie,route.endsWith('/open')?{method:'POST',body:{},headers:{'X-RF-Page-Init':oldToken}}:{});
  assert.equal(stale.status,409);assert.equal((await stale.json()).error,'page-generation-retired');
 }
 p.token=ack.pageInitToken;const replacement=await f.openPoll(p),seed=await(await f.poll(p,replacement)).json();
 assert.ok(seed.events.some(e=>e.type==='match'&&e.data.id===f.drivers[0].match.id));
 assert.deepEqual(f.drivers[0].disconnected,[]);
});

test('replayed and slow-body old handoff return the same ACK without retiring a new pending replacement',async t=>{
 const f=await fixture(t),p=f.players[0],oldToken=p.token;
 const delayed=await slowPost(t,f,p,'/api/online/handoff',{pageInitToken:oldToken});
 const response=await handoff(f,p);assert.equal(response.status,200);const ack=await response.json();p.token=ack.pageInitToken;
 const replacement=await f.openPoll(p),seed=await(await f.poll(p,replacement)).json(),live=await f.pendingPoll(p,replacement,seed.cursor);
 const retry=await handoff(f,p,oldToken);assert.equal(retry.status,200);assert.deepEqual(await retry.json(),ack);
 const late=await delayed.finish();assert.equal(late.status,200);assert.deepEqual(late.body,ack);
 const duplicate=await f.request('/api/online/poll/open',p.cookie,{method:'POST',body:{},headers:{'X-RF-Page-Init':p.token}});
 assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).error,'stream-already-open');
 assert.equal((await f.closePoll(p,p.lease)).status,200,'old connection-specific close cannot revoke replacement');
 assert.equal((await f.closePoll(p,replacement)).status,200);await live.closed;await live.response;
 assert.deepEqual(f.drivers[0].disconnected,[]);
});

test('poll open admitted before handoff cannot install an obsolete lease after its body completes',async t=>{
 const f=await fixture(t),p=f.players[0],oldToken=p.token;
 const delayed=await slowPost(t,f,p,'/api/online/poll/open',{}, {'X-RF-Page-Init':oldToken});
 const reply=await handoff(f,p);assert.equal(reply.status,200);p.token=(await reply.json()).pageInitToken;
 const late=await delayed.finish();assert.equal(late.status,409);assert.equal(late.body.error,'page-generation-retired');
 const replacement=await f.openPoll(p),seed=await(await f.poll(p,replacement)).json();assert.ok(seed.events.some(e=>e.type==='match'));
});

test('invalid, foreign and unauthenticated handoff requests leave the original pending lease intact',async t=>{
 const f=await fixture(t),p=f.players[0],batch=await(await f.poll(p,p.lease,p.seed.cursor)).json(),live=await f.pendingPoll(p,p.lease,batch.cursor);
 const cases=[{body:{pageInitToken:p.token,extra:1},status:400},{body:{pageInitToken:'bad'},status:400},
  {body:{pageInitToken:f.players[1].token},status:409},{body:{pageInitToken:p.token},cookie:'',status:401}];
 for(const row of cases){const result=await f.request('/api/online/handoff',row.cookie??p.cookie,{method:'POST',body:row.body});assert.equal(result.status,row.status);await result.json();}
 const session=[...f.instance.sessions.values()].find(s=>s.username===accounts[0].username);
 while(session.pageInitTokens.size<256)session.pageInitTokens.add('capacity-fixture-token-'+session.pageInitTokens.size);
 const limited=await handoff(f,p);assert.equal(limited.status,409);assert.equal((await limited.json()).error,'page-initialization-limit');
 const duplicate=await f.request('/api/online/poll/open',p.cookie,{method:'POST',body:{},headers:{'X-RF-Page-Init':p.token}});assert.equal(duplicate.status,409);
 assert.equal((await f.closePoll(p,p.lease)).status,200);await live.closed;await live.response;
 assert.deepEqual(f.drivers[0].disconnected,[]);
});

test('handoff awaiting a body cannot revoke a later login session for the same account',async t=>{
 const f=await fixture(t),old=f.players[0],delayed=await slowPost(t,f,old,'/api/online/handoff',{pageInitToken:old.token});
 assert.equal((await f.request('/api/logout',old.cookie,{method:'POST',body:{}})).status,200);
 const login=await f.request('/api/login',null,{method:'POST',body:accounts[0]});assert.equal(login.status,200);
 const current={cookie:login.headers.get('set-cookie').split(';')[0],token:'fresh-login-page-token-123'};
 assert.equal((await f.request('/api/session',current.cookie,{headers:{'X-RF-Page-Init':current.token}})).status,200);
 const lease=await f.openPoll(current),seed=await(await f.poll(current,lease)).json(),live=await f.pendingPoll(current,lease,seed.cursor);
 const late=await delayed.finish();assert.equal(late.status,401);assert.equal(late.body.error,'login-required');
 const overlap=await f.request('/api/online/poll/open',current.cookie,{method:'POST',body:{},headers:{'X-RF-Page-Init':current.token}});assert.equal(overlap.status,409);
 assert.equal((await f.closePoll(current,lease)).status,200);await live.closed;await live.response;
});

test('completed old handoff cannot authorize retiring a later authenticated page lease',async t=>{
 const f=await fixture(t),p=f.players[0],originalToken=p.token,response=await handoff(f,p);assert.equal(response.status,200);p.token=(await response.json()).pageInitToken;
 const laterToken='genuinely-later-page-123';assert.equal((await f.request('/api/session',p.cookie,{headers:{'X-RF-Page-Init':laterToken}})).status,200);p.token=laterToken;
 const replacement=await f.openPoll(p),seed=await(await f.poll(p,replacement)).json(),live=await f.pendingPoll(p,replacement,seed.cursor);
 assert.equal((await handoff(f,p,originalToken)).status,409);
 const overlap=await f.request('/api/online/poll/open',p.cookie,{method:'POST',body:{},headers:{'X-RF-Page-Init':laterToken}});assert.equal(overlap.status,409);
 assert.equal((await f.closePoll(p,replacement)).status,200);await live.closed;await live.response;
});

test('handoff retires actual SSE and WebSocket; old socket close cannot revoke replacement transports',async t=>{
 const f=await fixture(t),p=f.players[0];assert.equal((await f.closePoll(p,p.lease)).status,200);
 const abort=new AbortController(),response=await f.request('/api/online/events?pageInitToken='+p.token,p.cookie,{signal:abort.signal});assert.equal(response.status,200);
 t.after(()=>{abort.abort();});const old=openSocket(t,f,p);await old.opened;
 const reply=await handoff(f,p);assert.equal(reply.status,200);p.token=(await reply.json()).pageInitToken;await old.closed;
 const replacement=await f.openPoll(p),seed=await(await f.poll(p,replacement)).json(),live=await f.pendingPoll(p,replacement,seed.cursor);
 const next=openSocket(t,f,p);await next.opened;old.socket.close();
 assert.equal((await f.closePoll(p,p.lease)).status,200);assert.equal(next.socket.readyState,1);
 assert.equal((await f.closePoll(p,replacement)).status,200);await live.closed;await live.response;next.socket.close();await next.closed;
 abort.abort();await response.body.cancel().catch(()=>{});assert.deepEqual(f.drivers[0].disconnected,[]);
});

test('matched same-page bootstrap keeps the old pending poll alive; only acknowledged close admits its replacement',async t=>{
 const f=await fixture(t),p=f.players[0],batch=await(await f.poll(p,p.lease,p.seed.cursor)).json();
 const old=await f.pendingPoll(p,p.lease,batch.cursor),session=[...f.instance.sessions.values()].find(s=>s.username===accounts[0].username),generation=session.pageGeneration;
 const boot=await f.request('/api/session',p.cookie,{headers:{'X-RF-Page-Init':p.token}});assert.equal(boot.status,200);
 assert.equal((await boot.json()).online.match.id,f.drivers[0].match.id);assert.equal(session.pageGeneration,generation);
 const duplicate=await f.request('/api/online/poll/open',p.cookie,{method:'POST',body:{},headers:{'X-RF-Page-Init':p.token}});
 assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).error,'stream-already-open');
 assert.equal((await f.closePoll(p,p.lease)).status,200);await old.closed;await old.response;
 const replacement=await f.openPoll(p);assert.notEqual(replacement.connectionId,p.lease.connectionId);
 const seed=await(await f.poll(p,replacement)).json();assert.ok(seed.events.some(e=>e.type==='match'&&e.data.id===f.drivers[0].match.id));
 const live=await f.pendingPoll(p,replacement,seed.cursor);
 assert.equal((await f.closePoll(p,p.lease)).status,200,'late old close cannot revoke replacement');
 assert.ok([...f.instance.sessions.values()].includes(session));
 assert.deepEqual(f.drivers[0].disconnected,[]);live.abort();await live.closed;await live.response;
});

test('matched same-page SSE bootstrap rejects overlap and permits a closed-stream replacement without rotating page identity',async t=>{
 const f=await fixture(t),p=f.players[0];assert.equal((await f.closePoll(p,p.lease)).status,200);
 const route='/api/online/events?pageInitToken='+encodeURIComponent(p.token),abort=new AbortController();let observe;
 const closed=new Promise(resolve=>{observe=(req,res)=>{if(req.url!==route||req.headers.cookie!==p.cookie)return;f.instance.server.off('request',observe);res.once('close',resolve);};f.instance.server.on('request',observe);});
 t.after(()=>{abort.abort();f.instance.server.off('request',observe);});
 const response=await f.request(route,p.cookie,{signal:abort.signal});assert.equal(response.status,200);
 const session=[...f.instance.sessions.values()].find(s=>s.username===accounts[0].username),generation=session.pageGeneration;
 assert.equal((await f.request('/api/session',p.cookie,{headers:{'X-RF-Page-Init':p.token}})).status,200);assert.equal(session.pageGeneration,generation);
 const overlap=await f.request(route,p.cookie);assert.equal(overlap.status,409);assert.equal((await overlap.json()).error,'stream-already-open');
 abort.abort();await response.body.cancel().catch(()=>{});await closed;
 const replacement=await f.openPoll(p),seed=await(await f.poll(p,replacement)).json();
 assert.ok(seed.events.some(e=>e.type==='match'&&e.data.id===f.drivers[0].match.id));assert.equal(session.pageGeneration,generation);
 assert.deepEqual(f.drivers[0].disconnected,[]);
});

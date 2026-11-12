import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';
import {createNodeOnlineSocketClass} from '../../tools/node-online-socket.mjs';

const account={username:'takeover-fixture',password:'fixture-password'};
const peer={username:'takeover-peer',password:'peer-fixture-password'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t,options={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'rf-session-v59-'));let clock=100000;
 await mkdir(path.join(root,'dist'));await writeFile(path.join(root,'dist/game.js'),'session fixture');
 const drivers=[],instance=await createDevServer({root,credentials:account,additionalCredentials:[peer],now:()=>clock,
  driverFactory:args=>{const driver={...args,disconnected:[],inputs:[],ready(){},stop(){},snapshot(){return null;},
   disconnect(id,options){this.disconnected.push({id,...options});},submitInput(id,input){this.inputs.push({id,input});return {accepted:true};}};drivers.push(driver);return driver;},...options});
 const base='http://127.0.0.1:'+await listenLoopback(instance.server);
 t.after(async()=>{instance.closeStreams();instance.server.closeAllConnections();await new Promise(done=>instance.server.close(done));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
 const request=(route,{cookie,token,method='GET',body,signal}={})=>fetch(base+route,{method,signal,
  headers:{'Content-Type':'application/json',...(cookie?{cookie}:{}),...(token?{'X-RF-Page-Init':token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const login=async(credentials=account)=>{const response=await request('/api/login',{method:'POST',body:credentials});assert.equal(response.status,200);await response.json();return response.headers.get('set-cookie').split(';')[0];};
 const session=(cookie,token)=>request('/api/session',{cookie,token});
 const open=async(cookie,token)=>{const response=await request('/api/online/poll/open',{cookie,token,method:'POST',body:{}});assert.equal(response.status,200);return response.json();};
 const poll=(cookie,lease,after=lease.cursor)=>request('/api/online/poll?connectionId='+lease.connectionId+'&after='+after,{cookie});
 return {base,instance,drivers,request,login,session,open,poll,async advance(ms){clock+=ms;await instance.online.tick();}};
}

test('only valid credentials take over; old cookies, old tab identity and logout cannot clear the new session',async t=>{
 const f=await fixture(t),old=await f.login(),oldToken='old-page-v59';assert.equal((await f.session(old,oldToken)).status,200);
 const invalid=await f.request('/api/login',{method:'POST',body:{...account,password:'wrong'}});assert.equal(invalid.status,401);
 assert.equal((await f.session(old)).status,200);assert.equal(f.instance.sessions.size,1);
 const fresh=await f.login();assert.notEqual(fresh,old);assert.equal(f.instance.sessions.size,1);
 const expired=await f.session(old);assert.equal(expired.status,401);assert.equal((await expired.json()).error,'session-replaced');
 for(const route of ['/api/session','/api/heartbeat','/api/logout','/api/online/queue']){
  const response=await f.request(route,{cookie:fresh,token:oldToken,method:route==='/api/session'?'GET':'POST',body:route==='/api/online/queue'?{mode:'1v1'}:undefined});
  assert.equal(response.status,401,route);assert.equal((await response.json()).error,'session-replaced');assert.equal(response.headers.get('set-cookie'),null);
 }
 const oldLogout=await f.request('/api/logout',{cookie:old,method:'POST'});assert.equal(oldLogout.status,401);assert.equal(oldLogout.headers.get('set-cookie'),null);
 assert.equal((await f.session(fresh,'new-page-v59')).status,200);assert.equal(f.instance.sessions.size,1);
});

test('takeover flushes an SSE terminal notification before closure and retires only the old upload',async t=>{
 const f=await fixture(t),old=await f.login();await f.session(old,'sse-old-v59');
 const response=await f.request('/api/online/events?pageInitToken=sse-old-v59',{cookie:old});assert.equal(response.status,200);
 const Socket=createNodeOnlineSocketClass({base:f.base,cookie:()=>old});let socket;
 await new Promise((resolve,reject)=>{socket=new Socket('/api/online/socket?textAck=1&pageInitToken=sse-old-v59','rf-online-gzip-v1');
  socket.onmessage=event=>{assert.equal(JSON.parse(event.data).type,'transport');resolve();};socket.onerror=()=>reject(Error('socket open failed'));});
 const closed=new Promise(resolve=>{socket.onclose=resolve;});t.after(()=>socket.close());
 const body=response.text();const fresh=await f.login();const text=await body;await closed;
 assert.match(text,/event: session-replaced\ndata: .*session-replaced/);assert.equal((await f.session(fresh)).status,200);
 assert.equal(f.instance.transportDiagnostics().sessionReleases['session-replaced'],1);
});

test('a pending old session response cannot restore its cookie after the replacement commits',async t=>{
 const f=await fixture(t),old=await f.login();await f.advance(1800001);let unblock,reached;
 const waiting=new Promise(resolve=>{reached=resolve;}),profile=f.instance.accountStore.profile;let intercept=true;
 f.instance.accountStore.profile=async username=>{if(intercept&&username===account.username){intercept=false;reached();await new Promise(resolve=>{unblock=resolve;});}return profile(username);};
 const pending=f.session(old,'renew-old-v59');await waiting;const fresh=await f.login();unblock();
 const response=await pending;assert.equal(response.status,401);assert.equal(response.headers.get('set-cookie'),null);
 assert.equal((await f.session(fresh,'renew-new-v59')).status,200);
});

test('concurrent verified logins serialize takeover and leave one live identity',async t=>{
 const f=await fixture(t);await f.login();const results=await Promise.all(Array.from({length:3},()=>f.login()));
 const states=await Promise.all(results.map(cookie=>f.session(cookie)));assert.deepEqual(states.map(response=>response.status),[401,401,200]);
 assert.equal(f.instance.sessions.size,1);assert.equal(f.instance.transportDiagnostics().sessionReleases['session-replaced'],3);
});

test('pending poll gets an explicit terminal response and an old close cannot retire the replacement lease',async t=>{
 const f=await fixture(t,{onlineEventTransport:'poll'}),old=await f.login();await f.session(old,'poll-old-v59');
 const lease=await f.open(old,'poll-old-v59'),seed=await(await f.poll(old,lease)).json();
 let seen;const arrived=new Promise(resolve=>{seen=(req)=>{if(req.url.startsWith('/api/online/poll?')){f.instance.server.off('request',seen);resolve();}};f.instance.server.on('request',seen);});
 const pending=f.poll(old,lease,seed.cursor);await arrived;
 const fresh=await f.login(),ended=await pending;assert.equal(ended.status,401);assert.equal((await ended.json()).error,'session-replaced');
 await f.session(fresh,'poll-new-v59');const replacement=await f.open(fresh,'poll-new-v59');
 const closed=await f.request('/api/online/poll/close',{cookie:fresh,token:'poll-old-v59',method:'POST',body:{connectionId:lease.connectionId}});assert.equal(closed.status,401);
 const current=await f.poll(fresh,replacement);assert.equal(current.status,200);await current.json();assert.equal(f.instance.sessions.size,1);
});

test('successive valid logins leave exactly the final session alive; wrong later credentials do not evict it',async t=>{
 const f=await fixture(t),cookies=[];
 for(let index=0;index<3;index++)cookies.push(await f.login());
 const invalid=await f.request('/api/login',{method:'POST',body:{...account,password:'bad-later'}});assert.equal(invalid.status,401);
 const states=await Promise.all(cookies.map(cookie=>f.session(cookie)));assert.deepEqual(states.map(response=>response.status),[401,401,200]);
 assert.equal(f.instance.sessions.size,1);assert.equal(f.instance.transportDiagnostics().sessionReleases['session-replaced'],2);
});

test('a queue request waiting for profile IO cannot recreate the revoked login in matchmaking',async t=>{
 const f=await fixture(t),old=await f.login();let unblock,reached;const waiting=new Promise(resolve=>{reached=resolve;});
 const profile=f.instance.accountStore.profile;let intercept=true;
 f.instance.accountStore.profile=async username=>{if(intercept&&username===account.username){intercept=false;reached();await new Promise(resolve=>{unblock=resolve;});}return profile(username);};
 const pending=f.request('/api/online/queue',{cookie:old,method:'POST',body:{mode:'1v1'}});await waiting;
 const fresh=await f.login();unblock();const rejected=await pending;assert.equal(rejected.status,401);assert.equal((await rejected.json()).error,'session-replaced');
 assert.equal(f.instance.online.status(account.username).queued,false);assert.equal((await f.session(fresh)).status,200);
});

test('an entered match retires the old actor once and the replacement starts outside that room',async t=>{
 const f=await fixture(t,{onlineEventTransport:'poll'}),old=await f.login(),other=await f.login(peer);
 await f.open(old);await f.open(other);
 for(const cookie of [old,other])assert.equal((await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'1v1'}})).status,200);
 await f.advance(11000);assert.equal(f.drivers.length,1);const driver=f.drivers[0],match=driver.match;
 for(const cookie of [old,other])assert.equal((await f.request('/api/online/ready',{cookie,method:'POST',body:{matchId:match.id}})).status,200);
 driver.emit('state',{matchId:match.id,pvp:{phase:'fight'}});assert.equal(f.instance.online.isPlaying(account.username),true);
 const fresh=await f.login();assert.deepEqual(driver.disconnected,[{id:account.username,recoverable:false}]);
 const status=await(await f.request('/api/online/status',{cookie:fresh})).json();assert.equal(status.match,null);assert.equal(status.queued,false);
 const invalid=await f.request('/api/online/input',{cookie:old,method:'POST',body:{matchId:match.id,sequence:0,frames:[{frameSeq:1,held:['Z']}]}});assert.equal(invalid.status,401);assert.equal(driver.inputs.length,0);
 driver.emit('player-timeout',{playerId:account.username,reason:'loading-timeout'});
 await tick();assert.deepEqual(driver.disconnected,[{id:account.username,recoverable:false}]);assert.equal((await f.session(fresh)).status,200);
});

test('an old input request with an unfinished body cannot apply after takeover',async t=>{
 const f=await fixture(t),old=await f.login();const body=JSON.stringify({matchId:'old-room',sequence:0,frames:[]});
 let request;const pending=new Promise((resolve,reject)=>{request=http.request(f.base+'/api/online/input',{method:'POST',headers:{cookie:old,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},response=>{
  let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(text)}));});request.on('error',reject);request.write(body.slice(0,5));});
 await tick();const fresh=await f.login();request.end(body.slice(5));const result=await pending;assert.equal(result.status,401);assert.equal(result.body.error,'session-replaced');assert.equal((await f.session(fresh)).status,200);
});

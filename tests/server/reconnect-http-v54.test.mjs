/** Actual HTTP admission and controlled timers; no historical-version reruns. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'webpvp-reconnect-v54-'));await mkdir(path.join(root,'dist'));await writeFile(path.join(root,'dist/game.js'),'fixture');
 const accounts=Array.from({length:4},(_,i)=>({username:'rejoin-'+i,password:'test-secret-'+i,role:'gm'}));let clock=100000;
 const timers=new Set(),drivers=[];
 const instance=await createDevServer({root,credentials:accounts[0],additionalCredentials:accounts.slice(1),onlineEventTransport:'poll',now:()=>clock,
  disconnectTimers:{setTimeout(callback,delay){const timer={callback,delay,unref(){}};timers.add(timer);return timer;},clearTimeout(timer){timers.delete(timer);}},
  driverFactory(args){const d={...args,disconnected:[],reconnected:[],submitInput(){return {accepted:true};},
   disconnect(id,options){this.disconnected.push({id,options});},reconnect(id){this.reconnected.push(id);return {resumed:true,epoch:2};},stop(){},snapshot(){return null;}};drivers.push(d);return d;}});
 const base='http://127.0.0.1:'+await listenLoopback(instance.server);
 t.after(async()=>{instance.closeStreams();await new Promise(done=>instance.server.close(done));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
 const request=(route,cookie,body,headers={})=>fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const cookies=[];for(const account of accounts){const response=await request('/api/login',null,account);assert.equal(response.status,200);cookies.push(response.headers.get('set-cookie').split(';')[0]);await response.json();}
 for(const account of accounts)await instance.online.join(account.username,'gm',{loadout:Array(8).fill(null),branchChoices:{},keyBindings:{schemaVersion:1,bindings:{up:'ArrowUp'}}});
 clock=111000;for(const session of instance.sessions.values())session.lastSeen=clock;await instance.online.tick();
 const driver=drivers[0];driver.emit('state',{pvp:{phase:'fight'}});
 return {base,instance,driver,request,cookies,timers,get clock(){return clock;},advance(ms){clock+=ms;},
  fire(){for(const timer of [...timers])if(timers.delete(timer))timer.callback();},
  async open(index=0){const response=await request('/api/online/poll/open',cookies[index],{});assert.equal(response.status,200);return response.json();}};
}
test('all-channel silence confirms after short grace, removes seat, keeps login, and poll reopen restores through worker',async t=>{
 const f=await fixture(t);await f.open();f.advance(2501);f.fire();
 assert.deepEqual(f.driver.disconnected,[{id:'rejoin-0',options:{recoverable:true}}]);
 assert.equal(f.instance.online.status('rejoin-0').match.players.find(p=>p.id==='rejoin-0').connected,false);
 const session=await f.request('/api/session',f.cookies[0]);assert.equal(session.status,200);await session.json();
 await f.open();assert.deepEqual(f.driver.reconnected,['rejoin-0']);
 assert.equal(f.instance.online.status('rejoin-0').match.players.find(p=>p.id==='rejoin-0').connected,true);
});
test('actual SSE socket close confirms absence and a new authenticated page restores the same saved seat',async t=>{
 const f=await fixture(t);let closedServer,observe;
 const closed=new Promise(resolve=>{observe=(req,res)=>{if(!req.url.startsWith('/api/online/events'))return;
  f.instance.server.off('request',observe);res.once('close',resolve);closedServer=res;};f.instance.server.on('request',observe);});
 const response=await new Promise((resolve,reject)=>{const req=http.get(f.base+'/api/online/events',{headers:{cookie:f.cookies[0]}},resolve);req.on('error',reject);});
 t.after(()=>{response.destroy();closedServer?.destroy();f.instance.server.off('request',observe);});
 assert.equal(response.statusCode,200);response.resume();response.destroy();await closed;
 assert.equal(f.timers.size,1);f.advance(2501);f.fire();assert.equal(f.driver.disconnected.length,1);
 const pageToken='new-page-v54-0001';const session=await f.request('/api/session',f.cookies[0],undefined,{'x-rf-page-init':pageToken});
 assert.equal(session.status,200);const status=await session.json();assert.equal(status.online.match.id,f.driver.match.id);
 const reopened=await f.request('/api/online/poll/open',f.cookies[0],{}, {'x-rf-page-init':pageToken});
 assert.equal(reopened.status,200);await reopened.json();assert.deepEqual(f.driver.reconnected,[]);
 f.advance(10001);for(const user of f.instance.sessions.values())if(user.username!=='rejoin-0')user.lastSeen=f.clock;
 f.instance.expireSessions();assert.equal(f.driver.disconnected.length,1,'a still-missing seat must keep its original snapshot/grace');
 const seededAgain=await f.request('/api/online/poll/open',f.cookies[0],{}, {'x-rf-page-init':pageToken});
 assert.equal(seededAgain.status,200);await seededAgain.json();assert.deepEqual(f.driver.reconnected,[],'re-suspension cannot turn an unready new page into immediate recovery');
 f.advance(6000);assert.equal(f.instance.online.status('rejoin-0').match.players.find(p=>p.id==='rejoin-0').connected,false);
 const staleReady=await f.request('/api/online/ready',f.cookies[0],{matchId:f.driver.match.id},{'x-rf-page-init':'old-page-v54-0001'});
 assert.equal(staleReady.status,409);await staleReady.json();assert.deepEqual(f.driver.reconnected,[]);
 const ready=await f.request('/api/online/ready',f.cookies[0],{matchId:f.driver.match.id},{'x-rf-page-init':pageToken});
 assert.equal(ready.status,200);assert.equal((await ready.json()).ok,true);assert.deepEqual(f.driver.reconnected,['rejoin-0']);
});
test('accepted HTTP fallback activity postpones a closed downstream deadline instead of falsely removing a healthy owner',async t=>{
 const f=await fixture(t);await f.open();f.advance(2000);
 const response=await f.request('/api/online/input',f.cookies[0],{matchId:f.driver.match.id,sequence:0,frames:[{held:[],frameSeq:1}]});
 assert.equal(response.status,200);await response.json();f.advance(501);f.fire();
 assert.equal(f.driver.disconnected.length,0);assert.ok(f.timers.size>0);
 f.advance(2000);f.fire();assert.equal(f.driver.disconnected.length,1);
});
test('an awaited ready from a retired page cannot clear the current recovery identity',async t=>{
 const f=await fixture(t);await f.open();f.advance(2501);f.fire();
 const firstToken='ready-page-v54-0001',nextToken='ready-page-v54-0002';
 const first=await f.request('/api/session',f.cookies[0],undefined,{'x-rf-page-init':firstToken});assert.equal(first.status,200);await first.json();
 let entered,complete;const inWorker=new Promise(resolve=>{entered=resolve;});
 f.driver.reconnect=id=>{f.driver.reconnected.push(id);entered();return new Promise(resolve=>{complete=resolve;});};
 t.after(()=>complete?.({resumed:false}));
 const pending=f.request('/api/online/ready',f.cookies[0],{matchId:f.driver.match.id},{'x-rf-page-init':firstToken});await inWorker;
 const next=await f.request('/api/session',f.cookies[0],undefined,{'x-rf-page-init':nextToken});assert.equal(next.status,200);await next.json();
 const session=[...f.instance.sessions.values()].find(row=>row.username==='rejoin-0'),saved=session.suspendedPageGeneration;
 assert.ok(Object.hasOwn(session,'suspendedPageGeneration'));complete({resumed:true,epoch:2});
 const response=await pending;assert.equal(response.status,409);assert.equal((await response.json()).error,'page-generation-retired');
 assert.equal(session.pageInitToken,nextToken);assert.equal(session.suspendedPageGeneration,saved);
});
test('half-open combat silence uses bounded10s deadline; ended suspended match is not seeded back as a battle',async t=>{
 const f=await fixture(t);f.advance(10001);
 for(const session of f.instance.sessions.values())if(session.username!=='rejoin-0')session.lastSeen=f.clock;
 const response=await f.request('/api/online/status',f.cookies[0]);assert.equal(response.status,200);await response.json();
 assert.equal(f.driver.disconnected.length,1);
 await f.driver.finish({winnerTeam:1,players:[]});await f.open();
 assert.equal(f.driver.reconnected.length,0);assert.equal(f.instance.online.status('rejoin-0').match,null);
});

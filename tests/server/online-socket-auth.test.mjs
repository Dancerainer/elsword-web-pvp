import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {createNodeOnlineSocketClass} from '../../tools/node-online-socket.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {gunzipSync} from 'node:zlib';
import {isNetworkBinary,decodeNetworkBinary} from '../../packages/online/network-binary.mjs';
const profile=JSON.parse(await readFile(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<200;i++){if(predicate())return;await delay(5);}throw Error('Timed out waiting for socket fixture');}
async function fixture(t,options={}){
 const dir=await mkdtemp(path.join(tmpdir(),'rf-socket-auth-')),root=path.resolve(new URL('../..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
 const credentials=[{username:'socket-a',password:'private-fixture-a',role:'player'},{username:'socket-b',password:'private-fixture-b',role:'player'}];
 let now=10000,driver,sim;
 const factory=async({match,emit,finish})=>{
  assert.equal(match.ownerStatusVersion??0,0,'manual owner-report fixtures must exercise the legacy room protocol');
  assert.equal(match.continuousAuraVersion??0,0);
  const map={sceneId:match.sceneId,lines:[{lineId:0,start:[-1000,0,0],end:[1000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
   starts:match.players.map((p,i)=>({index:i,kind:'SetTeamStartPos',teamFlag:p.team===0,position:[i*200,0,0],lineId:0,facingRight:true}))};
  sim=createSimulation({profile,map,actors:match.players.map((p,i)=>({...p,position:[i*200,0,0],lineId:0})),versions:{referenceVersion:'fixture',presetVersion:'fixture',programVersion:'fixture'}});
  const pvp=new PvpMatch({mode:match.mode,players:match.players,map,versions:sim.versions,rules:options.pvpRules});
  driver=createLocalOwnerBattleDriver({match,simulation:sim,pvp,emit,finish,manual:true});return driver;
 };
 factory.ownership='local-owner-v1';
 const ctx=await createDevServer({root,accountRoot:dir,credentials:credentials[0],additionalCredentials:[credentials[1]],driverFactory:factory,now:()=>now,...options});
 const base='http://127.0.0.1:'+await listenLoopback(ctx.server);
 t.after(async()=>{ctx.closeStreams();ctx.online.close();ctx.server.closeAllConnections();await new Promise(resolve=>ctx.server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const clients=[];
 for(const credential of credentials){
  let cookie;const events=[],errors=[];
  const request=async(url,options={})=>{
   // This suite intentionally exercises the legacy body/auth/ACK codecs with
   // manually captured owner reports. New status rooms use the real clock
   // producer in their separate v11 integration tests.
   if(new URL(url,base).pathname==='/api/online/queue'&&options.method==='POST'&&options.body){
    const body=JSON.parse(options.body);options={...options,body:JSON.stringify({...body,continuousAuraVersion:0,ownerStatusVersion:0})};
   }
   const response=await fetch(base+url,{...options,headers:{Origin:base,...options.headers,...(cookie?{Cookie:cookie}:{})}});
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;};
  await request('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credential)});
  const sources=[];
  class Source{
   constructor(url){sources.push(this);this.listeners=new Map();this.wireEvents=[];this.heldStates=[];this.controller=new AbortController();void this.read(url).catch(()=>{});}
   addEventListener(type,fn){this.listeners.set(type,fn);}close(){this.controller.abort();}
   releaseStates(){this.holdStates=false;for(const data of this.heldStates.splice(0))this.listeners.get('state')?.({data});}
   async read(url){const target=new URL(url,base);if(options.legacySocket)target.searchParams.delete('ownedDelta');
    const response=await request(target.pathname+target.search,{signal:this.controller.signal}),reader=response.body.getReader(),decoder=new TextDecoder();let text='';
    if(response.ok)this.listeners.get('open')?.({type:'open',target:this});
    while(true){const part=await reader.read();if(part.done)return;text+=decoder.decode(part.value,{stream:true});let cut;while((cut=text.indexOf('\n\n'))>=0){const block=text.slice(0,cut);text=text.slice(cut+2);const type=block.match(/^event: (.*)$/m)?.[1],data=block.match(/^data: (.*)$/m)?.[1];if(data){this.wireEvents.push({type,data:JSON.parse(data)});if(this.holdStates&&type==='state')this.heldStates.push(data);else this.listeners.get(type)?.({data});}}}}
  }
  const sockets=[],NodeSocket=createNodeOnlineSocketClass({base,cookie:()=>cookie});
  class CapturedSocket extends NodeSocket{
   constructor(url,...args){const target=new URL(url,base);if(options.legacySocket){target.searchParams.delete('textAck');target.searchParams.delete('ownedDelta');target.searchParams.delete('networkBinaryVersion');}
    super(target.pathname+target.search,...args);this.messageKinds=[];this.receivedValues=[];sockets.push(this);}
   get onmessage(){return this.messageHandler;}
   set onmessage(handler){this.messageHandler=handler?event=>{this.messageKinds.push(typeof event.data);
    const bytes=typeof event.data==='string'?null:Buffer.from(event.data),raw=bytes?(isNetworkBinary(bytes)?bytes:gunzipSync(bytes)):null;
    this.receivedValues.push(raw&&isNetworkBinary(raw)?decodeNetworkBinary(raw):JSON.parse(raw?raw.toString():event.data));return handler(event);}:null;}
  }
  const client=createOnlineClient({fetch:request,EventSource:Source,RTCPeerConnection:null,WebSocket:CapturedSocket,
   onEvent:(type,data)=>{events.push({type,data});if(type==='match')void client.setMatch(data,credential.username);},onError:error=>errors.push(error.message)});
  clients.push({client,events,errors,request,sources,sockets,get cookie(){return cookie;}});t.after(()=>client.close());await client.open();
 }
 await until(()=>clients.every(c=>c.client.performance().relay?.active));
 return {ctx,base,clients,advance:(ms=6000)=>{now+=ms;},get driver(){return driver;},get sim(){return sim;}};
}

function controlledTimers(){const pending=new Set();return {pending,setTimeout(callback,delay){const timer={callback,delay,unref(){}};pending.add(timer);return timer;},clearTimeout(timer){pending.delete(timer);},fire(){for(const timer of [...pending])if(pending.delete(timer))timer.callback();}};}
function pacingClock(){let now=0;const pending=new Set();return {pending,clock:()=>now,
 setTimeout(callback,delay){const timer={callback,due:now+delay,unref(){}};pending.add(timer);return timer;},clearTimeout(timer){pending.delete(timer);},
 set(value){now=value;},fire(value){now=value;for(const timer of [...pending])if(timer.due<=now&&pending.delete(timer))timer.callback();}};}
async function startFight(f){for(const c of f.clients)await c.client.join('1v1');f.advance();await f.ctx.online.tick();
 await until(()=>f.clients.every(c=>c.events.some(e=>e.type==='match')));for(const c of f.clients)await c.client.ready(c.events.find(e=>e.type==='match').data.id);
 f.driver.tick(10);await until(()=>f.clients.every(c=>c.events.some(e=>e.type==='state'&&e.data.pvp.phase==='fight')));}
test('real masked/gzip uplink retains auth, ACKs receipts and SSE delivers full→delta room/owner states',async t=>{
 const f=await fixture(t);for(const c of f.clients)await c.client.join('1v1');f.advance();await f.ctx.online.tick();await until(()=>f.clients.every(c=>c.events.some(e=>e.type==='match')));
 for(const c of f.clients)await c.client.ready(c.events.find(e=>e.type==='match').data.id);f.driver.tick(10);
 await until(()=>f.clients.every(c=>c.events.some(e=>e.type==='state'&&e.data.pvp.phase==='fight')));
 const a=f.clients[0],b=f.clients[1],owner=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq:3});
 owner.hits=[{id:123,attackerId:'socket-b',damage:10}];a.client.send({held:[],pressed:[],released:[]},owner);
 await until(()=>b.events.some(e=>e.type==='peer-owned-state')&&a.client.performance().pendingHits===0);
 owner.frameSeq=6;owner.actor.x=112;owner.actor.stateTime=.1;owner.hits=[];a.client.send({held:['RIGHT'],pressed:['RIGHT'],released:[]},owner);
 await until(()=>b.events.some(e=>e.type==='peer-owned-state'&&e.data.report.frameSeq===6));
 assert.equal(b.events.filter(e=>e.type==='peer-owned-state').at(-1).data.report.actor.x,112);
 f.driver.tick(.1);await until(()=>b.events.filter(e=>e.type==='state').length>=3);
 const state=b.events.filter(e=>e.type==='state').at(-1).data;assert.ok(state.snapshot.actors.every(actor=>actor.stats&&actor.loadout));
 const receiver=createSimulation({profile,map:f.sim.map,actors:f.sim.state.actors.map(a=>({id:a.id,team:a.team,position:[a.x,a.y,a.z]})),versions:f.sim.versions});
 const sync=createLocalOwnershipSync();sync.reconcile(receiver,state,'socket-b');assert.equal(receiver.actor('socket-b').hp,f.sim.actor('socket-b').hp);
 // Remote SSE delivery and the sender's WS ACK use separate connections; the
 // receiver observing frame 6 cannot establish that its ACK arrived already.
 await until(()=>a.client.performance().socketAcknowledgements===0);
 assert.ok(a.client.performance().relay.sentMessages>=2);assert.equal(a.client.performance().socketAcknowledgements,0);assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
});
test('a new authenticated poll mailbox reseeds the same life while a reused mailbox preserves its delta baseline',async t=>{
 const f=await fixture(t);for(const c of f.clients)await c.client.join('1v1');f.advance();await f.ctx.online.tick();await until(()=>f.clients.every(c=>c.events.some(e=>e.type==='match')));
 for(const c of f.clients)await c.client.ready(c.events.find(e=>e.type==='match').data.id);f.driver.tick(10);
 await until(()=>f.clients.every(c=>c.events.some(e=>e.type==='state'&&e.data.pvp.phase==='fight')));
 const a=f.clients[0],b=f.clients[1],owner=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq:3});
 const send=async(frame,mp)=>{owner.frameSeq=frame;owner.actor.mp=mp;a.client.send({held:[],pressed:[],released:[]},owner);await until(()=>a.client.performance().socketAcknowledgements===0);await delay(10);};
 await send(3,90);await until(()=>b.events.some(e=>e.type==='peer-owned-state'));
 b.sources[0].close();await delay(20);
 const post=async(url,body)=>{const response=await b.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
 let lease=await post('/api/online/poll/open',{}),cursor=lease.cursor;
 const poll=async()=>{const response=await b.request(`/api/online/poll?connectionId=${lease.connectionId}&after=${cursor}`);assert.equal(response.status,200);const data=await response.json();cursor=data.cursor;return data.events;};
 await poll();await send(6,80);let events=await poll(),birth=events.find(e=>e.type==='owned-state'&&e.data.baselineOnly).data;
 assert.equal(birth.baselineOnly,true,'fresh mailbox must not reference the previous SSE baseline');const firstToken=birth.relayToken,codec=createOwnedRelayDelta();assert.equal(codec.decode(birth),null);
 const dynamic=events.find(e=>e.type==='owned-state'&&!e.data.baselineOnly).data;assert.equal(codec.decode(dynamic).actor.mp,80);
 lease=await post('/api/online/poll/open',{});cursor=lease.cursor;await poll();await send(9,70);
 events=await poll();const patch=events.find(e=>e.type==='owned-state').data;assert.equal(patch.full,false);assert.equal(patch.relayToken,firstToken);assert.equal(codec.decode(patch).actor.mp,70);
 await post('/api/online/poll/close',{connectionId:lease.connectionId});lease=await post('/api/online/poll/open',{});cursor=lease.cursor;await poll();await send(12,60);
 events=await poll();birth=events.find(e=>e.type==='owned-state'&&e.data.baselineOnly).data;assert.notEqual(birth.relayToken,firstToken);
 const restarted=createOwnedRelayDelta();assert.equal(restarted.decode(birth),null);assert.equal(restarted.decode(events.find(e=>e.type==='owned-state'&&!e.data.baselineOnly).data).actor.mp,60);
});
test('socket upgrade rejects no session, cross-origin and retired page token; a valid page never gains another username',async t=>{
 const f=await fixture(t);const valid=f.clients[0];
 for(const {origin,cookie,url}of [{origin:f.base,cookie:null,url:'/api/online/socket'},
  {origin:'http://evil.example',cookie:valid.cookie,url:'/api/online/socket'}]){
  const Socket=createNodeOnlineSocketClass({base:f.base,origin,cookie:()=>cookie});const socket=new Socket(url,'rf-online-gzip-v1');await until(()=>socket.readyState===3);assert.equal(socket.readyState,3);
 }
 await valid.request('/api/session',{headers:{'X-RF-Page-Init':'new-page-token-123'}});
 const Socket=createNodeOnlineSocketClass({base:f.base,cookie:()=>valid.cookie}),retired=new Socket('/api/online/socket?pageInitToken=retired-token-123','rf-online-gzip-v1');
 await until(()=>retired.readyState===3);assert.equal(retired.readyState,3);
});

test('a healthy authenticated WS preserves the same room across an SSE gap and a fresh lease reconstructs the newest source state',async t=>{
 const disconnectTimers=controlledTimers(),f=await fixture(t,{disconnectTimers});await startFight(f);
 const [a,b]=f.clients,owner=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq:3});
 a.client.send({held:[],pressed:[],released:[]},owner);await until(()=>a.client.performance().socketAcknowledgements===0&&b.events.some(e=>e.type==='peer-owned-state'));
 a.sources[0].close();await until(()=>f.ctx.transportDiagnostics().sseClosed===1);assert.equal(disconnectTimers.pending.size,0);f.advance(2600);disconnectTimers.fire();
 assert.equal(f.ctx.sessions.size,2);assert.ok(f.ctx.online.status('socket-a').match);assert.equal(f.sim.actor('socket-a').pvpDisconnected,false);
 assert.equal(f.ctx.transportDiagnostics().downstreamRecoveryPreserved,0);
 const fresh=new a.sources[0].constructor('/api/online/events'),events=[];t.after(()=>fresh.close());
 fresh.addEventListener('state',event=>events.push(JSON.parse(event.data)));await until(()=>events.length>0);
 assert.equal(events.at(-1).snapshot.actors.find(actor=>actor.id==='socket-a').x,owner.actor.x);
 assert.equal(disconnectTimers.pending.size,0);assert.ok(a.client.performance().relay.active);
 assert.equal(f.ctx.transportDiagnostics().sessionReleases['stream-disconnected']??0,0);
});

test('recent activity preserves an entered match over a short socket/downstream gap and login expiry, then renews its browser cookie',async t=>{
 const disconnectTimers=controlledTimers(),f=await fixture(t,{disconnectTimers,sessionSeconds:10});await startFight(f);
 const a=f.clients[0],owner=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq:3});a.client.send({held:[],pressed:[],released:[]},owner);
 await until(()=>a.client.performance().socketAcknowledgements===0);a.sources[0].close();await until(()=>f.ctx.transportDiagnostics().sseClosed===1);assert.equal(disconnectTimers.pending.size,0);
 f.advance(2600);disconnectTimers.fire();assert.equal(f.ctx.sessions.size,2);
 f.advance(10_000);f.ctx.expireSessions();assert.equal(f.ctx.sessions.size,2);assert.equal(f.sim.actor('socket-a').pvpDisconnected,false);
 const response=await a.request('/api/heartbeat',{method:'POST'});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict.*Max-Age=10/);
 assert.equal(f.ctx.transportDiagnostics().sessionReleases['heartbeat-timeout']??0,0);
});

test('a fully silent playing owner is retired once, hidden authoritatively and cannot be restored by a late owned report',async t=>{
 const f=await fixture(t);await startFight(f);const [a,b]=f.clients;
 const owner=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq:3});a.client.send({held:[],pressed:[],released:[]},owner);
 await until(()=>a.client.performance().socketAcknowledgements===0);await b.request('/api/heartbeat',{method:'POST'});
 a.client.close();await until(()=>f.ctx.transportDiagnostics().socketClosed===1&&f.ctx.transportDiagnostics().sseClosed===1);
 f.advance(19_999);f.ctx.expireSessions();assert.equal(f.sim.actor('socket-a').pvpDisconnected,false);
 await b.request('/api/heartbeat',{method:'POST'});f.advance(1);f.ctx.expireSessions();
 const actor=f.sim.actor('socket-a');assert.equal(actor.pvpDisconnected,true);assert.equal(actor.hidden,true);assert.equal(actor.hp,0);assert.equal(actor.deathComplete,true);
 assert.equal(f.driver.snapshot().pvp.players.find(row=>row.id==='socket-a').connected,false);
 assert.equal(f.driver.submitInput('socket-a',{frames:[{held:[],frameSeq:999}],owner:{...owner,frameSeq:999}}).accepted,false);
 assert.equal(actor.hidden,true);assert.equal(actor.hp,0);f.ctx.expireSessions();
 await until(()=>b.events.some(e=>e.type==='disconnect'&&e.data.playerId==='socket-a'));
 assert.equal(f.ctx.transportDiagnostics().sessionReleases['heartbeat-timeout'],1);
 assert.equal(b.events.filter(e=>e.type==='disconnect'&&e.data.playerId==='socket-a').length,1);
 assert.equal((await a.request('/api/session')).status,401);
});

test('fresh accepted WS owner reports preserve playing liveness beyond cookie expiry without HTTP heartbeat or a downstream connection',async t=>{
 const f=await fixture(t,{sessionSeconds:20});await startFight(f);const [a,b]=f.clients;
 a.sources[0].close();await until(()=>f.ctx.transportDiagnostics().sseClosed===1);
 for(const frameSeq of [3,6,9,12]){
  f.advance(15_000);await b.request('/api/heartbeat',{method:'POST'});
  const owner=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq});a.client.send({held:[],pressed:[],released:[]},owner);
  await until(()=>f.driver.snapshot().ownership.actors['socket-a'].frameSeq===frameSeq&&a.client.performance().socketAcknowledgements===0);
  f.ctx.expireSessions();assert.equal(f.sim.actor('socket-a').pvpDisconnected,false);assert.equal(f.ctx.sessions.size,2);
 }
 assert.equal(f.ctx.transportDiagnostics().sessionReleases['heartbeat-timeout']??0,0);
 assert.ok(a.client.performance().relay.active);
});

test('only fresh same-life receipts suppress duplicate dynamic relay and age, frame gaps and invalid room identities recover safely',async t=>{
 const f=await fixture(t);await startFight(f);const [a,b]=f.clients;
 const owner=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq:3});
 const send=async frame=>{owner.frameSeq=frame;a.client.send({held:[],pressed:[],released:[]},owner);
  await until(()=>f.driver.snapshot().ownership.actors['socket-a'].frameSeq===frame);await until(()=>a.client.performance().socketAcknowledgements===0);await delay(20);};
 await send(3);await until(()=>b.events.some(e=>e.type==='peer-owned-state'));
 const matchId=b.events.find(e=>e.type==='match').data.id;
 const receiverOwner=encodeOwnedState(f.sim,'socket-b',{epoch:1,frameSeq:100});
 const receipt=async(sequence,rows)=>{receiverOwner.frameSeq=sequence;b.sockets.at(-1).send(JSON.stringify({matchId,sequence,frames:[{held:[],frameSeq:sequence}],owner:receiverOwner,peerReceipts:rows}));await delay(15);};
 await receipt(100,[{playerId:'socket-a',epoch:1,frameSeq:3}]);await send(6);
 assert.equal(b.events.filter(e=>e.type==='peer-owned-state').at(-1).data.report.frameSeq,3);assert.ok(f.ctx.transportDiagnostics().ownedRelaySkipped>=1);
 await send(30);await until(()=>b.events.filter(e=>e.type==='peer-owned-state').at(-1).data.report.frameSeq===30);
 assert.equal(b.events.filter(e=>e.type==='peer-owned-state').at(-1).data.report.frameSeq,30,'advancing source frames invalidate a stopped direct path');
 await receipt(101,[{playerId:'socket-a',epoch:1,frameSeq:30}]);await send(33);assert.equal(b.events.filter(e=>e.type==='peer-owned-state').at(-1).data.report.frameSeq,30);
 f.advance(800);await send(36);await until(()=>b.events.filter(e=>e.type==='peer-owned-state').at(-1).data.report.frameSeq===36);
 assert.equal(b.events.filter(e=>e.type==='peer-owned-state').at(-1).data.report.frameSeq,36,'wall-clock expiry restores relay');
 for(const row of [{playerId:'outside-room',epoch:1,frameSeq:36},{playerId:'socket-a',epoch:0,frameSeq:36},{playerId:'socket-b',epoch:1,frameSeq:36}])await receipt(102,[row]);
 assert.equal(f.ctx.transportDiagnostics().invalidPeerReceipts,2);assert.equal(f.ctx.transportDiagnostics().stalePeerReceipts,1);assert.equal(f.ctx.sessions.size,2);
 const diagnostic=JSON.stringify(f.ctx.transportDiagnostics());assert.equal(diagnostic.includes('socket-a'),false);assert.equal(diagnostic.includes('socket-b'),false);
});

test('an unadvertised legacy socket keeps gzip replies and full/top-level owned baselines on the unchanged subprotocol',async t=>{
 const f=await fixture(t,{legacySocket:true});await startFight(f);const [a,b]=f.clients,owner=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq:3});
 a.client.send({held:[],pressed:[],released:[]},owner);await until(()=>b.events.some(e=>e.type==='peer-owned-state'));
 const full=b.sources[0].wireEvents.find(event=>event.type==='owned-state').data;
 assert.equal(full.full,true);assert.equal(full.baselineOnly,undefined);assert.equal(full.deltaVersion,undefined);
 const oldDecoder=createOwnedRelayDelta();assert.equal(oldDecoder.decode(full).frameSeq,3);
 owner.frameSeq=6;owner.actor.x+=25;a.client.send({held:[],pressed:[],released:[]},owner);
 await until(()=>b.events.some(event=>event.type==='peer-owned-state'&&event.data.report.frameSeq===6));
 const patch=b.sources[0].wireEvents.filter(event=>event.type==='owned-state').at(-1).data;
 assert.equal(patch.full,false);assert.equal(patch.deltaVersion,undefined);assert.equal(oldDecoder.decode(patch).actor.x,owner.actor.x);
 await until(()=>a.client.performance().socketAcknowledgements===0);
 assert.ok(a.sockets[0].messageKinds.length>=2);assert.ok(a.sockets[0].messageKinds.every(kind=>kind==='object'),'legacy transport and ACK remain binary gzip');
 assert.equal(f.ctx.transportDiagnostics().sockets[0].textMessages,0);
});

test('a respawn notification overtaking a receiver receipt does not reject its valid owner or keep the old relay suppression',async t=>{
 // The ordinary two-user socket fixture enables respawning only to exercise
 // a genuine driver-issued life transition; production room rules are intact.
 const f=await fixture(t,{pvpRules:{respawnEnabled:true,scoreLimit:100}});await startFight(f);const [a,b]=f.clients;
 const matchId=b.events.find(event=>event.type==='match').data.id,source=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq:3});
 a.client.send({held:[],pressed:[],released:[]},source);await until(()=>b.events.some(event=>event.type==='peer-owned-state'));
 const receiver=encodeOwnedState(f.sim,'socket-b',{epoch:1,frameSeq:100}),socket=b.sockets.at(-1);
 const input=async(sequence,sourceEpoch,sourceFrame)=>{receiver.frameSeq=sequence;socket.send(JSON.stringify({matchId,sequence,frames:[{held:[],frameSeq:sequence}],owner:receiver,
   peerReceipts:[{playerId:'socket-a',epoch:sourceEpoch,frameSeq:sourceFrame}]}));
  await until(()=>socket.receivedValues.some(value=>value.type==='ack'&&value.data.sequence===sequence));
  return socket.receivedValues.find(value=>value.type==='ack'&&value.data.sequence===sequence).data;};
 assert.equal((await input(100,1,3)).accepted,true);
 source.frameSeq=6;a.client.send({held:[],pressed:[],released:[]},source);await until(()=>f.driver.snapshot().ownership.actors['socket-a'].frameSeq===6);
 assert.ok(f.ctx.transportDiagnostics().ownedRelaySkipped>0);
 b.sources[0].holdStates=true;
 source.frameSeq=9;source.actor.hp=0;source.actor.deathComplete=true;a.client.send({held:[],pressed:[],released:[]},source);
 await until(()=>f.sim.actor('socket-a').hp===0);f.driver.tick(.1);f.driver.tick(13);
 assert.equal(f.driver.snapshot().ownership.actors['socket-a'].epoch,2,'only the driver creates the new life');
 await until(()=>b.sources[0].wireEvents.some(event=>event.type==='state'&&event.data.ownership.actors['socket-a'].epoch===2));
 assert.equal(b.events.filter(event=>event.type==='state').at(-1).data.ownership.actors['socket-a'].epoch,1,'receiver has not consumed the respawn message');
 assert.equal((await input(101,1,9)).accepted,true);assert.equal(f.ctx.transportDiagnostics().stalePeerReceipts,1);
 assert.equal(f.driver.snapshot().ownership.actors['socket-b'].frameSeq,101);assert.ok(b.client.performance().relay.active);
 b.sources[0].releaseStates();await until(()=>b.events.filter(event=>event.type==='state').at(-1).data.ownership.actors['socket-a'].epoch===2);
 const reborn=encodeOwnedState(f.sim,'socket-a',{epoch:2,frameSeq:12});a.client.send({held:[],pressed:[],released:[]},reborn);
 await until(()=>b.events.some(event=>event.type==='peer-owned-state'&&event.data.report.epoch===2));
 assert.equal(f.ctx.transportDiagnostics().invalidPeerReceipts,0);
 assert.equal((await input(102,2,1000)).accepted,true,'a source uplink lagging far behind direct receipt cannot reject the receiver owner');
 assert.equal(f.ctx.transportDiagnostics().stalePeerReceipts,2);assert.ok(b.client.performance().relay.active);
});

test('v2 pose pacing coalesces to a fixed deadline while every reliable action arrives immediately in order',async t=>{
 const clock=pacingClock(),f=await fixture(t,{ownedRelayClock:clock.clock,ownedRelayTimers:clock});await startFight(f);
 const [a,b]=f.clients,owner=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq:3});
 const send=async(frame,action)=>{owner.frameSeq=frame;owner.actor.x=frame;owner.actions=action?[{id:action,frameSeq:frame,actor:{},effects:[]}]:[];
  a.client.send({held:[],pressed:[],released:[]},owner);await until(()=>f.driver.snapshot().ownership.actors['socket-a'].frameSeq===frame&&a.client.performance().socketAcknowledgements===0);};
 await send(3);await until(()=>b.events.some(event=>event.type==='peer-owned-state'));
 clock.set(10);await send(6,1);await send(9,2);await until(()=>b.events.some(event=>event.type==='input'&&event.data.actions.at(-1).id===2));
 const timer=[...clock.pending][0];assert.equal(timer.due,50);clock.set(49);await send(12,3);
 await until(()=>b.events.some(event=>event.type==='input'&&event.data.actions.at(-1).id===3));assert.equal([...clock.pending][0],timer);
 assert.deepEqual(b.events.filter(event=>event.type==='peer-owned-state').map(event=>event.data.report.frameSeq),[3]);
 clock.fire(50);await until(()=>b.events.some(event=>event.type==='peer-owned-state'&&event.data.report.frameSeq===12));
 assert.deepEqual(b.events.filter(event=>event.type==='peer-owned-state').map(event=>event.data.report.frameSeq),[3,12]);
 assert.deepEqual(b.events.filter(event=>event.type==='input').flatMap(event=>event.data.actions.map(action=>action.id)),[1,2,3]);
 const wire=b.sources[0].wireEvents.filter(event=>event.type==='owned-state');assert.equal(wire[0].data.baselineOnly,true);
 assert.ok(f.ctx.transportDiagnostics().ownedRelayPacers.some(row=>row.replaced>=2&&row.sent===2&&row.pending===0));
});

test('death and a driver-issued new life cancel pending poses and bypass dynamic pacing',async t=>{
 const clock=pacingClock(),f=await fixture(t,{ownedRelayClock:clock.clock,ownedRelayTimers:clock,pvpRules:{respawnEnabled:true,scoreLimit:100}});await startFight(f);
 const [a,b]=f.clients,owner=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq:3});
 const send=async frame=>{owner.frameSeq=frame;a.client.send({held:[],pressed:[],released:[]},owner);await until(()=>f.driver.snapshot().ownership.actors['socket-a'].frameSeq===frame&&a.client.performance().socketAcknowledgements===0);};
 await send(3);await until(()=>b.events.some(event=>event.type==='peer-owned-state'));
 clock.set(10);await send(6);const retired=[...clock.pending][0];assert.ok(retired);
 owner.actor.hp=0;owner.actor.deathComplete=true;await send(9);
 await until(()=>b.events.some(event=>event.type==='peer-owned-state'&&event.data.report.frameSeq===9));
 assert.equal(b.events.filter(event=>event.type==='peer-owned-state').at(-1).data.report.actor.hp,0);
 retired.callback();assert.equal(clock.pending.size,0);
 await send(12);const deadTimer=[...clock.pending][0];assert.ok(deadTimer);
 f.driver.tick(.1);f.driver.tick(13);await until(()=>b.events.some(event=>event.type==='state'&&event.data.ownership.actors['socket-a'].epoch===2));
 assert.equal(clock.pending.size,0);deadTimer.callback();
 const reborn=encodeOwnedState(f.sim,'socket-a',{epoch:2,frameSeq:15});a.client.send({held:[],pressed:[],released:[]},reborn);
 await until(()=>b.events.some(event=>event.type==='peer-owned-state'&&event.data.report.epoch===2));
 const poses=b.events.filter(event=>event.type==='peer-owned-state').map(event=>event.data.report);
 assert.deepEqual(poses.slice(0,2).map(report=>report.frameSeq),[3,9]);assert.equal(poses.length,3);
 assert.equal(poses[2].epoch,2);assert.ok(poses[2].frameSeq>=15);assert.ok(poses[2].actor.hp>0);
});

test('a newly acknowledged healthy RTC path cancels pending relay, and a missing receipt restores the next pose',async t=>{
 const clock=pacingClock(),f=await fixture(t,{ownedRelayClock:clock.clock,ownedRelayTimers:clock});await startFight(f);const [a,b]=f.clients;
 const owner=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq:3}),matchId=b.events.find(event=>event.type==='match').data.id;
 const send=async frame=>{owner.frameSeq=frame;a.client.send({held:[],pressed:[],released:[]},owner);await until(()=>f.driver.snapshot().ownership.actors['socket-a'].frameSeq===frame&&a.client.performance().socketAcknowledgements===0);};
 await send(3);await until(()=>b.events.some(event=>event.type==='peer-owned-state'));clock.set(10);await send(6);
 const retired=[...clock.pending][0],receiver=encodeOwnedState(f.sim,'socket-b',{epoch:1,frameSeq:100});
 const receipt=async(sequence,rows)=>{receiver.frameSeq=sequence;b.sockets.at(-1).send(JSON.stringify({matchId,sequence,frames:[{held:[],frameSeq:sequence}],owner:receiver,peerReceipts:rows}));
  await until(()=>b.sockets.at(-1).receivedValues.some(value=>value.type==='ack'&&value.data.sequence===sequence));};
 await receipt(100,[{playerId:'socket-a',epoch:1,frameSeq:6}]);assert.equal(clock.pending.size,0);retired.callback();await delay(10);
 assert.equal(b.events.filter(event=>event.type==='peer-owned-state').at(-1).data.report.frameSeq,3);
 await receipt(101,[]);await send(9);assert.ok([...clock.pending].some(timer=>timer.due===50));clock.fire(50);
 await until(()=>b.events.some(event=>event.type==='peer-owned-state'&&event.data.report.frameSeq===9));
 assert.deepEqual(b.events.filter(event=>event.type==='peer-owned-state').map(event=>event.data.report.frameSeq),[3,9]);
});

test('retiring an SSE lease cancels old poses and reseeds the new lease before its immediate first pose',async t=>{
 const clock=pacingClock(),f=await fixture(t,{ownedRelayClock:clock.clock,ownedRelayTimers:clock});await startFight(f);const [a,b]=f.clients;
 const owner=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq:3});
 const send=async frame=>{owner.frameSeq=frame;a.client.send({held:[],pressed:[],released:[]},owner);await until(()=>f.driver.snapshot().ownership.actors['socket-a'].frameSeq===frame&&a.client.performance().socketAcknowledgements===0);};
 await send(3);await until(()=>b.events.some(event=>event.type==='peer-owned-state'));clock.set(10);await send(6);const retired=[...clock.pending][0];
 b.sources[0].close();await until(()=>clock.pending.size===0);retired.callback();
 const fresh=new b.sources[0].constructor('/api/online/events');t.after(()=>fresh.close());
 await until(()=>fresh.wireEvents.some(event=>event.type==='state'));await send(9);
 await until(()=>fresh.wireEvents.some(event=>event.type==='owned-state'&&!event.data.baselineOnly));
 const wire=fresh.wireEvents.filter(event=>event.type==='owned-state'),decoder=createOwnedRelayDelta();
 assert.equal(wire.length,2);assert.equal(wire[0].data.baselineOnly,true);assert.equal(decoder.decode(wire[0].data),null);
 assert.equal(decoder.decode(wire[1].data).frameSeq,9);assert.equal(clock.pending.size,0);
});

test('poll lease rotation cancels pending poses without changing its baseline, while a closed mailbox reseeds independently',async t=>{
 const clock=pacingClock(),f=await fixture(t,{ownedRelayClock:clock.clock,ownedRelayTimers:clock});await startFight(f);const [a,b]=f.clients;
 const owner=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq:3});
 const send=async frame=>{owner.frameSeq=frame;owner.actor.mp=100-frame;a.client.send({held:[],pressed:[],released:[]},owner);
  await until(()=>f.driver.snapshot().ownership.actors['socket-a'].frameSeq===frame&&a.client.performance().socketAcknowledgements===0);};
 await send(3);await until(()=>b.events.some(event=>event.type==='peer-owned-state'));b.sources[0].close();await delay(15);
 const post=async(url,body)=>{const response=await b.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
 let lease=await post('/api/online/poll/open',{}),cursor=lease.cursor;
 const poll=async()=>{const response=await b.request(`/api/online/poll?connectionId=${lease.connectionId}&after=${cursor}`);assert.equal(response.status,200);
  const data=await response.json();cursor=data.cursor;return data.events;};
 await poll();await send(6);let events=await poll();const codec=createOwnedRelayDelta(),birth=events.find(event=>event.type==='owned-state'&&event.data.baselineOnly).data;
 assert.equal(codec.decode(birth),null);const token=birth.relayToken;assert.equal(codec.decode(events.find(event=>event.type==='owned-state'&&!event.data.baselineOnly).data).frameSeq,6);
 clock.set(10);await send(9);const retired=[...clock.pending][0];assert.ok(retired);
 lease=await post('/api/online/poll/open',{});cursor=lease.cursor;assert.equal(clock.pending.size,0);retired.callback();await poll();await send(12);
 events=await poll();const poses=events.filter(event=>event.type==='owned-state');assert.equal(poses.length,1);assert.equal(poses[0].data.baselineOnly,undefined);
 assert.equal(poses[0].data.relayToken,token);assert.equal(codec.decode(poses[0].data).frameSeq,12);
 clock.set(20);await send(15);const closed=[...clock.pending][0];assert.ok(closed);await post('/api/online/poll/close',{connectionId:lease.connectionId});
 assert.equal(clock.pending.size,0);closed.callback();lease=await post('/api/online/poll/open',{});cursor=lease.cursor;await poll();await send(18);
 events=await poll();const newBirth=events.find(event=>event.type==='owned-state'&&event.data.baselineOnly).data,newDecoder=createOwnedRelayDelta();
 assert.notEqual(newBirth.relayToken,token);assert.equal(newDecoder.decode(newBirth),null);
 assert.equal(newDecoder.decode(events.find(event=>event.type==='owned-state'&&!event.data.baselineOnly).data).frameSeq,18);
 assert.equal(events.some(event=>event.type==='owned-state'&&event.data.frameSeq===15),false);
});

test('WebSocket receiver control receipts selectively omit established action IDs and leave unrelated actions reliable',async t=>{
 const f=await fixture(t);await startFight(f);const [a,b]=f.clients;
 const owner=encodeOwnedState(f.sim,'socket-a',{epoch:1,frameSeq:3});
 const send=async(frame,ids)=>{owner.frameSeq=frame;owner.actions=ids.map(id=>({id,frameSeq:frame,actor:{x:frame,buffs:[]},effects:[]}));
  a.client.send({held:[],pressed:[],released:[]},owner);await until(()=>f.driver.snapshot().ownership.actors['socket-a'].frameSeq===frame
   &&a.client.performance().socketAcknowledgements===0);};
 await send(3,[1]);await until(()=>b.events.some(event=>event.type==='input'&&event.data.actions[0].id===1));
 const matchId=b.events.find(event=>event.type==='match').data.id,receiver=encodeOwnedState(f.sim,'socket-b',{epoch:1,frameSeq:100});
 b.sockets.at(-1).send(JSON.stringify({matchId,sequence:100,frames:[{held:[],frameSeq:100}],owner:receiver,
  peerReceipts:[{playerId:'socket-a',epoch:1,frameSeq:3,controlIds:[2]}]}));
 await until(()=>b.sockets.at(-1).receivedValues.some(row=>row.type==='ack'&&row.data.sequence===100&&row.data.accepted));
 await send(6,[2,3]);await until(()=>b.events.some(event=>event.type==='input'&&event.data.actions.some(action=>action.id===3)));
 assert.deepEqual(b.events.filter(event=>event.type==='input').flatMap(event=>event.data.actions.map(action=>action.id)),[1,3]);
 assert.equal(f.ctx.transportDiagnostics().controlActionsSkipped,1);assert.equal(f.ctx.transportDiagnostics().controlRelaySkipped,0);
 assert.deepEqual(b.errors,[]);
});

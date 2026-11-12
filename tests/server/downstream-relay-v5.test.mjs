/** Downstream capability must survive a missing or failed upload WebSocket. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import {createOwnerStatusClock} from '../../packages/online/owner-status-clock.mjs';
import {createCombatPlaybackProducer} from '../../packages/online/combat-playback.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {createNodeOnlineSocketClass} from '../../tools/node-online-socket.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {gunzipSync} from 'node:zlib';

const root=fileURLToPath(new URL('../../',import.meta.url));
const profile=JSON.parse(await readFile(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<300;i++){if(predicate())return;await delay(5);}throw Error('Timed out waiting for downstream fixture');}

async function fixture(t,{sockets=false,legacy=false}={}){
 const accountRoot=await mkdtemp(path.join(tmpdir(),'rf-downstream-v5-'));
 const credentials=['downstream-a','downstream-b'].map(username=>({username,password:'synthetic-'+username,role:'player'}));
 let now=10000,driver,sim;
 const statusClocks=new Map(),playback=createCombatPlaybackProducer({version:1});
 const ownerReport=(playerId,frameSeq,{action=null,x=null}={})=>{
  // Current clients negotiate independent status and combat playback. Use
  // their real producers even in this transport-only, manually ticked room.
  // A requested reliable fixture action is an actual fresh idle controller.
  if(action!==null)sim.enter(sim.actor(playerId),'RSI_WAIT','downstream-fixture-controller');
  const report=encodeOwnedState(sim,playerId,{epoch:1,frameSeq});
  if(x!==null)report.actor.x=x;
  if(!statusClocks.has(playerId))statusClocks.set(playerId,createOwnerStatusClock());
  report.actor=statusClocks.get(playerId).encode(report.actor,report.epoch,frameSeq).actor;
  if(action!==null){
   const sample=playback.capture(sim,playerId,{epoch:report.epoch,frameSeq,held:[],report});
   assert.ok(sample,'a fresh fixture controller produces a reliable playback start');
   report.actions=[{...sample,id:action}];
  }
  return report;
 };
 const factory=async({match,emit,finish})=>{
  const map={sceneId:match.sceneId,lines:[{lineId:0,start:[-1000,0,0],end:[1000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
   starts:match.players.map((player,i)=>({index:i,kind:'SetTeamStartPos',teamFlag:player.team===0,position:[i*200,0,0],lineId:0,facingRight:true}))};
  sim=createSimulation({profile,map,actors:match.players.map((player,i)=>({...player,position:[i*200,0,0],lineId:0})),versions:{referenceVersion:'fixture',presetVersion:'fixture',programVersion:'fixture'}});
  const pvp=new PvpMatch({mode:match.mode,players:match.players,map,versions:sim.versions});
  driver=createLocalOwnerBattleDriver({match,simulation:sim,pvp,emit,finish,manual:true});return driver;
 };
 factory.ownership='local-owner-v1';
 const ctx=await createDevServer({root,accountRoot,credentials:credentials[0],additionalCredentials:[credentials[1]],driverFactory:factory,now:()=>now});
 await new Promise(resolve=>ctx.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+ctx.server.address().port,clients=[];
 t.after(async()=>{for(const row of clients)row.client.close();ctx.closeStreams();ctx.online.close();ctx.server.closeAllConnections();
  await new Promise(resolve=>ctx.server.close(resolve));await rm(accountRoot,{recursive:true,force:true});});
 for(const credential of credentials){
  let cookie,blockSockets=false;const events=[],errors=[],sources=[],openedSockets=[];
  const request=async(url,options={})=>{const response=await fetch(base+url,{...options,headers:{Origin:base,...options.headers,...(cookie?{Cookie:cookie}:{})}});
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;};
  const login=await request('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credential)});assert.equal(login.status,200);
  class Source{
   constructor(url){this.url=url;this.listeners=new Map();this.wire=[];this.controller=new AbortController();sources.push(this);void this.read(url).catch(()=>{});}
   addEventListener(type,callback){this.listeners.set(type,callback);}close(){this.controller.abort();}
   async read(url){const target=new URL(url,base);if(legacy)target.searchParams.delete('ownedDelta');
    const response=await request(target.pathname+target.search,{signal:this.controller.signal}),reader=response.body.getReader(),decoder=new TextDecoder();let text='';
    while(true){const part=await reader.read();if(part.done)return;text+=decoder.decode(part.value,{stream:true});let cut;
     while((cut=text.indexOf('\n\n'))>=0){const block=text.slice(0,cut);text=text.slice(cut+2);
      const type=block.match(/^event: (.*)$/m)?.[1],data=block.match(/^data: (.*)$/m)?.[1],id=block.match(/^id: (.*)$/m)?.[1];
      if(data){this.wire.push({type,data:JSON.parse(data)});this.listeners.get(type)?.({data,lastEventId:id});}}}}
  }
  const NodeSocket=createNodeOnlineSocketClass({base,cookie:()=>cookie});
  class Socket extends NodeSocket{
   constructor(url,...args){super(blockSockets?'/api/not-a-socket':url,...args);this.received=[];openedSockets.push(this);}
   get onmessage(){return this.handler;}set onmessage(handler){this.handler=handler?event=>{
    this.received.push(JSON.parse(typeof event.data==='string'?event.data:gunzipSync(Buffer.from(event.data)).toString()));handler(event);}:null;}
  }
  const client=createOnlineClient({fetch:request,EventSource:Source,RTCPeerConnection:null,WebSocket:sockets?Socket:null,
   onEvent:(type,data)=>{events.push({type,data});if(type==='match')void client.setMatch(data,credential.username);},onError:error=>errors.push(error.message)});
  clients.push({client,events,errors,sources,openedSockets,request,blockSockets(){blockSockets=true;for(const socket of openedSockets)socket.close();}});
  await client.open();
 }
 if(sockets)await until(()=>clients.every(row=>row.client.performance().relay?.active));
 // Match the real status-clock and playback producers above with the current
 // client's advertised room capabilities. `legacy` changes only the receiver's
 // downstream delta advertisement, preserving its complete SSE wire check.
 for(const row of clients)await row.client.join('1v1');
 now+=6000;await ctx.online.tick();
 await until(()=>clients.every(row=>row.events.some(event=>event.type==='match')));
 for(const row of clients){const match=row.events.find(event=>event.type==='match').data;
  assert.equal(match.continuousAuraVersion,2);assert.equal(match.ownerStatusVersion,1);assert.equal(match.combatPlaybackVersion,1);}
 for(const row of clients)await row.client.ready(row.events.find(event=>event.type==='match').data.id);
 driver.tick(10);await until(()=>clients.every(row=>row.events.some(event=>event.type==='state'&&event.data.pvp.phase==='fight')));
 assert.equal(driver.snapshot().ownership.ownerStatusVersion,1);
 assert.equal(driver.snapshot().ownership.combatPlaybackVersion,1);
 return {ctx,clients,ownerReport,advance:ms=>{now+=ms;},get driver(){return driver;},get sim(){return sim;}};
}

async function sendOwner(f,frameSeq,{action=null}={}){
 const owner=f.ownerReport('downstream-a',frameSeq,{action,x:frameSeq});
 f.clients[0].client.send({held:[],pressed:[],released:[]},owner);
 await until(()=>f.driver.snapshot().ownership.actors['downstream-a'].frameSeq===frameSeq);
 return owner;
}

test('HTTP input with an SSE-only v3 receiver gets compact room state, independent owner deltas and reliable actions',async t=>{
 const f=await fixture(t),[a,b]=f.clients;
 assert.equal(f.ctx.transportDiagnostics().socketOpened,0);
 const first=await sendOwner(f,3);await until(()=>b.events.some(event=>event.type==='peer-owned-state'&&event.data.report.frameSeq===3));
 const start=b.sources[0].wire.length;
 for(let i=0;i<5;i++){f.driver.tick(.1);await until(()=>b.sources[0].wire.slice(start).filter(event=>event.type==='state').length===i+1);}
 const states=b.sources[0].wire.slice(start).filter(event=>event.type==='state').map(event=>event.data);
 assert.ok(states.every(state=>state.snapshotDelta===true&&Object.keys(state.owners).length===0));
 assert.ok(states.every(state=>state.snapshot.actors.every(actor=>!Object.hasOwn(actor,'stats'))),'static actor templates are not retransmitted each room tick');
 await sendOwner(f,6,{action:1});await until(()=>b.events.some(event=>event.type==='peer-owned-state'&&event.data.report.frameSeq===6)
  &&b.events.some(event=>event.type==='input'&&event.data.actions?.[0].id===1));
 const wire=b.sources[0].wire.filter(event=>event.type==='owned-state');
 assert.equal(wire[0].data.baselineOnly,true);assert.equal(wire.at(-1).data.deltaVersion,3);
 const expanded=b.events.filter(event=>event.type==='peer-owned-state').at(-1).data.report;
 assert.equal(expanded.actor.x,6);assert.deepEqual(expanded.actor.stats,first.actor.stats);
 assert.ok(b.sources[0].wire.some(event=>event.type==='input'&&event.data.actionDeltaVersion===1));
 assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
});

test('losing only the upload WebSocket preserves the SSE codec token and subsequent HTTP owner/action delivery',async t=>{
 const f=await fixture(t,{sockets:true}),[a,b]=f.clients;
 await sendOwner(f,3);await until(()=>b.events.some(event=>event.type==='peer-owned-state'&&event.data.report.frameSeq===3));
 const token=b.sources[0].wire.find(event=>event.type==='owned-state').data.relayToken,start=b.sources[0].wire.length;
 a.blockSockets();b.blockSockets();await until(()=>f.ctx.transportDiagnostics().sockets.length===0);
 await sendOwner(f,6,{action:1});await until(()=>b.events.some(event=>event.type==='peer-owned-state'&&event.data.report.frameSeq===6));
 f.driver.tick(.1);await until(()=>b.sources[0].wire.slice(start).some(event=>event.type==='state'));
 const next=b.sources[0].wire.slice(start),poses=next.filter(event=>event.type==='owned-state');
 assert.ok(poses.length>0);assert.ok(poses.every(event=>event.data.relayToken===token));
 assert.equal(poses.some(event=>event.data.baselineOnly&&event.data.actorBaseline),false);
 assert.ok(next.filter(event=>event.type==='state').every(event=>event.data.snapshotDelta===true&&Object.keys(event.data.owners).length===0));
 await until(()=>b.events.some(event=>event.type==='input'&&event.data.actions?.[0].id===1));
 assert.ok(a.client.performance().sentPosts>0);assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
});

test('a receiver that never advertises delta decoding keeps the complete legacy SSE room contract',async t=>{
 const f=await fixture(t,{legacy:true}),b=f.clients[1],start=b.sources[0].wire.length;
 await sendOwner(f,3);f.driver.tick(.1);await until(()=>b.sources[0].wire.slice(start).some(event=>event.type==='state'));
 const wire=b.sources[0].wire.slice(start),states=wire.filter(event=>event.type==='state');
 assert.ok(states.every(event=>event.data.snapshotDelta!==true&&event.data.snapshot.actors.every(actor=>actor.stats)));
 assert.ok(states.some(event=>Object.keys(event.data.owners).includes('downstream-a')));
 assert.equal(wire.some(event=>event.type==='owned-state'),false);
 assert.equal(f.ctx.transportDiagnostics().socketOpened,0);assert.deepEqual(b.errors,[]);
});

test('repeated upload reconnections do not reseed a retained SSE mailbox or repeat actor/action birth templates',async t=>{
 const f=await fixture(t,{sockets:true}),[a,b]=f.clients;
 await sendOwner(f,3,{action:1});await until(()=>b.events.some(event=>event.type==='peer-owned-state'&&event.data.report.frameSeq===3));
 const token=b.sources[0].wire.find(event=>event.type==='owned-state').data.relayToken,start=b.sources[0].wire.length;
 for(let i=0;i<3;i++){
  const opened=f.ctx.transportDiagnostics().socketOpened;
  a.openedSockets.at(-1).close();b.openedSockets.at(-1).close();
  await until(()=>f.ctx.transportDiagnostics().socketOpened===opened+2&&a.client.performance().relay.active&&b.client.performance().relay.active);
  const frameSeq=6+i*3;await sendOwner(f,frameSeq,{action:i+2});
  await until(()=>b.events.some(event=>event.type==='peer-owned-state'&&event.data.report.frameSeq===frameSeq));
 }
 const rows=b.sources[0].wire.slice(start),owners=rows.filter(event=>event.type==='owned-state');
 assert.equal(rows.some(event=>['match','state'].includes(event.type)),false,'an upload restart does not generate a downstream seed');
 assert.ok(owners.length>=3);assert.ok(owners.every(event=>event.data.relayToken===token));
 assert.equal(owners.some(event=>event.data.actorBaseline),false);
 assert.equal(rows.some(event=>event.type==='input'&&event.data.actionActorBaseline),false);
 assert.deepEqual(b.events.filter(event=>event.type==='input').flatMap(event=>event.data.actions.map(action=>action.id)),[1,2,3,4]);
 assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
});

test('an SSE-only replacement uses a fresh token and sends a current full room seed before independent owner patches',async t=>{
 const f=await fixture(t),b=f.clients[1];await sendOwner(f,3);
 await until(()=>b.events.some(event=>event.type==='peer-owned-state'&&event.data.report.frameSeq===3));
 const token=b.sources[0].wire.find(event=>event.type==='owned-state').data.relayToken;
 b.sources[0].close();await until(()=>f.ctx.transportDiagnostics().streams.length===1);
 const fresh=new b.sources[0].constructor('/api/online/events?ownedDelta=3');t.after(()=>fresh.close());
 await until(()=>fresh.wire.some(event=>event.type==='state'));
 const seed=fresh.wire.find(event=>event.type==='state').data;
 assert.equal(seed.snapshotDelta,true);assert.ok(seed.snapshot.actors.every(actor=>actor.stats));
 await sendOwner(f,6);await until(()=>fresh.wire.some(event=>event.type==='owned-state'&&!event.data.baselineOnly));
 const poses=fresh.wire.filter(event=>event.type==='owned-state'),codec=createOwnedRelayDelta();
 assert.notEqual(poses[0].data.relayToken,token);assert.equal(poses[0].data.baselineOnly,true);
 assert.equal(codec.decode(poses[0].data),null);assert.equal(codec.decode(poses[1].data).frameSeq,6);
 assert.deepEqual(b.errors,[]);
});

test('RTC receipts during an SSE recovery gap cannot reject a valid owner upload or suppress a new mailbox baseline',async t=>{
 const f=await fixture(t,{sockets:true}),b=f.clients[1];await sendOwner(f,3);
 await until(()=>b.events.some(event=>event.type==='peer-owned-state'&&event.data.report.frameSeq===3));
 const matchId=b.events.find(event=>event.type==='match').data.id;
 b.sources[0].close();await until(()=>f.ctx.transportDiagnostics().streams.length===1);
 const receiver=f.ownerReport('downstream-b',100),socket=b.openedSockets[0];
 socket.send(JSON.stringify({matchId,sequence:100,frames:[{held:[],frameSeq:100}],owner:receiver,
  peerReceipts:[{playerId:'downstream-a',epoch:1,frameSeq:3}]}));
 await until(()=>socket.received.some(value=>value.type==='ack'&&value.data.sequence===100));
 const ack=socket.received.find(value=>value.type==='ack'&&value.data.sequence===100).data;
 assert.equal(ack.accepted,true);assert.equal(f.ctx.transportDiagnostics().invalidPeerReceipts,0);
 const fresh=new b.sources[0].constructor('/api/online/events?ownedDelta=3');t.after(()=>fresh.close());
 await until(()=>fresh.wire.some(event=>event.type==='state'));await sendOwner(f,6);
 await until(()=>fresh.wire.some(event=>event.type==='owned-state'&&!event.data.baselineOnly));
 assert.equal(f.ctx.transportDiagnostics().sockets.length,2);assert.equal(f.ctx.transportDiagnostics().ownedRelaySkipped,0);
 assert.equal(fresh.wire.find(event=>event.type==='owned-state').data.baselineOnly,true);
});

test('HTTP receiver control receipts trim only acknowledged same-life actions and expired evidence restores the server path',async t=>{
 const f=await fixture(t),b=f.clients[1];await sendOwner(f,3,{action:1});
 await until(()=>b.events.some(event=>event.type==='input'&&event.data.actions?.[0].id===1));
 const matchId=b.events.find(event=>event.type==='match').data.id;
 const receiver=f.ownerReport('downstream-b',100);
 receiver.actor.hp-=10;receiver.hits=[{id:900,attackerId:'downstream-a',damage:10}];
 const response=await b.request('/api/online/input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({matchId,sequence:100,
  frames:[{held:[],frameSeq:100}],owner:receiver,peerReceipts:[{playerId:'downstream-a',epoch:1,frameSeq:3,controlIds:[2,4]}]})});
 assert.equal(response.status,200);assert.equal((await response.json()).accepted,true);
 const accepted=f.driver.snapshot();assert.equal(accepted.snapshot.actors.find(actor=>actor.id==='downstream-b').hp,receiver.actor.hp);
 assert.equal(accepted.pvp.players.find(player=>player.id==='downstream-b').damageBy['downstream-a'],10,'HP and victim-owned scoring receipts remain on the server');
 await sendOwner(f,6,{action:2});await sendOwner(f,9,{action:3});
 await until(()=>b.events.some(event=>event.type==='input'&&event.data.actions?.[0].id===3));
 assert.deepEqual(b.events.filter(event=>event.type==='input').flatMap(event=>event.data.actions.map(action=>action.id)),[1,3]);
 assert.equal(f.ctx.transportDiagnostics().controlActionsSkipped,1);assert.equal(f.ctx.transportDiagnostics().controlRelaySkipped,1);
 f.advance(751);await sendOwner(f,12,{action:4});await until(()=>b.events.some(event=>event.type==='input'&&event.data.actions?.[0].id===4));
 assert.deepEqual(b.errors,[]);
});

test('HTTP rejects foreign and malformed control receipts before consuming the owner sequence',async t=>{
 const f=await fixture(t),b=f.clients[1];await sendOwner(f,3);await until(()=>b.events.some(event=>event.type==='peer-owned-state'));
 const matchId=b.events.find(event=>event.type==='match').data.id,owner=f.ownerReport('downstream-b',100);
 const body={matchId,sequence:100,frames:[{held:[],frameSeq:100}],owner};
 for(const row of [{playerId:'outside',epoch:1,frameSeq:3,controlIds:[2]},{playerId:'downstream-a',epoch:1,frameSeq:3,controlIds:[2,2]}]){
  const response=await b.request('/api/online/input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,peerReceipts:[row]})});
  assert.equal(response.status,400);assert.equal((await response.json()).error,'invalid-peer-receipts');
 }
 const response=await b.request('/api/online/input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal(response.status,200);assert.equal((await response.json()).accepted,true);
 assert.equal(f.ctx.transportDiagnostics().invalidPeerReceipts,2);
});

/** Real HTTP + production room-process relay tests; no original combat claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {createRoomWorkerFactory} from '../../apps/server/room-worker-factory.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import profile from '../../packages/combat-core/rf-profile.json' with {type:'json'};

const root=fileURLToPath(new URL('../../',import.meta.url));
const workerEntry=fileURLToPath(new URL('./fixtures/downstream-worker-poll-entry-v5.mjs',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<400;i++){if(predicate())return;await delay(5);}throw Error('Timed out waiting for worker/poll fixture');}
function frozenTimers(){return {setTimeout(callback,delay){return {callback,delay,unref(){}};},clearTimeout(){}};}

async function fixture(t,{legacy=false,rotateDuringStartup=false}={}){
  const accountRoot=await mkdtemp(path.join(tmpdir(),'rf-worker-poll-v5-'));
  const credentials=['worker-poll-a','worker-poll-b'].map(username=>({username,password:'synthetic-'+username,role:'player'}));
  const metadataFactory=Object.assign(()=>{}, {ownership:'local-owner-v1',professions:{RF:true},versions:{fixture:true}});
  const workerFactory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry});
  const held=[],holdTypes=new Set();let release,releaseInstall,markStarted;
  const installGate=new Promise(resolve=>{releaseInstall=resolve;}),started=new Promise(resolve=>{markStarted=resolve;});
  const factory=Object.assign(async args=>{
    const driver=await workerFactory({...args,emit(type,data){
      if(holdTypes.has(type))held.push({type,data});else args.emit(type,data);
      release=()=>{holdTypes.clear();for(const row of held.splice(0))args.emit(row.type,row.data);};
    }});
    markStarted();if(rotateDuringStartup)await installGate;return driver;
  },{ownership:workerFactory.ownership,professions:workerFactory.professions,versions:workerFactory.versions,
    workerDiagnostics:workerFactory.workerDiagnostics,close:workerFactory.close});
  Object.defineProperty(factory,'relayBindings',{get:()=>workerFactory.relayBindings,set:value=>{workerFactory.relayBindings=value;}});
  let now=10000,relayNow=0;
  const ctx=await createDevServer({root,accountRoot,credentials:credentials[0],additionalCredentials:[credentials[1]],driverFactory:factory,
    now:()=>now,onlineEventTransport:'poll',pollWaitMs:0,disconnectTimers:frozenTimers(),ownedRelayClock:()=>relayNow});
  await new Promise(resolve=>ctx.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+ctx.server.address().port,peers=[];
  t.after(async()=>{ctx.closeStreams();ctx.online.close();workerFactory.close();ctx.server.closeAllConnections();
    await new Promise(resolve=>ctx.server.close(resolve));assert.ok(path.resolve(accountRoot).startsWith(path.resolve(tmpdir())+path.sep));
    await rm(accountRoot,{recursive:true,force:true});});
  for(const credential of credentials){
    let cookie;const peer={username:credential.username,lease:null,cursor:0,sequence:0};
    peer.request=async(url,{method='GET',body,headers={}}={})=>{
      const response=await fetch(base+url,{method,headers:{Origin:base,'Content-Type':'application/json',...headers,...(cookie?{Cookie:cookie}:{})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;
    };
    peer.open=async(version=legacy?null:'3')=>{const response=await peer.request('/api/online/poll/open',{method:'POST',body:{},headers:version===null?{}:{'X-RF-Owned-Delta':version}});
      assert.equal(response.status,200);peer.lease=await response.json();peer.cursor=peer.lease.cursor;return peer.lease;};
    peer.poll=async()=>{const response=await peer.request(`/api/online/poll?connectionId=${peer.lease.connectionId}&after=${peer.cursor}`);
      assert.equal(response.status,200);const batch=await response.json();peer.cursor=batch.cursor;return batch.events;};
    peer.close=async()=>{const response=await peer.request('/api/online/poll/close',{method:'POST',body:{connectionId:peer.lease.connectionId}});assert.equal(response.status,200);};
    const login=await peer.request('/api/login',{method:'POST',body:credential});assert.equal(login.status,200);await login.json();await peer.open();await peer.poll();peers.push(peer);
  }
  for(const peer of peers){const response=await peer.request('/api/online/queue',{method:'POST',body:{mode:'1v1'}});assert.equal(response.status,200);}
  now+=6000;const starting=ctx.online.tick();
  if(rotateDuringStartup){await started;try{await peers[1].close();await peers[1].open();}finally{releaseInstall();}}
  await starting;const match=ctx.online.status(peers[0].username).match;assert.ok(match);
  for(const peer of peers){const response=await peer.request('/api/online/ready',{method:'POST',body:{matchId:match.id}});assert.equal(response.status,200);await response.json();await peer.poll();}
  const send=async(frameSeq,pressed=[])=>{relayNow+=60;
    const response=await peers[0].request('/api/online/input',{method:'POST',body:{matchId:match.id,sequence:peers[0].sequence++,frames:[{frameSeq,held:[],pressed,released:[]}]}});
    assert.equal(response.status,200);assert.equal((await response.json()).accepted,true);
    await until(()=>ctx.online.matchSnapshot(peers[0].username)?.ownership?.actors?.[peers[0].username]?.frameSeq===frameSeq);
  };
  return {ctx,peers,match,send,hold(...types){for(const type of types)holdTypes.add(type);},held,release:()=>release?.()};
}

function decodeOwners(events,codec){return events.filter(event=>event.type==='owned-state').map(event=>codec.decode(event.data)).filter(Boolean);}

test('HTTP-only v3 poll uses the production room child and delivers compact state plus decodable owner/action baselines',async t=>{
  const f=await fixture(t),receiver=f.peers[1],codec=createOwnedRelayDelta();
  const diagnostics=f.ctx.transportDiagnostics();assert.equal(diagnostics.socketOpened,0);
  assert.equal(diagnostics.roomWorkers.active,1);assert.notEqual(diagnostics.roomWorkers.workers[0].pid,process.pid);
  await f.send(3,['Z']);let events=await receiver.poll(),owners=decodeOwners(events,codec);
  assert.equal(owners.at(-1).frameSeq,3);assert.equal(owners.at(-1).actor.x,3);
  const action=events.find(event=>event.type==='input');assert.equal(action.data.actionDeltaVersion,1);
  assert.equal(codec.decodeActions(action.data).actions[0].id,1);
  await f.send(6);events=await receiver.poll();owners=decodeOwners(events,codec);assert.equal(owners.at(-1).actor.x,6);
  const state=events.find(event=>event.type==='state').data;assert.equal(state.snapshotDelta,true);
  assert.deepEqual(state.owners,{});assert.ok(state.snapshot.actors.every(actor=>!Object.hasOwn(actor,'stats')));
});

test('same poll mailbox rotation retains in-flight worker baselines and rejects an incompatible codec change',async t=>{
  const f=await fixture(t),receiver=f.peers[1],codec=createOwnedRelayDelta();
  f.hold('owned-state','input');await f.send(3,['Z']);assert.equal(f.held.length,2);
  const oldPacket=f.held.find(row=>row.type==='owned-state').data.__roomPackets[receiver.username];assert.ok(oldPacket.baselineJson);
  const oldLease=receiver.lease.connectionId;await receiver.open();assert.notEqual(receiver.lease.connectionId,oldLease);
  f.release();const delivered=await receiver.poll();assert.equal(decodeOwners(delivered,codec).at(-1).frameSeq,3);
  const encoded=delivered.find(event=>event.type==='input').data;assert.equal(encoded.relayToken,oldPacket.token);
  assert.equal(codec.decodeActions(encoded).actions[0].id,1);
  await f.send(6,['Z']);const next=await receiver.poll();assert.equal(decodeOwners(next,codec).at(-1).frameSeq,6);
  assert.equal(next.some(event=>event.type==='owned-state'&&event.data.actorBaseline),false);
  assert.equal(next.find(event=>event.type==='input').data.relayToken,oldPacket.token);
  const incompatible=await receiver.request('/api/online/poll/open',{method:'POST',body:{},headers:{'X-RF-Owned-Delta':'2'}});
  assert.equal(incompatible.status,409);await incompatible.json();
});

test('a new poll mailbox fences old worker owner packets and new-life seed omits the retired action history',async t=>{
  const f=await fixture(t),receiver=f.peers[1];
  f.hold('owned-state');await f.send(3,['Z']);const old=f.held[0].data.__roomPackets[receiver.username];
  await receiver.close();await receiver.open();f.release();let events=await receiver.poll();
  assert.equal(events.some(event=>event.type==='owned-state'&&event.data.relayToken===old.token),false);
  await f.send(4,['X']);events=await receiver.poll();const codec=createOwnedRelayDelta(),owners=decodeOwners(events,codec);
  assert.equal(owners.at(-1).epoch,2);assert.equal(owners.at(-1).frameSeq,4);
  const baseline=events.find(event=>event.type==='owned-state'&&event.data.baselineOnly).data;assert.notEqual(baseline.relayToken,old.token);
  await receiver.close();await receiver.open();events=await receiver.poll();
  const seed=events.find(event=>event.type==='state').data;assert.equal(seed.ownership.actors[f.peers[0].username].epoch,2);
  assert.equal(seed.recentActions?.[f.peers[0].username],undefined);
  await f.send(5,['Z']);events=await receiver.poll();const fresh=createOwnedRelayDelta();decodeOwners(events,fresh);
  const action=fresh.decodeActions(events.find(event=>event.type==='input').data);assert.equal(action.epoch,2);assert.equal(action.actions[0].id,1);
});

test('an unadvertised HTTP-only poll receiver keeps the complete legacy room and plain action contract with a room child',async t=>{
  const f=await fixture(t,{legacy:true}),receiver=f.peers[1];await f.send(3,['Z']);const events=await receiver.poll();
  assert.equal(events.some(event=>event.type==='owned-state'),false);
  const state=events.find(event=>event.type==='state').data;assert.notEqual(state.snapshotDelta,true);
  assert.ok(state.snapshot.actors.every(actor=>Object.hasOwn(actor,'stats')));assert.ok(state.owners[f.peers[0].username]);
  const action=events.find(event=>event.type==='input').data;assert.equal(action.actionDeltaVersion,undefined);assert.equal(action.actions[0].id,1);
});

test('a replacement mailbox during asynchronous worker creation overrides the child initial binding before its first owner',async t=>{
  const f=await fixture(t,{rotateDuringStartup:true}),receiver=f.peers[1];
  await f.send(3,['Z']);const events=await receiver.poll(),codec=createOwnedRelayDelta();
  const owners=decodeOwners(events,codec);assert.equal(owners.length,1);assert.equal(owners[0].frameSeq,3);
  assert.equal(codec.decodeActions(events.find(event=>event.type==='input').data).actions[0].id,1);
  assert.equal(f.ctx.transportDiagnostics().socketOpened,0);
});

test('worker control suppression preserves the first server codec baseline and keeps later fallback actions decodable',async t=>{
 const f=await fixture(t),receiver=f.peers[1],codec=createOwnedRelayDelta();
 f.hold('input');await f.send(3,['Z']);
 const held=f.held.find(row=>row.type==='input');assert.ok(held);assert.equal(held.data.actions[0].id,1);
 // Authored owner fixture only supplies a valid upload envelope. The child
 // remains the existing transport fixture, not an original combat answer.
 const sim=createSimulation({profile,map:{sceneId:'receipt-fixture',lines:[{lineId:0,start:[-1000,0,0],end:[1000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},
  actors:[{id:receiver.username,team:1,position:[0,0,0],lineId:0}]});
 const owner=encodeOwnedState(sim,receiver.username,{epoch:1,frameSeq:100});
 const response=await receiver.request('/api/online/input',{method:'POST',body:{matchId:f.match.id,sequence:receiver.sequence++,frames:[{frameSeq:100,held:[]}],owner,
  peerReceipts:[{playerId:f.peers[0].username,epoch:1,frameSeq:3,controlIds:[1,2]}]}});
 assert.equal(response.status,200);assert.equal((await response.json()).accepted,true);
 f.release();let events=await receiver.poll();decodeOwners(events,codec);
 const seed=events.find(event=>event.type==='input');assert.ok(seed.data.actionActorBaseline);
 assert.equal(codec.decodeActions(seed.data).actions[0].id,1,'independent reliable relay dictionaries retain their first definition');
 await f.send(6,['Z']);events=await receiver.poll();decodeOwners(events,codec);
 assert.equal(events.some(event=>event.type==='input'),false,'already received established action omitted only for this receiver');
 await f.send(9,['Z']);events=await receiver.poll();decodeOwners(events,codec);
 assert.equal(codec.decodeActions(events.find(event=>event.type==='input').data).actions[0].id,3);
 assert.equal(f.ctx.transportDiagnostics().controlActionsSkipped,1);
});

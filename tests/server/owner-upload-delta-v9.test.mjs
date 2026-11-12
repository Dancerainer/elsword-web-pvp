/** Production HTTP/WS authentication, owner validators and IPC; no GPU/WAN. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {createRoomWorkerFactory} from '../../apps/server/room-worker-factory.mjs';
import {createBattleDriverFactory} from './fixtures/owned-controller-relay-driver-v7.mjs';
import {createOnlineService,registerLocalOwnerInputConsumer} from '../../packages/online/service.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {createNodeOnlineSocketClass} from '../../tools/node-online-socket.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {createOwnerUploadDelta} from '../../packages/online/owner-upload-delta.mjs';
import profile from '../../packages/combat-core/rf-profile.json' with {type:'json'};
const root=fileURLToPath(new URL('../../',import.meta.url));
async function until(check){const deadline=performance.now()+7000;while(!check()){if(performance.now()>deadline)throw Error('upload fixture timed out');await new Promise(resolve=>setTimeout(resolve,5));}}

async function fixture(t,{worker=false,mutateInput=false,lateReply=false}={}){
  const accountRoot=await mkdtemp(path.join(tmpdir(),'rf-owner-upload-v9-'));
  const credentials=['upload-source-v9','upload-receiver-v9'].map(username=>({username,password:'synthetic-'+username,role:'player'}));
  const original=await createBattleDriverFactory();
  const heldReplies=[];let lifecycle;
  const direct=options=>{let driver;
    if(lateReply){
      const {match,emit,finish}=options,map={sceneId:match.sceneId,lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
        starts:match.players.map((player,index)=>({index,kind:'SetTeamStartPos',teamFlag:player.team===0,position:[index*200,0,0],lineId:0,facingRight:true}))};
      const simulation=createSimulation({profile,map,seed:match.seed,actors:match.players.map((player,index)=>({...player,position:[index*200,0,0]})),
        versions:{referenceVersion:'fixture',presetVersion:'fixture',programVersion:'fixture'}});
      const templates=structuredClone(simulation.state.actors);
      // Authored rules enable a real respawn in this two-account transport
      // fixture. This is lifecycle coverage, not original 1v1 rule evidence.
      const pvp=new PvpMatch({mode:match.mode,players:match.players,map,seed:match.seed,versions:simulation.versions,rules:{scoreLimit:4,respawnEnabled:true},
        onRespawn(id){const index=simulation.state.actors.findIndex(actor=>actor.id===id);simulation.state.actors[index]=structuredClone(templates[index]);return simulation.state.actors[index];}});
      driver=createLocalOwnerBattleDriver({match,simulation,pvp,emit,finish,manual:true});const ready=driver.ready,entered=new Set();
      driver.ready=id=>{const value=ready(id);entered.add(id);if(entered.size===match.players.length)driver.tick(10);return value;};lifecycle={simulation,driver};
    }else driver=original(options);
    if(!mutateInput&&!lateReply)return driver;
    // A real validated driver still consumes the pose first. Altering its
    // detached request afterward exercises immutable codec storage separately.
    const consume=(id,body)=>{const result=driver.submitInput(id,body);if(mutateInput&&body.owner)body.owner.actor.x=99999;
      if(lateReply&&body.owner?.epoch===1&&body.owner.frameSeq===3)return new Promise(resolve=>heldReplies.push({resolve:()=>resolve(result)}));return result;};
    const wrapped={...driver,submitInput:consume};registerLocalOwnerInputConsumer(wrapped,consume);return wrapped;};
  const metadata=Object.assign(direct,{ownership:'local-owner-v1',professions:{RF:true},versions:{fixture:true},
    ...(lateReply?{orderedInputDispatch:'synchronous-owner-ipc-v1'}:{})});
  const factory=worker?await createRoomWorkerFactory({root,assetRoot:root,metadataFactory:metadata,
    workerEntry:fileURLToPath(new URL('./fixtures/owned-controller-relay-entry-v7.mjs',import.meta.url))}):metadata;
  let now=10000;const ctx=await createDevServer({root,accountRoot,credentials:credentials[0],additionalCredentials:[credentials[1]],driverFactory:factory,now:()=>now});
  await new Promise(resolve=>ctx.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+ctx.server.address().port,clients=[],sockets=[],sources=[];
  t.after(async()=>{for(const socket of sockets)socket.close();for(const source of sources)source.abort();ctx.closeStreams();ctx.online.close();factory.close?.();ctx.server.closeAllConnections();
    await new Promise(resolve=>ctx.server.close(resolve));assert.ok(path.resolve(accountRoot).startsWith(path.resolve(tmpdir())+path.sep));await rm(accountRoot,{recursive:true,force:true});});
  for(const credential of credentials){let cookie;
    const request=async(url,body)=>{const response=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;};
    assert.equal((await request('/api/login',credential)).status,200);const abort=new AbortController();sources.push(abort);
    const stream=await fetch(base+'/api/online/events?ownedDelta=3',{headers:{Cookie:cookie},signal:abort.signal});assert.equal(stream.status,200);
    void stream.body.pipeTo(new WritableStream({write(){}})).catch(()=>{});
    const Socket=createNodeOnlineSocketClass({base,cookie:()=>cookie});
    const open=async(capability=true)=>{const socket=new Socket('/api/online/socket?ownedDelta=3&textAck=1'+(capability?'&ownerUploadDelta=1':''),'rf-online-gzip-v1'),values=[];
      socket.onmessage=event=>values.push(JSON.parse(typeof event.data==='string'?event.data:gunzipSync(Buffer.from(event.data))));sockets.push(socket);
      await until(()=>values.some(value=>value.type==='transport'));return {socket,values};};
    clients.push({request,open});assert.equal((await request('/api/online/queue',{mode:'1v1'})).status,200);
  }
  now+=6000;await ctx.online.tick();const match=ctx.online.status(credentials[0].username).match;assert.ok(match);
  for(const client of clients)assert.equal((await client.request('/api/online/ready',{matchId:match.id})).status,200);
  await until(()=>ctx.online.matchSnapshot(credentials[0].username)?.pvp?.phase==='fight');
  const simulation={profile,state:structuredClone(ctx.online.matchSnapshot(credentials[0].username).snapshot)},sender=createOwnerUploadDelta();
  let sequence=0;const report=(frameSeq,epoch=1)=>encodeOwnedState(simulation,credentials[0].username,{epoch,frameSeq});
  async function send(connection,owner,{compact=true,carrier,extra={}}={}){
    const batch={matchId:match.id,sequence:sequence++,frames:[{frameSeq:owner.frameSeq,held:[],pressed:[],released:[]}],
      ...(compact?{ownerUpload:carrier??sender.encode(owner)}:{owner}),...extra};
    connection.socket.send(gzipSync(JSON.stringify(batch)));await until(()=>connection.values.some(value=>value.type==='ack'&&value.data.sequence===batch.sequence));
    return connection.values.find(value=>value.type==='ack'&&value.data.sequence===batch.sequence).data;
  }
  return {ctx,clients,match,sender,report,send,heldReplies,sourceId:credentials[0].username,
    advanceLife(){const actor=lifecycle.simulation.state.actors.find(actor=>actor.id===credentials[0].username);actor.hp=0;actor.deathComplete=true;
      lifecycle.driver.tick(.1);lifecycle.driver.tick(10);lifecycle.driver.tick(6);assert.equal(lifecycle.driver.snapshot().ownership.actors[credentials[0].username].epoch,2);}};
}

for(const worker of [false,true])test(`${worker?'actual child':'in-process'} negotiated full/delta owner uploads preserve reliable histories and precise baseline receipts`,async t=>{
  const f=await fixture(t,{worker}),connection=await f.clients[0].open();assert.equal(connection.values[0].data.ownerUploadDelta,1);
  const first=f.report(3);first.actor.x=42;first.actions=[encodeCriticalAction(first,{id:3})];
  let ack=await f.send(connection,first);assert.equal(ack.accepted,true);assert.deepEqual(ack.ownerReceipt,{epoch:1,frameSeq:3});
  assert.deepEqual(ack.consumedActionIds,[3]);assert.equal(f.sender.acknowledge(ack.ownerReceipt),true);
  const second={...structuredClone(first),frameSeq:6};const carrier=f.sender.encode(second);assert.equal(carrier.pose.full,false);
  ack=await f.send(connection,second,{carrier});assert.deepEqual(ack.ownerReceipt,{epoch:1,frameSeq:6});f.sender.acknowledge(ack.ownerReceipt);
  if(worker)assert.equal((await f.clients[0].request('/api/online/ready',{matchId:f.match.id})).status,200,'refresh the manual room snapshot through its real FIFO RPC');
  assert.equal(f.ctx.online.matchSnapshot(f.sourceId).snapshot.actors.find(actor=>actor.id===f.sourceId).x,42);
  const old=await f.send(connection,first);assert.equal(old.accepted,true);assert.equal(old.ignored,'old-state');assert.equal(Object.hasOwn(old,'ownerReceipt'),false);
  const partial={...structuredClone(second),frameSeq:9,actionFrontierComplete:false};partial.actions=[encodeCriticalAction(partial,{id:9})];
  ack=await f.send(connection,partial);assert.equal(ack.ignored,'actions-pending');assert.deepEqual(ack.consumedActionIds,[9]);assert.equal(Object.hasOwn(ack,'ownerReceipt'),false);
  const complete={...structuredClone(partial),frameSeq:12};delete complete.actionFrontierComplete;
  ack=await f.send(connection,complete);assert.deepEqual(ack.ownerReceipt,{epoch:1,frameSeq:12});assert.deepEqual(ack.consumedActionIds,[9]);
  const oldLife={...structuredClone(complete),epoch:0,frameSeq:15};const oldCarrier={v:1,pose:{v:1,full:true,epoch:0,frameSeq:15,report:{...oldLife,actions:[],hits:[]}},actions:oldLife.actions,hits:[]};
  ack=await f.send(connection,oldLife,{carrier:oldCarrier});assert.equal(Object.hasOwn(ack,'ownerReceipt'),false);
});

test('driver-side request mutation cannot poison a subsequent delta raw baseline',async t=>{
  const f=await fixture(t,{mutateInput:true}),connection=await f.clients[0].open(),first=f.report(3);first.actor.x=42;
  const ack=await f.send(connection,first);assert.equal(f.sender.acknowledge(ack.ownerReceipt),true);
  const second={...structuredClone(first),frameSeq:6},carrier=f.sender.encode(second);assert.equal(carrier.pose.full,false);
  assert.deepEqual((await f.send(connection,second,{carrier})).ownerReceipt,{epoch:1,frameSeq:6});
  assert.equal(f.ctx.online.matchSnapshot(f.sourceId).snapshot.actors.find(actor=>actor.id===f.sourceId).x,42);
});

test('unnegotiated upload rejects compact carrier while old full owner ACK remains unchanged',async t=>{
  const f=await fixture(t),connection=await f.clients[0].open(false);assert.equal(Object.hasOwn(connection.values[0].data,'ownerUploadDelta'),false);
  let ack=await f.send(connection,f.report(3));assert.equal(ack.accepted,false);assert.equal(Object.hasOwn(ack,'ownerReceipt'),false);
  ack=await f.send(connection,f.report(6),{compact:false});assert.equal(ack.accepted,true);assert.equal(Object.hasOwn(ack,'ownerReceipt'),false);
  const owner=f.report(9),response=await f.clients[0].request('/api/online/input',{matchId:f.match.id,sequence:ack.sequence+1,frames:[{held:[],frameSeq:9}],owner});
  assert.equal(response.status,200);assert.equal(Object.hasOwn(await response.json(),'ownerReceipt'),false);
});

test('invalid frozen references and ambiguous full/compact carriers do not produce a baseline receipt',async t=>{
  const f=await fixture(t),connection=await f.clients[0].open(),first=f.report(3);const accepted=await f.send(connection,first);f.sender.acknowledge(accepted.ownerReceipt);
  const invalid=f.report(6);invalid.actor.state='not-a-real-state';let ack=await f.send(connection,invalid);
  assert.equal(ack.accepted,false);assert.equal(Object.hasOwn(ack,'ownerReceipt'),false);
  ack=await f.send(connection,f.report(9),{extra:{owner:f.report(9)}});assert.equal(ack.accepted,false);assert.equal(Object.hasOwn(ack,'ownerReceipt'),false);
  ack=await f.send(connection,f.report(12));assert.deepEqual(ack.ownerReceipt,{epoch:1,frameSeq:12});
});

test('new physical WS has no old compact bases and a fresh full upload repairs it',async t=>{
  const f=await fixture(t),old=await f.clients[0].open(),accepted=await f.send(old,f.report(3));f.sender.acknowledge(accepted.ownerReceipt);
  old.socket.close();await until(()=>f.ctx.transportDiagnostics().socketClosed>0);const next=await f.clients[0].open();
  let ack=await f.send(next,f.report(6));assert.equal(ack.accepted,false);assert.equal(Object.hasOwn(ack,'ownerReceipt'),false);
  f.sender.reset();ack=await f.send(next,f.report(9));assert.deepEqual(ack.ownerReceipt,{epoch:1,frameSeq:9});
});

test('a compact wire cannot expand a reconstructed input beyond the original 128 KiB batch bound',async t=>{
  const f=await fixture(t),connection=await f.clients[0].open(),first=f.report(3);const accepted=await f.send(connection,first);f.sender.acknowledge(accepted.ownerReceipt);
  const owner=f.report(6),carrier=f.sender.encode(owner);assert.equal(carrier.pose.full,false);
  const frames=[{held:[''],frameSeq:6}],wire={matchId:f.match.id,sequence:1,frames,ownerUpload:carrier};
  frames[0].held[0]='X'.repeat(128*1024-Buffer.byteLength(JSON.stringify(wire))-1);
  assert.ok(Buffer.byteLength(JSON.stringify(wire))<128*1024);
  const restored={matchId:f.match.id,sequence:1,frames,owner};assert.ok(Buffer.byteLength(JSON.stringify(restored))>128*1024);
  const ack=await f.send(connection,owner,{carrier,extra:{frames}});
  assert.equal(ack.accepted,false);assert.equal(ack.error,'input-batch-too-large');assert.equal(Object.hasOwn(ack,'ownerReceipt'),false);
});

test('late accepted old-life reply keeps canonical ACKs without poisoning the new-life upload cache',async t=>{
  const f=await fixture(t,{lateReply:true}),connection=await f.clients[0].open(),old=f.report(3);old.actions=[encodeCriticalAction(old,{id:3})];
  const oldCarrier=f.sender.encode(old);
  connection.socket.send(gzipSync(JSON.stringify({matchId:f.match.id,sequence:0,frames:[{held:[],frameSeq:3}],ownerUpload:oldCarrier})));
  await until(()=>f.heldReplies.length===1);assert.equal(connection.values.some(value=>value.type==='ack'),false);
  f.advanceLife();const newer=f.report(6,2),newCarrier=f.sender.encode(newer);
  connection.socket.send(gzipSync(JSON.stringify({matchId:f.match.id,sequence:1,frames:[{held:[],frameSeq:6}],ownerUpload:newCarrier})));
  await until(()=>connection.values.some(value=>value.type==='ack'&&value.data.sequence===1));
  const accepted=connection.values.find(value=>value.type==='ack'&&value.data.sequence===1).data;
  assert.deepEqual(accepted.ownerReceipt,{epoch:2,frameSeq:6});assert.equal(f.sender.acknowledge(accepted.ownerReceipt),true);
  f.heldReplies[0].resolve();await until(()=>connection.values.some(value=>value.type==='ack'&&value.data.sequence===0));
  const late=connection.values.find(value=>value.type==='ack'&&value.data.sequence===0).data;
  assert.equal(late.accepted,true);assert.deepEqual(late.consumedActionIds,[3]);assert.equal(Object.hasOwn(late,'ownerReceipt'),false);
  const latest=f.report(9,2),delta=f.sender.encode(latest);assert.equal(delta.pose.full,false);assert.equal(delta.pose.base,6);
  connection.socket.send(gzipSync(JSON.stringify({matchId:f.match.id,sequence:2,frames:[{held:[],frameSeq:9}],ownerUpload:delta})));
  await until(()=>connection.values.some(value=>value.type==='ack'&&value.data.sequence===2));
  assert.deepEqual(connection.values.find(value=>value.type==='ack'&&value.data.sequence===2).data.ownerReceipt,{epoch:2,frameSeq:9});
});

test('service opt-in baseline proof requires an exact normal owner frame and snapshots submitted metadata',async t=>{
  let stamp=0,result={accepted:true,frameSeq:3};const factory=()=>({ownership:'local-owner-v1',inputValidation:'room-worker-v1',submitInput(id,body){return typeof result==='function'?result(body):result;},stop(){}});
  factory.ownership='local-owner-v1';const online=createOnlineService({driverFactory:factory,accountStore:{},versions:{fixture:true},now:()=>stamp,random:()=>.5});t.after(()=>online.close());
  for(const id of ['a','b'])await online.join(id,'gm',{loadout:Array(8).fill(null)},'1v1');stamp=11000;await online.tick();const matchId=online.status('a').match.id;
  const f=await createBattleDriverFactory(),driver=f({match:{id:'fixture',players:[{id:'a',team:0},{id:'b',team:1}],mode:'1v1'},emit(){},finish(){}});t.after(()=>driver.stop());
  const state=driver.snapshot(),owner=encodeOwnedState({profile,state:state.snapshot},'a',{epoch:1,frameSeq:3});let sequence=0;
  const submit=()=>online.submitInput('a',{matchId,sequence:sequence++,frames:[{held:[],frameSeq:owner.frameSeq}],owner},{ownerReceipt:true});
  assert.deepEqual((await submit()).ownerReceipt,{epoch:1,frameSeq:3});
  for(const ignored of ['old-life','room-locked','old-state','actions-pending']){result={accepted:true,frameSeq:3,ignored};assert.equal(Object.hasOwn(await submit(),'ownerReceipt'),false);}
  result={accepted:true,frameSeq:4};assert.equal(Object.hasOwn(await submit(),'ownerReceipt'),false);result={accepted:true};assert.equal(Object.hasOwn(await submit(),'ownerReceipt'),false);
  result=body=>{body.owner.epoch=99;body.owner.frameSeq=999;return Promise.resolve({accepted:true,frameSeq:3});};
  assert.deepEqual((await submit()).ownerReceipt,{epoch:1,frameSeq:3});
});

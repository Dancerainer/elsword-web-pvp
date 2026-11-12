import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createWebSocketStream} from '../../apps/server/websocket-stream.mjs';
import {createRoomWorkerFactory} from '../../apps/server/room-worker-factory.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {createPipelineFixture} from './fixtures/room-worker-pipeline-driver-v7.mjs';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {createNodeOnlineSocketClass} from '../../tools/node-online-socket.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)),workerEntry=fileURLToPath(new URL('./fixtures/room-worker-pipeline-entry-v7.mjs',import.meta.url));
const metadataFactory=Object.assign(()=>{}, {ownership:'local-owner-v1',versions:{fixture:true},professions:{RF:true},maps:[]});
const match={id:'pipeline-room',players:['a','b','c','d'].map((id,index)=>({id,username:id,team:index<2?0:1,loadout:Array(8).fill(null)}))};
class Socket extends EventEmitter{writableLength=0;writableNeedDrain=false;destroyed=false;written=[];
 write(bytes){this.written.push(Buffer.from(bytes));return true;}end(){this.emit('close');}destroy(){this.destroyed=true;this.emit('close');}}
function masked(body){const bytes=gzipSync(JSON.stringify(body)),mask=Buffer.from([7,13,17,23]),header=Buffer.alloc(bytes.length<126?2:4);
 header[0]=0x82;header[1]=0x80|(bytes.length<126?bytes.length:126);if(header.length===4)header.writeUInt16BE(bytes.length,2);
 for(let index=0;index<bytes.length;index++)bytes[index]^=mask[index%4];return Buffer.concat([header,mask,bytes]);}
function decoded(frame){const opcode=frame[0]&15,offset=(frame[1]&127)===126?4:2,bytes=frame.subarray(offset);return JSON.parse(opcode===1?bytes:gunzipSync(bytes));}
async function until(predicate){const deadline=performance.now()+2500;while(!predicate()){if(performance.now()>deadline)throw Error('pipeline fixture timed out');await new Promise(resolve=>setTimeout(resolve,5));}}

test('only the default synchronous production worker entry advertises pipelined dispatch',async()=>{
 const production=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory});
 const alternative=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry});
 assert.equal(production.orderedInputDispatch,'synchronous-owner-ipc-v1');assert.equal(alternative.orderedInputDispatch,null);
 production.close();alternative.close();
});

test('actual child consumes critical actions once and in FIFO order before held RPC replies, with no old-pose rollback',async t=>{
 const events=[],factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry});
 const driver=await factory({match,emit:(type,data)=>events.push({type,data}),finish(){}});
 const local=createPipelineFixture(match);t.after(()=>{local.driver.stop();driver.stop();factory.close();});
 let frame=0;const report=(x,state='RSI_STAND',serial=0)=>{
  const value=encodeOwnedState(local.simulation,'a',{epoch:1,frameSeq:++frame});
  Object.assign(value.actor,{x,state,stateSerial:serial});return value;
 };
 // Canonical identities and authored state serials distinguish urgent action
 // edges. This tests transport consumption, not original/native skill timing.
 const first=report(100,'RSI_COMBO_Z',1);first.actions=[encodeCriticalAction(first,{id:1})];
 const second=report(200,'RSI_COMBO_X',2);second.actions=[...first.actions,encodeCriticalAction(second,{id:2})];
 const third=report(300,'RSI_COMBO_Z',3);third.actions=[...second.actions,encodeCriticalAction(third,{id:3})];
 const old={...first,actor:{...first.actor,x:999}};
 const batches=[first,second,third,old].map((owner,sequence)=>({matchId:match.id,sequence,frames:[{held:[],frameSeq:owner.frameSeq}],owner}));
 const socket=new Socket(),submitted=[],completions=[];
 const stream=createWebSocketStream(socket,{maximumConsumerInFlight:8,onMessage:body=>{
  submitted.push(body.sequence);return driver.submitInput('a',body).then(value=>{completions.push(body.sequence);if(!stream.closed)stream.sendJson({sequence:body.sequence,...value});});
 }});t.after(()=>stream.destroy());
 for(const body of batches)socket.emit('data',masked(body));
 await until(()=>events.filter(row=>row.type==='input').length===3&&events.filter(row=>row.type==='owned-state').length===3&&submitted.length===4);
 assert.deepEqual(submitted,[0,1,2,3]);assert.deepEqual(completions,[]);assert.equal(socket.written.length,0,'an IPC dispatch is not an ACK');
 assert.equal(stream.performance().consumerInFlight,4);assert.equal(stream.performance().decodeQueuedMessages,4);
 const actions=events.filter(row=>row.type==='input').flatMap(row=>row.data.actions);
 assert.deepEqual(actions.map(action=>[action.id,action.actor.state,action.actor.stateSerial]),[[1,'RSI_COMBO_Z',1],[2,'RSI_COMBO_X',2],[3,'RSI_COMBO_Z',3]]);
 assert.deepEqual(events.filter(row=>row.type==='owned-state').map(row=>row.data.report.frameSeq),[1,2,3]);
 driver.bindRelay('b',{generation:1,token:'fixture-release-replies',splitDeltas:true,deltaVersion:3});
 await until(()=>completions.length===4);assert.deepEqual(completions,[0,1,2,3]);
 const acknowledgements=socket.written.map(decoded);assert.deepEqual(acknowledgements.map(value=>value.sequence),[0,1,2,3]);
 assert.deepEqual(acknowledgements.map(value=>value.consumedActionIds),[[1],[1,2],[1,2,3],[1]]);
 assert.equal(acknowledgements[3].ignored,'old-state');assert.equal(stream.performance().decodeQueuedMessages,0);
 await driver.ready('b');
 const latest=driver.snapshot().snapshot.actors.find(actor=>actor.id==='a');assert.equal(latest.x,300);
});

test('real HTTP/WS enables only the explicit worker capability and fences delayed ACKs after upload replacement',async t=>{
 const accountRoot=await mkdtemp(path.join(tmpdir(),'rf-owner-pipeline-'));
 const credentials=['pipeline-a','pipeline-b'].map(username=>({username,password:'private-transport-fixture',role:'player'}));
 let now=10000,local;const pending=[];
 const factory=async({match,emit})=>{
  local=createPipelineFixture(match,emit);const driver=local.driver;
  // This authored RPC barrier mimics a synchronous ordered worker consuming
  // before its reply arrives. The actual production child is covered above.
  return {ownership:driver.ownership,inputValidation:'room-worker-v1',snapshot:driver.snapshot,ready:driver.ready,
   disconnect:driver.disconnect,stop:driver.stop,submitInput(id,body){const value=driver.submitInput(id,body);
    return new Promise(resolve=>pending.push({sequence:body.sequence,resolve:()=>resolve(value)}));}};
 };
 Object.assign(factory,{ownership:'local-owner-v1',orderedInputDispatch:'synchronous-owner-ipc-v1'});
 const ctx=await createDevServer({root,accountRoot,credentials:credentials[0],additionalCredentials:[credentials[1]],
  driverFactory:factory,createPlayerAccount:false,now:()=>now});
 const base='http://127.0.0.1:'+await listenLoopback(ctx.server),sources=[],sockets=[];
 t.after(async()=>{sockets.forEach(socket=>socket.close());sources.forEach(source=>source.abort());
  ctx.closeStreams();ctx.online.close();ctx.server.closeAllConnections();await new Promise(resolve=>ctx.server.close(resolve));
  await rm(accountRoot,{recursive:true,force:true});});
 const clients=[];
 for(const credential of credentials){
  let cookie;const request=async(url,options={})=>{const response=await fetch(base+url,{...options,
   headers:{Origin:base,...options.headers,...(cookie?{Cookie:cookie}:{})}});
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;};
  assert.equal((await request('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credential)})).status,200);
  const abort=new AbortController();sources.push(abort);const events=await request('/api/online/events?ownedDelta=3',{signal:abort.signal});
  void events.body.pipeTo(new WritableStream({write(){}})).catch(()=>{});
  const NodeSocket=createNodeOnlineSocketClass({base,cookie:()=>cookie});
  const open=async()=>{const socket=new NodeSocket('/api/online/socket?ownedDelta=3&textAck=1','rf-online-gzip-v1'),values=[];
   socket.onmessage=event=>values.push(JSON.parse(typeof event.data==='string'?event.data:gunzipSync(Buffer.from(event.data))));
   sockets.push(socket);await until(()=>socket.readyState===1);return {socket,values};};
  const connection=await open();
  assert.equal((await request('/api/online/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'1v1'})})).status,200);
  clients.push({request,cookie:()=>cookie,open,connection});
 }
 await ctx.online.tick();now+=6000;await ctx.online.tick();const active=ctx.online.status(credentials[0].username).match;
 assert.ok(active,JSON.stringify(ctx.online.status(credentials[0].username)));
 const {connection:first,open}=clients[0];assert.equal(ctx.transportDiagnostics().sockets[0].maximumConsumerInFlight,8);
 const send=(socket,sequence)=>{const owner=encodeOwnedState(local.simulation,credentials[0].username,{epoch:1,frameSeq:sequence+1});
  owner.actor.x=100+sequence;socket.send(gzipSync(JSON.stringify({matchId:active.id,sequence,frames:[{held:[],frameSeq:owner.frameSeq}],owner})));};
 send(first.socket,0);send(first.socket,1);await until(()=>pending.length===2);
 assert.deepEqual(pending.map(row=>row.sequence),[0,1]);assert.equal(first.values.filter(value=>value.type==='ack').length,0);
 assert.equal(ctx.transportDiagnostics().sockets[0].consumerInFlight,2);
 pending[0].resolve();pending[1].resolve();await until(()=>first.values.filter(value=>value.type==='ack').length===2);
 assert.deepEqual(first.values.filter(value=>value.type==='ack').map(value=>[value.data.sequence,value.data.accepted]),[[0,true],[1,true]]);
 send(first.socket,2);await until(()=>pending.length===3);first.socket.close();await until(()=>ctx.transportDiagnostics().socketClosed===1);
 const replacement=await open();pending[2].resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(replacement.values.some(value=>value.type==='ack'&&value.data.sequence===2),false,'late old upload completion cannot ACK a replacement');
 send(replacement.socket,3);await until(()=>pending.length===4);pending[3].resolve();
 await until(()=>replacement.values.some(value=>value.type==='ack'&&value.data.sequence===3));
 assert.equal(replacement.values.some(value=>value.type==='ack'&&value.data.sequence===2),false);
 assert.equal(local.simulation.actor(credentials[0].username).x,103);assert.equal(ctx.transportDiagnostics().sessionReleases.logout??0,0);
 send(replacement.socket,4);await until(()=>pending.length===5);
 // An authored generation handover while an RPC reply is held verifies the
 // post-await identity fence separately from closing the old upload socket.
 const session=ctx.sessions.get(clients[0].cookie().slice('rf_session='.length));session.pageGeneration++;
 pending[4].resolve();await new Promise(resolve=>setImmediate(resolve));send(replacement.socket,5);
 await until(()=>replacement.socket.readyState===3);
 assert.equal(replacement.values.some(value=>value.type==='ack'&&value.data.sequence===4),false);
 assert.equal(local.simulation.actor(credentials[0].username).x,104,'a retired upload cannot dispatch another generation input');
});

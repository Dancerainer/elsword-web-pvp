/** Production coordinator-to-coordinator transport regressions. The RTC/SSE
 * wires are controlled in memory; no Native/GPU/WAN behavior is asserted.
 * NETWORK2016_TEST_ROOT lets an isolated test worktree read an integration
 * tree without copying or committing its in-progress production modules. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {gzipSync} from 'node:zlib';

const root=path.resolve(process.env.NETWORK2016_TEST_ROOT??fileURLToPath(new URL('../../',import.meta.url))),
  url=relative=>pathToFileURL(path.join(root,relative)).href;
const {createOnlineClient}=await import(url('apps/web/online-client.mjs'));
const {decodeOnlineGzip}=await import(url('apps/web/online-socket.mjs'));
const {isNetworkBinary,NETWORK_BINARY_VERSION}=await import(url('packages/online/network-binary.mjs'));
const {createSimulation}=await import(url('packages/combat-core/index.mjs'));
const {encodeOwnedState,encodeCriticalAction}=await import(url('packages/online/owned-state.mjs'));
const {createOwnerStatusClock}=await import(url('packages/online/owner-status-clock.mjs'));
const {createLocalOwnershipSync}=await import(url('apps/web/input-prediction.mjs'));
const profile=JSON.parse(readFileSync(path.join(root,'packages/combat-core/rf-profile.json')));
const map={sceneId:'network2016-pair',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const input={held:[],pressed:[],released:[]},ids=['a','b'];
const settle=async()=>{for(let n=0;n<60;n++)await Promise.resolve();};
const value=async data=>typeof data==='string'?JSON.parse(data):decodeOnlineGzip(data,{allowBinary:true});
const legacyFiles=new Set(['apps/web/online-client.mjs','apps/web/online-peer-control.mjs','apps/web/online-socket.mjs',
  'packages/online/owner-pose-delta.mjs','packages/online/owner-upload-delta.mjs','packages/online/network-binary.mjs','packages/online/owner-buff-sync.mjs']);
const legacyModules=new Map();
const legacyJsonRef=process.env.WEB_PVP_LEGACY_JSON_REF;
const legacyV36Ref=process.env.WEB_PVP_V36_REF;
const legacyV37Ref=process.env.WEB_PVP_V37_REF;
function legacyModule(relative,ref=legacyJsonRef){
  const key=`${ref}:${relative}`;if(legacyModules.has(key))return legacyModules.get(key);
  const source=execFileSync('git',['show',key],{cwd:root,encoding:'utf8'});
  const patched=source.replace(/from (['"])(\.[^'"]+)\1/g,(_all,quote,dependency)=>{
    const resolved=path.resolve(root,path.dirname(relative),dependency),name=path.relative(root,resolved).replaceAll('\\','/');
    return `from ${quote}${legacyFiles.has(name)?legacyModule(name,ref):pathToFileURL(resolved).href}${quote}`;
  });
  const result='data:text/javascript;base64,'+Buffer.from(patched).toString('base64');legacyModules.set(key,result);return result;
}

async function pair(t,{legacyRight=false,legacyRef=legacyJsonRef,rejectRightPose=false,onObserved=()=>{}}={}){
  const wire=[],history=[],endpoints={},errors=[];let serial=0,now=0;
  const match={id:'network2016-pair',ownership:'local-owner-v1',continuousAuraVersion:2,ownerStatusVersion:1,combatPlaybackVersion:1,
    players:ids.map((id,team)=>({id,team}))};
  const legacy=legacyRight?(await import(legacyModule('apps/web/online-client.mjs',legacyRef))).createOnlineClient:null;
  class Channel{
    constructor(from,label){this.from=from;this.label=label;this.readyState='open';this.bufferedAmount=0;}
    send(data){const row={from:this.from,to:this.from==='a'?'b':'a',label:this.label,data:typeof data==='string'?data:new Uint8Array(data).slice()};wire.push(row);history.push(row);}
    close(){this.readyState='closed';}
  }
  for(const id of ids){
    const endpoint=endpoints[id]={channels:new Map(),events:[],tasks:new Map(),epoch:1};
    endpoint.sim=createSimulation({profile,map,networkOwnerId:id,actors:ids.map((actorId,team)=>({id:actorId,team,position:[team*2000,0,0],lineId:0,loadout:Array(8).fill(null)}))});
    class Source{constructor(){endpoint.source=this;this.listeners=new Map();}addEventListener(type,fn){this.listeners.set(type,fn);}close(){}
      emit(type,data){this.listeners.get(type)?.({data:JSON.stringify(data)});}}
    class Peer{constructor(){endpoint.peer=this;this.connectionState='connected';}
      createDataChannel(label){const channel=new Channel(id,label);endpoint.channels.set(label,channel);return channel;}
      async createOffer(){return {type:'offer',sdp:'fixture'};}async setLocalDescription(description){this.localDescription={toJSON:()=>description};}
      close(){this.connectionState='closed';}}
    const timers={setTimeout(fn,ms){const token=++serial;endpoint.tasks.set(token,{fn,ms});return token;},clearTimeout(token){endpoint.tasks.delete(token);}};
    endpoint.client=(id==='b'&&legacy?legacy:createOnlineClient)({EventSource:Source,RTCPeerConnection:Peer,WebSocket:null,rtcOptions:{enabled:false},timers,clock:()=>now,
      fetch:async()=>({ok:true,json:async()=>({accepted:true})}),onError:error=>errors.push(error),
      onEvent(type,data){endpoint.events.push({type,data});const observed=onObserved(id,type,data,endpoint);if(observed!==undefined)return observed;if(type==='owner-actions')return true;
        if(type==='peer-owned-state'){if(id==='b'&&rejectRightPose)return false;return {validated:true,applied:true,playerId:data.playerId,epoch:data.report.epoch,frameSeq:data.report.frameSeq};}return true;}});
    t.after(()=>endpoint.client.close());await endpoint.client.open();await endpoint.client.setMatch(match,id);
    endpoint.state=(epoch=1)=>{endpoint.epoch=epoch;endpoint.source.emit('state',{matchId:match.id,snapshot:endpoint.sim.snapshot(),
      ownership:{actors:Object.fromEntries(ids.map(actorId=>[actorId,{epoch,frameSeq:0}]))}});};endpoint.state();
    endpoint.report=(frame,actions=false,epoch=endpoint.epoch)=>{
      endpoint.sim.actor(id).x=frame;const report=encodeOwnedState(endpoint.sim,id,{epoch,frameSeq:frame});
      if(actions){const action=encodeCriticalAction(report,{id:frame});action.playback={version:1,start:true,held:[]};report.actions=[action];}return report;
    };
  }
  for(const label of ['input','control']){const channel=new Channel('b',label);endpoints.b.channels.set(label,channel);endpoints.b.peer.ondatachannel({channel});}
  const deliver=async row=>{endpoints[row.to].channels.get(row.label).onmessage?.({data:row.data});await settle();};
  const drain=async(predicate=()=>true)=>{for(let round=0;round<100;round++){await settle();const index=wire.findIndex(predicate);if(index<0)return;const [row]=wire.splice(index,1);await deliver(row);}throw Error('wire did not drain');};
  for(const endpoint of Object.values(endpoints))endpoint.channels.get('control').onopen();await drain();
  const send=async(id,frame,actions=false)=>{const endpoint=endpoints[id],report=endpoint.report(frame,actions);endpoint.client.send(input,report);await settle();return report;};
  const inputs=async from=>{const rows=history.filter(row=>row.from===from&&row.label==='input');return Promise.all(rows.map(async row=>({...row,value:await value(row.data)})));};
  const acks=from=>history.filter(row=>row.from===from&&row.label==='control'&&typeof row.data==='string').map(row=>JSON.parse(row.data)).filter(row=>row.type==='pose-ack');
  return {wire,history,endpoints,errors,send,drain,deliver,inputs,acks,match,advance(ms){now+=ms;},async reconnect(){
    await drain();for(const id of ids){await endpoints[id].client.setMatch(match,id);await settle();}
    for(const label of ['input','control']){const channel=new Channel('b',label);endpoints.b.channels.set(label,channel);endpoints.b.peer.ondatachannel({channel});}
    for(const endpoint of Object.values(endpoints))endpoint.channels.get('control').onopen();await drain();
  }};
}

test('actual published v37 and v38 keep full status plus bidirectional tiny motion without guessing Buff-v2 identities',{skip:!legacyV37Ref&&'Set WEB_PVP_V37_REF to compare the archived client'},async t=>{
  const f=await pair(t,{legacyRight:true,legacyRef:legacyV37Ref});
  for(const endpoint of Object.values(f.endpoints)){
    const original=endpoint.report,clock=createOwnerStatusClock();
    endpoint.report=(frame,...args)=>{const report=original(frame,...args);report.actor=clock.encode(report.actor,report.epoch,frame).actor;return report;};
  }
  for(const frame of [1,4,34])for(const id of ids){await f.send(id,frame);await f.drain();}
  for(const id of ids){
    const endpoint=f.endpoints[id];assert.ok(endpoint.events.some(row=>row.type==='owner-status'));
    assert.ok(endpoint.events.some(row=>row.type==='owner-motion'),'both versions keep independent motion');
    assert.equal(endpoint.client.performance().ownerBuffSync.compactSent,0);
    assert.equal(endpoint.client.performance().ownerBuffSync.rejected,0);
  }
  assert.deepEqual(f.errors,[]);
});

test('relay full v37 report locally supplies passive v38 recovery before queued starts without extending the legacy wire',{skip:!legacyV37Ref&&'Set WEB_PVP_V37_REF to compare the archived client'},async t=>{
  const sync=createLocalOwnershipSync({combatPlaybackVersion:1,ownerStatusVersion:1,clock:()=>0});t.after(()=>sync.clear());
  const f=await pair(t,{legacyRight:true,legacyRef:legacyV37Ref,onObserved(id,type,data,endpoint){
    if(id!=='a')return;
    if(type==='state')return sync.reconcile(endpoint.sim,{...data,ownership:{...data.ownership,mode:'local-owner-v1'}},id);
    if(type==='owner-motion')return sync.receiveMotion(endpoint.sim,data.playerId,data.motion,id);
    if(type==='owner-actions')return sync.receiveActions(data.playerId,data.actions,data.epoch,data.frameSeq);
    if(type==='peer-owned-state')return sync.receivePeerResult(endpoint.sim,data.playerId,data.report,id);
    if(type==='owner-status')return sync.receiveStatus(endpoint.sim,data.playerId,data.status,id);
  }}),{a,b}=f.endpoints;
  const attack=b.report(10),old=encodeCriticalAction(attack,{id:10});
  Object.assign(old.actor,{state:'RSI_COMBO_Z',stateSerial:20,animationName:profile.states.RSI_COMBO_Z.animationName});
  old.playback={version:1,start:true,held:['X']};
  a.source.emit('input',{matchId:f.match.id,playerId:'b',epoch:1,frameSeq:10,actions:[old]});
  const reaction=b.report(20);
  Object.assign(reaction.actor,{state:'RSI_DAMAGE_AIR_UP',stateSerial:30,animationName:profile.states.RSI_DAMAGE_AIR_UP.animationName,
    stateTime:.1,animationTime:.1,animationPlaybackSpeed:1,animationStopped:false,grounded:false,y:200,vy:600,lineId:null,
    hitStop:0,worldStop:0,downForce:false,flyCount:1,lastAttackerFront:true});
  const original=structuredClone(reaction),local=structuredClone(a.sim.actor('a'));
  a.source.emit('owned-state',{matchId:f.match.id,playerId:'b',report:reaction});await settle();
  const motion=a.events.findLast(row=>row.type==='owner-motion'&&row.data.transport==='relay-motion');
  assert.equal(motion.data.motion.reaction.state,'RSI_DAMAGE_AIR_UP');
  sync.beforeStep(a.sim,'a');assert.equal(a.sim.actor('b').state,'RSI_DAMAGE_AIR_UP');assert.equal(a.sim.actor('b').y,200);
  assert.deepEqual(a.sim.actor('a'),local);assert.equal(a.sim.state.effects.length,0);assert.equal(sync.combatPlaybackDiagnostics.receiver.reactionSuperseded,1);
  assert.deepEqual(reaction,original,'derivation never adds reaction fields to the server report');
  // A real published-v37 consumer still receives the ordinary report and
  // derives its unchanged v1 geometry; no reaction field is sent over wire.
  const legacyReport=a.report(30);b.source.emit('owned-state',{matchId:f.match.id,playerId:'a',report:legacyReport});await settle();
  const legacyMotion=b.events.findLast(row=>row.type==='owner-motion'&&row.data.transport==='relay-motion');
  assert.equal(legacyMotion.data.motion.reaction,undefined);assert.ok(b.events.some(row=>row.type==='peer-owned-state'&&row.data.transport==='relay'));
  // An attack header has no eligible passive checkpoint and cannot bypass
  // the reliable StateStart lane merely because it came through relay.
  const fresh=b.report(40);Object.assign(fresh.actor,{state:'RSI_COMBO_Z',stateSerial:40,animationName:profile.states.RSI_COMBO_Z.animationName});
  a.source.emit('owned-state',{matchId:f.match.id,playerId:'b',report:fresh});await settle();
  const attackMotion=a.events.findLast(row=>row.type==='owner-motion'&&row.data.transport==='relay-motion');
  assert.equal(attackMotion.data.motion.reaction,undefined);assert.equal(attackMotion.data.motion.locomotion,undefined);
  sync.beforeStep(a.sim,'a');assert.equal(a.sim.actor('b').state,'RSI_DAMAGE_AIR_UP');assert.equal(a.sim.state.effects.length,0);
  assert.deepEqual(f.errors,[]);
});

test('same-owner reconnect preserves the independent Buff revision and refreshes peer ACKs',async t=>{
  const f=await pair(t),{a}=f.endpoints,clock=createOwnerStatusClock(),original=a.report;
  a.report=(frame,...args)=>{const report=original(frame,...args);report.actor=clock.encode(report.actor,report.epoch,frame).actor;return report;};
  await f.send('a',1);await f.drain();await f.send('b',1);await f.drain();
  await f.send('a',4);await f.drain();
  a.sim.actor('a').buffs=[{schemaVersion:1,templateId:1,skillLevel:1,accumulationLimit:1,resistance:0,durationMultiplier:1,
    behaviors:[],finalizers:[],displayer:{},sourceActorId:'a',targetActorId:'a',factorId:1,accumulationCount:1}];
  f.advance(300);await f.send('a',604);await f.drain();
  const snapshots=async()=>{const rows=await Promise.all(f.history.filter(row=>row.from==='a'&&row.label==='control').map(row=>value(row.data)));return rows.filter(row=>row.type==='buff-sync'&&row.kind==='snapshot').map(row=>row.snapshot);};
  const prior=(await snapshots()).at(-1);assert.ok(prior.revision>=2);
  await f.reconnect();await f.send('b',607);await f.drain();f.advance(300);await f.send('a',607);await f.drain();
  assert.equal((await snapshots()).at(-1).revision,prior.revision);assert.deepEqual(f.errors,[]);
});

test('independent Buff repair retries lost snapshots while immediate protection keeps its full fallback',async t=>{
  const f=await pair(t),{a,b}=f.endpoints,clock=createOwnerStatusClock(),original=a.report;
  a.report=(frame,...args)=>{const report=original(frame,...args);report.actor=clock.encode(report.actor,report.epoch,frame).actor;return report;};
  await f.send('a',1);await f.drain();await f.send('b',1);await f.drain();
  await f.send('a',4);await f.drain(row=>row.label==='input');
  // Drop the reliable application snapshot to exercise application repair;
  // SCTP itself is reliable, but reconnect/decoder retirement can lose a job.
  for(let i=f.wire.length-1;i>=0;i--)if((await value(f.wire[i].data)).type==='buff-sync')f.wire.splice(i,1);
  a.sim.actor('a').superArmor=true;await f.send('a',7);await f.drain(row=>row.label==='input');
  assert.equal(b.events.filter(e=>e.type==='owner-protection').at(-1).data.status.actor.superArmor,true);
  assert.equal(b.client.performance().ownerBuffSync.compactReceived,0);
  f.advance(300);await f.send('a',10);await f.drain();
  await f.send('a',40);await f.drain();
  assert.ok(a.client.performance().ownerBuffSync.compactSent>0);
  assert.ok(b.client.performance().ownerBuffSync.compactReceived>0);
  assert.ok(a.client.performance().ownerBuffSync.snapshotsSent>=2);
  assert.deepEqual(f.errors,[]);
});

test('same-revision Buff timer anchor retries when its ACK is lost to backpressure',async t=>{
  const f=await pair(t),{a,b}=f.endpoints,clock=createOwnerStatusClock(),original=a.report;
  a.report=(frame,...args)=>{const report=original(frame,...args);report.actor=clock.encode(report.actor,report.epoch,frame).actor;return report;};
  await f.send('a',1);await f.drain();await f.send('b',1);await f.drain();
  await f.send('a',4);await f.drain();
  b.channels.get('control').bufferedAmount=50000;f.advance(300);await f.send('a',304);await f.drain();
  const sent=a.client.performance().ownerBuffSync.snapshotsSent;
  b.channels.get('control').bufferedAmount=0;f.advance(300);await f.send('a',307);await f.drain();
  assert.equal(a.client.performance().ownerBuffSync.snapshotsSent,sent+1);
  const compact=a.client.performance().ownerBuffSync.compactSent;await f.send('a',337);await f.drain();
  assert.ok(a.client.performance().ownerBuffSync.compactSent>compact);assert.deepEqual(f.errors,[]);
});

test('two new online clients negotiate raw binary and mask v2 only uses a validated pose ACK baseline',async t=>{
  const f=await pair(t),{a,b}=f.endpoints;
  assert.equal(a.client.performance().peerControls.b.networkBinaryVersion,NETWORK_BINARY_VERSION);assert.equal(b.client.performance().peerControls.a.networkBinaryVersion,NETWORK_BINARY_VERSION);
  await f.send('a',1);await f.drain();await f.send('b',1);await f.drain();
  await f.send('a',4);await f.drain();const full=(await f.inputs('a')).at(-1);
  assert.ok(isNetworkBinary(full.data));assert.equal(full.value.ownerDelta.v,2);assert.equal(full.value.ownerDelta.full,true);
  assert.deepEqual(f.acks('b').map(row=>row.frameSeq),[1,4]);
  assert.equal(a.client.performance().peerControls.b.acknowledgedPoseFrame,4);
  await f.send('a',7);await f.drain();const delta=(await f.inputs('a')).at(-1);
  assert.ok(isNetworkBinary(delta.data));assert.equal(delta.value.ownerDelta.v,2);assert.equal(delta.value.ownerDelta.full,false);assert.equal(delta.value.ownerDelta.base,4);
  assert.equal(b.client.performance().peerTransports.a.poseReceive.deltaReceived,1);assert.equal(a.client.performance().peerControls.b.acknowledgedPoseFrame,7);
  const received=b.events.filter(row=>row.type==='peer-owned-state'&&row.data.transport==='rtc').at(-1);assert.equal(received.data.report.frameSeq,7);assert.equal(received.data.report.actor.x,7);
  assert.deepEqual(f.errors,[]);
});

test('a binary pose outrunning its reliable action stays uncommitted and unacknowledged until control admission',async t=>{
  const f=await pair(t),{a,b}=f.endpoints;await f.send('a',1);await f.drain();await f.send('b',1);await f.drain();
  await f.send('a',4);await f.drain();const before=b.events.length;
  await f.send('a',7,true);await f.drain(row=>row.label==='input');
  const held=(await f.inputs('a')).at(-1);assert.equal(held.value.controlSequence,1);assert.equal(held.value.ownerDelta.v,2);
  assert.equal(b.events.slice(before).filter(row=>row.type==='peer-owned-state').length,0);
  assert.equal(f.acks('b').at(-1).frameSeq,4);assert.equal(b.client.performance().peerControls.a.fencedPoses,1);
  await f.drain(row=>row.label==='control');
  const sequence=b.events.slice(before).filter(row=>['owner-actions','peer-owned-state'].includes(row.type));
  assert.equal(sequence[0].type,'owner-actions');assert.equal(sequence[0].data.actions[0].frameSeq,7);
  assert.ok(sequence.some(row=>row.type==='peer-owned-state'&&row.data.transport==='rtc'&&row.data.report.frameSeq===7));
  assert.equal(f.acks('b').at(-1).frameSeq,7);assert.equal(a.client.performance().peerControls.b.pendingPackets,0);
  assert.equal(a.client.performance().peerActionLedgers.b.pending,0);assert.deepEqual(f.errors,[]);
});

test('asymmetric action congestion keeps both current motion directions flowing without a false full-pose receipt',async t=>{
  const f=await pair(t),{a,b}=f.endpoints;
  await f.send('a',1);await f.drain();await f.send('b',1);await f.drain();await f.send('a',4);await f.drain();
  const before=b.events.length;await f.send('a',7,true);
  await f.drain(row=>row.label==='input');await f.send('a',40);await f.drain(row=>row.label==='input');
  const fresh=b.events.slice(before).filter(row=>row.type==='owner-motion').at(-1);
  assert.equal(fresh.data.motion.frameSeq,40);assert.equal(fresh.data.motion.actor.x,40);
  assert.equal(b.events.slice(before).filter(row=>row.type==='peer-owned-state').length,0);
  assert.equal(f.acks('b').at(-1).frameSeq,4,'movement cannot suppress the durable full-pose fallback');
  await f.send('b',44);await f.drain(row=>row.from==='b'||row.label==='input');
  assert.equal(a.events.filter(row=>row.type==='owner-motion').at(-1).data.motion.frameSeq,44);
  assert.deepEqual(f.errors,[]);await f.drain();
});

test('archived JSON client negotiates JSON and pose v1 fallback with the new coordinator',{skip:!legacyJsonRef&&'Set WEB_PVP_LEGACY_JSON_REF to compare the archived client'},async t=>{
  const f=await pair(t,{legacyRight:true}),{a,b}=f.endpoints;
  assert.equal(a.client.performance().peerControls.b.networkBinaryVersion,0);
  await f.send('a',1);await f.drain();await f.send('b',1);await f.drain();
  await f.send('a',4);await f.drain();await f.send('a',7);await f.drain();
  const outgoing=await f.inputs('a');assert.ok(outgoing.every(row=>typeof row.data==='string'));
  assert.equal(outgoing.at(-1).value.ownerDelta.v,1);assert.equal(outgoing.at(-1).value.ownerDelta.full,false);
  assert.equal(b.client.performance().peerTransports.a.poseDeltaRejected,0);assert.equal(a.client.performance().peerControls.b.acknowledgedPoseFrame,7);
  await f.send('a',10,true);await f.drain();assert.equal(b.events.filter(row=>row.type==='owner-actions').at(-1).data.actions[0].frameSeq,10);
  assert.equal(a.client.performance().peerControls.b.pendingPackets,0);assert.deepEqual(f.errors,[]);
});

test('actual v36 EWNB v1 client falls back safely when its peer offers EWNB v2',{skip:!legacyV36Ref&&'Set WEB_PVP_V36_REF to compare the archived client'},async t=>{
  const f=await pair(t,{legacyRight:true,legacyRef:legacyV36Ref}),{a,b}=f.endpoints;
  assert.equal(a.client.performance().peerControls.b.networkBinaryVersion,0);
  assert.equal(b.client.performance().peerControls.a.networkBinaryVersion,0);
  await f.send('a',1);await f.drain();await f.send('b',1);await f.drain();
  for(const id of ids){await f.send(id,4);await f.drain();await f.send(id,7,true);await f.drain();}
  for(const id of ids){const outgoing=await f.inputs(id);assert.ok(outgoing.every(row=>typeof row.data==='string'));
    const other=id==='a'?'b':'a';assert.equal(f.endpoints[other].events.filter(row=>row.type==='owner-actions').at(-1).data.actions[0].frameSeq,7);
    assert.equal(f.endpoints[id].client.performance().peerControls[other].pendingPackets,0);}
  assert.deepEqual(f.errors,[]);
});

test('rejected current binary pose cannot become an ACK baseline',async t=>{
  const f=await pair(t,{rejectRightPose:true}),{a,b}=f.endpoints;
  await f.send('a',1);await f.drain();await f.send('b',1);await f.drain();await f.send('a',4);await f.drain();await f.send('a',7);await f.drain();
  assert.deepEqual(f.acks('b'),[]);assert.equal(a.client.performance().peerControls.b.acknowledgedPoseFrame,-1);
  assert.equal(b.client.performance().peerTransports.a.poseReceive.receivedSnapshots,0);
  assert.equal((await f.inputs('a')).at(-1).value.ownerDelta.full,true);assert.deepEqual(f.errors,[]);
});

test('pose ACKs reject impossible clocks and a new life establishes a fresh full baseline with monotonic wire frames',async t=>{
  const f=await pair(t),{a,b}=f.endpoints;await f.send('a',1);await f.drain();await f.send('b',1);await f.drain();await f.send('a',4);await f.drain();
  const control=a.channels.get('control');
  for(const [epoch,frameSeq]of [[1,999],[2,4],[0,4]])control.onmessage({data:JSON.stringify({v:1,matchId:f.match.id,type:'pose-ack',epoch,frameSeq})});
  assert.equal(a.client.performance().peerControls.b.acknowledgedPoseFrame,4);
  a.state(2);b.state(2);await f.send('a',1);
  control.onmessage({data:JSON.stringify({v:1,matchId:f.match.id,type:'pose-ack',epoch:1,frameSeq:4})});
  assert.equal(a.client.performance().peerControls.b.acknowledgedPoseFrame,-1);
  await f.drain();const full=(await f.inputs('a')).at(-1);
  assert.equal(full.value.ownerDelta.epoch,2);assert.equal(full.value.ownerDelta.full,true);assert.equal(full.value.ownerDelta.frameSeq,5);
  assert.equal(a.client.performance().peerControls.b.acknowledgedPoseEpoch,2);assert.equal(a.client.performance().peerControls.b.acknowledgedPoseFrame,5);
  await f.send('a',4);await f.drain();const delta=(await f.inputs('a')).at(-1);
  assert.equal(delta.value.ownerDelta.epoch,2);assert.equal(delta.value.ownerDelta.frameSeq,8);assert.equal(delta.value.ownerDelta.base,5);
  assert.equal(delta.value.ownerDelta.full,false);assert.deepEqual(f.errors,[]);
});

for(const compressed of [false,true])test(`negotiated ${compressed?'gzip EWNB':'raw EWNB'} motion survives control ACK timeout without reviving control or receipts`,async t=>{
  const f=await pair(t),{a,b}=f.endpoints;
  await f.send('a',1);await f.drain();await f.send('b',1);await f.drain();
  await f.send('b',4,true);await f.drain(row=>row.from==='b');
  await f.send('a',7);
  const delayed=(await f.inputs('a')).findLast(row=>row.value.motionOnly&&row.value.motion.frameSeq===7);
  assert.ok(delayed&&isNetworkBinary(delayed.data),'capture actual negotiated production motion');
  f.advance(1501);b.client.send(input,b.report(9));await settle();
  assert.equal(b.client.performance().peerControls.a.failed,true);
  assert.equal(b.client.performance().peerControls.a.wire.lastFault,'control-ack-timeout');
  const ackCount=f.acks('b').length,priorReceipts=b.client.performance().peerReceipts,
    before=b.events.filter(row=>row.type==='owner-motion').length;
  await f.deliver({...delayed,data:compressed?gzipSync(delayed.data):delayed.data});
  for(let turn=0;turn<100&&b.events.filter(row=>row.type==='owner-motion').length===before;turn++)await new Promise(resolve=>setTimeout(resolve,1));
  const motion=b.events.filter(row=>row.type==='owner-motion').at(-1);
  assert.equal(motion?.data.motion.frameSeq,7,'independent movement still reaches its real consumer');
  assert.equal(motion?.data.motion.actor.x,7);
  assert.equal(b.client.performance().peerControls.a.failed,true);
  assert.equal(b.client.performance().peerControls.a.networkBinaryVersion,0);
  assert.equal(b.client.performance().peerTransports.a.decodeFailures,0);
  assert.equal(f.acks('b').length,ackCount);assert.deepEqual(b.client.performance().peerReceipts,priorReceipts);
  const retired=b.channels.get('input').onmessage,count=b.events.length;b.client.clearMatch();
  retired({data:delayed.data});await settle();assert.equal(b.events.length,count,'retired connection cannot use remembered capability');
});

test('new life and retired match handlers reject queued old-life binary packets without receipts',async t=>{
  const f=await pair(t),{a,b}=f.endpoints;await f.send('a',1);await f.drain();await f.send('b',1);await f.drain();await f.send('a',4);await f.drain();
  await f.send('a',7);const delayed=f.wire.find(row=>row.from==='a'&&row.label==='input'),ackCount=f.acks('b').length;
  assert.ok(delayed);b.state(2);await f.deliver(delayed);assert.equal(f.acks('b').length,ackCount);
  assert.equal(b.client.performance().peerReceipts.length,0);
  const stale=b.channels.get('input').onmessage;b.client.clearMatch();stale({data:delayed.data});await settle();
  assert.equal(f.acks('b').length,ackCount);assert.deepEqual(b.client.connectivity(),[]);assert.deepEqual(f.errors,[]);
});

for(const [version,options]of [
  ['v2',{}],['v1',{legacyRight:true,legacyRef:legacyV37Ref}],
])test(`final v39 policy keeps motion and full poses at 20 Hz with ${version} peers and admits boundaries immediately`,{skip:options.legacyRight&&!legacyV37Ref&&'Set WEB_PVP_V37_REF to compare the archived client'},async t=>{
  const f=await pair(t,options),{a,b}=f.endpoints;
  await f.send('a',1);await f.drain();await f.send('b',1);await f.drain();
  const before=(await f.inputs('a')).length;
  f.advance(50);await f.send('a',4);await f.drain();
  const first=(await f.inputs('a')).slice(before);
  assert.equal(first.filter(row=>row.value.motionOnly===true).length,1);
  assert.equal(first.filter(row=>row.value.owner||row.value.ownerDelta).length,1);
  f.advance(50);await f.send('a',7);await f.drain();
  const second=(await f.inputs('a')).slice(before);
  assert.equal(second.filter(row=>row.value.motionOnly===true).length,2);
  assert.equal(second.filter(row=>row.value.owner||row.value.ownerDelta).length,2);
  assert.deepEqual(second.filter(row=>row.value.owner||row.value.ownerDelta).map(row=>(row.value.owner??row.value.ownerDelta).frameSeq),[4,7]);
  f.advance(10);const protectedReport=a.report(8);protectedReport.actor.forceInvincible=1;
  a.client.send(input,protectedReport);await settle();await f.drain();
  assert.equal((await f.inputs('a')).at(-1).value.ownerDelta.frameSeq,8,'protection sends after only 10 ms');
  const protectedPose=b.events.findLast(row=>row.type==='peer-owned-state'&&row.data.report.frameSeq===8);
  assert.equal(protectedPose?.data.report.actor.forceInvincible,1,'the receiver admits the actual protection boundary');
  f.advance(10);await f.send('a',9,true);await f.drain();
  assert.equal((await f.inputs('a')).at(-1).value.ownerDelta.frameSeq,9,'canonical controller remains immediate');
  const admitted=b.events.findLast(row=>row.type==='owner-actions');
  assert.equal(admitted?.data.actions[0].id,9);assert.equal(admitted?.data.transport,'peer-control');
  assert.equal(a.client.performance().peerControls.b.pendingPackets,0,'the reliable controller was acknowledged');
  assert.equal(a.client.performance().peerControls.b.acknowledgedPoseFrame,9);assert.deepEqual(f.errors,[]);
});

test('final v39 policy retries a failed full pose on the next sample without promoting the failed ACK baseline',async t=>{
  const f=await pair(t),{a}=f.endpoints;
  await f.send('a',1);await f.drain();await f.send('b',1);await f.drain();
  f.advance(100);const channel=a.channels.get('input'),original=channel.send.bind(channel);let sends=0;
  channel.send=data=>{if(++sends===2)throw new TypeError('controlled full pose send failure');return original(data);};
  const before=(await f.inputs('a')).length;await f.send('a',7);await f.drain();
  assert.equal((await f.inputs('a')).slice(before).filter(row=>row.value.owner||row.value.ownerDelta).length,0);
  assert.equal(a.client.performance().peerControls.b.acknowledgedPoseFrame,1);
  channel.send=original;f.advance(10);await f.send('a',8);await f.drain();
  const retry=(await f.inputs('a')).at(-1).value.ownerDelta;
  assert.equal(retry.frameSeq,8,'the next source sample retries after only 10 ms');
  assert.equal(retry.full,true,'send failure resets the encoder and retries a self-contained full pose');
  assert.equal(Object.hasOwn(retry,'base'),false,'a failed frame cannot become a delta baseline');
  assert.equal(retry.report.frameSeq,8);
  assert.equal(a.client.performance().peerControls.b.acknowledgedPoseFrame,8);
  assert.deepEqual(f.errors,[]);
});

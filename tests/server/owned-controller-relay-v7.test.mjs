/** Current Web transport timing/order evidence, not native combat goldens. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRoomWorkerFactory} from '../../apps/server/room-worker-factory.mjs';
import {createBattleDriverFactory} from './fixtures/owned-controller-relay-driver-v7.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {ownedRelayControllerSignature,observeOwnedRelayController} from '../../apps/server/owned-relay-controller.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const {createDevServer}=await import(process.env.RF_CONTROLLER_RELAY_SERVER?
  pathToFileURL(path.resolve(process.env.RF_CONTROLLER_RELAY_SERVER)).href:new URL('../../apps/server/dev-server.mjs',import.meta.url));
const profile=JSON.parse(await readFile(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const state={epoch:1,actor:{state:'WAIT',stateSerial:1,facing:1,grounded:true,lineId:0,animationTransitionSerial:1}};
test('relay urgency observes only validated controller boundaries, not movement, resources or continuously ticking clocks',()=>{
  const signatures=new Map(),observe=report=>observeOwnedRelayController(signatures,'source',ownedRelayControllerSignature(report));
  assert.equal(observe(state),false);
  assert.equal(observe({...state,actor:{...state.actor,x:200,hp:70,mp:9,animationTime:5,stateTime:5}}),false);
  for(const [field,value]of Object.entries({state:'RUN',stateSerial:2,facing:-1,grounded:false,lineId:1,animationTransitionSerial:2})){
    assert.equal(observe({...state,actor:{...state.actor,[field]:value}}),true,field);
    assert.equal(observe({...state,actor:{...state.actor,[field]:value}}),false,'duplicate '+field);
    signatures.clear();assert.equal(observe(state),false);
  }
});

async function fixture(t,worker){
  const accountRoot=await mkdtemp(path.join(tmpdir(),'rf-controller-relay-v7-'));
  const credentials=['controller-a','controller-b'].map(username=>({username,password:'synthetic-'+username,role:'player'}));
  const directFactory=await createBattleDriverFactory();
  const metadata=Object.assign(directFactory,{ownership:'local-owner-v1',professions:{RF:true},versions:{fixture:true}});
  const factory=worker?await createRoomWorkerFactory({root,assetRoot:root,metadataFactory:metadata,
    workerEntry:fileURLToPath(new URL('./fixtures/owned-controller-relay-entry-v7.mjs',import.meta.url))}):metadata;
  let now=10000,relayNow=0;const scheduled=new Set();
  const relayTimers={setTimeout(callback,delay){const timer={callback,due:relayNow+delay,unref(){}};scheduled.add(timer);return timer;},
    clearTimeout(timer){scheduled.delete(timer);}};
  const ctx=await createDevServer({root,accountRoot,credentials:credentials[0],additionalCredentials:[credentials[1]],driverFactory:factory,
    now:()=>now,onlineEventTransport:'poll',pollWaitMs:0,ownedRelayClock:()=>relayNow,ownedRelayTimers:relayTimers});
  await new Promise(resolve=>ctx.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+ctx.server.address().port,peers=[];
  t.after(async()=>{ctx.closeStreams();ctx.online.close();factory.close?.();ctx.server.closeAllConnections();
    await new Promise(resolve=>ctx.server.close(resolve));
    assert.ok(path.resolve(accountRoot).startsWith(path.resolve(tmpdir())+path.sep));await rm(accountRoot,{recursive:true,force:true});});
  for(const credential of credentials){
    let cookie;const peer={sequence:0,cursor:0};
    peer.request=async(url,{method='GET',body,headers={}}={})=>{
      const response=await fetch(base+url,{method,headers:{Origin:base,'Content-Type':'application/json',...headers,...(cookie?{Cookie:cookie}:{})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;
    };
    peer.poll=async()=>{const response=await peer.request(`/api/online/poll?connectionId=${peer.lease.connectionId}&after=${peer.cursor}`);
      assert.equal(response.status,200);const batch=await response.json();peer.cursor=batch.cursor;return batch.events;};
    peer.open=async()=>{const response=await peer.request('/api/online/poll/open',{method:'POST',body:{},headers:{'X-RF-Owned-Delta':'3'}});
      assert.equal(response.status,200);peer.lease=await response.json();peer.cursor=peer.lease.cursor;};
    assert.equal((await peer.request('/api/login',{method:'POST',body:credential})).status,200);
    await peer.open();await peer.poll();peers.push(peer);
  }
  for(const peer of peers)assert.equal((await peer.request('/api/online/queue',{method:'POST',body:{mode:'1v1'}})).status,200);
  now+=6000;await ctx.online.tick();const match=ctx.online.status(credentials[0].username).match;assert.ok(match);
  for(const peer of peers)assert.equal((await peer.request('/api/online/ready',{method:'POST',body:{matchId:match.id}})).status,200);
  const bootstrap=ctx.online.matchSnapshot(credentials[0].username);assert.equal(bootstrap.pvp.phase,'fight');
  const simulation={profile,state:structuredClone(bootstrap.snapshot)};
  for(const peer of peers)await peer.poll();
  return {ctx,peers,match,scheduled,simulation,setTime(value){relayNow=value;},
    advance(value){relayNow=value;for(const timer of [...scheduled])if(timer.due<=value&&scheduled.delete(timer))timer.callback();},
    async send(frameSeq,patch={},action=false){
      const report=encodeOwnedState(simulation,credentials[0].username,{epoch:1,frameSeq});Object.assign(report.actor,patch);
      if(action)report.actions=[encodeCriticalAction(report,{id:frameSeq})];
      const response=await peers[0].request('/api/online/input',{method:'POST',body:{matchId:match.id,sequence:peers[0].sequence++,
        frames:[{frameSeq,held:[],pressed:[],released:[]}],owner:report}});
      assert.equal(response.status,200);assert.equal((await response.json()).accepted,true);return report;
    }};
}
function decode(events,codec){return events.filter(row=>row.type==='owned-state').map(row=>codec.decode(row.data)).filter(Boolean);}

for(const worker of [false,true])test(`${worker?'child-prepared':'in-process-split'} relay publishes a validated controller boundary without another50ms wait, after its canonical action`,async t=>{
  const f=await fixture(t,worker),receiver=f.peers[1],codec=createOwnedRelayDelta();
  const initial=await f.send(3);assert.equal(decode(await receiver.poll(),codec).at(-1).frameSeq,3);
  f.setTime(10);await f.send(4,{x:10});assert.equal(decode(await receiver.poll(),codec).length,0,'ordinary position update stays paced');
  assert.equal(f.scheduled.size,1);
  f.setTime(17);await f.send(5,{x:17,facing:-initial.actor.facing},true);
  const events=await receiver.poll(),owners=decode(events,codec),pose=owners.find(row=>row.frameSeq===5);
  const actionIndex=events.findIndex(row=>row.type==='input'),poseIndex=events.findIndex(row=>row.type==='owned-state'&&!row.data.baselineOnly&&row.data.frameSeq===5);
  t.diagnostic(JSON.stringify({path:worker?'child-prepared':'in-process-split',sourceAtMs:17,observedAtMs:17,
    receivedBoundary:!!pose,pendingPacerTimers:f.scheduled.size,actionIndex,poseIndex,
    urgentClockPayloadBytes:poseIndex<0?0:Buffer.byteLength(JSON.stringify(events[poseIndex].data))}));
  assert.ok(pose,'source controller report must arrive before the old50ms movement deadline');
  assert.equal(pose.actor.facing,-initial.actor.facing);assert.equal(f.scheduled.size,0);
  assert.ok(actionIndex>=0&&actionIndex<poseIndex,'canonical action must precede its pose in the actual receiver mailbox');
  assert.equal(codec.decodeActions(events[actionIndex].data).actions[0].id,5);
  f.setTime(30);await f.send(6,{x:30,facing:pose.actor.facing});assert.equal(decode(await receiver.poll(),codec).length,0);
  assert.equal([...f.scheduled][0].due,67,'normal source movement still uses the original50ms interval');
  f.advance(67);assert.equal(decode(await receiver.poll(),codec).at(-1).frameSeq,6);
  assert.equal(events.some(row=>row.data.controllerSignature!==undefined),false,'controller signature never expands the client wire protocol');
  let steadyReports=0;
  for(let i=1;i<=20;i++){
    f.setTime(67+i*50);await f.send(6+i*3,{x:30+i*3,facing:pose.actor.facing});
    const steady=decode(await receiver.poll(),codec);assert.equal(steady.length,1);assert.equal(steady[0].frameSeq,6+i*3);
    steadyReports++;assert.equal(f.scheduled.size,0);
  }
  t.diagnostic(JSON.stringify({path:worker?'child-prepared':'in-process-split',steadySeconds:1,steadyReports,steadyHz:20}));
});

for(const worker of [false,true])test(`${worker?'child-prepared':'in-process-split'} relay retains queued controller boundaries across later paced movement`,async t=>{
  const f=await fixture(t,worker),receiver=f.peers[1],codec=createOwnedRelayDelta();
  const initial=await f.send(3);decode(await receiver.poll(),codec);
  f.setTime(17);await f.send(5,{x:17,facing:-initial.actor.facing},true);
  // Keep the authenticated receiver mailbox unread while several later
  // ordinary reports replace one another. A controller edge is a reliable
  // observation even when its canonical attack took an independent path.
  f.setTime(67);await f.send(8,{x:67,facing:-initial.actor.facing});
  f.setTime(117);await f.send(11,{x:117,facing:-initial.actor.facing});
  const events=await receiver.poll(),owners=decode(events,codec);
  const frames=owners.map(row=>row.frameSeq);
  assert.deepEqual(frames,[5,11], 'ordinary movement can coalesce, but cannot erase the queued controller boundary');
  const actionIndex=events.findIndex(row=>row.type==='input'&&row.data.actions?.length),
    boundaryIndex=events.findIndex(row=>row.type==='owned-state'&&row.data.frameSeq===5);
  assert.ok(actionIndex>=0&&actionIndex<boundaryIndex,'canonical action stays before its dependent controller pose');
  assert.equal(codec.decodeActions(events[actionIndex].data).actions[0].id,5);
  assert.equal(owners[0].actor.facing,-initial.actor.facing);
  assert.equal(f.scheduled.size,0);
  t.diagnostic(JSON.stringify({path:worker?'child-prepared':'in-process-split',queuedFrames:frames,actionIndex,boundaryIndex}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerUploadCheckpointKey as key,ownerUploadDeferral as defer,hasUnsentOwnerEvents,deferPeerOwnerPose} from '../../packages/online/owner-upload-schedule.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';

const input={held:[],pressed:[],released:[]};
const report=(frameSeq,extra={})=>({protocol:'local-owner-v1',epoch:1,frameSeq,actor:{hp:100,mp:0,state:'RSI_WAIT',stateSerial:1},effects:[],actions:[],hits:[],...extra});
const settle=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};

// These pure scheduling functions remain as an inactive v40 experiment.
// Production reverted to the v39 client; these tests do not assert live policy.
test('inactive experiment: two normal credits stay available for a new action or victim hit',()=>{
  const base=report(18),inFlight=Array.from({length:6},(_,i)=>report(i*3));
  const options={report:base,key:key(base),lastKey:key(base),now:350,lastAt:300,inFlight,reliable:true};
  assert.equal(defer(options),'reserved-credit');
  assert.equal(defer({...options,report:report(21,{actions:[{id:7}]})}),null);
  const prior=report(18,{actions:[{id:7}]});
  assert.equal(defer({...options,inFlight:[...inFlight,prior],report:report(22,{actions:[{id:7}],hits:[{id:9}]})}),null);
  assert.equal(defer({...options,maximumCredits:1,inFlight:[]}),null,'one-credit compatibility has a usable periodic slot');
  assert.equal(defer({...options,reliable:false}),null,'HTTP is already one request in flight and has no reserved-credit gate');
});

test('inactive experiment: canonical coverage is identity- and life-bound',()=>{
  const prior=report(3,{actions:[{id:11}],hits:[{id:21}]}),same=report(6,{actions:[{id:11}],hits:[{id:21}]});
  assert.equal(hasUnsentOwnerEvents(same,[prior]),false);
  assert.equal(hasUnsentOwnerEvents({...same,hits:[{id:22}]},[prior]),true);
  assert.equal(hasUnsentOwnerEvents({...same,epoch:2},[prior]),true);
  assert.equal(hasUnsentOwnerEvents(same,[]),true,'rejected/disconnected in-flight rows cannot cover a retry');
});

test('inactive experiment: covered reliable events retain checkpoint cadence and a new event is immediate',()=>{
  const base=report(3,{actions:[{id:11}],hits:[{id:21}]}),options={report:base,key:key(base),lastKey:key(base),now:50,lastAt:0,inFlight:[base],healthyDirect:true};
  assert.equal(defer(options),'direct-checkpoint');
  assert.equal(defer({...options,now:100}),null);
  assert.equal(defer({...options,healthyDirect:false}),null);
  assert.equal(defer({...options,report:{...base,hits:[{id:21},{id:22}]}}),null);
  assert.equal(defer({...options,inFlight:[]}),null,'unaccepted canonical events still retry after a negative receipt');
});

for(const [name,change]of [
  ['life',r=>r.epoch++],['HP',r=>r.actor.hp--],['MP',r=>r.actor.mp++],['state',r=>r.actor.state='RSI_DAMAGE_AIR_UP'],
  ['Add DP',r=>r.actor.sourceAdd={dp:10}],['awakening',r=>r.actor.awakening={gauge:.5,remaining:1}],
  ['state instance',r=>r.actor.stateSerial++],['facing',r=>r.actor.facing=-1],['landing',r=>r.actor.grounded=true],
  ['protection',r=>r.actor.forceInvincible=1],['status revision',r=>r.actor.sourceStatusClock={revision:2}],
  ['terminal effect',r=>r.effects.push({id:1,name:'effect',active:false,dead:true})],
  ['complete frontier',r=>r.actionFrontierComplete=false],
])test(`inactive experiment: ${name} boundary bypasses credit reservation and direct pacing`,()=>{
  const old=report(3),next=structuredClone(old);change(next);
  assert.equal(defer({report:next,key:key(next),lastKey:key(old),now:1,lastAt:0,inFlight:Array(6).fill(old),healthyDirect:true,reliable:true}),null);
});

test('inactive experiment: v2 motion and ACK freshness permit a 100 ms full-pose interval',()=>{
  const r=report(6),k=key(r),options={report:r,key:k,last:{epoch:1,frameSeq:3,key:k,at:0},now:50,motion:{locomotion:{}},buffSyncSupported:true,packet:input,
    control:{negotiated:true,failed:false,degraded:false,poseAckAgeMs:50,acknowledgedPoseEpoch:1,acknowledgedPoseFrame:3}};
  assert.equal(deferPeerOwnerPose(options),true);
  for(const altered of [
    {now:100},{report:{...r,frameSeq:9}},{motion:{}},{buffSyncSupported:false},{packet:{...input,pressed:['Z']}},
    {control:{...options.control,failed:true}},{control:{...options.control,degraded:true}},
    {control:{...options.control,poseAckAgeMs:250}},{control:{...options.control,acknowledgedPoseEpoch:2}},
    {key:'changed'},{last:null},
  ])assert.equal(deferPeerOwnerPose({...options,...altered}),false,JSON.stringify(altered));
});

// The real client fixture below verifies the retained v39 production policy.
async function clientFixture(t,{credits=8,holdInputResponses=false}={}){
  let now=0;const sockets=[],requests=[],errors=[],intervals=[];
  t.mock.method(globalThis,'setInterval',fn=>{intervals.push(fn);return intervals.length;});t.mock.method(globalThis,'clearInterval',()=>{});
  class Source{addEventListener(type,callback){if(type==='open')queueMicrotask(()=>callback({type:'open'}));}close(){}}
  class Socket{
    constructor(){this.sent=[];this.bufferedAmount=0;sockets.push(this);queueMicrotask(()=>this.receive({type:'transport',data:{connected:true}}));}
    send(value){this.sent.push(JSON.parse(new TextDecoder().decode(value)));}
    receive(value){this.onmessage?.({data:JSON.stringify(value)});}close(){}
  }
  const match={id:'transport-v40',ownership:'local-owner-v1',ownerStatusVersion:1,players:[{id:'a'},{id:'b'}]};
  const client=createOnlineClient({EventSource:Source,WebSocket:Socket,RTCPeerConnection:null,maximumOwnerCredits:credits,clock:()=>now,
    timers:{setTimeout(){return 1;},clearTimeout(){}},socketOptions:{compress:async text=>new TextEncoder().encode(text)},
    fetch:async(url,options)=>{
      const row={url,body:options?.body?JSON.parse(options.body):null};requests.push(row);
      if(url==='/api/online/input'&&holdInputResponses)return new Promise(resolve=>{row.respond=value=>resolve({ok:true,json:async()=>value});});
      return {ok:true,json:async()=>({accepted:true})};
    },onError:error=>errors.push(error)});
  t.after(()=>client.close());await client.open();await client.setMatch(match,'a');await settle();
  return {client,sockets,requests,errors,
    async send(frame,extra={}){now+=50;client.send(input,report(frame,extra));await settle();},
    async ack(batch,extra={}){sockets.at(-1).receive({type:'ack',data:{accepted:true,matchId:match.id,sequence:batch.sequence,...extra}});await settle();},
    async flush(){await intervals[0]();await settle();},
  };
}

test('production v39 uses all eight credits, retains queued action and hit, and consumes only reported identities on ACK',async t=>{
  const f=await clientFixture(t),socket=f.sockets[0];
  for(let i=1;i<=8;i++)await f.send(i*3);
  assert.equal(socket.sent.length,8);assert.equal(f.client.performance().pendingFrames,0);
  await f.send(27,{actions:[{id:71}]});assert.equal(socket.sent.length,8);
  await f.send(30,{hits:[{id:81,attackerId:'b',damage:10}]});assert.equal(socket.sent.length,8);
  await f.send(33);assert.equal(socket.sent.length,8);
  assert.equal(f.client.performance().pendingFrames,1);
  assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().pendingHits,1);
  await f.ack({sequence:999999},{consumedActionIds:[71],consumedHitIds:[81]});
  assert.equal(socket.sent.length,8,'an unknown ACK does not release a credit');
  await f.ack(socket.sent[7],{consumedActionIds:[71],consumedHitIds:[81]});
  assert.equal(socket.sent.length,9,'any matched ACK releases one credit, including an out-of-order ACK');
  const critical=socket.sent[8];assert.equal(critical.owner.frameSeq,33,'the newest pose replaces only the queued pose');
  assert.deepEqual(critical.owner.actions.map(a=>a.id),[71]);assert.deepEqual(critical.owner.hits.map(h=>h.id),[81]);
  assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().pendingHits,1);
  await f.ack(critical,{consumedActionIds:[71],consumedHitIds:[]});
  assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().pendingHits,1);
  await f.send(36);const hitRetry=socket.sent.at(-1);
  assert.deepEqual(hitRetry.owner.actions,[]);assert.deepEqual(hitRetry.owner.hits.map(h=>h.id),[81]);
  await f.ack(hitRetry,{consumedActionIds:[],consumedHitIds:[81]});
  assert.equal(f.client.performance().pendingHits,0);assert.deepEqual(f.errors,[]);
});

test('production v39 retains a new life and protection at a full window while old-life ACKs cannot consume its action',async t=>{
  const f=await clientFixture(t),socket=f.sockets[0];
  for(let i=1;i<=8;i++)await f.send(i*3);
  await f.send(1,{epoch:2,actions:[{id:1}]});assert.equal(socket.sent.length,8);
  await f.ack(socket.sent[0],{consumedActionIds:[1]});
  assert.equal(socket.sent.length,9);assert.equal(socket.sent[8].owner.epoch,2);assert.equal(f.client.performance().pendingActions,1);
  await f.send(4,{epoch:2,actor:{...report(4).actor,forceInvincible:1}});assert.equal(socket.sent.length,9);
  await f.ack(socket.sent[1],{consumedActionIds:[1]});assert.equal(socket.sent.length,10);
  assert.equal(socket.sent[9].owner.actor.forceInvincible,1);assert.deepEqual(socket.sent[9].owner.actions.map(a=>a.id),[1]);
  assert.equal(f.client.performance().pendingActions,1);
  await f.ack(socket.sent[8],{consumedActionIds:[1]});assert.equal(f.client.performance().pendingActions,0);assert.deepEqual(f.errors,[]);
});

test('production v39 retains unsent critical receipts across a full WebSocket window until HTTP fallback accepts them',async t=>{
  const f=await clientFixture(t,{holdInputResponses:true}),socket=f.sockets[0];
  for(let i=1;i<=8;i++)await f.send(i*3);
  await f.send(27,{actions:[{id:91}],hits:[{id:92,attackerId:'b',damage:10}]});await f.send(30);
  assert.equal(socket.sent.length,8);
  socket.onclose({code:1006,wasClean:false});await settle();
  const upload=f.requests.find(row=>row.url==='/api/online/input');assert.ok(upload);
  assert.equal(upload.body.owner.frameSeq,30);assert.deepEqual(upload.body.owner.actions.map(a=>a.id),[91]);assert.deepEqual(upload.body.owner.hits.map(h=>h.id),[92]);
  assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().pendingHits,1);
  upload.respond({accepted:true,consumedActionIds:[91],consumedHitIds:[92]});await settle();
  assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().pendingHits,0);assert.deepEqual(f.errors,[]);
});

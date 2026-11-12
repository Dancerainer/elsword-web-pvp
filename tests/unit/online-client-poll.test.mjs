import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {createOnlinePollChannel} from '../../apps/server/online-poll-channel.mjs';
import {ONLINE_POLL_MAXIMUM_BATCH_EVENTS,ONLINE_POLL_MAXIMUM_CRITICAL_EVENTS} from '../../packages/online/poll-contract.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import {make} from '../helpers/rf-passive-fixture-v12.mjs';

const response=(value,status=200)=>({ok:status<400,status,json:async()=>value});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const match={id:'m1',players:[{id:'a',lastSequence:4,lastFrameSeq:90},{id:'b'}]};
const event=(id,type,data)=>({id,type,data});
function fakeTimers(){
  let serial=0;const tasks=new Map();
  return {tasks,setTimeout(callback,ms){const id=++serial;tasks.set(id,{callback,ms});return id;},clearTimeout(id){tasks.delete(id);},
    run(ms){const found=[...tasks].find(([,task])=>task.ms===ms);assert.ok(found,'timer '+ms+'ms exists');tasks.delete(found[0]);found[1].callback();}};
}
class Peer{
  static instances=[];
  constructor(){this.connectionState='connected';this.channel={readyState:'open',bufferedAmount:0,sent:[],send(value){this.sent.push(JSON.parse(value));}};Peer.instances.push(this);}
  createDataChannel(){return this.channel;}
  async createOffer(){return {type:'offer'};}
  async setLocalDescription(value){this.localDescription={toJSON:()=>value};}
  async setRemoteDescription(value){this.remoteDescription=value;}
  async addIceCandidate(){}
  close(){this.connectionState='closed';}
}
async function harness(run,{peer=null,onEvent=()=>{},installMatch=true,holdUpload=false,pageInitToken=null}={}){
  const savedInterval=globalThis.setInterval,savedClear=globalThis.clearInterval;
  const intervals=new Map();let serial=0;
  globalThis.setInterval=callback=>{const id=++serial;intervals.set(id,callback);return id;};globalThis.clearInterval=id=>intervals.delete(id);
  const timers=fakeTimers(),requests=[],opens=[],polls=[],uploads=[],events=[],errors=[];
  let client;
  const request=async(url,options)=>{
    const record={url,options,body:options.body?JSON.parse(options.body):null};requests.push(record);
    if(url==='/api/online/poll/open'||url.startsWith('/api/online/poll?')){
      const gate={...deferred(),...record};(url.endsWith('/open')?opens:polls).push(gate);return gate.promise;
    }
    if(url==='/api/online/input'&&holdUpload){const gate={...deferred(),...record};uploads.push(gate);return gate.promise;}
    return response({ok:true});
  };
  client=createOnlineClient({fetch:request,eventTransport:'poll',EventSource:class{constructor(){throw Error('poll must not instantiate EventSource');}},
    RTCPeerConnection:peer,timers,pageInitToken,onError:error=>errors.push(error),onEvent(type,data){
      events.push({type,data});if(type==='match'&&installMatch)void client.setMatch(data,'a');onEvent(type,data,client);
    }});
  const f={client,timers,requests,opens,polls,uploads,events,errors,intervals,
    async open(id='lease-one',cursor=0){const opening=client.open();opens.at(-1).resolve(response({connectionId:id,cursor}));await opening;await settle();},
    async deliver(value,index=polls.length-1){polls[index].resolve(response(value));await settle();}};
  try{await run(f);}finally{client.close();await settle();globalThis.setInterval=savedInterval;globalThis.clearInterval=savedClear;}
}

test('poll open is single-owner and serial; status/match/state restore shares event dispatch and frame acknowledgement',async()=>{
  await harness(async f=>{
    const first=f.client.open(),second=f.client.open();assert.equal(f.opens.length,1);assert.deepEqual(f.opens[0].body,{});
    f.opens[0].resolve(response({connectionId:'lease & one',cursor:0}));await Promise.all([first,second]);await settle();
    assert.equal(f.polls.length,1);assert.ok(f.polls[0].url.includes('connectionId=lease%20%26%20one&after=0'));
    await f.deliver({events:[event(1,'status',{queued:false}),event(2,'match',match),event(3,'state',{matchId:'m1',sequence:7,snapshot:{actors:[]}})],cursor:3});
    assert.deepEqual(f.events.map(row=>row.type),['status','match','state']);assert.equal(f.polls.length,2);assert.ok(f.polls[1].url.endsWith('&after=3'));
    assert.equal(f.client.send({held:['Z'],pressed:['Z'],released:[]}),91);await [...f.intervals.values()][0]();
    const upload=f.requests.find(row=>row.url==='/api/online/input');assert.equal(upload.body.sequence,5);assert.equal(upload.body.frames[0].frameSeq,91);
    assert.ok(!f.requests.some(row=>row.url==='/api/online/status'),'poll seed status avoids a late parallel status read');
  });
});

test('every poll lease open carries the entry-point page identity while close targets only its lease',async()=>{
  await harness(async f=>{
    await f.open('first');assert.equal(f.opens[0].options.headers['X-RF-Page-Init'],'page-current-123');
    assert.equal(f.opens[0].options.headers['X-RF-Owned-Delta'],'3');
    assert.equal(f.opens[0].options.headers['Content-Type'],'application/json');
    f.client.close();await f.open('next');assert.equal(f.opens[1].options.headers['X-RF-Page-Init'],'page-current-123');
    assert.equal(f.opens[1].options.headers['X-RF-Owned-Delta'],'3');
    const close=f.requests.find(row=>row.url.endsWith('/poll/close'));assert.deepEqual(close.body,{connectionId:'first'});
  },{pageInitToken:'page-current-123'});
});

test('acknowledged handoff token changes only an unopened client and is carried by the next physical poll lease',async()=>{
 await harness(async f=>{
  assert.throws(()=>f.client.setPageInitToken('bad'),/Invalid online page identity/);
  assert.equal(f.client.setPageInitToken('acknowledged-page-token-123'),'acknowledged-page-token-123');
  await f.open('new-page-lease');assert.equal(f.opens[0].options.headers['X-RF-Page-Init'],'acknowledged-page-token-123');
  assert.throws(()=>f.client.setPageInitToken('should-not-replace-live-page'),/active online page identity/);
  f.client.close();f.client.setPageInitToken('next-acknowledged-page-456');await f.open('second-new-page-lease');
  assert.equal(f.opens[1].options.headers['X-RF-Page-Init'],'next-acknowledged-page-456');
 },{pageInitToken:'initial-page-token-123'});
});

test('acknowledged handoff identity also reaches the next SSE URL',async()=>{
 const urls=[];class Source{constructor(url){urls.push(url);}addEventListener(){}close(){}}
 const client=createOnlineClient({EventSource:Source,WebSocket:null,pageInitToken:'initial-page-token-123',fetch:async()=>response({})});
 try{client.setPageInitToken('acknowledged-page-token-456');await client.open();
  assert.equal(new URL(urls[0],'http://test.invalid').searchParams.get('pageInitToken'),'acknowledged-page-token-456');
  assert.throws(()=>client.setPageInitToken('never-change-live-sse-123'),/active online page identity/);
 }finally{client.close();}
});

test('closing a pending open cancels it, resolves cancellation and releases a late orphan connection',async()=>{
  await harness(async f=>{
    const opening=f.client.open();f.client.close();assert.equal(f.opens[0].options.signal.aborted,true);assert.equal(await opening,null);
    f.opens[0].resolve(response({connectionId:'orphan',cursor:0}));await settle();
    assert.equal(f.polls.length,0);assert.deepEqual(f.requests.find(row=>row.url.endsWith('/poll/close')).body,{connectionId:'orphan'});
    assert.equal(f.events.length,0);assert.equal(f.errors.length,0);assert.equal(f.intervals.size,0);
  });
});

test('late poll success or failure after close cannot dispatch, retry, report errors or upload old input',async()=>{
  for(const success of [true,false])await harness(async f=>{
    await f.open();await f.client.setMatch(match,'a');f.client.send({held:['Z'],pressed:['Z'],released:[]});
    const pending=f.polls[0];f.client.close();assert.equal(pending.options.signal.aborted,true);
    if(success)pending.resolve(response({events:[event(1,'status',{stale:true})],cursor:1}));else pending.reject(Error('old-request-failed'));
    await settle();assert.equal(f.events.length,0);assert.equal(f.errors.length,0);assert.equal(f.polls.length,1);assert.equal(f.intervals.size,0);
    assert.equal(f.client.send({held:[],pressed:[],released:[]}),undefined);assert.equal(f.requests.filter(row=>row.url==='/api/online/input').length,0);
  });
});

test('close/reopen isolates old poll callbacks and closes only the retired connection ID',async()=>{
  await harness(async f=>{
    await f.open('old');const old=f.polls[0];f.client.close();await f.open('new');const fresh=f.polls[1];
    old.resolve(response({events:[event(1,'status',{old:true})],cursor:1}));await settle();
    assert.equal(f.events.length,0);assert.equal(f.polls.length,2);assert.equal(fresh.options.signal.aborted,false);
    await f.deliver({events:[event(1,'status',{fresh:true})],cursor:1},1);assert.equal(f.events.length,1);assert.equal(f.events[0].data.fresh,true);
    assert.deepEqual(f.requests.filter(row=>row.url.endsWith('/poll/close')).map(row=>row.body.connectionId),['old']);
  });
});

test('an orphan open response after a newer open cannot close or replace the current connection',async()=>{
  await harness(async f=>{
    const old=f.client.open();f.client.close();assert.equal(await old,null);await f.open('new');
    f.opens[0].resolve(response({connectionId:'old-orphan',cursor:0}));await settle();
    assert.equal(f.polls.length,1);assert.ok(f.polls[0].url.includes('connectionId=new'));
    assert.deepEqual(f.requests.filter(row=>row.url.endsWith('/poll/close')).map(row=>row.body.connectionId),['old-orphan']);
  });
});

test('temporary network/server errors retry one ID and cursor with bounded grace-compatible backoff',async()=>{
  await harness(async f=>{
    await f.open();await f.deliver({events:[event(1,'status',{ready:true})],cursor:1});
    const errors=[Error('temporary-network-loss'),response({error:'upstream-unavailable'},503),response({error:'poll-already-pending'},409)];
    for(const [index,error]of errors.entries()){
      const pending=f.polls.at(-1);if(error instanceof Error)pending.reject(error);else pending.resolve(error);await settle();
      assert.equal(f.opens.length,1);assert.equal(f.polls.length,index+2);
      f.timers.run([250,500,1000][index]);await settle();assert.ok(f.polls.at(-1).url.endsWith('&after=1'));
    }
    await f.deliver({events:[event(1,'status',{duplicate:true}),event(2,'status',{fresh:true})],cursor:2});
    assert.deepEqual(f.events.map(row=>row.data),[{ready:true},{fresh:true}]);assert.ok(f.errors.every(error=>error.message==='connection-retrying'));
  });
});

test('closing during retry clears the wait timer and prevents another request',async()=>{
  await harness(async f=>{
    await f.open();f.polls[0].reject(Error('lost'));await settle();assert.ok([...f.timers.tasks.values()].some(row=>row.ms===250));
    f.client.close();await settle();assert.equal(f.polls.length,1);assert.equal(f.opens.length,1);assert.equal(f.timers.tasks.size,0);
  });
});

test('close cancels the hold watchdog even if a fetch implementation never settles after abort',async()=>{
  await harness(async f=>{
    await f.open();f.client.close();await settle();assert.equal(f.polls[0].options.signal.aborted,true);
    assert.equal(f.timers.tasks.size,0);assert.equal(f.intervals.size,0);
  });
});

test('an inactive connection reopens with a new cursor and receives the recovery batch exactly once',async()=>{
  await harness(async f=>{
    await f.open('old',10);f.polls[0].resolve(response({error:'poll-connection-not-active'},409));await settle();
    f.timers.run(250);await settle();assert.equal(f.opens.length,2);
    f.opens[1].resolve(response({connectionId:'new',cursor:20}));await settle();assert.ok(f.polls[1].url.includes('connectionId=new&after=20'));
    await f.deliver({events:[event(21,'status',{available:false}),event(22,'match',match),event(23,'state',{matchId:'m1',sequence:9})],cursor:23});
    assert.deepEqual(f.events.map(row=>row.type),['status','match','state']);assert.ok(f.polls.at(-1).url.endsWith('&after=23'));
    assert.equal(f.client.send({held:['X'],pressed:['X'],released:[]}),91);
  });
});

test('401 expires login and duplicate connection409 stops without reconnect storms',async()=>{
  for(const [status,code,message]of [[401,'login-required','Session expired'],[409,'stream-already-open','A connection is already open']]){
    await harness(async f=>{
      const opening=f.client.open(),assertion=assert.rejects(opening,error=>error.status===status&&error.code===code&&error.message.includes(message));
      f.opens[0].resolve(response({error:code},status));await assertion;await settle();
      assert.equal(f.errors.length,1);assert.equal(f.errors[0].fatal,true);assert.equal(f.intervals.size,0);assert.equal(f.polls.length,0);assert.equal(f.timers.tasks.size,0);
    });
  }
});

test('a poll401 retires its lease and cancels peers and pending uploads',async()=>{
  Peer.instances=[];
  await harness(async f=>{
    await f.open();await f.client.setMatch(match,'a');await settle();f.client.send({held:['Z'],pressed:['Z'],released:[]});
    const sending=[...f.intervals.values()][0]();assert.equal(f.uploads.length,1);
    f.polls[0].resolve(response({error:'login-required'},401));await settle();
    assert.equal(f.errors.at(-1).status,401);assert.equal(f.intervals.size,0);assert.ok(Peer.instances.every(peer=>peer.connectionState==='closed'));
    assert.equal(f.uploads[0].options.signal.aborted,true);f.uploads[0].reject(Error('late-upload-failure'));await sending;
    assert.equal(f.errors.length,1,'retired HTTP upload cannot report a second error');
    assert.equal(f.client.send({held:['X'],pressed:['X'],released:[]}),undefined);assert.deepEqual(f.client.connectivity(),[]);
  },{peer:Peer,holdUpload:true});
});

test('HTML or empty error bodies retain their HTTP status and stop4xx instead of retrying the login',async()=>{
  for(const status of [400,401,409])await harness(async f=>{
    const opening=f.client.open(),assertion=assert.rejects(opening,error=>error.status===status);
    f.opens[0].resolve({ok:false,status,json:async()=>{throw new SyntaxError('non-JSON proxy body');}});
    await assertion;await settle();assert.equal(f.opens.length,1);assert.equal(f.errors.length,1);assert.equal(f.timers.tasks.size,0);
    if(status===401)assert.match(f.errors[0].message,/Session expired/);
  });
});

test('an HTML503 proxy failure still retries the same connection and cursor',async()=>{
  await harness(async f=>{
    await f.open();f.polls[0].resolve({ok:false,status:503,json:async()=>{throw new SyntaxError('HTML503');}});await settle();
    assert.equal(f.errors.at(-1).message,'connection-retrying');f.timers.run(250);await settle();
    assert.equal(f.opens.length,1);assert.equal(f.polls.length,2);assert.equal(f.polls[1].url,f.polls[0].url);
  });
});

test('an allocated lease is released even when the open cursor is invalid or the response arrives after close',async()=>{
  for(const late of [false,true])await harness(async f=>{
    const opening=f.client.open();let assertion;
    if(late){f.client.close();assert.equal(await opening,null);}else assertion=assert.rejects(opening,/invalid-online-poll-open/);
    f.opens[0].resolve(response({connectionId:'allocated-invalid',cursor:-1}));if(assertion)await assertion;await settle();
    assert.deepEqual(f.requests.find(row=>row.url.endsWith('/poll/close')).body,{connectionId:'allocated-invalid'});
    assert.equal(f.polls.length,0);assert.equal(f.timers.tasks.size,0);
  });
});

test('events from a prior match are ignored and a close inside dispatch stops the remaining batch',async()=>{
  await harness(async f=>{
    await f.open();await f.client.setMatch({...match,id:'new'},'a');
    await f.deliver({events:[event(1,'input',{matchId:'m1',inputs:{b:{held:['Z']}}}),event(2,'disconnect',{matchId:'m1',playerId:'b'}),
      event(3,'result',{matchId:'m1'}),event(4,'state',{matchId:'new',sequence:2}),event(5,'status',{stop:true}),event(6,'status',{never:true})],cursor:6});
    assert.deepEqual(f.events.map(row=>row.type),['state','status']);assert.equal(f.events.at(-1).data.stop,true);
    assert.equal(f.polls.length,1);assert.equal(f.intervals.size,0);
  },{onEvent(type,data,client){if(type==='status'&&data.stop)client.close();}});
});

test('empty responses keep cursor and one request; the hold watchdog retries without an overlapping poll',async()=>{
  await harness(async f=>{
    await f.open('one',4);await f.deliver({events:[],cursor:4});assert.equal(f.polls.length,1);
    f.timers.run(25);await settle();assert.equal(f.polls.length,2);assert.ok(f.polls[1].url.endsWith('&after=4'));
    const pending=f.polls[1];f.timers.run(11000);assert.equal(pending.options.signal.aborted,true);
    pending.reject(Object.assign(Error('aborted'),{name:'AbortError'}));await settle();assert.equal(f.polls.length,2);
    f.timers.run(250);await settle();assert.equal(f.polls.length,3);assert.equal(f.opens.length,1);
  });
});

test('invalid or oversized event envelopes stop safely without dispatching or advancing a cursor',async()=>{
  const malformed=[{events:[],cursor:1},{events:[event(1,'state',{})],cursor:-1},
    {events:[event(1,'status',{}),event(1,'status',{})],cursor:1},{events:[event(1,'unknown',{})],cursor:1},
    {events:Array.from({length:ONLINE_POLL_MAXIMUM_BATCH_EVENTS+1},(_,i)=>event(i+1,'status',{})),cursor:ONLINE_POLL_MAXIMUM_BATCH_EVENTS+1}];
  for(const value of malformed)await harness(async f=>{
    await f.open();await f.deliver(value);assert.equal(f.events.length,0);assert.equal(f.errors.at(-1).message,'invalid-online-poll-response');
    assert.equal(f.errors.at(-1).fatal,true);
    assert.equal(f.intervals.size,0);assert.equal(f.polls.length,1);assert.equal(f.timers.tasks.size,0);
  });
});

test('a real mailbox with 128 critical events plus all five 3v3 owners and one room passes the shared envelope bound',async()=>{
  const channel=createOnlinePollChannel(),report=encodeOwnedState(await make({passives:[]}),'rf',{epoch:1,frameSeq:60}),codec=createOwnedRelayDelta();
  // Real match/player/input events fit inside the unchanged critical cap.
  for(let i=0;i<ONLINE_POLL_MAXIMUM_CRITICAL_EVENTS-5;i++)assert.equal(channel.push('input',{matchId:'m1',sample:i},{critical:true,replaceKey:null}),true);
  for(const id of ['b','c','d','e','f'])assert.equal(channel.push('owned-state',{matchId:'m1',relayToken:'max-batch',...codec.encode(id,report).value},{critical:true,replaceKey:null}),true);
  for(const id of ['b','c','d','e','f'])assert.equal(channel.push('owned-state',{matchId:'m1',relayToken:'max-batch',...codec.encode(id,{...report,frameSeq:61}).value},{critical:false,replaceKey:'owner:'+id}),true);
  assert.equal(channel.push('state',{matchId:'m1',snapshot:{actors:[]}},{critical:false,replaceKey:'room'}),true);
  const batch=await channel.poll(0).promise;assert.equal(batch.events.length,134);assert.equal(batch.events.length,ONLINE_POLL_MAXIMUM_BATCH_EVENTS);
  await harness(async f=>{await f.open();
    // A transport batch does not create the room. Install the same six-player
    // legacy-capability context before the production combat dispatch gate.
    await f.client.setMatch({id:'m1',mode:'3v3',ownership:'local-owner-v1',status:'playing',players:['a','b','c','d','e','f'].map(id=>({id}))},'a');
    await f.deliver(batch);assert.deepEqual(f.errors,[]);assert.equal(f.events.length,134);assert.equal(f.events.filter(row=>row.type==='peer-owned-state').length,10);assert.equal(f.polls.length,2);});
  assert.equal(channel.push('input',{matchId:'m1',oneTooMany:true},{critical:true,replaceKey:null}),false);assert.equal(channel.closed,true);
});

test('a valid poll lease without an installed battle cannot authorize combat-event delivery',async()=>{
 await harness(async f=>{await f.open();
  await f.deliver({events:[event(1,'input',{matchId:'m1',sample:0}),event(2,'owned-state',{matchId:'m1',playerId:'b',report:{}})],cursor:2});
  assert.deepEqual(f.events,[]);assert.deepEqual(f.errors,[]);assert.equal(f.polls.length,2);
  assert.ok(f.polls.at(-1).url.endsWith('&after=2'),'discarded unauthorized traffic still advances the consumed poll envelope');
 });
});

test('poll still transmits the same input-only P2P packets and named signal events',async()=>{
  Peer.instances=[];
  await harness(async f=>{
    await f.open();await f.client.setMatch(match,'a');await settle();
    assert.ok(f.requests.some(row=>row.url==='/api/online/signal'&&row.body.type==='offer'));
    assert.equal(f.client.send({held:['Z'],pressed:['Z'],released:[]}),91);
    assert.equal(Peer.instances[0].channel.sent[0].packet.frameSeq,91);
    const offer=f.requests.find(row=>row.url==='/api/online/signal'&&row.body.type==='offer').body;
    await f.deliver({events:[event(1,'signal',{matchId:'m1',from:'b',type:'answer',payload:{type:'answer',sdp:'poll-answer'},
      signalVersion:1,sourceEpoch:1,generation:1,offerId:offer.offerId})],cursor:1});await settle();
    assert.deepEqual(Peer.instances[0].remoteDescription,{type:'answer',sdp:'poll-answer'});
    f.client.close();assert.equal(Peer.instances[0].connectionState,'closed');
  },{peer:Peer});
});

test('game chooses session transport and old sessions default to SSE',()=>{
  const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
  assert.match(source,/eventTransport:session\.onlineEventTransport\?\?'sse'/);
  assert.throws(()=>createOnlineClient({eventTransport:'unknown'}),/Unsupported online event transport/);
});

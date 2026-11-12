import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const desc=(type,ufrag)=>({type,sdp:'v=0\r\na=ice-ufrag:'+ufrag+'\r\n'});
const identity=(generation=1,offerId='offer-00000001',sourceEpoch=1)=>({signalVersion:1,generation,offerId,sourceEpoch});
async function fixture(t,{local='b',players=['a','b','c'],holdRemote=false,pageInitToken='signal-live-page-v51'}={}){
  const peers=[],sources=[],requests=[],errors=[],intervals=[],events=[];let now=0;
  t.mock.method(globalThis,'setInterval',fn=>{intervals.push(fn);return intervals.length;});t.mock.method(globalThis,'clearInterval',()=>{});
  class Channel{constructor(label){this.label=label;this.readyState='open';this.bufferedAmount=0;this.sent=[];}send(value){this.sent.push(value);}}
  class Peer{
    constructor(){this.channels=new Map();this.connectionState='connected';this.signalingState='stable';this.remoteCalls=[];this.ice=[];peers.push(this);}
    createDataChannel(label){const channel=new Channel(label);this.channels.set(label,channel);return channel;}
    async createOffer(){return desc('offer','local-'+peers.indexOf(this));}
    async createAnswer(){this.answerCalls=(this.answerCalls??0)+1;return desc('answer','answer-'+peers.indexOf(this));}
    async setLocalDescription(value){this.localDescription={...value,toJSON:()=>value};this.signalingState=value.type==='offer'?'have-local-offer':'stable';}
    async setRemoteDescription(value){this.remoteCalls.push(value);if(holdRemote){this.remoteGate=deferred();await this.remoteGate.promise;}
      if(this.signalingState==='closed'||value.type==='answer'&&this.signalingState!=='have-local-offer')throw Error('wrong signaling state');
      this.remoteDescription=value;this.signalingState=value.type==='offer'?'have-remote-offer':'stable';}
    async addIceCandidate(value){this.ice.push(value);}close(){this.connectionState='closed';this.signalingState='closed';}
  }
  class Source{constructor(){this.listeners=new Map();sources.push(this);}addEventListener(type,fn){this.listeners.set(type,fn);}close(){}
    emit(type,value){this.listeners.get(type)?.({data:JSON.stringify(value)});}}
  const match={id:'rtc-v51',ownership:'local-owner-v1',players:players.map(id=>({id}))};
  const client=createOnlineClient({EventSource:Source,WebSocket:null,RTCPeerConnection:Peer,pageInitToken,clock:()=>now,
    fetch:async(url,options)=>{requests.push({url,options,body:options.body?JSON.parse(options.body):null});return {ok:true,json:async()=>({accepted:false})};},
    rtcOptions:{enabled:false},onEvent:(type,value)=>{events.push({type,value});return true;},onError:error=>errors.push(error)});
  t.after(()=>client.close());await client.open();await client.setMatch(match,local);await settle();
  return {client,peers,sources,requests,errors,events,match,
    signals(type){return requests.filter(row=>row.url==='/api/online/signal'&&(!type||row.body.type===type));},
    async deliver(from,type,payload,proof=identity()){sources[0].emit('signal',{matchId:match.id,from,type,payload,...proof});await settle();},
    async advance(ms){now+=ms;await intervals[0]();await settle();}};
}
test('O2 before O1 retains the healthy newer PC, and candidate/answer identities survive SSE duplicates',async t=>{
  const f=await fixture(t,{players:['a','b']});
  await f.deliver('a','offer',desc('offer','u2'),identity(2,'offer-00000002'));const pc=f.peers[0];
  await f.deliver('a','offer',desc('offer','u1'),identity(1));
  assert.equal(f.peers.length,1);assert.equal(pc.remoteDescription.sdp,desc('offer','u2').sdp);assert.equal(pc.connectionState,'connected');
  await f.deliver('a','offer',desc('offer','u2'),identity(2,'offer-00000002'));
  assert.equal(pc.remoteCalls.length,1);assert.equal(pc.answerCalls,1);assert.equal(f.signals('answer').length,2,'same cached answer may be retransmitted without SDP re-entry');
  assert.equal(f.client.performance().signaling.stale,1);assert.deepEqual(f.errors,[]);
});
test('candidate before offer is bounded and applied only to matching generation and SDP ufrag',async t=>{
  const f=await fixture(t,{players:['a','b']}),proof=identity(2,'offer-00000002');
  await f.deliver('a','candidate',{candidate:'new',usernameFragment:'u2'},proof);
  await f.deliver('a','candidate',{candidate:'old',usernameFragment:'u1'},identity(1));
  await f.deliver('a','candidate',{candidate:'wrong-ufrag',usernameFragment:'u1'},proof);
  await f.deliver('a','offer',desc('offer','u2'),proof);
  assert.deepEqual(f.peers[0].ice.map(row=>row.candidate),['new']);
  await f.deliver('a','candidate',{candidate:'new',usernameFragment:'u2'},proof);
  assert.equal(f.peers[0].ice.length,1);assert.equal(f.client.performance().signaling.pendingCandidates,0);
  assert.deepEqual(f.errors,[]);
});
test('old answer and ICE cannot enter a replacement local offer; same-page POSTs carry page identity',async t=>{
  const f=await fixture(t,{local:'a',players:['a','b']}),old=f.signals('offer')[0];
  assert.equal(old.options.headers['X-RF-Page-Init'],'signal-live-page-v51');
  f.peers[0].connectionState='failed';await f.advance(5001);const current=f.signals('offer').at(-1),pc=f.peers.at(-1);
  assert.notEqual(old.body.offerId,current.body.offerId);assert.ok(current.body.generation>old.body.generation);
  await f.deliver('b','answer',desc('answer','old'),identity(1,old.body.offerId));
  await f.deliver('b','candidate',{candidate:'old'},identity(1,old.body.offerId));
  assert.equal(pc.remoteCalls.length,0);assert.equal(pc.ice.length,0);
  const proof=identity(2,current.body.offerId);await f.deliver('b','answer',desc('answer','new'),proof);
  await f.deliver('b','answer',desc('answer','new'),proof);await f.deliver('b','answer',desc('answer','conflict'),proof);
  assert.equal(pc.remoteCalls.length,1);assert.equal(pc.remoteDescription.sdp,desc('answer','new').sdp);assert.deepEqual(f.errors,[]);
});
test('a newer authenticated page epoch supersedes a large old generation and late old completion stays retired',async t=>{
  const f=await fixture(t,{players:['a','b'],holdRemote:true});
  await f.deliver('a','offer',desc('offer','old'),identity(900,'old-page-offer',1));const old=f.peers[0];
  await f.deliver('a','offer',desc('offer','new'),identity(1,'new-page-offer',2));const current=f.peers[1];
  current.remoteGate.resolve();await settle();old.remoteGate.reject(Error('retired native job'));await settle();
  await f.deliver('a','offer',desc('offer','old'),identity(901,'another-old-offer',1));
  assert.equal(f.peers.length,2);assert.equal(current.answerCalls,1);assert.equal(old.answerCalls??0,0);assert.deepEqual(f.errors,[]);
});
test('legacy signaling falls back only that peer and retains canonical events for server delivery',async t=>{
  const f=await fixture(t,{local:'a'}),packet={held:[],pressed:[],released:[]};
  f.client.send(packet,{protocol:'local-owner-v1',epoch:1,frameSeq:3,actor:{},effects:[],hits:[],actions:[{id:7,ageFrames:0}]});await settle();
  assert.equal(f.client.performance().peerActionLedgers.b.pending,1);
  await f.deliver('b','answer',desc('answer','legacy'),{});
  assert.deepEqual(f.client.performance().signaling.legacyRelayPeers,['b']);
  assert.equal(f.client.connectivity().some(row=>row.id==='b'),false);assert.equal(f.client.connectivity().some(row=>row.id==='c'),true);
  assert.equal(f.client.performance().peerActionLedgers.b.pending,1);assert.equal(f.client.performance().pendingActions,1);
  f.client.send(packet,{protocol:'local-owner-v1',epoch:1,frameSeq:6,actor:{},effects:[],hits:[],actions:[]});await f.advance(50);
  assert.ok(f.requests.filter(row=>row.url==='/api/online/input').some(row=>row.body.owner.actions.some(action=>action.id===7)));
});
test('a legacy event cannot downgrade an established modern pair and clearing a match drops its candidates',async t=>{
  const f=await fixture(t,{players:['a','b']});await f.deliver('a','offer',desc('offer','modern'));
  const pc=f.peers[0];await f.deliver('a','offer',desc('offer','legacy'),{});
  assert.equal(pc.connectionState,'connected');assert.deepEqual(f.client.performance().signaling.legacyRelayPeers,[]);
  await f.deliver('a','candidate',{candidate:'pending'},identity(2,'next-offer-00002'));
  assert.equal(f.client.performance().signaling.pendingCandidates,1);f.client.clearMatch();
  assert.equal(f.client.performance().signaling.pendingCandidates,0);
});
test('candidate reorder storage is bounded per roster peer and no page token fixture can still negotiate modern RTC',async t=>{
  const f=await fixture(t,{players:['a','b'],pageInitToken:null});
  for(let i=0;i<70;i++)await f.deliver('a','candidate',{candidate:'candidate-'+i,usernameFragment:'bounded'});
  assert.equal(f.client.performance().signaling.pendingCandidates,64);assert.equal(f.client.performance().signaling.rejected,6);
  await f.deliver('a','offer',desc('offer','bounded'));await settle();assert.equal(f.peers[0].ice.length,64);
  assert.equal(f.signals('answer').length,1);assert.deepEqual(f.client.performance().signaling.legacyRelayPeers,[]);
  assert.equal(f.signals('answer')[0].options.headers['X-RF-Page-Init'],undefined);
});
test('a new authenticated generation retires an old PC even if a sender reuses its offer ID',async t=>{
  const f=await fixture(t,{players:['a','b']});await f.deliver('a','offer',desc('offer','old'));const old=f.peers[0];
  await f.deliver('a','offer',desc('offer','new'),identity(2));
  assert.equal(old.connectionState,'closed');assert.equal(f.peers.length,2);assert.equal(f.peers[1].remoteDescription.sdp,desc('offer','new').sdp);
});
test('plain HTTP browsers without randomUUID retain an unpredictable offer ID using getRandomValues',async t=>{
  t.mock.method(globalThis.crypto,'randomUUID',()=>undefined);
  const f=await fixture(t,{local:'a',players:['a','b']});
  assert.match(f.signals('offer')[0].body.offerId,/^[a-f0-9]{32}$/);assert.deepEqual(f.errors,[]);
});
for(const pending of [false,true])test(`a reloaded answerer immediately gets a new local offer while the old answer is ${pending?'pending':'applied'}`,async t=>{
  const f=await fixture(t,{local:'a',players:['a','b'],holdRemote:pending}),old=f.signals('offer')[0].body,pc=f.peers[0];
  await f.deliver('b','answer',desc('answer','before-reload'),identity(900,old.offerId,1));
  await f.deliver('b','answer',desc('answer','before-reload'),identity(900,old.offerId,1));
  await f.deliver('b','candidate',{candidate:'same-page'},identity(901,old.offerId,1));
  assert.equal(f.peers.length,1,'duplicates and same-page generation changes do not start an epoch recovery');
  await f.deliver('b',pending?'answer':'candidate',pending?desc('answer','after-reload'):
    {candidate:'new-page',usernameFragment:'after-reload'},identity(1,old.offerId,2));
  const next=f.signals('offer').at(-1).body;assert.notEqual(next.offerId,old.offerId);assert.equal(pc.connectionState,'closed');
  for(let i=0;i<5;i++)await f.deliver('b','candidate',{candidate:'new-page-'+i},identity(1,old.offerId,2));
  assert.equal(f.peers.length,2,'candidate burst from one epoch can trigger at most one replacement');
  if(pending){pc.remoteGate.reject(Error('old answer retired'));await settle();}
  await f.deliver('b','answer',desc('answer','late-old'),identity(901,old.offerId,1));
  const current=f.peers.at(-1);assert.equal(current.remoteCalls.length,0);
  await f.deliver('b','answer',desc('answer','reconnected'),identity(2,next.offerId,2));
  if(pending){current.remoteGate.resolve();await settle();}
  assert.equal(current.remoteDescription.sdp,desc('answer','reconnected').sdp);assert.deepEqual(f.errors,[]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineClient} from '../../apps/web/online-client.mjs';

const match={id:'match-one',players:[{id:'a'},{id:'b'},{id:'c'},{id:'d'}]};
const packet=held=>({held:[...held],pressed:[...held],released:[]});
const response=value=>({ok:true,json:async()=>value});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};
async function harness(run,{Peer=null,requestOverride,pageInitToken=null,clock}={}){
  const callbacks=[],requests=[],events=[],errors=[],sources=[];
  const savedInterval=globalThis.setInterval,savedClear=globalThis.clearInterval;
  globalThis.setInterval=fn=>{callbacks.push(fn);return callbacks.length;};globalThis.clearInterval=()=>{};
  class Source {
    constructor(url){this.url=url;this.listeners=new Map();this.closed=false;sources.push(this);}
    addEventListener(type,callback){this.listeners.set(type,callback);}
    emit(type,value){
      // This harness models the new authenticated signaling coordinator.
      if(type==='signal'&&value.signalVersion===undefined){const offer=[...requests].reverse().find(row=>row.url==='/api/online/signal'&&row.body.type==='offer'&&row.body.to===value.from);
        value={...value,signalVersion:1,sourceEpoch:1,generation:offer?.body.generation??1,offerId:offer?.body.offerId??'fixture-remote-offer'};}
      this.listeners.get(type)?.({data:JSON.stringify(value)});
    }
    close(){this.closed=true;}
  }
  const request=async(url,options)=>{requests.push({url,options,body:options.body?JSON.parse(options.body):null});if(requestOverride)return requestOverride(url,options);return {ok:true,json:async()=>url.endsWith('/status')?{queued:false,available:true}:{ok:true}};};
  const client=createOnlineClient({fetch:request,EventSource:Source,RTCPeerConnection:Peer,pageInitToken,...(clock?{clock}:{}),onEvent:(type,data)=>events.push({type,data}),onError:e=>errors.push(e)});
  try{await run({client,callbacks,requests,events,errors,sources});}
  finally{client.close();globalThis.setInterval=savedInterval;globalThis.clearInterval=savedClear;}
}
class FakePeer {
  static instances=[];
  constructor(){this.channel={readyState:'open',bufferedAmount:0,sent:[],send(value){this.sent.push(value);}};this.connectionState='connected';FakePeer.instances.push(this);}
  createDataChannel(){return this.channel;}
  async createOffer(){return {type:'offer',sdp:'test-offer'};}
  async createAnswer(){return {type:'answer',sdp:'test-answer'};}
  async setLocalDescription(value){this.localDescription={...value,toJSON(){return {type:this.type,sdp:this.sdp};}};}
  async setRemoteDescription(value){this.remoteDescription=value;}
  async addIceCandidate(){return;}
  close(){this.connectionState='closed';}
}
class StrictSignalPeer extends FakePeer{
  constructor(){super();this.signalingState='stable';}
  async createOffer(){return {type:'offer',sdp:'offer-'+FakePeer.instances.indexOf(this)};}
  async setLocalDescription(value){await super.setLocalDescription(value);this.signalingState=value.type==='offer'?'have-local-offer':'stable';}
  async setRemoteDescription(value){
    if(this.signalingState==='closed'||value.type==='answer'&&this.signalingState!=='have-local-offer')
      throw Error('Called in wrong state: '+this.signalingState);
    await super.setRemoteDescription(value);this.signalingState=value.type==='offer'?'have-remote-offer':'stable';
  }
  close(){super.close();this.signalingState='closed';}
}
const frozenRoom=()=>({id:'match-progress',mode:'1v1',sceneId:'real-map',seed:17,ownership:'local-owner-v1',
  versions:{reference:'native-2016',program:'current-web',preset:'frozen'},status:'starting',
  players:[{id:'a',team:0,professionId:'RF',unitClass:107,loadout:[{skillId:24032,branchId:'none'}]},
    {id:'b',team:1,professionId:'BM',unitClass:109,loadout:[{skillId:24025,branchId:'none'}]}]});
// The real entry point binds a match before accepting its state, then the
// authoritative state opens fight. Merely delivering a match event in this
// recording-only harness does neither. Keep ownership lives explicit too.
const roomState=(room,sequence=0,phase='fight')=>({matchId:room.id,sequence,pvp:{phase},
  snapshot:{actors:room.players.map(player=>({id:player.id}))},
  ownership:{actors:Object.fromEntries(room.players.map(player=>[player.id,{epoch:1,frameSeq:0}]))}});

test('loading and ready metadata retain one strict native offer and its delayed answer throughout the same frozen room',async()=>{
  FakePeer.instances=[];
  await harness(async({client,sources,requests,errors})=>{
    await client.open();const room=frozenRoom();await client.setMatch(room,'a');await settle();const peer=FakePeer.instances[0];
    for(const progress of [5,35,85,95,100])await client.refreshMatch({...room,status:progress===100?'playing':'starting',
      versions:{preset:'frozen',program:'current-web',reference:'native-2016'},
      players:room.players.map(p=>({...p,loadingProgress:progress,connected:true,lastSequence:-1,lastFrameSeq:0,lastReservedSequence:-1}))},'a');
    await settle();assert.equal(FakePeer.instances.length,1);assert.equal(peer.connectionState,'connected');
    assert.equal(requests.filter(r=>r.url==='/api/online/signal'&&r.body.type==='offer').length,1);
    sources[0].emit('signal',{matchId:room.id,from:'b',type:'answer',payload:{type:'answer',sdp:'answer-for-original-offer'}});await settle();
    assert.equal(peer.signalingState,'stable');assert.equal(peer.remoteDescription.sdp,'answer-for-original-offer');assert.deepEqual(errors,[]);
    await client.refreshMatch({...room,players:[...room.players].reverse()},'a');assert.equal(FakePeer.instances.length,1,'roster ordering does not change its binding');
  },{Peer:StrictSignalPeer});
});

test('metadata refresh preserves an active upload, source frame clock and pending canonical action receipts',async()=>{
  FakePeer.instances=[];const upload=deferred();
  await harness(async({client,requests,sources,events})=>{
    await client.open();const room=frozenRoom();await client.setMatch(room,'a');
    const owner={protocol:'local-owner-v1',epoch:1,frameSeq:3,actor:{},effects:[],hits:[{id:7,attackerId:'b',damage:10}],actions:[{id:3,ageFrames:0}]};
    assert.equal(client.send(packet(['Z']),owner),undefined,'created/loading cannot upload combat');
    sources[0].emit('state',roomState(room,0,'intro'));
    assert.equal(client.send(packet(['Z']),owner),undefined,'intro cannot upload combat');
    assert.equal(requests.filter(r=>r.url==='/api/online/input').length,0);
    sources[0].emit('state',roomState(room,1));
    assert.equal(client.send(packet(['Z']),owner),3);await settle();const first=requests.find(r=>r.url==='/api/online/input');assert.ok(first);
    const ledgers=client.performance().peerActionLedgers;assert.equal(ledgers.b.pending,1);
    await client.refreshMatch({...room,players:room.players.map(p=>({...p,loadingProgress:100,
      lastSequence:p.id==='a'?0:-1,lastFrameSeq:p.id==='a'?3:0,lastReservedSequence:p.id==='a'?1:-1}))},'a');
    assert.equal(FakePeer.instances.length,1,'ACK/reservation metadata does not recreate its RTC connection');
    assert.equal(first.options.signal.aborted,false);assert.equal(client.performance().pendingActions,1);
    assert.deepEqual(client.performance().peerActionLedgers,ledgers,'recipient action retention survives progress and ACK metadata');
    assert.equal(client.send(packet(['X']),{...owner,frameSeq:6,hits:[],actions:[]}),6);
    assert.equal(requests.filter(r=>r.url==='/api/online/input').length,1);
    upload.resolve(response({accepted:true,consumedActionIds:[3],consumedHitIds:[7]}));await settle();
    const second=requests.filter(r=>r.url==='/api/online/input')[1];assert.ok(second);assert.equal(second.body.owner.frameSeq,6);
    assert.deepEqual(second.body.owner.actions,[]);assert.deepEqual(second.body.owner.hits,[]);
    sources[0].emit('state',roomState(room,2,'result'));const delivered=events.length;
    sources[0].emit('state',roomState(room,3,'fight'));
    assert.equal(events.length,delivered,'a newer packet cannot move a terminal phase back to fight');
    assert.equal(client.send(packet(['Z']),{...owner,frameSeq:9}),undefined,'terminal combat remains closed');
    assert.equal(requests.filter(r=>r.url==='/api/online/input').length,2);
  },{Peer:StrictSignalPeer,requestOverride:url=>url==='/api/online/input'?upload.promise:response({available:true})});
});

test('a current ready acknowledgement remains current after its own loading progress broadcast',async()=>{
  const ready=deferred();FakePeer.instances=[];
  await harness(async({client})=>{
    const room=frozenRoom();await client.setMatch(room,'a');const pending=client.ready(room.id);
    await client.refreshMatch({...room,players:room.players.map(p=>({...p,loadingProgress:100}))},'a');
    ready.resolve(response({ok:true,matchId:room.id}));assert.deepEqual(await pending,{ok:true,matchId:room.id});
    assert.equal(FakePeer.instances.length,1);
  },{Peer:StrictSignalPeer,requestOverride:url=>url==='/api/online/ready'?ready.promise:response({available:true})});
});

test('refresh rebuilds on each frozen room or player binding change instead of accepting it as loading progress',async()=>{
  const changes={id:r=>{r.id='different';},seed:r=>{r.seed++;},versions:r=>{r.versions.program='different';},scene:r=>{r.sceneId='other-map';},
    mode:r=>{r.mode='2v2';},ownership:r=>{r.ownership='other';},roster:r=>{r.players[1].id='c';},team:r=>{r.players[1].team=0;},
    profession:r=>{r.players[1].professionId='RF';},unitClass:r=>{r.players[1].unitClass=107;},
    loadout:r=>{r.players[1].loadout[0].skillId=24033;},trait:r=>{r.players[1].loadout[0].branchId='other';},
    guild:r=>{r.players[1].guildSkills=[{id:1,level:3}];}};
  for(const [field,change]of Object.entries(changes)){
    FakePeer.instances=[];
    await harness(async({client})=>{
      const room=frozenRoom();await client.setMatch(room,'a');await settle();const old=FakePeer.instances[0],changed=structuredClone(room);change(changed);
      await client.refreshMatch(changed,'a');await settle();assert.equal(FakePeer.instances.length,2,field);assert.equal(old.connectionState,'closed',field);
    },{Peer:StrictSignalPeer});
  }
  FakePeer.instances=[];
  await harness(async({client})=>{const room=frozenRoom();await client.setMatch(room,'a');await client.refreshMatch(room,'b');
    assert.equal(FakePeer.instances.length,2);assert.equal(FakePeer.instances[0].connectionState,'closed','local player binding changes');
  },{Peer:StrictSignalPeer});
  FakePeer.instances=[];
  await harness(async({client})=>{const room=frozenRoom();await client.setMatch(room,'a');room.versions.program='caller-mutated';
    await client.refreshMatch(room,'a');assert.equal(FakePeer.instances.length,2,'binding must be frozen before caller mutation');
  },{Peer:StrictSignalPeer});
});

test('an in-progress answer for a retired same-room connection cannot overwrite its replacement connection',async()=>{
  class HeldAnswerPeer extends StrictSignalPeer{
    async setRemoteDescription(value){if(value.sdp==='old-answer'){this.answerGate=deferred();await this.answerGate.promise;}return super.setRemoteDescription(value);}
  }
  FakePeer.instances=[];
  await harness(async({client,sources,errors})=>{
    await client.open();const room=frozenRoom();await client.setMatch(room,'a');await settle();const old=FakePeer.instances[0];
    sources[0].emit('signal',{matchId:room.id,from:'b',type:'answer',payload:{type:'answer',sdp:'old-answer'}});await settle();assert.ok(old.answerGate);
    await client.refreshMatch({...room,seed:18},'a');await settle();const replacement=FakePeer.instances[1];
    sources[0].emit('signal',{matchId:room.id,from:'b',type:'answer',payload:{type:'answer',sdp:'replacement-answer'}});await settle();
    old.answerGate.resolve();await settle();assert.equal(replacement.remoteDescription.sdp,'replacement-answer');
    assert.equal(replacement.signalingState,'stable');assert.deepEqual(errors,[]);
  },{Peer:HeldAnswerPeer});
});

test('a conflicting same-generation SDP answer is rejected before re-entering a stable native connection',async()=>{
  FakePeer.instances=[];
  await harness(async({client,sources,errors})=>{
    await client.open();const room=frozenRoom();await client.setMatch(room,'a');await settle();
    for(const sdp of ['actual-answer','unexpected-different-answer']){
      sources[0].emit('signal',{matchId:room.id,from:'b',type:'answer',payload:{type:'answer',sdp}});await settle();
    }
    assert.equal(FakePeer.instances[0].remoteDescription.sdp,'actual-answer');assert.deepEqual(errors,[]);assert.equal(client.performance().signaling.rejected,1);
  },{Peer:StrictSignalPeer});
});

test('disconnected metadata closes its peer and a later live-looking refresh cannot erase its terminal tombstone',async()=>{
  FakePeer.instances=[];
  await harness(async({client,sources,errors})=>{
    await client.open();const room=frozenRoom();await client.setMatch(room,'a');await settle();const old=FakePeer.instances[0];
    await client.refreshMatch({...room,players:room.players.map(p=>({...p,connected:p.id!=='b'}))},'a');
    assert.equal(old.connectionState,'closed');assert.deepEqual(client.performance().disconnectedPlayers,['b']);
    await client.refreshMatch({...room,players:room.players.map(p=>({...p,connected:true}))},'a');
    sources[0].emit('signal',{matchId:room.id,from:'b',type:'answer',payload:{type:'answer',sdp:'late-answer'}});await settle();
    assert.equal(FakePeer.instances.length,1);assert.deepEqual(client.connectivity(),[]);assert.deepEqual(errors,[]);
  },{Peer:StrictSignalPeer});
});

test('an open pose channel with missing reliable handshake rebuilds within a bounded retry budget and keeps relay alive',async()=>{
  for(const controlState of ['open','connecting']){
    let now=0;FakePeer.instances=[];
    class DualPeer extends FakePeer{
      constructor(){super();this.control={label:'control',readyState:controlState,sent:[],send(value){this.sent.push(value);}};}
      createDataChannel(label){return label==='control'?this.control:this.channel;}
    }
    await harness(async({client,callbacks,requests})=>{
      await client.open();await client.setMatch({...match,players:match.players.slice(0,2)},'a');
      const original=FakePeer.instances[0];
      now=9999;await callbacks[0]();assert.equal(FakePeer.instances.length,1);
      for(let retry=0;retry<4;retry++){
        now+=10001;client.send(packet(['RIGHT']));await callbacks[0]();await settle();
        assert.equal(FakePeer.instances.length,retry+2);
        assert.equal(client.performance().peerRestarts.b,retry+1);
      }
      now+=20000;client.send(packet(['LEFT']));await callbacks[0]();await settle();
      assert.equal(FakePeer.instances.length,5);assert.equal(original.connectionState,'closed');
      assert.ok(requests.filter(row=>row.url==='/api/online/input').length>=5);
    },{Peer:DualPeer,clock:()=>now});
  }
});

test('legacy single-channel peers do not acquire a new reliable handshake requirement',async()=>{
  let now=0;FakePeer.instances=[];
  await harness(async({client,callbacks})=>{
    await client.open();await client.setMatch({...match,players:match.players.slice(0,2)},'a');
    now=20000;await callbacks[0]();assert.equal(FakePeer.instances.length,1);
    assert.deepEqual(client.performance().peerRestarts,{});
  },{Peer:FakePeer,clock:()=>now});
});

test('named SSE messages are decoded and delivered; malformed JSON is reported',async()=>{
  await harness(async({client,sources,events,errors})=>{
    await client.open();assert.equal(sources[0].url,'/api/online/events?ownedDelta=3');
    for(const type of ['status','match','state','input','disconnect','result','server-error'])assert.ok(sources[0].listeners.has(type));
    sources[0].emit('match',match);const delivered=events.length;
    sources[0].emit('state',roomState(match,1));assert.equal(events.length,delivered,'a match event alone does not bind a battle');
    await client.setMatch(match,'a');sources[0].emit('state',roomState(match,2));
    assert.deepEqual(events.at(-2),{type:'match',data:match});assert.equal(events.at(-1).data.sequence,2);
    sources[0].emit('state',roomState({...match,id:'another-match'},3));assert.equal(events.length,delivered+1,'foreign match state is rejected');
    sources[0].listeners.get('state')({data:'broken json'});assert.equal(errors.length,1);
    client.close();assert.ok(sources[0].closed);
  });
});

test('SSE reconnects remain bound to the page identity supplied by the entry point',async()=>{
  await harness(async({client,sources})=>{
    await client.open();assert.equal(sources[0].url,'/api/online/events?ownedDelta=3&pageInitToken=page-current-123');
    client.close();await client.open();assert.equal(sources[1].url,sources[0].url);
  },{pageInitToken:'page-current-123'});
  for(const token of ['', 'bad token', 12, 'x'.repeat(101)])assert.throws(()=>createOnlineClient({pageInitToken:token}),/Invalid online page identity/);
});
test('queue POST declares 2v2 and authenticated configuration is not sent as client-chosen battle state',async()=>{
  await harness(async({client,requests})=>{await client.join();const req=requests.at(-1);assert.equal(req.url,'/api/online/queue');assert.equal(req.options.method,'POST');assert.deepEqual(req.body,{mode:'2v2',continuousAuraVersion:2,ownerStatusVersion:1,combatPlaybackVersion:1});});
});

test('explicit 1v1 and 3v3 queues keep the selected mode in the authenticated request',async()=>{
  await harness(async({client,requests})=>{
    for(const mode of ['1v1','3v3']){await client.join(mode);assert.equal(requests.at(-1).url,'/api/online/queue');assert.deepEqual(requests.at(-1).body,{mode,continuousAuraVersion:2,ownerStatusVersion:1,combatPlaybackVersion:1});}
  });
});

test('GM account API accepts HTTP 201 and sends only username and exact password',async()=>{
  const body={username:'new-player',password:' secret1 '};
  await harness(async({client,requests})=>{
    const value=await client.api('/api/admin/accounts','POST',body);
    assert.deepEqual(value,{ok:true,username:body.username,role:'player'});
    const request=requests.at(-1);assert.equal(request.url,'/api/admin/accounts');assert.equal(request.options.method,'POST');
    assert.equal(request.options.headers['Content-Type'],'application/json');assert.equal(request.options.cache,'no-store');assert.deepEqual(request.body,body);
  },{requestOverride:async()=>({ok:true,status:201,json:async()=>({ok:true,username:body.username,role:'player'})})});
});

test('room capacity API reads live limits and submits only a complete per-mode configuration',async()=>{
  const maxRoomsByMode={'1v1':2,'2v2':0,'3v3':4};
  await harness(async({client,requests})=>{
    await client.roomCapacity();assert.equal(requests.at(-1).url,'/api/online/capacity');assert.equal(requests.at(-1).options.method,'GET');
    await client.setRoomCapacity(maxRoomsByMode);const saved=requests.at(-1);
    assert.equal(saved.url,'/api/online/capacity');assert.equal(saved.options.method,'POST');assert.deepEqual(saved.body,{maxRoomsByMode});
  });
  await harness(async({client})=>{await assert.rejects(client.setRoomCapacity(maxRoomsByMode),error=>error.status===403&&error.code==='gm-required');},
    {requestOverride:async()=>({ok:false,status:403,json:async()=>({error:'gm-required'})})});
});

test('GM account API preserves server failure codes for the lobby feedback',async()=>{
  for(const [status,code]of [[400,'invalid-password'],[401,'login-required'],[403,'gm-required'],[409,'account-exists'],[503,'account-save-failed']]){
    await harness(async({client})=>{
      await assert.rejects(client.api('/api/admin/accounts','POST',{username:'new-player',password:'secret1'}),error=>error.status===status&&error.code===code);
    },{requestOverride:async()=>({ok:false,status,json:async()=>({error:code})})});
  }
});
test('HTTP batches preserve frame order and ownership, limit each request to eight, and increase sequence',async()=>{
  await harness(async({client,callbacks,requests})=>{
    await client.open();await client.setMatch(match,'a');const first=packet(['LEFT']);client.send(first);first.held.push('Z');
    for(let i=1;i<11;i++)client.send(packet(i%2?['Z']:[]));
    await callbacks[0]();await callbacks[0]();const inputs=requests.filter(r=>r.url==='/api/online/input');
    assert.equal(inputs.length,2);assert.equal(inputs[0].body.frames.length,8);assert.equal(inputs[1].body.frames.length,3);assert.deepEqual(inputs[0].body.frames[0].held,['LEFT']);assert.deepEqual(inputs[0].body.frames[1].held,['Z']);assert.equal(inputs[0].body.sequence,0);assert.equal(inputs[1].body.sequence,1);assert.equal(inputs[1].body.matchId,match.id);
  });
});
test('peer construction failure keeps the server HTTP transport alive',async()=>{
  class BrokenPeer{constructor(){throw Error('webrtc-unavailable');}}
  await harness(async({client,callbacks,requests,errors})=>{
    await client.open();await client.setMatch(match,'a');client.send(packet(['RIGHT']));await callbacks[0]();
    assert.equal(errors.length,3);assert.ok(requests.some(r=>r.url==='/api/online/input'));assert.deepEqual(client.connectivity(),[]);
  },{Peer:BrokenPeer});
});
test('direct channel rejects old, foreign-match, or invalid held packets',async()=>{
  FakePeer.instances=[];
  await harness(async({client,events})=>{
    await client.setMatch(match,'a');const peer=FakePeer.instances[0];
    peer.channel.onmessage({data:JSON.stringify({matchId:match.id,sequence:2,packet:packet(['LEFT'])})});assert.equal(events.at(-1).type,'peer-input');const size=events.length;
    for(const data of [{matchId:match.id,sequence:1,packet:packet(['RIGHT'])},{matchId:'other',sequence:3,packet:packet(['RIGHT'])},{matchId:match.id,sequence:4,packet:packet(['INVALID'])}])peer.channel.onmessage({data:JSON.stringify(data)});
    assert.equal(events.length,size);assert.deepEqual(client.remoteInput('b').held,['LEFT']);
  },{Peer:FakePeer});
});
test('a channel send failure falls back without interrupting the simulation caller',async()=>{
  FakePeer.instances=[];
  await harness(async({client,callbacks,requests,errors})=>{
    await client.open();await client.setMatch(match,'a');FakePeer.instances[0].channel.send=()=>{throw Error('channel-closing');};
    assert.doesNotThrow(()=>client.send(packet(['Z'])));
    await callbacks[0]();assert.ok(requests.some(r=>r.url==='/api/online/input'));assert.ok(errors.some(e=>e.message==='channel-closing'));
  },{Peer:FakePeer});
});
test('temporary RTC send-buffer exhaustion preserves direct delivery for the next newest sample',async()=>{
  FakePeer.instances=[];
  await harness(async({client,callbacks,requests,errors})=>{
    await client.open();await client.setMatch(match,'a');const channel=FakePeer.instances[0].channel,send=channel.send;let first=true;
    channel.send=function(value){if(first){first=false;throw new DOMException('temporary queue limit','OperationError');}send.call(this,value);};
    client.send(packet(['Z']));client.send(packet(['RIGHT']));await callbacks[0]();
    assert.equal(channel.sent.length,1);assert.deepEqual(JSON.parse(channel.sent[0]).packet.held,['RIGHT']);
    assert.ok(client.connectivity().find(row=>row.id==='b').dataChannelOpen);assert.deepEqual(errors,[]);
    assert.equal(client.performance().peerTransports.b.sendFailures,1);assert.ok(requests.some(row=>row.url==='/api/online/input'));
  },{Peer:FakePeer});
});
test('RTC messages honor negotiated byte size and keep complete owner receipts in the authenticated fallback',async()=>{
  FakePeer.instances=[];
  await harness(async({client,callbacks,requests,errors})=>{
    await client.open();await client.setMatch({...match,ownership:'local-owner-v1'},'a');const peer=FakePeer.instances[0];peer.sctp={maxMessageSize:600};
    const owner={protocol:'local-owner-v1',epoch:1,frameSeq:3,actor:{marker:'\uad0d'.repeat(300)},effects:[],
      hits:[{id:7,attackerId:'b',damage:10}],actions:[{id:9,state:'STAND_COMBO_Z1',ageFrames:0}]};
    client.send(packet(['Z']),owner);assert.equal(peer.channel.sent.length,1);
    const capability=JSON.parse(peer.channel.sent[0]);assert.equal(capability.owner,undefined);assert.equal(capability.ownerDelta,undefined);
    assert.deepEqual(capability.packet.held,['Z']);assert.ok(new TextEncoder().encode(peer.channel.sent[0]).length<=600);
    assert.equal(client.performance().peerTransports.b.capabilityMessages,1);
    assert.ok(client.connectivity().find(row=>row.id==='b').dataChannelOpen);await callbacks[0]();
    const upload=requests.find(row=>row.url==='/api/online/input').body;
    assert.equal(upload.owner.actor.marker,owner.actor.marker);assert.deepEqual(upload.owner.hits,owner.hits);assert.equal(upload.owner.actions[0].id,9);
    client.send(packet(['RIGHT']),{...owner,frameSeq:6,actor:{marker:'small'},hits:[],actions:[]});
    assert.equal(peer.channel.sent.length,2);assert.equal(JSON.parse(peer.channel.sent[1]).owner.actor.marker,'small');assert.deepEqual(errors,[]);
  },{Peer:FakePeer});
});
test('RTC byte-size exceptions leave an open channel available to a later small sample',async()=>{
  FakePeer.instances=[];
  await harness(async({client,errors})=>{
    await client.setMatch(match,'a');const channel=FakePeer.instances[0].channel,send=channel.send;let first=true;
    channel.send=function(value){if(first){first=false;throw new TypeError('message exceeds peer receive limit');}send.call(this,value);};
    client.send(packet(['Z']));client.send(packet(['RIGHT']));assert.equal(channel.sent.length,1);
    assert.ok(client.connectivity().find(row=>row.id==='b').dataChannelOpen);assert.deepEqual(errors,[]);
  },{Peer:FakePeer});
});
test('reconnecting a page resumes per-frame identity above the existing match acknowledgement',async()=>{
  await harness(async({client,callbacks,requests})=>{
    await client.open();await client.setMatch({...match,players:[{id:'a',lastSequence:200,lastFrameSeq:1234},...match.players.slice(1)]},'a');client.send(packet(['X']));await callbacks[0]();
    const request=requests.find(r=>r.url==='/api/online/input');assert.equal(request.body.sequence,201);assert.ok(request.body.frames[0].frameSeq>1234);
  });
});

test('an old upload rejection cannot report an error, release a new upload lock, or consume the next match frames',async()=>{
  const uploads=[];
  await harness(async({client,callbacks,requests,errors})=>{
    await client.open();await client.setMatch(match,'a');client.send(packet(['Z']));const old=callbacks[0]();
    assert.equal(uploads.length,1);const firstRequest=requests.find(r=>r.url==='/api/online/input');
    await client.setMatch({...match,id:'match-two'},'a');assert.equal(firstRequest.options.signal.aborted,true);
    client.send(packet(['RIGHT']));const next=callbacks[0]();assert.equal(uploads.length,2);
    client.send(packet(['X']));uploads[0].reject(Error('old-upload-failed'));await old;
    assert.equal(errors.length,0);await callbacks[0]();assert.equal(uploads.length,2,'old finally must not release the new request lock');
    uploads[1].resolve(response({accepted:true}));await next;const third=callbacks[0]();assert.equal(uploads.length,3);
    const batches=requests.filter(r=>r.url==='/api/online/input');
    assert.equal(batches[1].body.matchId,'match-two');assert.equal(batches[1].body.sequence,0);assert.deepEqual(batches[1].body.frames[0].held,['RIGHT']);
    assert.equal(batches[2].body.sequence,1);assert.deepEqual(batches[2].body.frames[0].held,['X']);
    uploads[2].resolve(response({accepted:true}));await third;
  },{requestOverride:(url)=>{if(url==='/api/online/input'){const gate=deferred();uploads.push(gate);return gate.promise;}return response({available:true});}});
});

test('clearing or closing a match suppresses late failed HTTP requests and no longer sends buffered input',async()=>{
  const gate=deferred();
  await harness(async({client,callbacks,requests,errors})=>{
    await client.open();await client.setMatch(match,'a');client.send(packet(['LEFT']));const sending=callbacks[0]();
    client.clearMatch();client.send(packet(['Z']));await callbacks[0]();gate.reject(Error('late-failure'));await sending;
    assert.equal(errors.length,0);assert.equal(requests.filter(r=>r.url==='/api/online/input').length,1);
    client.close();client.send(packet(['X']));await callbacks[0]();assert.equal(requests.filter(r=>r.url==='/api/online/input').length,1);
  },{requestOverride:url=>url==='/api/online/input'?gate.promise:response({available:true})});
});

test('an old SSE source and delayed open response cannot deliver status or errors after close and reopen',async()=>{
  const firstStatus=deferred();let reads=0;
  await harness(async({client,sources,events,errors})=>{
    const firstOpen=client.open();assert.equal(sources.length,1);const first=sources[0];client.close();await client.open();
    assert.equal(sources.length,2);const count=events.length;
    first.emit('match',match);first.listeners.get('state')({data:'invalid JSON'});first.onerror();
    firstStatus.resolve(response({queued:true,stale:true}));await firstOpen;
    assert.equal(events.length,count);assert.equal(errors.length,0);
    const currentRoom={...match,id:'new',status:'starting'};
    sources[1].emit('state',roomState(currentRoom,1));assert.equal(events.length,count,'reopened stream cannot deliver an unbound battle state');
    await client.setMatch(currentRoom,'a');
    first.emit('state',roomState(currentRoom,1));assert.equal(events.length,count,'even a matching room cannot revive the old SSE generation');
    sources[1].emit('state',roomState(match,1));assert.equal(events.length,count,'old room cannot enter the new binding');
    sources[1].emit('state',roomState(currentRoom,1));assert.equal(events.length,count+1);
    assert.equal(events.at(-1).data.matchId,currentRoom.id);assert.equal(events.at(-1).data.ownership.actors.a.epoch,1);
  },{requestOverride:url=>url.endsWith('/status')&&++reads===1?firstStatus.promise:response({queued:false})});
});

test('delayed offers and queued ICE callbacks keep their old match context and never signal into the new match',async()=>{
  class DelayedOfferPeer extends FakePeer{
    createOffer(){this.offerGate=deferred();return this.offerGate.promise;}
  }
  FakePeer.instances=[];
  await harness(async({client,requests,errors})=>{
    await client.setMatch(match,'a');const oldPeers=FakePeer.instances.slice();const lateIce=oldPeers[0].onicecandidate;
    await client.setMatch({...match,id:'match-two'},'a');
    lateIce({candidate:{toJSON:()=>({candidate:'old'})}});
    for(const peer of oldPeers)peer.offerGate.resolve({type:'offer',sdp:'old'});await settle();
    assert.equal(requests.filter(r=>r.url==='/api/online/signal').length,0);assert.equal(errors.length,0);
    const newPeers=FakePeer.instances.slice(3);for(const peer of newPeers)peer.offerGate.resolve({type:'offer',sdp:'new'});await settle();
    const signals=requests.filter(r=>r.url==='/api/online/signal');assert.equal(signals.length,3);assert.ok(signals.every(r=>r.body.matchId==='match-two'));
  },{Peer:DelayedOfferPeer});
});

test('a delayed offer failure is ignored after its peer is retired',async()=>{
  class DelayedOfferPeer extends FakePeer{createOffer(){this.offerGate=deferred();return this.offerGate.promise;}}
  FakePeer.instances=[];
  await harness(async({client,errors})=>{
    await client.setMatch(match,'a');const oldPeers=FakePeer.instances.slice();client.clearMatch();
    for(const peer of oldPeers)peer.offerGate.reject(Error('offer-on-closed-peer'));await settle();assert.equal(errors.length,0);
  },{Peer:DelayedOfferPeer});
});

test('a delayed remote offer does not generate an answer after changing matches',async()=>{
  class DelayedRemotePeer extends FakePeer{
    setRemoteDescription(value){this.remoteGate=deferred();return this.remoteGate.promise.then(()=>{this.remoteDescription=value;});}
    async createAnswer(){this.answers=(this.answers??0)+1;return super.createAnswer();}
  }
  FakePeer.instances=[];
  await harness(async({client,sources,requests,errors})=>{
    await client.open();await client.setMatch(match,'d');const peer=FakePeer.instances[0];
    sources[0].emit('signal',{matchId:match.id,from:'a',type:'offer',payload:{type:'offer',sdp:'old'}});await settle();assert.ok(peer.remoteGate);
    await client.setMatch({...match,id:'match-two'},'d');peer.remoteGate.resolve();await settle();
    assert.equal(peer.answers??0,0);assert.equal(requests.filter(r=>r.url==='/api/online/signal').length,0);assert.equal(errors.length,0);
  },{Peer:DelayedRemotePeer});
});

test('old peer handlers cannot pollute the remote input map on a same-match reconnect',async()=>{
  FakePeer.instances=[];
  await harness(async({client,events})=>{
    await client.setMatch(match,'a');const peer=FakePeer.instances[0],oldMessage=peer.channel.onmessage,oldChannel=peer.ondatachannel;
    await client.setMatch({...match,players:[{id:'a',lastFrameSeq:500},...match.players.slice(1)]},'a');
    oldMessage({data:JSON.stringify({matchId:match.id,sequence:999,packet:packet(['Z'])})});
    let closed=false;oldChannel({channel:{close(){closed=true;}}});
    assert.equal(events.filter(e=>e.type==='peer-input').length,0);assert.deepEqual(client.remoteInput('b').held,[]);assert.equal(closed,true);
  },{Peer:FakePeer});
});

test('late readiness rejection from an old match is suppressed for the caller after a new match is installed',async()=>{
  const ready=deferred();
  await harness(async({client,errors})=>{
    await client.setMatch(match,'a');const pendingReady=client.ready(match.id);await client.setMatch({...match,id:'match-two'},'a');
    ready.reject(Error('old-match-not-active'));assert.equal(await pendingReady,null);assert.equal(errors.length,0);
    assert.equal(await client.ready(match.id),null);
  },{requestOverride:url=>url==='/api/online/ready'?ready.promise:response({available:true})});
});

test('successful owner upload immediately sends the newest pending state with one request in flight; failure retains paced retry and hit receipts',async()=>{
  const uploads=[];let now=0;
  await harness(async({client,callbacks,requests})=>{
    await client.open();await client.setMatch({...match,ownership:'local-owner-v1'},'a');
    const owner=frameSeq=>({protocol:'local-owner-v1',epoch:1,frameSeq,actor:{},effects:[],actions:[],hits:frameSeq===3?[{id:7,attackerId:'b',damage:10}]:frameSeq===6?[{id:8,attackerId:'b',damage:20}]:[]});
    client.send(packet([]),owner(3));void callbacks[0]();await settle();
    client.send(packet(['RIGHT']),owner(6));client.send(packet(['Z']),owner(9));
    assert.equal(uploads.length,1);
    uploads[0].resolve(response({accepted:true}));await settle();
    assert.equal(uploads.length,2);
    const second=requests.filter(row=>row.url==='/api/online/input')[1];
    assert.equal(second.body.owner.frameSeq,9);assert.deepEqual(second.body.frames[0].held,['Z']);assert.deepEqual(second.body.owner.hits.map(row=>row.id),[8]);
    client.send(packet(['LEFT']),owner(12));uploads[1].resolve({ok:false,status:503,json:async()=>({error:'retry'})});await settle();
    assert.equal(uploads.length,2);void callbacks[0]();await settle();assert.equal(uploads.length,2);
    now+=50;void callbacks[0]();await settle();assert.equal(uploads.length,3);
    const third=requests.filter(row=>row.url==='/api/online/input')[2];assert.equal(third.body.owner.frameSeq,12);assert.deepEqual(third.body.owner.hits.map(row=>row.id),[8]);
    assert.equal(client.performance().pendingFrames,0);assert.equal(client.performance().failedPosts,1);
  },{clock:()=>now,requestOverride:url=>{if(url!=='/api/online/input')return response({});const gate=deferred();uploads.push(gate);return gate.promise;}});
  for(const gate of uploads)gate.resolve(response({accepted:true}));await settle();
});

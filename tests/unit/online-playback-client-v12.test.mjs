import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {createPeerControl} from '../../apps/web/online-peer-control.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map=JSON.parse(readFileSync(new URL('../../artifacts/scene/sander-garpai-rock-pvp/collision.json',import.meta.url)));
const settle=async()=>{for(let n=0;n<40;n++)await Promise.resolve();};
const response=(value={},status=200)=>({ok:status>=200&&status<300,status,json:async()=>value});
const room=(version=1)=>({id:'playback-client-room',ownership:'local-owner-v1',seed:2016,mode:'1v1',
  continuousAuraVersion:2,ownerStatusVersion:1,combatPlaybackVersion:version,players:[{id:'a',team:0},{id:'b',team:1}]});
function report(playback=true){
  const sim=createSimulation({profile,actors:[{id:'a',team:0,position:[2022.98,2840,0],lineId:6},
    {id:'b',team:1,position:[1858.11,2840,0],lineId:6}],map,preset:{passives:[],guildPassives:[]}});
  const packet=encodeOwnedState(sim,'b',{epoch:1,frameSeq:3}),action=encodeCriticalAction(packet,{id:3,frameSeq:3});
  if(playback)action.playback={version:1,start:true,held:['Z']};packet.actions=[action];return packet;
}
async function harness(run,{version=1,request}={}){
  const saved={setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval},sources=[],connections=[],events=[],errors=[],requests=[];
  globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{};
  class Source{constructor(){this.listeners=new Map();sources.push(this);}addEventListener(type,fn){this.listeners.set(type,fn);}close(){}
    emit(type,value){this.listeners.get(type)?.({data:JSON.stringify(value)});}}
  class Peer{constructor(){this.channels=new Map();this.connectionState='connected';connections.push(this);}
    createDataChannel(label){const channel={label,readyState:'open',bufferedAmount:0,sent:[],send(text){this.sent.push(JSON.parse(text));}};this.channels.set(label,channel);return channel;}
    async createOffer(){return {type:'offer',sdp:'fixture'};}async setLocalDescription(value){this.localDescription={toJSON:()=>value};}
    close(){this.connectionState='closed';}}
  const client=createOnlineClient({EventSource:Source,RTCPeerConnection:Peer,WebSocket:null,rtcOptions:{enabled:false},clock:()=>0,
    fetch:async(url,options)=>{requests.push({url,body:options.body?JSON.parse(options.body):null});return request?request(url,options,requests):response({available:true});},
    onEvent:(type,data)=>{events.push({type,data});return true;},onError:error=>errors.push(error)});
  try{await client.open();await client.setMatch(room(version),'a');await settle();
    sources[0].emit('state',{matchId:room().id,snapshot:{actors:[{id:'a'},{id:'b'}]},ownership:{actors:{a:{epoch:1,frameSeq:0},b:{epoch:1,frameSeq:0}}}});
    await run({client,sources,connections,events,errors,requests});
  }finally{client.close();globalThis.setInterval=saved.setInterval;globalThis.clearInterval=saved.clearInterval;}
}
test('queue requests v12 first and only explicit400 shape rejection falls back to status/aura v11',async()=>{
  await harness(async({client,requests})=>{await client.join('2v2');const bodies=requests.filter(row=>row.url==='/api/online/queue').map(row=>row.body);
    assert.deepEqual(bodies,[{mode:'2v2',continuousAuraVersion:2,ownerStatusVersion:1,combatPlaybackVersion:1},
      {mode:'2v2',continuousAuraVersion:2,ownerStatusVersion:1}]);},
  {request:(url,options)=>url==='/api/online/queue'&&JSON.parse(options.body).combatPlaybackVersion===1?
    response({error:'invalid-queue-request'},400):response({ok:true})});
});
test('ordinary server failure cannot silently select older collision semantics',async()=>{
  await harness(async({client,requests})=>{await assert.rejects(client.join('2v2'),error=>error.status===503);
    assert.equal(requests.filter(row=>row.url==='/api/online/queue').length,1);},
  {request:url=>url==='/api/online/queue'?response({error:'busy'},503):response({ok:true})});
});
test('same-room metadata omissions retain the frozen cap and explicit downgrade rejects without reconnecting',async()=>{
  await harness(async({client,connections})=>{const metadata=room();delete metadata.combatPlaybackVersion;delete metadata.ownerStatusVersion;delete metadata.continuousAuraVersion;
    await client.refreshMatch(metadata,'a');assert.equal(client.performance().combatPlayback.version,1);assert.equal(connections.length,1);
    await assert.rejects(client.refreshMatch(room(0),'a'),/room-network-capability-changed/);
    assert.equal(client.performance().combatPlayback.version,1);assert.equal(connections[0].connectionState,'connected');
    await client.setMatch({...room(0),id:'different-room'},'a');assert.equal(client.performance().combatPlayback.version,0);assert.equal(connections.length,2);
  });
});
for(const version of [0,1])test(`RTC pose and reliable control reject wrong playback mode before owner admission/ACK (cap${version})`,async()=>{
  await harness(async({client,connections,events})=>{const peer=connections[0],bad=report(version===0),input=peer.channels.get('input'),control=peer.channels.get('control');
    const before=events.length;input.onmessage({data:JSON.stringify({matchId:room().id,sequence:3,packet:{held:[]},owner:bad})});await settle();
    assert.equal(events.slice(before).filter(event=>['owner-actions','peer-owned-state'].includes(event.type)).length,0);
    control.onmessage({data:JSON.stringify({v:1,matchId:room().id,type:'actions',sequence:1,report:bad})});await settle();
    assert.equal(control.sent.filter(packet=>packet.type==='ack').length,0);assert.equal(client.performance().peerControls.b.admittedActions,0);
    // A fresh stream still accepts a canonical correctly marked report; pose
    // admission must not inherit a receipt from the rejected control packet.
    const good=report(version===1);input.onmessage({data:JSON.stringify({matchId:room().id,sequence:3,packet:{held:[]},owner:good})});await settle();
    assert.ok(events.slice(before).some(event=>event.type==='owner-actions'));assert.ok(events.slice(before).some(event=>event.type==='peer-owned-state'));
  },{version});
});

test('queued playback actions retain reaction intents after newer poses and publish the reliable envelope body too',async()=>{
 await harness(async({client,connections,events})=>{
   const control=connections[0].channels.get('control'),accepted=[];
   const input={held:[],pressed:[],released:[]},first=report(),second=report();
   first.actor.hitStop=.12;first.actor.vy=730;
   second.frameSeq=6;second.actions[0].id=6;second.actions[0].frameSeq=6;second.actor.hitStop=0;second.actor.vy=-60;
   for(const value of [first,second])Object.assign(value.actions[0].actor,{hitStop:value.actor.hitStop,vy:value.actor.vy});
   client.send(input,first);client.send(input,second);await settle();
   const receiver=createPeerControl({matchId:room().id,reliableTransport:true,controlDelta:false,
     apply:value=>{accepted.push(value);return true;},send:text=>{control.onmessage({data:text});return true;}});
   let cursor=0;
   for(let round=0;round<8;round++){while(cursor<control.sent.length)receiver.receiveText(JSON.stringify(control.sent[cursor++]));await settle();receiver.pump();}
   assert.deepEqual(accepted.flatMap(value=>value.actions).map(value=>[value.frameSeq,value.actor.hitStop,value.actor.vy]),[[3,.12,730],[6,0,-60]]);
   // Incoming reliable traffic already has this body, even if its ordinary
   // pose datagram is missing. The client must not throw it away.
   const before=events.length,remote=report();remote.actor.hitStop=.1;
   control.onmessage({data:JSON.stringify({v:1,matchId:room().id,type:'actions',sequence:1,report:remote})});await settle();
   const delivered=events.slice(before).find(event=>event.type==='peer-owned-state');
   assert.equal(delivered?.data.transport,'peer-control');assert.equal(delivered?.data.report.actor.hitStop,.1);
 });
});

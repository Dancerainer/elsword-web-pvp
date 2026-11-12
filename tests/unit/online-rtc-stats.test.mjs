import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineClient} from '../../apps/web/online-client.mjs';

const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const stats=({local='host',remote='srflx',rtt=.05,selected=true}={})=>new Map([
 ['transport',{id:'transport',type:'transport',...(selected?{selectedCandidatePairId:'pair'}:{})}],
 ['pair',{id:'pair',type:'candidate-pair',state:'succeeded',nominated:true,localCandidateId:'local',remoteCandidateId:'remote',currentRoundTripTime:rtt}],
 ['local',{id:'local',type:'local-candidate',candidateType:local,protocol:'udp',address:'private-local-address'}],
 ['remote',{id:'remote',type:'remote-candidate',candidateType:remote,address:'private-remote-address'}],
]);
async function fixture(t){
 const peers=[],errors=[],tasks=new Map();let now=0,serial=0;
 class Peer{
  constructor(){peers.push(this);this.connectionState='connected';this.channel={readyState:'open',bufferedAmount:0,send(){}};this.stats=stats();this.calls=0;}
  createDataChannel(){return this.channel;}
  async createOffer(){return {type:'offer',sdp:'fixture'};}
  async setLocalDescription(value){this.localDescription={toJSON:()=>value};}
  getStats(){this.calls++;return Promise.resolve(this.stats);}
  close(){this.connectionState='closed';}
 }
 const timers={setTimeout(callback,ms){const id=++serial;tasks.set(id,{callback,at:now+ms});return id;},clearTimeout(id){tasks.delete(id);}};
 const client=createOnlineClient({RTCPeerConnection:Peer,WebSocket:null,timers,clock:()=>now,
  fetch:async()=>({ok:true,json:async()=>({accepted:true})}),onError:error=>errors.push(error)});
 const match=id=>({id,players:[{id:'me'},{id:'other'}]});await client.setMatch(match('one'),'me');t.after(()=>client.close());
 return {client,peers,errors,tasks,match,async advance(ms){now+=ms;for(const [id,row]of tasks)if(row.at<=now){tasks.delete(id);row.callback();}await settle();}};
}

test('an open channel remains unknown until a selected candidate pair confirms direct routing and RTT',async t=>{
 const f=await fixture(t);let row=f.client.connectivity()[0];assert.equal(row.dataChannelOpen,true);assert.equal(row.direct,false);assert.equal(row.route,'unknown');
 await settle();row=f.client.connectivity()[0];assert.equal(row.route,'direct');assert.equal(row.direct,true);assert.equal(row.roundTripTimeMs,50);
 assert.equal(row.localCandidateType,'host');assert.equal(row.remoteCandidateType,'srflx');assert.equal(row.protocol,'udp');assert.equal(row.statsStatus,'ready');
 assert.equal(JSON.stringify(row).includes('address'),false);assert.equal(f.peers[0].calls,1);
 for(let i=0;i<60;i++)f.client.connectivity();await settle();assert.equal(f.peers[0].calls,1,'render diagnostics cannot poll getStats at render frequency');
});

test('either selected relay candidate classifies TURN routing without claiming a direct peer',async t=>{
 for(const pair of [{local:'relay',remote:'host'},{local:'host',remote:'relay'}]){
  const f=await fixture(t);f.peers[0].stats=stats(pair);f.client.connectivity();await settle();const row=f.client.connectivity()[0];
  assert.equal(row.route,'relay');assert.equal(row.direct,false);assert.equal(row.dataChannelOpen,true);assert.equal(row.roundTripTimeMs,50);
 }
});

test('nominated-only or incomplete candidates are not sufficient evidence for direct routing',async t=>{
 const f=await fixture(t);f.peers[0].stats=stats({selected:false});f.client.connectivity();await settle();assert.equal(f.client.connectivity()[0].route,'unknown');
 await f.advance(1000);f.peers[0].stats=stats({remote:'unrecognized',rtt:NaN});f.client.connectivity();await settle();const row=f.client.connectivity()[0];
 assert.equal(row.route,'unknown');assert.equal(row.direct,false);assert.equal(row.roundTripTimeMs,null);
});

test('legacy explicit selected-pair statistics remain usable when transport selection is absent',async t=>{
 const f=await fixture(t),value=stats({selected:false,remote:'prflx',rtt:0});value.get('pair').selected=true;f.peers[0].stats=value;
 f.client.connectivity();await settle();const row=f.client.connectivity()[0];assert.equal(row.route,'direct');assert.equal(row.roundTripTimeMs,0);
});

test('a hung statistics call times out without blocking input or creating further in-flight work',async t=>{
 const f=await fixture(t),gate=deferred();f.peers[0].stats=gate.promise;f.client.connectivity();await settle();await f.advance(1000);
 assert.equal(f.client.connectivity()[0].statsStatus,'timeout');assert.equal(f.client.send({held:['Z'],pressed:['Z'],released:[]}),1);
 await f.advance(10000);for(let i=0;i<50;i++)f.client.connectivity();await settle();assert.equal(f.peers[0].calls,1);assert.deepEqual(f.errors,[]);
 gate.resolve(stats());await settle();const row=f.client.connectivity()[0];assert.equal(row.route,'unknown','timed-out data is not promoted to current route evidence');
});

test('statistics and timer callbacks from a retired match cannot populate its replacement peer',async t=>{
 const f=await fixture(t),gate=deferred();f.peers[0].stats=gate.promise;f.client.connectivity();await settle();assert.equal(f.tasks.size,1);
 await f.client.setMatch(f.match('two'),'me');assert.equal(f.tasks.size,0);f.peers[1].stats=stats({local:'relay'});
 f.client.connectivity();await settle();gate.resolve(stats());await settle();const row=f.client.connectivity()[0];
 assert.equal(row.route,'relay');assert.equal(row.direct,false);assert.equal(row.statsStatus,'ready');assert.deepEqual(f.errors,[]);
});

test('stale route evidence expires and a rejected stats read stays diagnostic only',async t=>{
 const f=await fixture(t);f.client.connectivity();await settle();assert.equal(f.client.connectivity()[0].direct,true);
 f.peers[0].getStats=function(){this.calls++;return Promise.reject(Error('stats unavailable'));};await f.advance(5001);
 const stale=f.client.connectivity()[0];assert.equal(stale.route,'unknown');assert.equal(stale.roundTripTimeMs,null);await settle();
 assert.equal(f.client.connectivity()[0].statsStatus,'failed');assert.deepEqual(f.errors,[]);assert.equal(f.client.send({held:[],pressed:[],released:[]}),1);
 f.client.clearMatch();assert.deepEqual(f.client.connectivity(),[]);assert.equal(f.tasks.size,0);
});

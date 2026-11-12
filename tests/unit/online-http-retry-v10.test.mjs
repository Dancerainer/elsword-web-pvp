/** HTTP owner-inbox retries with controlled transport failures and clocks.
 * Production RF reports are used; these checks do not measure a WAN route. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'http-retry-v10',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const packet={held:[],pressed:[],released:[]};
const response=value=>({ok:true,status:200,json:async()=>value});
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

async function fixture(t,{queueReply}={}){
  const simulation=createSimulation({profile,map,networkOwnerId:'a',seed:2016,
    actors:[{id:'a',professionId:'RF',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
      {id:'b',professionId:'RF',team:1,position:[1000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  const uploads=[],errors=[],requests=[],intervals=[],timeouts=new Map();let now=0,timerId=0,queueCount=0;
  t.mock.method(globalThis,'setInterval',callback=>{intervals.push(callback);return intervals.length;});
  t.mock.method(globalThis,'clearInterval',()=>{});
  class Source{addEventListener(){}close(){}}
  const client=createOnlineClient({EventSource:Source,WebSocket:null,RTCPeerConnection:null,
    clock:()=>now,onError:error=>errors.push(error),
    timers:{setTimeout(fn,ms){const id=++timerId;timeouts.set(id,{fn,ms});return id;},clearTimeout(id){timeouts.delete(id);}},
    fetch:async(url,options)=>{
      requests.push({url,body:options.body?JSON.parse(options.body):null});
      if(url==='/api/online/queue'&&queueReply)return queueReply(++queueCount);
      if(url!=='/api/online/input')return response({accepted:true});
      const gate=deferred();uploads.push({...gate,body:JSON.parse(options.body),signal:options.signal});return gate.promise;
    }});
  t.after(async()=>{client.close();for(const upload of uploads)upload.resolve(response({accepted:false}));await settle();});
  const match={id:'http-retry-v10',ownership:'local-owner-v1',players:[{id:'a'},{id:'b'}]};
  await client.open();await client.setMatch(match,'a');await settle();
  return {client,uploads,errors,requests,match,
    report(frameSeq,{epoch=1,actions=[],hits=[]}={}){
      const report=encodeOwnedState(simulation,'a',{epoch,frameSeq});
      report.actions=actions.map(id=>encodeCriticalAction(report,{id}));
      report.hits=hits.map(id=>({id,attackerId:'b',damage:10}));
      return validateOwnedState(report);
    },
    async send(report){client.send(packet,report);await settle();},
    async flush(ms=0){now+=ms;void intervals[0]();await settle();},
  };
}

for(const failure of ['network','server','not-accepted'])test(`a final ${failure} HTTP failure retries unconfirmed actions and hits without a new source report`,async t=>{
  const f=await fixture(t);await f.send(f.report(3,{actions:[3],hits:[7]}));
  const first=f.uploads[0];assert.equal(f.uploads.length,1);assert.equal(f.client.performance().pendingFrames,0);
  if(failure==='network')first.reject(Error('controlled network failure'));
  else if(failure==='server')first.resolve({ok:false,status:503,json:async()=>({error:'controlled unavailable'})});
  else first.resolve(response({accepted:false}));
  await settle();assert.equal(f.client.performance().pendingFrames,1);
  await f.flush(49);assert.equal(f.uploads.length,1,'retry preserves the existing 50 ms failure pace');
  await f.flush(1);assert.equal(f.uploads.length,2);
  const second=f.uploads[1];assert.ok(second.body.sequence>first.body.sequence);
  assert.deepEqual(second.body.frames,first.body.frames);
  assert.deepEqual(second.body.owner.actions,first.body.owner.actions);
  assert.deepEqual(second.body.owner.hits,first.body.owner.hits);
  await f.flush(100);assert.equal(f.uploads.length,2,'a retry retains one request in flight');
  second.resolve(response({accepted:true,consumedActionIds:[3],consumedHitIds:[7]}));await settle();
  assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().pendingHits,0);
  await f.flush(100);assert.equal(f.uploads.length,2,'confirmed history does not create another retry');
});

test('a failed ordinary pose retries its unconfirmed checkpoint once at a time, then stops after success',async t=>{
  const f=await fixture(t);await f.send(f.report(3));f.uploads[0].reject(Error('controlled pose failure'));await settle();
  assert.equal(f.client.performance().pendingFrames,1,'the final unconfirmed pose survives the actual HTTP rejection');
  await f.flush(49);assert.equal(f.uploads.length,1);
  await f.flush(1);assert.equal(f.uploads.length,2);
  assert.deepEqual(f.uploads[1].body.frames,f.uploads[0].body.frames);
  assert.deepEqual(f.uploads[1].body.owner,f.uploads[0].body.owner);
  assert.ok(f.uploads[1].body.sequence>f.uploads[0].body.sequence);
  await f.flush(500);assert.equal(f.uploads.length,2,'only one retry may remain in flight');
  f.uploads[1].resolve(response({accepted:true}));await settle();
  assert.equal(f.client.performance().pendingFrames,0);
  await f.flush(500);assert.equal(f.uploads.length,2,'successful delivery does not start periodic pose retries');
});

test('a failed older HTTP pose retries the newest pending input without rewinding its source clock',async t=>{
  const f=await fixture(t);await f.send(f.report(3,{actions:[3],hits:[7]}));
  await f.send(f.report(6));f.uploads[0].reject(Error('controlled older pose failure'));await settle();
  assert.equal(f.client.performance().pendingFrames,1);await f.flush(50);
  const retry=f.uploads[1].body;assert.equal(retry.owner.frameSeq,6);assert.equal(retry.frames[0].frameSeq,6);
  assert.deepEqual(retry.owner.actions.map(action=>action.id),[3]);assert.deepEqual(retry.owner.hits.map(hit=>hit.id),[7]);
});

test('a failed previous-life HTTP request cannot replace the new life input or restore its old events',async t=>{
  const f=await fixture(t);await f.send(f.report(3,{actions:[3],hits:[7]}));
  await f.send(f.report(1,{epoch:2,actions:[1],hits:[8]}));
  f.uploads[0].reject(Error('controlled previous-life failure'));await settle();await f.flush(50);
  const retry=f.uploads[1].body;assert.equal(retry.owner.epoch,2);
  assert.deepEqual(retry.owner.actions.map(action=>action.id),[1]);assert.deepEqual(retry.owner.hits.map(hit=>hit.id),[8]);
  assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().pendingHits,1);
});

for(const retirement of ['clear','new-room','close'])test(`late failed HTTP work after ${retirement} cannot restore a retry trigger`,async t=>{
  const f=await fixture(t);await f.send(f.report(3,{actions:[3],hits:[7]}));
  if(retirement==='clear')f.client.clearMatch();
  else if(retirement==='new-room')await f.client.setMatch({...f.match,id:'http-retry-next-room'},'a');
  else f.client.close();
  assert.equal(f.uploads[0].signal.aborted,true);f.uploads[0].reject(Error('controlled retired upload failure'));await settle();
  await f.flush(500);assert.equal(f.uploads.length,1);assert.equal(f.client.performance().pendingFrames,0);
  assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().pendingHits,0);
  assert.deepEqual(f.errors,[]);
});

test('joining explicitly advertises continuous aura support while absent or unknown room versions retain the zero-version binding',async t=>{
  const f=await fixture(t);await f.client.join('2v2');
  assert.deepEqual(f.requests.filter(row=>row.url==='/api/online/queue').map(row=>row.body),[{mode:'2v2',continuousAuraVersion:2,ownerStatusVersion:1,combatPlaybackVersion:1}]);
  await f.send(f.report(3,{actions:[3]}));const upload=f.uploads[0];
  await f.client.refreshMatch({...f.match,continuousAuraVersion:0},'a');assert.equal(upload.signal.aborted,false);
  await f.client.refreshMatch({...f.match,continuousAuraVersion:3},'a');assert.equal(upload.signal.aborted,false,'unknown room capability does not enable the feature');
  await f.client.refreshMatch({...f.match,continuousAuraVersion:1},'a');assert.equal(upload.signal.aborted,true,'changing the legacy exact capability retires the former context');
  upload.reject(Error('controlled old capability request'));await settle();assert.deepEqual(f.errors,[]);
});

test('only the exact legacy request-shape rejection permits the v10 capability retry',async t=>{
  const f=await fixture(t,{queueReply:index=>index===1?{ok:false,status:400,json:async()=>({error:'invalid-queue-request'})}:response({accepted:true})});
  assert.deepEqual(await f.client.join('2v2'),{accepted:true});
  assert.deepEqual(f.requests.filter(row=>row.url==='/api/online/queue').map(row=>row.body),[{mode:'2v2',continuousAuraVersion:2,ownerStatusVersion:1,combatPlaybackVersion:1},{mode:'2v2',continuousAuraVersion:2,ownerStatusVersion:1}]);
});

test('a coordinator accepting only mode receives the capability-free request after both exact shape rejections',async t=>{
  const f=await fixture(t,{queueReply:index=>index<=3?{ok:false,status:400,json:async()=>({error:'invalid-queue-request'})}:response({accepted:true})});
  assert.deepEqual(await f.client.join('2v2'),{accepted:true});
  assert.deepEqual(f.requests.filter(row=>row.url==='/api/online/queue').map(row=>row.body),[
    {mode:'2v2',continuousAuraVersion:2,ownerStatusVersion:1,combatPlaybackVersion:1},{mode:'2v2',continuousAuraVersion:2,ownerStatusVersion:1},{mode:'2v2',continuousAuraVersion:1},{mode:'2v2'}]);
});

for(const [status,code]of [[400,'invalid-mode'],[403,'queue-denied'],[503,'invalid-queue-request']])test(`queue rejection ${status}/${code} does not retry with a legacy request`,async t=>{
  const f=await fixture(t,{queueReply:()=>({ok:false,status,json:async()=>({error:code})})});
  await assert.rejects(f.client.join('2v2'),error=>error.status===status&&error.code===code);
  assert.equal(f.requests.filter(row=>row.url==='/api/online/queue').length,1);
});

test('a retired queue request cannot initiate the legacy compatibility retry after a late shape rejection',async t=>{
  const gate=deferred(),f=await fixture(t,{queueReply:()=>gate.promise});
  const joining=f.client.join('2v2');await settle();f.client.clearMatch();
  gate.resolve({ok:false,status:400,json:async()=>({error:'invalid-queue-request'})});assert.equal(await joining,null);
  assert.equal(f.requests.filter(row=>row.url==='/api/online/queue').length,1);assert.deepEqual(f.errors,[]);
});

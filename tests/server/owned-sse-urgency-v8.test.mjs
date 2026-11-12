// Exercise authenticated HTTP uploads -> actual gzip SSE in both server paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {createRoomWorkerFactory} from '../../apps/server/room-worker-factory.mjs';
import {createBattleDriverFactory} from './fixtures/owned-controller-relay-driver-v7.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import profile from '../../packages/combat-core/rf-profile.json' with {type:'json'};
const root=fileURLToPath(new URL('../../',import.meta.url));
async function until(check){for(let i=0;i<400&&!check();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(check(),'SSE event did not arrive');}

for(const worker of [false,true])test(`${worker?'child-prepared':'in-process'} critical actions and controller poses expedite real gzip SSE while steady movement remains paced`,async t=>{
  const accountRoot=await mkdtemp(path.join(tmpdir(),'rf-sse-v8-'));
  const credentials=['source-v8','receiver-v8'].map(username=>({username,password:'synthetic-'+username,role:'player'}));
  const directFactory=await createBattleDriverFactory();
  const metadata=Object.assign(directFactory,{ownership:'local-owner-v1',professions:{RF:true},versions:{fixture:true}});
  const factory=worker?await createRoomWorkerFactory({root,assetRoot:root,metadataFactory:metadata,
    workerEntry:fileURLToPath(new URL('./fixtures/owned-controller-relay-entry-v7.mjs',import.meta.url))}):metadata;
  let now=10000,relayNow=0;const scheduled=new Set();
  const ctx=await createDevServer({root,accountRoot,credentials:credentials[0],additionalCredentials:[credentials[1]],driverFactory:factory,
    now:()=>now,ownedRelayClock:()=>relayNow,ownedRelayTimers:{setTimeout(callback,delay){const timer={callback,due:relayNow+delay,unref(){}};scheduled.add(timer);return timer;},clearTimeout(timer){scheduled.delete(timer);}}});
  await new Promise(resolve=>ctx.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+ctx.server.address().port,peers=[];
  t.after(async()=>{for(const peer of peers)peer.controller.abort();ctx.closeStreams();ctx.online.close();factory.close?.();ctx.server.closeAllConnections();
    await new Promise(resolve=>ctx.server.close(resolve));
    assert.ok(path.resolve(accountRoot).startsWith(path.resolve(tmpdir())+path.sep));await rm(accountRoot,{recursive:true,force:true});});
  for(const credential of credentials){
    let cookie;const peer={controller:new AbortController(),events:[],errors:[]};peers.push(peer);
    peer.request=async(url,body)=>{
      const response=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;
    };
    assert.equal((await peer.request('/api/login',credential)).status,200);
    const response=await fetch(base+'/api/online/events?ownedDelta=3',{headers:{Cookie:cookie,'Accept-Encoding':'gzip'},signal:peer.controller.signal});
    assert.equal(response.status,200);assert.equal(response.headers.get('content-encoding'),'gzip');
    const reader=response.body.getReader(),decoder=new TextDecoder();
    peer.read=(async()=>{let text='';try{for(;;){const part=await reader.read();if(part.done)break;text+=decoder.decode(part.value,{stream:true});
      let index;while((index=text.indexOf('\n\n'))>=0){const block=text.slice(0,index);text=text.slice(index+2);
        const type=block.match(/^event: (.*)$/m)?.[1],data=block.match(/^data: (.*)$/m)?.[1];if(type&&data)peer.events.push({type,data:JSON.parse(data)});}
    }}catch(error){if(!peer.controller.signal.aborted)peer.errors.push(String(error));}})();
  }
  await until(()=>peers.every(peer=>peer.events.some(row=>row.type==='status')));
  for(const peer of peers)assert.equal((await peer.request('/api/online/queue',{mode:'1v1'})).status,200);
  now+=6000;await ctx.online.tick();const match=ctx.online.status(credentials[0].username).match;assert.ok(match);
  for(const peer of peers)assert.equal((await peer.request('/api/online/ready',{matchId:match.id})).status,200);
  await until(()=>peers.every(peer=>peer.events.some(row=>row.type==='state'&&row.data.pvp?.phase==='fight')));
  const urgentBeforeSignal=ctx.transportDiagnostics().streams.reduce((sum,row)=>sum+row.urgentEvents,0);
  for(const [type,payload]of [['offer',{type:'offer',sdp:'synthetic-sdp-v51'}],['candidate',{candidate:'synthetic-candidate-v51'}]]){
    assert.equal((await peers[0].request('/api/online/signal',{matchId:match.id,to:credentials[1].username,type,payload})).status,200);
  }
  await until(()=>peers[1].events.filter(row=>row.type==='signal').length===2);
  assert.deepEqual(peers[1].events.filter(row=>row.type==='signal').map(row=>row.data.type),['offer','candidate']);
  assert.ok(ctx.transportDiagnostics().streams.reduce((sum,row)=>sum+row.urgentEvents,0)>=urgentBeforeSignal+2,
    'offer and candidate must use the existing immediate FIFO flush, without waiting for movement batching');
  const simulation={profile,state:structuredClone(ctx.online.matchSnapshot(credentials[0].username).snapshot)};
  const codec=createOwnedRelayDelta(),receiver=peers[1];let cursor=0,sequence=0;
  const observed=[];
  function consume(){for(const row of receiver.events.slice(cursor)){if(row.type==='owned-state'){const owner=codec.decode(row.data);if(owner)observed.push(owner);}}cursor=receiver.events.length;}
  async function send(frameSeq,patch={},action=false){const report=encodeOwnedState(simulation,credentials[0].username,{epoch:1,frameSeq});Object.assign(report.actor,patch);
    if(action)report.actions=[encodeCriticalAction(report,{id:frameSeq})];
    const response=await peers[0].request('/api/online/input',{matchId:match.id,sequence:sequence++,frames:[{frameSeq,held:[],pressed:[],released:[]}],owner:report});
    assert.equal(response.status,200);assert.equal((await response.json()).accepted,true);return report;}
  const initial=await send(3);await until(()=>{consume();return observed.some(row=>row.frameSeq===3);});
  const before=ctx.transportDiagnostics().streams.map(row=>row.urgentEvents).reduce((a,b)=>a+b,0);
  relayNow=10;await send(4,{x:10});assert.equal(scheduled.size,1);
  relayNow=17;await send(5,{x:17,facing:-initial.actor.facing},true);
  await until(()=>{consume();return observed.some(row=>row.frameSeq===5);});
  const actionIndex=receiver.events.findIndex(row=>row.type==='input'&&row.data.actions?.length),
    poseIndex=receiver.events.findIndex(row=>row.type==='owned-state'&&!row.data.baselineOnly&&row.data.frameSeq===5);
  assert.ok(actionIndex>=0&&actionIndex<poseIndex,'canonical action precedes its replaceable pose on the actual stream');
  assert.equal(codec.decodeActions(receiver.events[actionIndex].data).actions[0].id,5);
  const streams=ctx.transportDiagnostics().streams;
  assert.ok(streams.reduce((sum,row)=>sum+row.urgentEvents,0)>=before+2,'the production emitter expedited action and controller pose');
  assert.ok(streams.some(row=>row.expeditedBatches>0));assert.equal(scheduled.size,0);
  relayNow=30;await send(6,{x:30,facing:-initial.actor.facing});assert.equal([...scheduled][0].due,67);
  relayNow=67;for(const timer of [...scheduled])if(timer.due<=relayNow&&scheduled.delete(timer))timer.callback();
  await until(()=>{consume();return observed.some(row=>row.frameSeq===6);});
  assert.ok(peers.every(peer=>peer.errors.length===0));
  t.diagnostic(JSON.stringify({path:worker?'child-prepared':'in-process',actionIndex,poseIndex,ordinaryNextDueMs:67,
    streams:streams.map(({urgentEvents,expeditedBatches,flushes,inputBytes,outputBytes})=>({urgentEvents,expeditedBatches,flushes,inputBytes,outputBytes}))}));
});

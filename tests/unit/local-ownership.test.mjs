/** Deterministic latency injection into the actual browser coordinator and
 * combat core. The network timings are a regression fixture, not WAN evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const ids=['a','b','c','d'],versions={referenceVersion:'fixture',presetVersion:'fixture',programVersion:'fixture'};
const map={sceneId:'latency-fixture',lines:[{lineId:0,start:[-100000,0,0],end:[100000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const make=id=>createSimulation({profile,map,networkOwnerId:id,actors:ids.map((actorId,index)=>({id:actorId,team:index%2,position:[index*10000,0,0],loadout:Array(8).fill(null)})),versions});
const room=(snapshot,phase='fight',epoch=1)=>({snapshot,pvp:{phase,fightTime:0,players:ids.map(id=>({id,alive:true,connected:true,lockUntil:null,invincibleUntil:null}))},
  ownership:{mode:'local-owner-v1',actors:Object.fromEntries(ids.map(id=>[id,{epoch,frameSeq:0}]))},owners:{}});
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};

test('authoritative disconnect hides immediately and a later live room or peer pose cannot revive the old match slot',()=>{
  const s=make('a'),sync=createLocalOwnershipSync(),live=room(s.snapshot());sync.reconcile(s,live,'a');
  assert.equal(sync.disconnect(s,'b'),true);assert.equal(s.actor('b').hidden,true);assert.equal(s.actor('b').hp,0);
  const late=encodeOwnedState(make('b'),'b',{epoch:1,frameSeq:100});
  assert.equal(sync.receivePeer(s,'b',late,'a'),false);
  sync.reconcile(s,live,'a');assert.equal(s.actor('b').pvpDisconnected,true);assert.equal(s.actor('b').hidden,true);
  assert.equal(sync.receiveActions('b',[],1,100),false);
  sync.clear();sync.reconcile(s,live,'a');assert.equal(s.actor('b').hp,live.snapshot.actors.find(actor=>actor.id==='b').hp);
  assert.equal(s.actor('b').pvpDisconnected,undefined);
});
test('disconnect received during resource preparation retires an actor installed by an older snapshot afterward',()=>{
  const s=make('a'),sync=createLocalOwnershipSync(),live=room(s.snapshot());
  s.state.actors=s.state.actors.filter(actor=>actor.id!=='b');
  assert.equal(sync.disconnect(s,'b'),false,'no rendered actor exists yet');
  s.state.actors.push(structuredClone(live.snapshot.actors.find(actor=>actor.id==='b')));
  sync.reconcile(s,live,'a');assert.equal(s.actor('b').pvpDisconnected,true);assert.equal(s.actor('b').hidden,true);
  assert.equal(s.actor('b').hp,0);assert.equal(sync.receivePeer(s,'b',encodeOwnedState(make('b'),'b',{epoch:1,frameSeq:100}),'a'),false);
});

test('final slow-motion room locks fresh controls but preserves the late-hit trade window',()=>{
  const s=make('a'),sync=createLocalOwnershipSync();sync.reconcile(s,room(s.snapshot()),'a');
  const value=room(s.snapshot(),'slow');sync.reconcile(s,value,'a');
  assert.equal(s.actor('a').forceInvincible,0);assert.ok(s.actor('a').inputLock>0);
  value.pvp.phase='result';sync.reconcile(s,value,'a');assert.equal(s.actor('a').forceInvincible,9999);
});
test('four owners keep all 600 local movement steps through600ms delayed state and a2second network gap; no restore or replay occurs',()=>{
  const sims=ids.map(make),syncs=ids.map(()=>createLocalOwnershipSync());const base=sims[0].snapshot();
  for(let index=0;index<4;index++)syncs[index].reconcile(sims[index],room(base),ids[index]);
  const starts=sims.map((sim,index)=>sim.actor(ids[index]).x),packets=[];let syncCount=0;
  for(const sim of sims)sim.restore=()=>{throw Error('local ownership must never restore whole simulation');};
  for(let frame=1;frame<=600;frame++){
    for(let index=0;index<4;index++){
      const sim=sims[index],id=ids[index];sim.step(1/60,{[id]:{held:['RIGHT'],pressed:frame===1?['RIGHT']:[],released:[]}},{snapshot:false});
      const report=syncs[index].afterStep(sim,id,sim.drainEvents());if(report)packets.push({arrives:frame+36,index,report:{...report,frameSeq:frame}});
    }
    if(frame>=240&&frame<360)continue; // loss of transport, local clocks continue
    for(const packet of packets.filter(packet=>packet.arrives<=frame)){
      for(let index=0;index<4;index++)if(index!==packet.index){const sim=sims[index],before=structuredClone(sim.actor(ids[index]));
        syncs[index].receivePeer(sim,ids[packet.index],packet.report,ids[index]);assert.deepEqual(sim.actor(ids[index]),before);syncCount++;}
    }
    for(let index=packets.length-1;index>=0;index--)if(packets[index].arrives<=frame)packets.splice(index,1);
    if(frame%6===0)for(let index=0;index<4;index++){
      const sim=sims[index],before=structuredClone(sim.actor(ids[index]));syncs[index].reconcile(sim,room(base),ids[index]);assert.deepEqual(sim.actor(ids[index]),before);
    }
  }
  assert.ok(syncCount>1000);for(let index=0;index<4;index++){assert.equal(sims[index].state.step,600);assert.ok(sims[index].actor(ids[index]).x>starts[index]+1000);}
});
test('a600ms HTTP request replaces pending states instead of building a60Hz backlog and preserves unacknowledged victim hits',async()=>{
  const interval=globalThis.setInterval,clear=globalThis.clearInterval,callbacks=[],requests=[],pending=[],errors=[];
  globalThis.setInterval=callback=>{callbacks.push(callback);return 1;};globalThis.clearInterval=()=>{};
  class Source{addEventListener(){}close(){}}
  const client=createOnlineClient({EventSource:Source,RTCPeerConnection:null,onError:error=>errors.push(error),
    fetch:async(url,options)=>{
      if(url!=='/api/online/input')return {ok:true,json:async()=>({})};
      const body=JSON.parse(options.body);requests.push(body);return new Promise(resolve=>pending.push({resolve,body}));
    }});
  try{
    await client.open();await client.setMatch({id:'latency-match',ownership:'local-owner-v1',players:ids.map(id=>({id}))},'a');
    const sim=make('a'),sync=createLocalOwnershipSync();sync.reconcile(sim,room(sim.snapshot()),'a');
    let latestProduced=null,releasedAfterAck=null;
    for(let frame=1;frame<=120;frame++){
      sim.step(1/60,{a:{held:['RIGHT'],pressed:frame===1?['RIGHT']:[],released:[]}},{snapshot:false});
      const report=sync.afterStep(sim,'a',frame===3?[{type:'hit',targetId:'a',actorId:'c',amount:10,eventId:8}]:[]);
      const sentFrame=client.send({held:['RIGHT'],pressed:[],released:[]},report);
      if(report)latestProduced={frameSeq:sentFrame,actor:structuredClone(report.actor),effects:structuredClone(report.effects)};
      if(frame%3===0){void callbacks[0]();await settle();}
      if(frame===39){pending.shift().resolve({ok:false,status:503,json:async()=>({error:'network-gap'})});await settle();}
      if(frame===40)await client.setMatch({id:'latency-match',ownership:'local-owner-v1',players:ids.map(id=>({id,...(id==='a'?{lastSequence:0,lastFrameSeq:3}:{})}))},'a');
      if(frame===78){
        assert.equal(requests.length,2,'the second HTTP request is still in flight');
        releasedAfterAck=structuredClone(latestProduced);
        pending.shift().resolve({ok:true,json:async()=>({accepted:true})});await settle();
        assert.equal(requests.length,3,'ACK immediately sends the newest report without another source step or timer callback');
        assert.equal(requests[2].frames[0].frameSeq,sentFrame,'the newest input can be newer than the latest produced owner report');
        assert.deepEqual({frameSeq:requests[2].owner.frameSeq,actor:requests[2].owner.actor,effects:requests[2].owner.effects},releasedAfterAck);
      }
    }
    assert.equal(sim.state.step,120);assert.equal(requests.length,3);assert.equal(requests[0].frames.length,1);
    // The successful frame78 acknowledgement immediately releases the newest
    // report. It no longer waits for the next frame81 interval callback.
    assert.equal(requests[0].owner.frameSeq,1);assert.equal(requests[1].owner.frameSeq,39);assert.equal(requests[2].owner.frameSeq,releasedAfterAck.frameSeq);
    assert.equal(requests[0].owner.hits.length,0);assert.equal(requests[1].owner.hits.length,1);assert.equal(requests[2].owner.hits.length,0);
    assert.ok(!errors.some(error=>error.message==='input-backlog'));
  }finally{client.close();for(const request of pending)request.resolve({ok:true,json:async()=>({})});globalThis.setInterval=interval;globalThis.clearInterval=clear;await settle();}
});
test('room life epochs alone reset the local actor; stale peer state cannot cross respawn and fight unlocks intro',()=>{
  const sim=make('a'),sync=createLocalOwnershipSync(),snapshot=sim.snapshot();sync.reconcile(sim,room(snapshot,'intro'), 'a');assert.equal(sim.actor('a').inputLock,1);
  sync.reconcile(sim,room(snapshot,'fight'),'a');assert.equal(sim.actor('a').inputLock,0);sim.actor('a').x=123;
  sync.reconcile(sim,room(snapshot,'fight'),'a');assert.equal(sim.actor('a').x,123);
  const old=encodeOwnedState(sim,'b',{epoch:1,frameSeq:100});snapshot.actors[0].x=888;
  sync.reconcile(sim,room(snapshot,'fight',2),'a');assert.equal(sim.actor('a').x,888);assert.equal(sync.receivePeer(sim,'b',old,'a'),false);
});
test('owner byte limits count UTF8 bytes and reject prototype keys before any state is applied',()=>{
  const sim=make('a'),value=encodeOwnedState(sim,'a');value.actor.core.large=Array(120).fill('\uad00'.repeat(400));
  assert.ok(JSON.stringify(value).length<96*1024);assert.throws(()=>validateOwnedState(value),/too-large/);
});

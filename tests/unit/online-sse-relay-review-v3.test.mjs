/** Independent review of downstream stream baselines and source-clock seeds. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import {make} from '../helpers/rf-passive-fixture-v12.mjs';

async function fixture(t){
  const sources=[],events=[],errors=[];let time=0;
  class Source{
    constructor(){this.listeners=new Map();sources.push(this);}
    addEventListener(type,callback){this.listeners.set(type,callback);}
    close(){}
    emit(type,data){this.listeners.get(type)?.({data:JSON.stringify(data)});}
  }
  const client=createOnlineClient({EventSource:Source,WebSocket:null,RTCPeerConnection:null,clock:()=>time,
    fetch:async()=>({ok:true,json:async()=>({available:true})}),
    onEvent:(type,data)=>events.push({type,data}),onError:error=>errors.push(error.message)});
  t.after(()=>client.close());await client.open();
  const match=id=>({id,ownership:'local-owner-v1',players:[{id:'me'},{id:'other'}]});
  await client.setMatch(match('one'),'me');
  const sim=await make({passives:[]}),report=encodeOwnedState(sim,'rf',{epoch:1,frameSeq:60});
  const deliver=(codec,value,token,matchId='one')=>sources[0].emit('owned-state',{matchId,relayToken:token,...codec.encode('other',value).value});
  return {client,sources,events,errors,report,deliver,match,time(value){time=value;}};
}

test('a same-life relay restart uses its new downstream token before decoding patches',async t=>{
  const f=await fixture(t),first=createOwnedRelayDelta();f.deliver(first,f.report,'lease-one');
  const restarted=createOwnedRelayDelta(),baseline={...f.report,frameSeq:90,actor:{...f.report.actor,mp:11,x:20}};
  f.deliver(restarted,baseline,'lease-two');
  const next={...baseline,frameSeq:93,actor:{...baseline.actor,x:30}};f.deliver(restarted,next,'lease-two');
  const last=f.events.filter(row=>row.type==='peer-owned-state').at(-1);
  assert.deepEqual(f.errors,[]);assert.equal(last.data.report.actor.mp,11);assert.equal(last.data.report.actor.x,30);
});

test('a retired-room SSE message cannot reset the current relay token or actor baseline',async t=>{
  const f=await fixture(t);await f.client.setMatch(f.match('two'),'me');
  const current=createOwnedRelayDelta(),baseline={...f.report,actor:{...f.report.actor,mp:17}};
  f.deliver(current,baseline,'current','two');
  f.deliver(createOwnedRelayDelta(),f.report,'retired','one');
  f.deliver(current,{...baseline,frameSeq:63,actor:{...baseline.actor,x:baseline.actor.x+20}},'current','two');
  const reports=f.events.filter(row=>row.type==='peer-owned-state');
  assert.deepEqual(f.errors,[]);assert.equal(reports.length,2);assert.equal(reports[1].data.report.actor.mp,17);
});

test('loading and respawn zero-frame seeds do not turn intro waiting into source delay',async t=>{
  const f=await fixture(t),state=(epoch,frameSeq)=>({matchId:'one',snapshot:{actors:[]},ownership:{mode:'local-owner-v1',actors:{other:{epoch,frameSeq}}}});
  f.sources[0].emit('state',state(1,0));f.time(4500);f.sources[0].emit('state',state(1,0));
  assert.deepEqual(f.client.performance().remoteSources,{});
  f.time(4550);f.sources[0].emit('state',state(1,3));
  assert.equal(f.client.performance().remoteSources.other.relativeSourceAgeMs,0);
  f.time(4600);f.sources[0].emit('state',state(1,6));
  assert.equal(f.client.performance().remoteSources.other.relativeSourceAgeMs,0);
  f.time(7000);f.sources[0].emit('state',state(2,0));f.time(10000);f.sources[0].emit('state',state(2,3));
  assert.equal(f.client.performance().remoteSources.other.epoch,2);
  assert.equal(f.client.performance().remoteSources.other.relativeSourceAgeMs,0);
  assert.deepEqual(f.errors,[]);
});

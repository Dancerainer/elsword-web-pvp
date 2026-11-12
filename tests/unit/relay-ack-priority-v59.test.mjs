import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineSocket} from '../../apps/web/online-socket.mjs';
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(t){
 const sockets=[],events=[],acks=[],tasks=new Map(),held=gate();let now=0,next=0;
 class Socket{constructor(){this.bufferedAmount=0;sockets.push(this);}send(){}close(){}
  raw(value){this.onmessage?.({data:JSON.stringify(value)});}slow(){this.onmessage?.({data:new Uint8Array([1,2,3]).buffer});}}
 const relay=createOnlineSocket({WebSocket:Socket,url:'ws://fixture',clock:()=>now,
  timers:{setTimeout(fn,ms){const id=++next;tasks.set(id,{fn,at:now+ms});return id;},clearTimeout(id){tasks.delete(id);}},
  decode:()=>held.promise,onEvent:(event,data)=>events.push({event,data,at:now}),onAcknowledgement:data=>acks.push({data,at:now})});
 t.after(()=>{held.resolve({type:'event',event:'state',data:{frame:1}});relay.close();});
 relay.open();sockets[0].raw({type:'transport',data:{connected:true}});
 return {relay,sockets,events,acks,held,async advance(ms){now+=ms;for(const [id,row]of [...tasks])if(row.at<=now){tasks.delete(id);row.fn();}await settle();}};
}
test('positive raw upload ACK arrives while a separate event is awaiting native decompression',async t=>{
 const f=fixture(t);await settle();f.sockets[0].slow();await f.advance(120);
 f.sockets[0].raw({type:'ack',data:{accepted:true,matchId:'current',sequence:7}});
 assert.equal(f.acks.length,1);assert.equal(f.acks[0].at,120);assert.equal(f.events.length,0);
 assert.equal(f.relay.performance().independentAckBypasses,1);
 await f.advance(200);assert.equal(f.events.length,0);assert.equal(f.acks.length,1);
 f.held.resolve({type:'event',event:'state',data:{frame:1}});await settle();
 assert.equal(f.events.length,1);assert.equal(f.events[0].at,320);assert.equal(f.acks.length,1);
 console.log('V59_ACK_DECODE_INDEPENDENCE',JSON.stringify({controlledDecoderReleaseMs:320,ackArrivalMs:120,ackDispatchMs:f.acks[0].at,avoidableFifoWaitMs:200}));
});
test('negative ACKs and gameplay events retain FIFO across the native decode',async t=>{
 const f=fixture(t);await settle();f.sockets[0].slow();
 f.sockets[0].raw({type:'ack',data:{accepted:false,sequence:1}});
 f.sockets[0].raw({type:'event',event:'state',data:{frame:2}});
 assert.equal(f.acks.length,0);assert.equal(f.events.length,0);
 f.held.resolve({type:'event',event:'state',data:{frame:1}});await settle();
 assert.deepEqual(f.events.map(x=>x.data.frame),[1,2]);assert.equal(f.acks.length,1);
 assert.equal(f.relay.performance().independentAckBypasses,0);
});
test('retired connection callbacks cannot deliver fast ACKs to the replacement',async t=>{
 const f=fixture(t);await settle();f.sockets[0].slow();const oldCallback=f.sockets[0].onmessage;
 f.relay.fail();await f.advance(1000);f.sockets[1].raw({type:'transport',data:{connected:true}});await settle();
 oldCallback({data:JSON.stringify({type:'ack',data:{accepted:true,sequence:1}})});
 assert.deepEqual(f.acks,[]);assert.equal(f.relay.active,true);
 f.held.resolve({type:'event',event:'state',data:{frame:1}});await settle();assert.deepEqual(f.events,[]);
});

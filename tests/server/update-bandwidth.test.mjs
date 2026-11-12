import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import * as updateBandwidthModule from '../../apps/server/update-bandwidth.mjs';
const {createUpdateBandwidth,DEFAULT_UPDATE_BANDWIDTH}=updateBandwidthModule;

test('100 MB blob fits the bounded queue without increasing bandwidth or admitting two maximum blobs',()=>{
  const bandwidth=createUpdateBandwidth();
  const release=bandwidth.reserve(100_000_000);assert.ok(release);
  assert.equal(bandwidth.reserve(100_000_000),null);
  const stats=bandwidth.performance();
  assert.equal(stats.bufferedBytes,100_000_000);
  assert.equal(stats.config.bytesPerSecond,1_250_000);
  assert.equal(stats.config.usableFraction,.9);
  assert.equal(stats.config.playerReserveBytesPerSecond,80_000);
  assert.equal(stats.config.roomReserveBytesPerSecond,250_000);
  assert.equal(stats.config.maximumBufferedBytes,128*1024*1024);
  release();assert.equal(bandwidth.performance().bufferedBytes,0);bandwidth.close();
});

function fixture(options={}){
  let at=0,pump,pressure={};const socket=new EventEmitter();socket.bytesWritten=0;
  const bandwidth=createUpdateBandwidth({bytesPerSecond:100_000,playerReserveBytesPerSecond:8000,roomReserveBytesPerSecond:20_000,
    clock:()=>at,getPressure:()=>pressure,timers:{setInterval(fn){pump=fn;return{};},clearInterval(){}},...options});
  bandwidth.attachSocket(socket);
  class Response extends EventEmitter{
    constructor(){super();this.bytes=0;this.writableNeedDrain=false;this.destroyed=false;this.ended=false;}
    write(chunk){this.bytes+=chunk.length;socket.bytesWritten+=chunk.length;return!this.writableNeedDrain;}
    end(){this.ended=true;}
    destroy(){this.destroyed=true;this.emit('close');}
  }
  const start=(bytes=500_000)=>{const response=new Response(),buffer=Buffer.alloc(bytes),release=bandwidth.reserve(bytes);assert.ok(release);
    return{response,done:bandwidth.send(response,buffer,release)};};
  return{bandwidth,socket,start,pressure(value){pressure=value;},step(ms=20){at+=ms;pump();},run(ms){for(let i=0;i<ms;i+=20){at+=20;pump();}}};
}

test('all concurrent downloads share one aggregate cap and receive fair bounded rounds',()=>{
  const f=fixture(),rows=Array.from({length:4},()=>f.start());f.run(1000);
  const counts=rows.map(row=>row.response.bytes),total=counts.reduce((a,b)=>a+b,0);
  assert.ok(total<=90_000&&total>=89_900,{total});assert.ok(Math.max(...counts)-Math.min(...counts)<=8192,{counts});
  assert.equal(f.bandwidth.performance().priorityBytes,0,'own download bytes are excluded from priority traffic');f.bandwidth.close();
});

test('a battle starting during a download immediately reduces shared budget; more rooms reserve more; finish recovers',()=>{
  const f=fixture(),row=f.start();f.run(1000);let before=row.response.bytes;
  f.pressure({playingRooms:1,playingPlayers:2});f.run(1000);
  assert.equal(f.bandwidth.performance().budgetBytesPerSecond,70_000);assert.ok(row.response.bytes-before<=72_000);before=row.response.bytes;
  f.pressure({playingRooms:2,playingPlayers:6});f.run(1000);
  assert.equal(f.bandwidth.performance().budgetBytesPerSecond,42_000);assert.ok(row.response.bytes-before<=43_000);before=row.response.bytes;
  f.pressure({playingRooms:0,playingPlayers:0});f.run(1000);assert.ok(row.response.bytes-before>=89_000);f.bandwidth.close();
});

test('saturation and battle transport backpressure pause downloads without banking credit, and recovery resumes',()=>{
  const f=fixture(),row=f.start();f.run(1000);const before=row.response.bytes;
  f.pressure({blocked:true});f.run(10_000);assert.equal(row.response.bytes,before);
  f.pressure({});f.step();assert.ok(row.response.bytes-before<=1800,'paused interval cannot become a burst');
  f.socket.bytesWritten+=30_000;f.step();const paused=row.response.bytes;assert.equal(f.bandwidth.performance().paused,true);
  f.run(220);assert.equal(row.response.bytes,paused);f.run(1500);assert.ok(row.response.bytes>paused);f.bandwidth.close();
});

test('the first sampling interval of a priority burst reduces downloads before a 250 ms average fills',()=>{
  const f=fixture(),row=f.start();
  // 1000 priority bytes over 20 ms is 50,000 B/s. Waiting for the 250 ms
  // estimate would call this only 4000 B/s and admit almost the idle budget.
  f.socket.bytesWritten+=1000;f.step();
  assert.equal(f.bandwidth.performance().priorityBytesPerSecond,50_000);
  assert.equal(f.bandwidth.performance().budgetBytesPerSecond,27_300);
  assert.equal(row.response.bytes,546,'the first pump must already use the reduced 20 ms credit');
  f.bandwidth.close();
});

test('short-interval priority pressure clears after the burst while the original rolling reserve remains',()=>{
  const f=fixture(),row=f.start();f.socket.bytesWritten+=20_000;f.step();
  assert.equal(row.response.bytes,0);assert.equal(f.bandwidth.performance().paused,true);
  f.run(1500);const before=row.response.bytes;
  assert.equal(f.bandwidth.performance().priorityBytesPerSecond,0);
  assert.equal(f.bandwidth.performance().budgetBytesPerSecond,90_000);
  f.step();assert.equal(row.response.bytes-before,1800,'cleared pressure cannot retain or release phantom burst credit');
  f.bandwidth.close();
});

test('pending SSE and WS output yields update credit immediately and clears without phantom starvation',()=>{
  const hasPressure=updateBandwidthModule.hasBattleOutputPressure;
  assert.equal(typeof hasPressure,'function','production pressure observation must be independently testable');
  const sse={ended:false,queuedBytes:0,queuedEvents:0,compressionInFlight:false,queueAgeMs:0};
  const ws={closed:false,queuedBytes:0,queuedEvents:0,queueAgeMs:0};
  const streams=[{transport:'sse',performance:()=>sse},{transport:'poll',performance(){throw Error('poll is not an output socket');}}];
  const relays=[{channel:{performance:()=>ws}}];
  const pressure=()=>hasPressure(streams.values(),relays.values());
  const f=fixture(),row=f.start();f.run(1000);
  for(const [target,field,value] of [[sse,'queuedBytes',1],[sse,'queuedEvents',1],
    [sse,'compressionInFlight',true],[ws,'queuedBytes',1],[ws,'queuedEvents',1]]){
    const before=row.response.bytes;target[field]=value;
    assert.equal(pressure(),true,field+' is pressure before the old 30 ms age gate');
    f.pressure({blocked:pressure()});f.run(200);
    assert.equal(row.response.bytes,before,'update writes must wait for '+field);
    target[field]=typeof value==='boolean'?false:0;
    assert.equal(pressure(),false,'cleared '+field+' cannot remain sticky');
    f.pressure({blocked:pressure()});f.step();
    assert.equal(row.response.bytes-before,1800,'recovery grants one ordinary 20 ms credit, not accumulated pause credit');
  }
  sse.ended=true;sse.compressionInFlight=true;sse.queuedBytes=900;sse.queueAgeMs=500;
  ws.closed=true;ws.queuedBytes=900;ws.queueAgeMs=500;
  assert.equal(pressure(),false,'retired diagnostic rows do not keep downloads paused');
  f.pressure({blocked:pressure()});const before=row.response.bytes;f.step();
  assert.equal(row.response.bytes-before,1800);
  f.bandwidth.close();
});

test('reserve alone can use all capacity for battle and zero for updates even before the first output spike',()=>{
  const f=fixture(),row=f.start();f.pressure({playingRooms:2,playingPlayers:12});f.run(2000);
  assert.equal(row.response.bytes,0);assert.equal(f.bandwidth.performance().paused,true);f.bandwidth.close();
});

test('a blocked download does not starve others; drain resumes and close releases memory and its queue slot',async()=>{
  const f=fixture(),slow=f.start(),fast=f.start();slow.response.writableNeedDrain=true;f.run(1000);
  assert.equal(slow.response.bytes,0);assert.ok(fast.response.bytes>=89_000);
  slow.response.writableNeedDrain=false;slow.response.emit('drain');f.run(1000);assert.ok(slow.response.bytes>0);
  slow.response.destroy();assert.equal(await slow.done,false);assert.equal(f.bandwidth.performance().reservedTransfers,1);assert.equal(f.bandwidth.performance().bufferedBytes,500_000);f.bandwidth.close();
});

test('socket close preserves its last priority bytes and does not erase traffic from the rolling measurement',()=>{
  const f=fixture(),row=f.start();f.socket.bytesWritten=25_000;f.socket.emit('close');f.step();
  assert.equal(f.bandwidth.performance().priorityBytes,25_000);assert.equal(f.bandwidth.performance().paused,true);assert.equal(row.response.bytes,0);f.bandwidth.close();
});

test('completed and cancelled transfers release reservations exactly once; memory and admission bounds are finite',async()=>{
  const f=fixture({maximumTransfers:2,maximumBufferedBytes:100});const one=f.start(40),two=f.start(50);
  assert.equal(f.bandwidth.reserve(1),null);f.step();assert.equal(await one.done,true);assert.equal(await two.done,true);
  assert.equal(f.bandwidth.performance().bufferedBytes,0);assert.equal(f.bandwidth.reserve(101),null);
  const release=f.bandwidth.reserve(100);assert.ok(release);release();release();assert.equal(f.bandwidth.performance().reservedTransfers,0);f.bandwidth.close();
});

test('invalid deployment capacity rejects startup and default 10 Mbps conversion is bytes per second',()=>{
  assert.equal(DEFAULT_UPDATE_BANDWIDTH.bytesPerSecond,10_000_000/8);
  for(const options of [{bytesPerSecond:0},{bytesPerSecond:NaN},{usableFraction:1},{tickMs:-1},{maximumTransfers:Infinity}])
    assert.throws(()=>createUpdateBandwidth(options),/invalid-update-bandwidth-config/);
});

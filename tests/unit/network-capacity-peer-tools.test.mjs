import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createHttpEventSourceClass} from '../../tools/http-event-source-peer.mjs';
import {createCapacityTcpProxy} from '../../tools/capacity-tcp-proxy-v4.mjs';
import {createPeerInputController} from '../../tools/network-peer-controls.mjs';
import {setCapacityProcessPriority} from '../../tools/network-capacity-priority.mjs';

test('capacity priority affects only the supplied own PID and records permission failure',()=>{
 const calls=[],api={constants:{priority:{PRIORITY_ABOVE_NORMAL:-7}},getPriority:pid=>{calls.push(['get',pid]);return 0;},setPriority:(pid,value)=>{calls.push(['set',pid,value]);throw Error('denied');}};
 const result=setCapacityProcessPriority('above-normal',123,api);assert.deepEqual(calls,[['get',123],['set',123,-7],['get',123]]);
 assert.equal(result.actualPriority,0);assert.equal(result.error,'denied');assert.throws(()=>setCapacityProcessPriority('high',123,api),/Unsupported/);
 calls.length=0;setCapacityProcessPriority('normal',123,api);assert.equal(calls.some(row=>row[0]==='set'),false);
});

test('diagnostic EventSource reconnects after EOF with server retry and Last-Event-ID, then closes without another request',async()=>{
 let calls=0,headers;const seen=[],Class=createHttpEventSourceClass({request:async(_url,options)=>{calls++;if(calls===2)headers=options.headers;
  return new Response(calls===1?'retry: 1\nid: 7\nevent: state\ndata: first\n\n':'id: 8\nevent: state\ndata: second\n\n',{headers:{'Content-Type':'text/event-stream'}});}});
 const source=new Class('/events');source.addEventListener('state',event=>{seen.push(event);if(event.data==='second')source.close();});
 await source.task;assert.equal(calls,2);assert.equal(headers['Last-Event-ID'],'7');assert.deepEqual(seen.map(row=>[row.data,row.lastEventId]),[['first','7'],['second','8']]);
 assert.equal(source.metrics.reconnects,1);assert.equal(source.metrics.eofs,1);assert.equal(source.readyState,2);
 assert.deepEqual(source.metrics.eventTypes,{state:{events:2,payloadBytes:11}});
});

test('3v3 diagnostic input chooses a living opponent and uses legal multiplayer jump/drop without changing vitals',()=>{
 const local={id:'me',team:0,x:0,y:0,hp:100,mp:0,grounded:true,loadout:[]},enemy={id:'enemy',team:1,x:200,y:150,hp:100},ally={id:'ally',team:0,x:10,y:0,hp:100};
 const sim={actor:id=>[local,enemy,ally].find(row=>row.id===id),state:{actors:[local,enemy,ally]},skillAvailability:()=>({available:false})};
 const before=structuredClone(sim.state);const result=createPeerInputController({mode:'3v3'}).next(sim,'me',{phase:'fight',elapsed:0});
 assert.equal(result.enemyId,'enemy');assert.deepEqual(result.input.held,['RIGHT','UP']);assert.deepEqual(sim.state,before);
});

test('transparent TCP proxy preserves bytes and applies one aggregate budget across two players',async t=>{
 const payload=Buffer.alloc(8192);for(let i=0;i<payload.length;i++)payload[i]=i%251;
 const server=net.createServer(socket=>socket.end(payload));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const proxy=await createCapacityTcpProxy({upstreamPort:server.address().port,players:2,egressBytesPerSecond:20000,oneWayMs:0,queueHighWater:4096});t.after(()=>proxy.close());
 const start=Date.now(),fetch=port=>new Promise((resolve,reject)=>{const chunks=[],client=net.connect({host:'127.0.0.1',port});client.on('data',row=>chunks.push(row));client.on('error',reject);client.on('end',()=>{client.end();resolve(Buffer.concat(chunks));});});
 const received=await Promise.all(proxy.ports.map(fetch));for(const bytes of received)assert.deepEqual(bytes,payload);
 assert.ok(Date.now()-start>=700,'shared 20 KB/s budget must not become 20 KB/s per connection');
 assert.equal(proxy.snapshot().flows.filter(row=>row.direction==='down').reduce((sum,row)=>sum+row.bytes,0),payload.length*2);
});

test('shared egress remains fair after many short connections close and releases their live socket records',async t=>{
 const upstreamSockets=new Set(),held=[],clients=[];
 const server=net.createServer(socket=>{upstreamSockets.add(socket);socket.once('close',()=>upstreamSockets.delete(socket));socket.once('data',data=>{
  if(data[0]===72)held.push(socket);else socket.end('x');
 });});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const proxy=await createCapacityTcpProxy({upstreamPort:server.address().port,players:2,egressBytesPerSecond:20000,oneWayMs:0,queueHighWater:4096});
 t.after(async()=>{for(const client of clients)client.destroy();await proxy.close();for(const socket of upstreamSockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 const counts=[0,0];for(let i=0;i<2;i++){const client=net.connect({host:'127.0.0.1',port:proxy.ports[i]});clients.push(client);client.on('data',data=>{counts[i]+=data.length;});client.on('error',()=>{});await new Promise(resolve=>client.once('connect',resolve));client.write('H');}
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));for(let n=0;held.length<2&&n<200;n++)await wait(5);assert.equal(held.length,2);
 await Promise.all(Array.from({length:80},(_,i)=>new Promise((resolve,reject)=>{const client=net.connect({host:'127.0.0.1',port:proxy.ports[i%2]});clients.push(client);client.on('connect',()=>client.write('C'));client.on('data',()=>{});client.on('error',reject);client.on('end',()=>client.end());client.on('close',resolve);})));
 // Client close precedes the proxy's peer close callback on Windows. Wait
 // for actual record retirement instead of assuming it finishes in20ms.
 for(let n=0;n<400&&(proxy.snapshot().closedFlowRecords<160||proxy.snapshot().activeFlows!==4);n++)await wait(5);
 const idleSnapshot=proxy.snapshot();assert.ok(idleSnapshot.closedFlowRecords>=160);assert.equal(idleSnapshot.activeFlows,4);
 for(const socket of held)socket.write(Buffer.alloc(128*1024,7));await wait(500);
 const total=counts[0]+counts[1];assert.ok(total>=6000,`actual egress must make progress: ${counts}`);
 for(const count of counts)assert.ok(count>=total*.35&&count<=total*.65,`closed socket history must not skew live two-player shares: ${counts}`);
 assert.equal(proxy.snapshot().activeFlows,4);
});

test('transparent proxy drains the delayed response tail after a client half-closes its request',async t=>{
 const payload=Buffer.alloc(12*1024);for(let i=0;i<payload.length;i++)payload[i]=i%251;
 const upstreamSockets=new Set(),server=net.createServer(socket=>{upstreamSockets.add(socket);socket.on('close',()=>upstreamSockets.delete(socket));socket.once('data',()=>socket.end(payload));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const proxy=await createCapacityTcpProxy({upstreamPort:server.address().port,players:1,egressBytesPerSecond:30000,oneWayMs:30,queueHighWater:4096});
 let client;t.after(async()=>{client?.destroy();await proxy.close();for(const socket of upstreamSockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 const received=await new Promise((resolve,reject)=>{const chunks=[];client=net.connect({host:'127.0.0.1',port:proxy.ports[0]});client.on('connect',()=>client.end('request'));client.on('data',chunk=>chunks.push(chunk));client.on('error',reject);client.on('end',()=>resolve(Buffer.concat(chunks)));});
 assert.deepEqual(received,payload);assert.equal(proxy.snapshot().flows.filter(row=>row.direction==='down').reduce((sum,row)=>sum+row.bytes,0),payload.length);
});

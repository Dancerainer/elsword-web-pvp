import test from 'node:test';
import assert from 'node:assert/strict';
import {ApplicationWire,scenarios} from '../tools/validation/network-application-wire-v40.mjs';
import {createGzip,constants} from 'node:zlib';
import {bindSseBatchSource} from '../tools/validation/network-production-client-v40.mjs';

test('reliable SSE chunks retain FIFO when equal due times differ after relative reconstruction',async()=>{
 const wire=new ApplicationWire({seed:2016401003,scenario:scenarios.find(s=>s.id==='severe-jitter-loss-10pct')}),delivered=[];
 const common={direction:0,lane:'relayDown',connection:'sse:b',reliable:true,suppressDuplicate:true,kind:'gzip-sse',frame:0,actions:[]};
 await wire.advance(96.63166703511874);
 const header=wire.send(new Uint8Array(10),{...common,identity:'gzip-sse:chunk0'},()=>delivered.push({name:'header',at:wire.now}));
 await wire.advance(header.serializedAt);
 const body=wire.send(new Uint8Array(1610),{...common,identity:'gzip-sse:chunk1'},()=>delivered.push({name:'body',at:wire.now}));
 await wire.advance(500);
 console.log(JSON.stringify({fixture:'observed-seed1003-sse-fifo',headerDue:header.due,bodyDue:body.due,delivered}));
 assert.equal(header.due,body.due);assert.deepEqual(delivered.map(r=>r.name),['header','body']);
 assert.equal(delivered[0].at,header.due);assert.equal(delivered[1].at,body.due);
 wire.close();
});

test('virtual time does not execute a slightly future callback early or reverse',async()=>{
 const wire=new ApplicationWire({seed:1,scenario:scenarios[0]}),target=500,due=target+5e-9,arrivals=[];
 wire.scheduleAt(()=>arrivals.push(wire.now),due);await wire.advance(target);
 assert.equal(wire.now,target);assert.deepEqual(arrivals,[]);
 await wire.advance(due);assert.equal(wire.now,due);assert.deepEqual(arrivals,[due]);
 await wire.advance(due);assert.deepEqual(arrivals,[due]);wire.close();
});

test('native gzip flush markers preserve SSE batch semantic metadata and local chunk indexes',async()=>{
 const gzip=createGzip({level:6}),rawWrite=gzip.write.bind(gzip),chunks=[],batches=[];let emptyWrites=0,active=null,part=0;
 gzip.write=(value,...rest)=>{if(!Buffer.byteLength(value))emptyWrites++;return rawWrite(value,...rest);};
 const source=new Map([[1,{direction:0,frame:42,epoch:7,actions:['action-42']}],[2,{direction:0,frame:99,epoch:7,actions:['action-99']}]]);
 bindSseBatchSource(gzip,{parse:value=>value.split('\n\n').filter(Boolean).map(block=>({id:Number(block.match(/^id: (\d+)/)?.[1])})),
  lookup:id=>source.get(id),fallbackDirection:1,onBatch:batch=>{active=batch;part=0;batches.push(batch);}});
 gzip.on('data',chunk=>chunks.push({...active,part:part++,bytes:chunk.length}));
 try{
  for(const id of [1,2]){gzip.write(`id: ${id}\nevent: input\ndata: {"frame":${source.get(id).frame}}\n\n`);
   await new Promise((resolve,reject)=>gzip.flush(constants.Z_SYNC_FLUSH,error=>error?reject(error):resolve()));}
  assert.equal(emptyWrites,2);assert.deepEqual(batches,[source.get(1),source.get(2)]);
  for(const frame of [42,99]){const rows=chunks.filter(row=>row.frame===frame);assert.ok(rows.length>0);
   assert.deepEqual(rows.map(row=>row.part),rows.map((_,i)=>i));assert.ok(rows.every(row=>row.epoch===7&&row.actions[0]==='action-'+frame));}
  assert.equal(chunks.length,chunks.filter(row=>[42,99].includes(row.frame)).length);
  console.log(JSON.stringify({fixture:'native-gzip-flush-metadata',emptyWrites,batches,chunks}));
 }finally{gzip.destroy();}
});

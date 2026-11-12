import test from 'node:test';
import assert from 'node:assert/strict';
import {createPeerControl} from '../../apps/web/online-peer-control.mjs';
function pair({accept=()=>true,reliableTransport=false,sendA=()=>true,sendB=()=>true,onAcknowledged=()=>{}}={}){
  let now=0;const ab=[],ba=[],metadataAB=[],metadataBA=[],accepted=[],poses=[],faults=[];
  const a=createPeerControl({matchId:'room',clock:()=>now,reliableTransport,onAcknowledged,
    onFault:reason=>faults.push(reason),send:(text,metadata)=>{if(!sendA(text,metadata))return false;ab.push(text);metadataAB.push(metadata);return true;}});
  const b=createPeerControl({matchId:'room',clock:()=>now,reliableTransport,send:(text,metadata)=>{if(!sendB(text,metadata))return false;ba.push(text);metadataBA.push(metadata);return true;},
    apply:report=>{if(!accept(report))return false;accepted.push(report.actions.map(a=>a.id));return true;},
    onPose:p=>poses.push(p),onFault:reason=>faults.push(reason)});
  const deliver=(from,to)=>{while(from.length)to.receiveText(from.shift());};
  a.pump();deliver(ab,b);deliver(ba,a);deliver(ab,b);deliver(ba,a);
  return {a,b,ab,ba,metadataAB,metadataBA,accepted,poses,faults,deliver,advance(ms){now+=ms;a.pump();b.pump();}};
}
const report=(id,{epoch=0,fill=''}={})=>({protocol:'local-owner-v1',epoch,frameSeq:id,
  actor:{state:'attack',payload:fill},effects:[],hits:[],actions:[{id,frameSeq:id,actor:{fired:['STOP_OTHER_UNIT1']},effects:[]}]});

test('a later pose waits for admitted control and duplicate server/peer-style actions do not break the stream',()=>{
  const f=pair();f.a.stage(report(7));
  assert.equal(f.b.fence({frameSeq:9},0,1),true);assert.deepEqual(f.poses,[]);
  f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);
  assert.deepEqual(f.accepted,[[7]]);assert.deepEqual(f.poses,[{frameSeq:9}]);assert.deepEqual(f.b.receipt(0),[7]);
  assert.equal(f.a.performance().pendingPackets,0);f.a.stage(report(7));f.deliver(f.ab,f.b);
  assert.deepEqual(f.accepted,[[7]],'server acknowledgement cannot make an already staged peer event disappear/re-enter');
});

test('receiver admission rejection retains the action and withholds ACK until recovery',()=>{
  let permit=false;const f=pair({accept:()=>permit});f.a.stage(report(5));f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);
  assert.deepEqual(f.b.receipt(0),[]);assert.equal(f.a.performance().pendingPackets,1);
  permit=true;f.advance(50);f.deliver(f.ba,f.a);
  assert.deepEqual(f.accepted,[[5]]);assert.equal(f.a.performance().pendingPackets,0);
});

test('failed hello does not consume the live retry interval and successful hello remains rate limited',()=>{
  let now=0,open=false;const sent=[];
  const control=createPeerControl({matchId:'hello-wake',clock:()=>now,send:text=>{if(!open)return false;sent.push({at:now,value:JSON.parse(text)});return true;}});
  control.pump();now=20;open=true;control.pump();
  assert.deepEqual(sent.map(row=>row.at),[20]);
  now=519;control.pump();assert.equal(sent.length,1);
  now=520;control.pump();assert.deepEqual(sent.map(row=>row.at),[20,520]);
});

test('explicit consumer capacity wake retries only a blocked ordered head and ACKs only actual admission',()=>{
  let capacity=0;const f=pair({accept:()=>capacity>0&&!!capacity--,reliableTransport:true});
  f.a.stage(report(4));f.a.stage(report(8));f.deliver(f.ab,f.b);
  assert.equal(f.b.performance().admissionBlocked,true);assert.equal(f.b.performance().receivedSequence,0);assert.deepEqual(f.ba,[]);
  assert.equal(f.b.resumeAdmission(),true);assert.deepEqual(f.ba,[]);
  capacity=1;f.b.resumeAdmission();f.deliver(f.ba,f.a);
  assert.deepEqual(f.accepted,[[4]]);assert.equal(f.a.performance().pendingPackets,1);assert.equal(f.b.performance().admissionBlocked,true);
  capacity=1;f.b.resumeAdmission();f.deliver(f.ba,f.a);
  assert.deepEqual(f.accepted,[[4],[8]]);assert.equal(f.a.performance().pendingPackets,0);assert.equal(f.b.performance().admissionBlocked,false);
  const wakes=f.b.performance().admissionWakes;assert.equal(f.b.resumeAdmission(),false);assert.equal(f.b.performance().admissionWakes,wakes);
  f.b.closed();assert.equal(f.b.resumeAdmission(),false);
});

test('continuous newer controls cannot starve the pose associated with an earlier admitted barrier',()=>{
  const f=pair();f.a.stage(report(1));const first=f.ab.splice(0);
  f.b.fence({frameSeq:1},0,1);f.a.stage(report(2));f.b.fence({frameSeq:2},0,2);
  f.a.stage(report(3));f.b.fence({frameSeq:3},0,3);
  f.deliver(first,f.b);assert.deepEqual(f.poses,[{frameSeq:1}]);assert.equal(f.b.performance().pendingPoses,2);
  f.deliver(f.ab,f.b);assert.deepEqual(f.poses,[{frameSeq:1},{frameSeq:2},{frameSeq:3}]);
  assert.equal(f.b.performance().pendingPoses,0);
});

test('control fragmentation is bounded and preserves a large UTF-8 action as one admitted event',()=>{
  const f=pair();f.a.stage(report(5,{fill:'\uad0d\uad05'.repeat(18000)}));assert.ok(f.ab.length>1);
  f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);assert.deepEqual(f.accepted,[[5]]);assert.equal(f.a.performance().pendingPackets,0);
});

test('a delayed critical packet suspends only its pair, then resumes when admitted',()=>{
  const delayed=pair(),healthy=pair();delayed.a.stage(report(2));healthy.a.stage(report(2));
  delayed.b.fence({frameSeq:3},0,1);healthy.b.fence({frameSeq:3},0,1);
  healthy.deliver(healthy.ab,healthy.b);healthy.deliver(healthy.ba,healthy.a);
  delayed.advance(251);assert.equal(delayed.b.performance().degraded,true);assert.equal(delayed.b.performance().failed,false);
  assert.equal(healthy.b.performance().degraded,false);assert.deepEqual(healthy.poses,[{frameSeq:3}]);
  delayed.deliver(delayed.ab,delayed.b);assert.equal(delayed.b.performance().degraded,false);assert.deepEqual(delayed.accepted,[[2]]);
  assert.equal(delayed.b.fence({frameSeq:4},0,1),false);
});

test('new life control cannot release a previous life pose or reuse its receipts',()=>{
  const f=pair();f.a.stage(report(2));f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);
  assert.equal(f.b.fence({old:true},0,2),true);f.a.stage(report(1,{epoch:1}));f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);
  assert.deepEqual(f.poses,[]);assert.deepEqual(f.b.receipt(0),[]);assert.deepEqual(f.b.receipt(1),[1]);
  assert.equal(f.b.fence({fresh:true},1,1),false);
});

test('lost application ACK replays the same packet without repeating admitted actions',()=>{
  const f=pair();f.a.stage(report(3));f.deliver(f.ab,f.b);f.ba.length=0;
  f.advance(251);f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);
  assert.deepEqual(f.accepted,[[3]]);assert.equal(f.a.performance().pendingPackets,0);
});

test('unbounded source backlog fails back instead of silently dropping accepted control',()=>{
  const f=pair();for(let id=1;id<=33;id++)f.a.stage(report(id));
  assert.equal(f.a.performance().failed,true);assert.equal(f.a.watermark(0),0);assert.equal(f.a.performance().pendingPackets,0);
});

test('native reliable queued action sends once while its admission ACK remains required',()=>{
  const f=pair({reliableTransport:true});f.a.stage(report(3));f.deliver(f.ab,f.b);
  assert.deepEqual(f.accepted,[[3]]);assert.equal(f.a.performance().pendingPackets,1);
  f.advance(1200);assert.equal(f.ab.length,0);assert.equal(f.a.performance().sentPackets,1);
  assert.equal(f.a.performance().failed,false);assert.equal(f.a.performance().reliableTransport,true);
  f.deliver(f.ba,f.a);assert.equal(f.a.performance().pendingPackets,0);
  assert.equal(f.a.performance().acknowledgedPackets,1);
});

test('native reliable missing admission ACK faults at the bounded age without adding transport copies',()=>{
  const f=pair({reliableTransport:true});f.a.stage(report(3));f.deliver(f.ab,f.b);f.ba.length=0;
  f.advance(1500);assert.equal(f.a.performance().failed,false);assert.equal(f.ab.length,0);
  f.advance(1);assert.equal(f.a.performance().failed,true);assert.equal(f.a.performance().sentPackets,1);
  assert.equal(f.a.performance().pendingPackets,0);assert.equal(f.a.watermark(0),0);
  assert.ok(f.faults.includes('control-ack-timeout'));
});

test('native reliable false consumer admission drains later without replaying its queued action',()=>{
  let permit=false;const f=pair({reliableTransport:true,accept:()=>permit});f.a.stage(report(5));f.deliver(f.ab,f.b);
  f.advance(600);assert.equal(f.ab.length,0);assert.equal(f.ba.length,0);
  assert.equal(f.b.performance().pendingReceive,1);assert.deepEqual(f.b.receipt(0),[]);
  permit=true;f.advance(1);f.deliver(f.ba,f.a);
  assert.deepEqual(f.accepted,[[5]]);assert.equal(f.a.performance().pendingPackets,0);
  assert.equal(f.a.performance().sentPackets,1);
});

test('native reliable failed queue admission retries only an unsent action',()=>{
  let allow=false;const f=pair({reliableTransport:true,sendA:(_text,metadata)=>metadata.type!=='actions'||allow});
  f.a.stage(report(6));assert.equal(f.a.performance().sentPackets,0);assert.equal(f.ab.length,0);
  allow=true;f.advance(10);assert.equal(f.ab.length,1);assert.equal(f.a.performance().sentPackets,1);
  f.advance(300);assert.equal(f.ab.length,1,'accepted queue is not duplicated while transport is still pending');
  f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);assert.deepEqual(f.accepted,[[6]]);
});

test('native fragment queue backpressure resumes its unsent part without restarting accepted fragments',()=>{
  let allow=false;const f=pair({reliableTransport:true,sendA:(_text,metadata)=>metadata.type!=='fragment'||metadata.part!==1||allow});
  f.a.stage(report(8,{fill:'\uad0d\uad05'.repeat(15000)}));
  const first=f.ab.splice(0);assert.equal(first.length,1);f.deliver(first,f.b);
  assert.deepEqual(f.accepted,[]);f.advance(100);assert.equal(f.ab.length,0);
  allow=true;f.advance(100);f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);
  const fragments=f.metadataAB.filter(row=>row.type==='fragment');
  assert.ok(fragments.length>2);assert.deepEqual(fragments.map(row=>row.part),Array.from({length:fragments[0].parts},(_,i)=>i));
  assert.ok(fragments.every(row=>row.sequence===1&&row.epoch===0));
  assert.deepEqual(f.accepted,[[8]]);assert.equal(f.a.performance().sentPackets,1);assert.equal(f.a.performance().pendingPackets,0);
});

test('a blocked native ACK retries metadata independently while the admitted action stays single',()=>{
  let allow=false;const f=pair({reliableTransport:true,sendB:(_text,metadata)=>metadata.type!=='ack'||allow});
  f.a.stage(report(4));f.deliver(f.ab,f.b);
  assert.deepEqual(f.accepted,[[4]]);assert.equal(f.b.performance().pendingAck,true);
  f.advance(500);assert.equal(f.ab.length,0);assert.equal(f.a.performance().pendingPackets,1);
  allow=true;f.advance(1);f.deliver(f.ba,f.a);
  assert.equal(f.b.performance().pendingAck,false);assert.equal(f.a.performance().pendingPackets,0);
  assert.equal(f.a.performance().sentPackets,1);assert.deepEqual(f.accepted,[[4]]);
});

test('wire metadata distinguishes immediate negotiation and receipts from causal action fragments',()=>{
  const f=pair({reliableTransport:true});f.a.stage(report(2));f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);
  f.a.acknowledgePose(0,2);
  assert.ok(f.metadataAB.some(row=>row.type==='hello'));assert.ok(f.metadataBA.some(row=>row.type==='hello-ack'));
  assert.ok(f.metadataAB.some(row=>row.type==='actions'&&row.sequence===1&&row.epoch===0));
  assert.ok(f.metadataBA.some(row=>row.type==='ack'&&row.sequence===1&&row.epoch===0));
  assert.ok(f.metadataAB.some(row=>row.type==='pose-ack'));
});

test('only newly acknowledged actions notify the pair ledger after all covered rows have retired',()=>{
  const acknowledgements=[];let f;
  f=pair({reliableTransport:true,onAcknowledged:value=>{
    acknowledgements.push(value);assert.equal(f.a.performance().pendingPackets,0,'retire covered rows before callback re-entry');
  }});
  f.a.stage(report(1));f.a.stage(report(2));f.deliver(f.ab,f.b);
  const ack=f.ba.at(-1);f.ba.length=0;f.a.receiveText(ack);f.a.receiveText(ack);
  assert.deepEqual(acknowledgements,[{epoch:0,actionIds:[1,2]}]);
  f.a.stage(report(1,{epoch:1}));f.a.receiveText(ack);
  assert.equal(f.a.performance().pendingPackets,1);assert.equal(acknowledgements.length,1,'previous life cannot retire a new life ledger');
});

test('ACK callback re-entry can stage the next control without the old cumulative ACK deleting it',()=>{
  const acknowledgements=[];let f;
  f=pair({reliableTransport:true,onAcknowledged:value=>{
    acknowledgements.push(value);
    if(value.actionIds.includes(1))f.a.stage(report(2));
  }});
  f.a.stage(report(1));f.deliver(f.ab,f.b);const firstAck=f.ba.shift();f.a.receiveText(firstAck);
  assert.equal(f.a.performance().pendingPackets,1);f.a.receiveText(firstAck);
  assert.equal(f.a.performance().pendingPackets,1,'duplicate old ACK cannot remove callback-staged next sequence');
  f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);
  assert.deepEqual(f.accepted,[[1],[2]]);assert.deepEqual(acknowledgements,[{epoch:0,actionIds:[1]},{epoch:0,actionIds:[2]}]);
  assert.equal(f.a.performance().pendingPackets,0);
});

test('a bounded parsed control avoids whole-envelope stringify and parse while preserving byte accounting',()=>{
  const f=pair({reliableTransport:true});f.a.stage(report(9,{fill:'\uad0d\uad05'}));
  const text=f.ab.shift(),value=JSON.parse(text),decodedBytes=new TextEncoder().encode(text).byteLength;
  const before=f.b.performance().receivedBytes,parse=JSON.parse,stringify=JSON.stringify;
  try{
    JSON.parse=()=>{throw Error('unexpected whole-envelope parse');};
    JSON.stringify=(entry,...args)=>{assert.notEqual(entry,value,'parsed envelope must not be serialized again');return stringify(entry,...args);};
    f.b.receiveParsed(value,{decodedBytes});
  }finally{JSON.parse=parse;JSON.stringify=stringify;}
  assert.deepEqual(f.accepted,[[9]]);assert.equal(f.b.performance().receivedBytes,before+decodedBytes);
  assert.equal(f.b.performance().receivedByteScope,'decoded-control-envelope-utf8-before-fragment-assembly');
  f.deliver(f.ba,f.a);assert.equal(f.a.performance().pendingPackets,0);
});

test('parsed fragment accounting includes carrier bytes exactly once and preserves epoch/sequence binding',()=>{
  const f=pair({reliableTransport:true});f.a.stage(report(8,{fill:'\uad0d\uad05'.repeat(10000)}));
  const texts=f.ab.splice(0),before=f.b.performance().receivedBytes;
  for(const text of texts)f.b.receiveParsed(JSON.parse(text),{decodedBytes:new TextEncoder().encode(text).byteLength});
  assert.deepEqual(f.accepted,[[8]]);
  assert.equal(f.b.performance().receivedBytes,before+texts.reduce((n,text)=>n+new TextEncoder().encode(text).byteLength,0));
  assert.equal(f.b.performance().receivedPackets,1);
  const wrong=pair();wrong.a.stage(report(4,{fill:'x'.repeat(15000)}));
  for(const text of wrong.ab.splice(0)){
    const fragment=JSON.parse(text);fragment.sequence=2;wrong.b.receiveText(JSON.stringify(fragment));
  }
  assert.deepEqual(wrong.accepted,[]);assert.equal(wrong.b.performance().failed,true);
});

test('parsed size metadata is mandatory and crafted oversized/cyclic values never reach the consumer',()=>{
  for(const kind of ['missing-size','oversize-size','oversize-object','cyclic','deep']){
    const f=pair(),value={v:1,matchId:'room',type:'actions',sequence:1,report:report(1)};
    let options={decodedBytes:1000};
    if(kind==='missing-size'){value.decodedBytes=1000;options=undefined;}
    if(kind==='oversize-size')options={decodedBytes:128*1024+1};
    if(kind==='oversize-object')value.report.actor.payload='x'.repeat(128*1024);
    if(kind==='cyclic')value.report.actor.cycle=value;
    if(kind==='deep'){let target=value.report.actor;for(let i=0;i<65;i++)target=target.child={};}
    f.b.receiveParsed(value,options);assert.deepEqual(f.accepted,[],kind);assert.equal(f.b.performance().failed,true,kind);
    assert.equal(f.b.performance().rejected,1,kind);
  }
});

test('native credit eight batches forty canonical actions without advancing their latest pose before admission',()=>{
  const f=pair({reliableTransport:true});for(let id=1;id<=40;id++)assert.equal(f.a.stage(report(id)),true);
  assert.equal(f.a.performance().sentPackets,8);assert.equal(f.a.performance().inflightPackets,8);
  assert.equal(f.a.performance().pendingUnsentPackets,2);assert.equal(f.a.performance().pendingPackets,10);
  assert.equal(f.a.performance().mergedActionBatches,30);assert.equal(f.a.performance().creditLimit,8);
  assert.equal(f.a.watermark(0),10);assert.equal(f.b.fence({frameSeq:40},0,10),true);
  f.deliver(f.ab,f.b);assert.deepEqual(f.accepted,[[1],[2],[3],[4],[5],[6],[7],[8]]);assert.deepEqual(f.poses,[]);
  f.deliver(f.ba,f.a);assert.equal(f.ab.length,2,'ACK immediately drains newly available credits without an external timer');
  assert.equal(f.a.performance().inflightPackets,2);
  f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);
  assert.deepEqual(f.accepted.map(ids=>ids.length),[1,1,1,1,1,1,1,1,16,16]);
  assert.deepEqual(f.accepted.flat(),Array.from({length:40},(_,i)=>i+1));assert.deepEqual(f.poses,[{frameSeq:40}]);
  assert.equal(f.a.performance().pendingPackets,0);assert.equal(f.a.stage(report(40)),true);
  assert.equal(f.a.performance().sentPackets,10,'already staged IDs cannot create a new sequence after their ACK');
});

test('native tail merge preserves every frozen canonical sample and chooses the latest actual source report',()=>{
  const f=pair({reliableTransport:true});for(let id=1;id<=8;id++)f.a.stage(report(id));
  const queued=f.ab.slice(),first=report(9);first.actor={state:'old-pose',sourceMegaDrill:{phase:'old'}};
  first.actions[0]={id:9,frameSeq:9,actor:{state:'old-attack',fired:['STOP_OTHER_UNIT1'],buffs:[{id:'old'}]},
    effects:[{id:51,elapsed:.12,name:'captured-effect',position:[1,2,3]}],targetViews:[{playerId:'b',epoch:0,frameSeq:2,position:[4,5,6]}]};
  const captured=structuredClone(first.actions[0]);f.a.stage(first);
  const newest=report(11);newest.actor={state:'new-pose',sourceMegaDrill:{phase:'future'}};
  f.a.stage(newest);const sparse=report(10);sparse.actor={state:'older-pose'};f.a.stage(sparse);
  assert.deepEqual(f.ab,queued,'already accepted SCTP packets are immutable while the tail accumulates');
  f.deliver(f.ab,f.b);const ack=f.ba.at(-1);f.ba.length=0;f.a.receiveText(ack);
  const packet=JSON.parse(f.ab[0]);assert.equal(packet.sequence,9);assert.equal(packet.report.frameSeq,11);
  assert.deepEqual(packet.report.actor,newest.actor);assert.deepEqual(packet.report.actions.map(action=>action.id),[9,10,11]);
  assert.deepEqual(packet.report.actions[0],captured,'source actor/effects/contact reference remain byte-equivalent captured data');
  f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);assert.deepEqual(f.accepted.flat(),Array.from({length:11},(_,i)=>i+1));
});

test('an accepted partial fragment occupies credit and cannot merge while its remaining parts can drain a full window',()=>{
  let allow=false;const f=pair({reliableTransport:true,sendA:(_text,metadata)=>metadata.type!=='fragment'||metadata.part!==1||allow});
  for(let id=1;id<=7;id++)f.a.stage(report(id));f.a.stage(report(8,{fill:'\uad0d\uad05'.repeat(15000)}));
  assert.equal(f.a.performance().inflightPackets,8);assert.equal(f.a.performance().sentPackets,7);
  const fragmentStart=f.ab.at(-1);f.a.stage(report(9));f.a.stage(report(10));
  assert.equal(f.a.performance().pendingPackets,9);assert.equal(f.a.performance().pendingUnsentPackets,1);
  assert.equal(f.a.watermark(0),9);assert.equal(f.ab.at(-1),fragmentStart);
  allow=true;f.advance(100);assert.equal(f.a.performance().sentPackets,8,'partial completion is allowed at credit eight');
  assert.equal(f.metadataAB.filter(metadata=>metadata.type==='actions').length,7,'a wholly unsent new packet still waits for credit');
  const parts=f.metadataAB.filter(metadata=>metadata.type==='fragment');assert.deepEqual(parts.map(metadata=>metadata.part),Array.from({length:parts[0].parts},(_,i)=>i));
  f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);assert.equal(f.ab.length,1);
  assert.deepEqual(JSON.parse(f.ab[0]).report.actions.map(action=>action.id),[9,10]);
  f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);assert.deepEqual(f.accepted.flat(),Array.from({length:10},(_,i)=>i+1));
});

test('tail coalescing does not slide the oldest unacknowledged action deadline',()=>{
  const f=pair({reliableTransport:true,sendA:(_text,metadata)=>metadata.type!=='actions'});
  f.a.stage(report(1));f.advance(1000);f.a.stage(report(2));
  assert.equal(f.a.watermark(0),1);assert.equal(f.a.performance().pendingPackets,1);assert.equal(f.a.performance().mergedActionBatches,1);
  f.advance(500);assert.equal(f.a.performance().failed,false);f.advance(1);assert.equal(f.a.performance().failed,true);
  assert.ok(f.faults.includes('control-ack-timeout'));assert.equal(f.a.stage(report(3)),false);
});

test('native batches retain sixteen-action and 128KiB bounds and the unchanged thirty-two packet hard cap',()=>{
  const sized=pair({reliableTransport:true,sendA:(_text,metadata)=>!['actions','fragment'].includes(metadata.type)});
  for(const id of [1,2]){const value=report(id);value.actions[0].effects=[{payload:'x'.repeat(60000)}];assert.equal(sized.a.stage(value),true);}
  assert.equal(sized.a.performance().pendingPackets,2,'two packets within the carrier cap cannot merge beyond the inner owner 96KiB schema bound');
  assert.equal(sized.a.performance().mergedActionBatches,0);
  const oversize=report(3);oversize.actions[0].effects=[{payload:'x'.repeat(128*1024)}];
  assert.equal(sized.a.stage(oversize),false);assert.ok(sized.faults.includes('control-backlog'));
  const capped=pair({reliableTransport:true});
  for(let batch=0;batch<32;batch++){
    const start=batch*16+1,value=report(start+15);value.actions=Array.from({length:16},(_,i)=>report(start+i).actions[0]);
    assert.equal(capped.a.stage(value),true);
  }
  assert.equal(capped.a.performance().pendingPackets,32);assert.equal(capped.a.performance().inflightPackets,8);
  assert.equal(capped.a.stage(report(513)),false);assert.ok(capped.faults.includes('control-backlog'));
});

test('generic transport keeps its original immediate packets and retransmission without native credits or coalescing',()=>{
  const f=pair();for(let id=1;id<=8;id++)assert.equal(f.a.stage(report(id)),true);
  assert.equal(f.ab.length,8);assert.equal(f.a.performance().pendingPackets,8);assert.equal(f.a.performance().creditLimit,null);
  assert.equal(f.a.performance().mergedActionBatches,0);f.advance(251);assert.equal(f.ab.length,16);
  f.deliver(f.ab,f.b);f.deliver(f.ba,f.a);assert.deepEqual(f.accepted.flat(),[1,2,3,4,5,6,7,8]);
});

test('pose timeout recovers only after the highest timed-out same-life barrier is admitted and never revives old poses',()=>{
  const f=pair({reliableTransport:true});for(let id=1;id<=3;id++)f.a.stage(report(id,{epoch:1}));
  const packets=f.ab.splice(0);f.b.fence({old:1},1,1);f.b.fence({old:3},1,3);f.advance(251);
  assert.equal(f.b.performance().degraded,true);assert.deepEqual(f.b.performance().degradedBarrier,{epoch:1,barrier:3});
  f.b.receiveText(JSON.stringify({v:1,matchId:'room',type:'actions',sequence:1,report:report(1,{epoch:0})}));
  assert.equal(f.b.performance().receivedSequence,0,'a stale life cannot initialize or satisfy the timed-out frontier');
  f.b.receiveText(packets[0]);assert.equal(f.b.performance().degraded,true,'the initial same-life admission cannot discard its pending higher barrier');
  f.b.receiveText(packets[2]);assert.equal(f.b.performance().degraded,true,'a buffered later sequence is not consumer admission');
  assert.deepEqual(f.poses,[]);f.b.receiveText(packets[1]);assert.equal(f.b.performance().degraded,false);
  assert.equal(f.b.performance().poseRecoveries,1);assert.equal(f.b.performance().degradedBarrier,null);assert.deepEqual(f.poses,[]);
  assert.equal(f.b.fence({fresh:true},1,3),false,'only a newly arriving pose can resume after the admitted frontier');
});

test('negotiation and transport ACK cannot recover a pose timeout while its consumer still rejects the control',()=>{
  let permit=false;const f=pair({reliableTransport:true,accept:()=>permit});f.a.stage(report(1));
  f.b.fence({old:true},0,1);f.deliver(f.ab,f.b);f.advance(251);
  assert.equal(f.b.performance().degraded,true);assert.equal(f.b.performance().pendingReceive,1);
  for(const type of ['hello','hello-ack','ack','pose-ack'])f.b.receiveText(JSON.stringify({v:1,matchId:'room',type,epoch:0,sequence:1,frameSeq:1}));
  assert.equal(f.b.performance().degraded,true);assert.equal(f.b.performance().poseRecoveries,0);assert.deepEqual(f.b.receipt(0),[]);
  permit=true;f.b.pump();assert.equal(f.b.performance().degraded,false);assert.equal(f.b.performance().poseRecoveries,1);
  assert.deepEqual(f.poses,[]);f.deliver(f.ba,f.a);assert.equal(f.a.performance().pendingPackets,0);
});

test('a newer life clears the old timeout anchor but still requires its own admission; a failed control never recovers',()=>{
  let permit=false;const f=pair({reliableTransport:true,accept:()=>permit});f.a.stage(report(1,{epoch:1}));
  f.b.fence({old:true},1,7);f.deliver(f.ab,f.b);f.advance(251);assert.equal(f.b.performance().degraded,true);
  f.a.stage(report(1,{epoch:2}));f.deliver(f.ab,f.b);
  assert.equal(f.b.performance().degradedBarrier,null);assert.equal(f.b.performance().degraded,true,'changing life alone cannot claim consumption');
  permit=true;f.b.pump();assert.equal(f.b.performance().degraded,false);assert.deepEqual(f.b.receipt(2),[1]);assert.deepEqual(f.b.receipt(1),[]);
  f.b.fence({expired:true},2,8);f.advance(251);f.b.closed();
  f.b.receiveText(JSON.stringify({v:1,matchId:'room',type:'actions',sequence:1,report:report(1,{epoch:3})}));f.b.pump();
  assert.equal(f.b.performance().failed,true);assert.equal(f.b.performance().negotiated,false);assert.equal(f.b.performance().poseRecoveries,1);
  assert.equal(f.b.fence({fresh:true},3,1),true);assert.deepEqual(f.poses,[]);
});

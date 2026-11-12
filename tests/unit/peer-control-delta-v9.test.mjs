/** Actual ownership schema and control FIFO, no renderer, Native resources,
 * sockets or WAN claim. Compression size evidence is measured separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createPeerControl} from '../../apps/web/online-peer-control.mjs';
import {createPeerControlDelta} from '../../packages/online/peer-control-delta.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,MAX_OWNER_BYTES} from '../../packages/online/owned-state.mjs';
const utf8=text=>new TextEncoder().encode(text).length;
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const baseSimulation=createSimulation({profile,map,networkOwnerId:'source',actors:[{id:'source',team:0,position:[0,0,0],lineId:0}]});
const baseActor=encodeOwnedState(baseSimulation,'source').actor;
const buff=(templateId=545,remaining=10)=>({schemaVersion:1,templateId,factorId:1,skillLevel:1,sourceActorId:'source',targetActorId:'source',
 accumulationLimit:1,resistance:0,durationMultiplier:1,behaviors:[{type:1,kind:'mpInterval',value:-4,changeType:1,interval:1,sum:0}],
 finalizers:[{kind:'time',sourceDuration:10,remaining}],displayer:{BDT_EFFECT_SET:['original-buff-display']}});
const effect=(id=1,time=0)=>({id,name:'wire-effect',setName:'wire-set',elapsed:time,animationTime:time,active:true,
 birthAnchor:{position:[1,2,3],facing:1,rotation:[0,0,0]},x:1,y:2,z:3});
function report(frameSeq,{epoch=1,buffs=[buff()],effects=[effect()],fired=['STOP_OTHER_UNIT0']}={}){
 const value={protocol:'local-owner-v1',epoch,frameSeq,actor:{...structuredClone(baseActor),x:frameSeq,hp:1000,mp:50,
  stateTime:frameSeq/60,animationTime:frameSeq/60,buffs,fired,cooldowns:{one:0,two:1}},effects,hits:[]};
 value.actions=[encodeCriticalAction(value,{id:frameSeq,effectIds:new Set(effects.map(effect=>effect.id)),
  targetViews:[{playerId:'enemy',epoch,frameSeq:Math.max(0,frameSeq-1),position:[10,20,30]}]})];
 return validateOwnedState(value);
}
function pair({senderDelta=true,receiverDelta=true,reliableTransport=true,allow=()=>true,admit=()=>true}={}){
 let now=0;const ab=[],ba=[],sentAB=[],sentBA=[],accepted=[],faults=[];
 const a=createPeerControl({matchId:'delta-room',clock:()=>now,reliableTransport,controlDelta:senderDelta,
  onFault:reason=>faults.push({side:'a',reason}),send:(text,metadata)=>{
   if(!allow(text,metadata))return false;ab.push(text);sentAB.push({text,metadata});return true;
  }});
 const b=createPeerControl({matchId:'delta-room',clock:()=>now,reliableTransport,controlDelta:receiverDelta,
  onFault:reason=>faults.push({side:'b',reason}),apply:value=>{
   const checked=validateOwnedState(value);if(!admit(checked))return false;accepted.push(checked);return true;
  },send:(text,metadata)=>{ba.push(text);sentBA.push({text,metadata});return true;}});
 const deliver=(from,to)=>{while(from.length)to.receiveText(from.shift());};
 a.pump();deliver(ab,b);deliver(ba,a);deliver(ab,b);deliver(ba,a);
 return {a,b,ab,ba,sentAB,sentBA,accepted,faults,deliver,
  drain(){deliver(ab,b);deliver(ba,a);},advance(ms){now+=ms;a.pump();b.pump();}};
}

test('negotiated control restores exact actor, captured geometry, Buff reapplication and deletion',()=>{
 const f=pair();assert.equal(f.a.performance().controlDelta,1);assert.equal(f.b.performance().controlDelta,1);
 const values=[report(1),report(2,{buffs:[buff(545,9)],effects:[effect(1,.1)]}),
  report(3,{buffs:[],effects:[],fired:[]}),report(4,{buffs:[buff(545,10),buff(52,1)],effects:[effect(2,.2)]})];
 values[3].actor.buffs[0].behaviors[0].value=-8;values[3].actions[0].actor.buffs[0].behaviors[0].value=-8;
 for(const value of values){assert.equal(f.a.stage(value),true);f.drain();}
 assert.deepEqual(f.accepted,values.map(value=>({...value,effects:[]})));
 const packets=f.sentAB.filter(row=>row.metadata.type==='actions').map(row=>JSON.parse(row.text));
 assert.ok(packets.every(packet=>packet.report.controlDeltaVersion===1));
 assert.equal(packets[1].report.current.baseline,null);assert.equal(packets[1].report.actionEvent.actionActorBaseline,undefined);
 assert.deepEqual(f.faults,[]);assert.equal(f.a.performance().pendingPackets,0);assert.equal(f.b.performance().deltaReceivedPackets,4);
});

test('merged playback control backlog preserves each event reaction intent independently of its newer body',()=>{
 let blocked=true;const f=pair({allow:(_text,metadata)=>!blocked||['hello','hello-ack','ack'].includes(metadata?.type)});
 const first=report(1),second=report(2);
 for(const value of [first,second]){delete value.actions[0].targetViews;value.actions[0].playback={version:1,start:true,held:[]};}
 first.actor.hitStop=.12;second.actor.hitStop=0;first.actor.vy=730;second.actor.vy=-60;
 for(const value of [first,second])Object.assign(value.actions[0].actor,{hitStop:value.actor.hitStop,vy:value.actor.vy});
 assert.equal(f.a.stage(first),true);assert.equal(f.a.stage(second),true);
 assert.equal(f.a.performance().pendingPackets,1);assert.equal(f.a.performance().mergedActionBatches,1);
 blocked=false;for(let round=0;round<5;round++){f.advance(20);f.drain();}
 assert.equal(f.accepted.length,1);assert.equal(f.accepted[0].frameSeq,2);assert.equal(f.accepted[0].actor.hitStop,0);
 assert.deepEqual(f.accepted[0].actions.map(value=>[value.frameSeq,value.actor.hitStop,value.actor.vy]),[[1,.12,730],[2,0,-60]]);assert.deepEqual(f.faults,[]);
});

for(const side of ['sender','receiver'])test(`an old ${side} capability retains complete legacy controls`,()=>{
 const f=pair(side==='sender'?{senderDelta:false}:{receiverDelta:false}),value=report(1);
 f.a.stage(value);f.drain();assert.deepEqual(f.accepted,[{...value,effects:[]}]);
 assert.equal(f.a.performance().controlDelta,null);assert.equal(f.b.performance().controlDelta,null);
 assert.ok(f.sentAB.filter(row=>row.metadata.type==='actions').every(row=>JSON.parse(row.text).report.controlDeltaVersion===undefined));
});

test('generic transport retains its retransmission semantics and never negotiates reliable baselines',()=>{
 const f=pair({reliableTransport:false});f.a.stage(report(1));assert.equal(f.ab.length,1);f.advance(251);assert.equal(f.ab.length,2);
 f.drain();assert.equal(f.accepted.length,1);assert.equal(f.a.performance().controlDelta,null);assert.equal(f.a.performance().creditLimit,null);
});

test('out-of-order delivery waits for the first baseline and replay does not repeat consumer admission',()=>{
 const f=pair(),first=report(1),second=report(2,{effects:[effect(1,.2)]});f.a.stage(first);f.a.stage(second);
 const packets=f.ab.splice(0);assert.equal(packets.length,2);f.b.receiveText(packets[1]);assert.deepEqual(f.accepted,[]);
 f.b.receiveText(packets[0]);f.b.receiveText(packets[1]);f.deliver(f.ba,f.a);
 assert.deepEqual(f.accepted,[{...first,effects:[]},{...second,effects:[]}]);assert.equal(f.a.performance().pendingPackets,0);
 assert.deepEqual(f.faults,[]);
});

test('life reset sends new birth definitions and an old life cannot populate or release the new stream',()=>{
 const f=pair();f.a.stage(report(1));const old=f.ab[0];f.drain();const fresh=report(1,{epoch:2,buffs:[buff(52,1)]});
 f.a.stage(fresh);const packet=JSON.parse(f.ab[0]);assert.ok(packet.report.current.baseline.actorBaseline);
 assert.ok(packet.report.actionEvent.actionActorBaseline);f.drain();f.b.receiveText(old);
 assert.deepEqual(f.accepted,[{...report(1),effects:[]},{...fresh,effects:[]}]);assert.deepEqual(f.b.receipt(1),[]);
 assert.deepEqual(f.b.receipt(2),[1]);assert.equal(f.a.performance().acknowledgedPoseEpoch,2);assert.equal(f.a.performance().acknowledgedPoseFrame,-1);
 f.b.closed();assert.equal(f.b.performance().deltaBaselineCount,0);assert.deepEqual(f.faults,[{side:'b',reason:'control-closed'}]);
});

test('a wholly unsent encoded tail retains its original births while adding a later Buff and effect',()=>{
 let permit=false;const f=pair({allow:(_text,metadata)=>metadata.type!=='actions'||permit}),first=report(1),second=report(2,{buffs:[buff(545,9),buff(52,1)],effects:[effect(1,.1),effect(2,.2)]});
 f.a.stage(first);f.a.stage(second);assert.equal(f.a.performance().mergedActionBatches,1);assert.equal(f.a.performance().pendingPackets,1);
 permit=true;f.advance(1);f.drain();
 assert.deepEqual(f.accepted,[{...second,effects:[],actions:[first.actions[0],second.actions[0]]}]);
 assert.equal(f.a.performance().sentPackets,1);assert.deepEqual(f.faults,[]);
});

test('immediate MP duplicate applications remain ordered when an already encoded unsent tail grows',()=>{
 let permit=false;const f=pair({allow:(_text,metadata)=>metadata.type!=='actions'||permit}),first=report(1);
 const immediate=()=>({...buff(97),accumulationLimit:0,behaviors:[{type:1,kind:'mpInterval',value:4,changeType:1,interval:0,sum:0}],finalizers:[{kind:'immediate',remaining:0}]});
 const second=report(2,{buffs:[immediate(),immediate()]});f.a.stage(first);f.a.stage(second);permit=true;f.advance(1);f.drain();
 assert.deepEqual(f.accepted,[{...second,effects:[],actions:[first.actions[0],second.actions[0]]}]);assert.deepEqual(f.faults,[]);
});

test('production delta traffic retains the eight-credit and sixteen-action FIFO limits',()=>{
 const f=pair(),values=Array.from({length:40},(_,i)=>report(i+1,{buffs:[buff(545,10-i/60)],effects:[effect(1,i/60)]}));
 for(const value of values)assert.equal(f.a.stage(value),true);
 assert.equal(f.a.performance().inflightPackets,8);assert.equal(f.a.performance().pendingPackets,10);assert.equal(f.a.performance().mergedActionBatches,30);
 f.drain();f.drain();assert.equal(f.a.performance().pendingPackets,0);assert.deepEqual(f.accepted.map(value=>value.actions.length),[1,1,1,1,1,1,1,1,16,16]);
 assert.deepEqual(f.accepted.flatMap(value=>value.actions),values.flatMap(value=>value.actions));assert.deepEqual(f.faults,[]);
});

test('false consumer admission decodes once, withholds receipts, then uses the same canonical sample',()=>{
 let permit=false;const f=pair({admit:()=>permit}),value=report(1);f.a.stage(value);f.drain();
 assert.equal(f.b.performance().deltaReceivedPackets,1);assert.deepEqual(f.accepted,[]);f.advance(500);
 assert.equal(f.b.performance().deltaReceivedPackets,1);assert.equal(f.a.performance().pendingPackets,1);
 permit=true;f.advance(1);f.drain();assert.deepEqual(f.accepted,[{...value,effects:[]}]);assert.equal(f.a.performance().pendingPackets,0);
});

test('encoded fragmentation retains original byte accounting and partial-send credit without changing frozen samples',()=>{
 let permit=false;const f=pair({allow:(_text,metadata)=>metadata.type!=='fragment'||metadata.part!==1||permit});
 const fired=Array.from({length:90},(_,i)=>`${i}:`+'x'.repeat(300)),value=report(1,{fired});f.a.stage(value);
 assert.equal(f.a.performance().inflightPackets,1);assert.equal(f.a.performance().sentPackets,0);f.deliver(f.ab,f.b);
 permit=true;f.advance(1);f.drain();assert.deepEqual(f.accepted,[{...value,effects:[]}]);
 const fragments=f.sentAB.filter(row=>row.metadata.type==='fragment');assert.ok(fragments.length>2);
 assert.deepEqual(fragments.map(row=>row.metadata.part),Array.from({length:fragments[0].metadata.parts},(_,i)=>i));
 assert.equal(f.b.performance().receivedBytes,f.sentAB.reduce((bytes,row)=>bytes+utf8(row.text),0));
 assert.equal(f.a.performance().sentBytes,f.sentAB.reduce((bytes,row)=>bytes+utf8(row.text),0));assert.deepEqual(f.faults,[]);
});

test('delta wrappers cannot amplify a small control into a full report beyond the existing 96KiB limit',()=>{
 const f=pair(),codec=createPeerControlDelta(),fired=Array.from({length:90},(_,i)=>`${i}:`+'x'.repeat(400));
 const first=report(1,{fired});assert.ok(utf8(JSON.stringify(first))<MAX_OWNER_BYTES);
 const wire=(sequence,value)=>JSON.stringify({v:1,matchId:'delta-room',type:'actions',sequence,report:codec.encode({...value,effects:[]})});
 const initial=wire(1,first);assert.ok(utf8(initial)<128*1024);f.b.receiveText(initial);assert.equal(f.accepted.length,1);
 const huge=report(20,{fired});huge.actions=Array.from({length:16},(_,i)=>({...first.actions[0],id:i+2,frameSeq:i+2}));
 assert.ok(utf8(JSON.stringify(huge))>MAX_OWNER_BYTES);const compressedTree=wire(2,huge);assert.ok(utf8(compressedTree)<128*1024);
 f.b.receiveText(compressedTree);assert.equal(f.accepted.length,1);assert.equal(f.b.performance().failed,true);
 assert.equal(f.b.performance().deltaBaselineCount,0);assert.deepEqual(f.faults,[{side:'b',reason:'control-delta-invalid'}]);
});

test('unnegotiated delta and corrupted capture identities fail before admission',()=>{
 for(const kind of ['unnegotiated','wrong-life','unknown-version','wrong-capture-id']){
  const f=pair(kind==='unnegotiated'?{receiverDelta:false}:{}),codec=createPeerControlDelta(),value=codec.encode({...report(1),effects:[]});
  if(kind==='wrong-life')value.actionEvent.epoch=9;
  if(kind==='unknown-version')value.controlDeltaVersion=99;
  if(kind==='wrong-capture-id')value.actionEvent.actions[0].effects[0].fields.id=55;
  f.b.receiveText(JSON.stringify({v:1,matchId:'delta-room',type:'actions',sequence:1,report:value}));
  assert.deepEqual(f.accepted,[],kind);assert.equal(f.b.performance().failed,true,kind);assert.equal(f.b.performance().deltaBaselineCount,0,kind);
 }
});

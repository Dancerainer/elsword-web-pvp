import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedRelayPacer} from '../../apps/server/owned-relay-pacer.mjs';

function fixture(options={}) {
  let now=0;const timers=new Set(),sent=[];
  const timerApi={setTimeout(fn,ms){const timer={fn,due:now+ms,unref(){}};timers.add(timer);return timer;},clearTimeout(timer){timers.delete(timer);}};
  const pacer=createOwnedRelayPacer({clock:()=>now,timers:timerApi,send:(value,context)=>sent.push({value,context,at:now}),...options});
  return {pacer,sent,timers,setTime(value){now=value;},advance(value){now=value;for(const timer of [...timers])if(timer.due<=now&&timers.delete(timer))timer.fn();}};
}

test('first frame is immediate and replacements retain the original 50 ms deadline',()=>{
  const f=fixture();f.pacer.offer('a',{frameSeq:1});f.setTime(10);f.pacer.offer('a',{frameSeq:2});
  const timer=[...f.timers][0];assert.equal(timer.due,50);
  f.setTime(49);f.pacer.offer('a',{frameSeq:3});assert.equal([...f.timers][0],timer);assert.equal(f.sent.length,1);
  f.advance(50);assert.deepEqual(f.sent.map(row=>[row.value.frameSeq,row.at]),[[1,0],[3,50]]);
  f.setTime(55);f.pacer.offer('a',{frameSeq:4});f.advance(100);assert.equal(f.sent.at(-1).value.frameSeq,4);
  assert.equal(f.pacer.performance().replaced,1);assert.equal(f.pacer.performance().pending,0);
});

test('each of the five other owners has one bounded pending packet and an independent clock',()=>{
  const f=fixture();for(let i=0;i<5;i++){f.setTime(i);f.pacer.offer(String(i),{frameSeq:1});}
  f.setTime(10);for(let frame=2;frame<=200;frame++)for(let i=0;i<5;i++)f.pacer.offer(String(i),{frameSeq:frame});
  assert.equal(f.pacer.performance().pending,5);assert.equal(f.timers.size,5);assert.equal(f.pacer.performance().maxPending,5);
  assert.equal(f.pacer.offer('outside',{frameSeq:1}),false);assert.equal(f.pacer.performance().sources,5);
  f.advance(50);assert.equal(f.sent.length,6);f.advance(54);assert.equal(f.sent.length,10);
  assert.ok(f.sent.slice(5).every(row=>row.value.frameSeq===200));
});

test('birth boundary drops old pending without postponing cadence; life boundary sends immediately',()=>{
  const f=fixture();f.pacer.offer('a',{epoch:1,frameSeq:1});f.setTime(10);f.pacer.offer('a',{epoch:1,frameSeq:2});
  const retired=[...f.timers][0];f.pacer.clear('a',{resetClock:false});f.setTime(20);f.pacer.offer('a',{epoch:1,frameSeq:3});
  assert.equal([...f.timers][0].due,50);retired.fn();assert.equal(f.sent.length,1);
  f.setTime(30);f.pacer.clear('a');f.pacer.offer('a',{epoch:2,frameSeq:0});f.advance(50);
  assert.deepEqual(f.sent.map(row=>[row.value.epoch,row.value.frameSeq]),[[1,1],[2,0]]);
  f.setTime(35);f.pacer.offer('a',{epoch:2,frameSeq:1});f.pacer.offer('a',{epoch:2,frameSeq:2,dead:true},undefined,{immediate:true});
  assert.equal(f.sent.at(-1).value.dead,true);assert.equal(f.pacer.performance().pending,0);
});

test('seed and lease retirement cancel all timers, including callbacks already queued by the runtime',()=>{
  const f=fixture();for(const source of ['a','b']){f.pacer.offer(source,{frameSeq:1});f.setTime(10);f.pacer.offer(source,{frameSeq:2});}
  const retired=[...f.timers];f.pacer.clearAll();assert.equal(f.timers.size,0);assert.equal(f.pacer.performance().sources,0);
  f.setTime(100);for(const timer of retired)timer.fn();assert.equal(f.sent.length,2);
  f.pacer.offer('a',{frameSeq:3});assert.equal(f.sent.at(-1).at,100);
});

test('flush rechecks stream identity, current life and newly healthy RTC rather than sending a captured report',()=>{
  let identity='lease-a',epoch=1,healthy=false;
  const f=fixture({canSend:(value,context)=>context.identity===identity&&value.epoch===epoch&&!healthy});
  f.pacer.offer('a',{epoch:1,frameSeq:1},{identity});f.setTime(10);f.pacer.offer('a',{epoch:1,frameSeq:2},{identity});
  identity='lease-b';f.advance(50);assert.equal(f.sent.length,1);
  f.setTime(60);f.pacer.offer('a',{epoch:1,frameSeq:3},{identity});f.setTime(65);f.pacer.offer('a',{epoch:1,frameSeq:4},{identity});
  healthy=true;f.advance(110);assert.equal(f.sent.length,2);
  healthy=false;f.setTime(120);f.pacer.offer('a',{epoch:1,frameSeq:5},{identity});f.setTime(125);f.pacer.offer('a',{epoch:1,frameSeq:6},{identity});
  epoch=2;f.advance(170);assert.equal(f.sent.length,3);assert.equal(f.pacer.performance().staleDropped,3);
});

test('a late timer cannot replay an old dynamic after a fresh packet already met the deadline',()=>{
  const f=fixture();f.pacer.offer('a',{frameSeq:1});f.setTime(10);f.pacer.offer('a',{frameSeq:2});const retired=[...f.timers][0];
  f.setTime(80);f.pacer.offer('a',{frameSeq:3});retired.fn();assert.deepEqual(f.sent.map(row=>row.value.frameSeq),[1,3]);
  f.setTime(90);f.pacer.offer('a',{frameSeq:4});assert.equal([...f.timers][0].due,130);
});

test('a lifecycle immediate packet cancels its old clock packet and begins the next deadline at actual send time',()=>{
  const f=fixture();f.pacer.offer('a',{frameSeq:1});f.setTime(10);f.pacer.offer('a',{frameSeq:2});
  f.setTime(20);f.pacer.offer('a',{frameSeq:3,dead:true},undefined,{immediate:true});
  assert.equal(f.timers.size,0);f.setTime(30);f.pacer.offer('a',{frameSeq:4,dead:true});assert.equal([...f.timers][0].due,70);
});

test('a retired transport returning false never advances successful send time or starts a retry loop',()=>{
  let writable=false;const delivered=[];
  const f=fixture({send:value=>{if(!writable)return false;delivered.push(value.frameSeq);return true;}});
  assert.equal(f.pacer.offer('a',{frameSeq:1}),false);assert.equal(f.pacer.performance().sent,0);assert.equal(f.timers.size,0);
  writable=true;f.setTime(10);assert.equal(f.pacer.offer('a',{frameSeq:2}),true);assert.deepEqual(delivered,[2]);
  f.setTime(20);f.pacer.offer('a',{frameSeq:3});assert.equal([...f.timers][0].due,60);
  writable=false;const retired=[...f.timers][0];f.advance(60);
  assert.equal(f.pacer.performance().sent,1);assert.equal(f.pacer.performance().pending,0);assert.equal(f.timers.size,0);
  writable=true;f.setTime(61);assert.equal(f.pacer.offer('a',{frameSeq:4}),true);assert.deepEqual(delivered,[2,4]);
  assert.equal(f.timers.size,0,'failed flush must retain the earlier successful send deadline');
  f.setTime(62);f.pacer.offer('a',{frameSeq:5});assert.equal([...f.timers][0].due,111);
  f.pacer.clearAll();retired.fn();assert.deepEqual(delivered,[2,4]);assert.equal(f.timers.size,0);
});

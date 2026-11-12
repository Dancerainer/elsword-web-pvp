import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlinePollChannel, PollChannelError} from '../../apps/server/online-poll-channel.mjs';

test('poll mailbox retains unacknowledged critical events, coalesces state, and rejects forged/stale cursors', async () => {
  const channel = createOnlinePollChannel();
  channel.push('match', {id: 'm1'});
  for (let sequence = 0; sequence < 1000; sequence++) channel.push('state', {sequence});
  channel.push('result', {winnerTeam: 1});
  assert.equal(channel.queuedEvents, 3);
  const first = await channel.poll(0).promise;
  assert.deepEqual(first.events.map(event => event.type), ['match', 'state', 'result']);
  assert.equal(first.events[1].data.sequence, 999);
  assert.deepEqual(await channel.poll(0).promise, first, 'lost HTTP response can be retried without losing critical events');
  assert.throws(() => channel.poll(first.cursor + 1), error => error instanceof PollChannelError && error.code === 'poll-cursor-rejected');
  const wait = channel.poll(first.cursor);
  assert.equal(channel.queuedEvents, 0);
  assert.throws(() => channel.poll(first.cursor), error => error.code === 'poll-already-pending');
  assert.throws(() => channel.poll(0), error => error.code === 'poll-cursor-rejected');
  channel.push('signal', {sdp: 'fixture'});
  assert.deepEqual((await wait.promise).events.map(event => event.type), ['signal']);
  channel.close();
});

test('bounded poll mailbox closes on critical-event or byte overflow rather than silently dropping results', async () => {
  let overflow = 0;
  const channel = createOnlinePollChannel({maximumCriticalEvents: 2, onOverflow: () => overflow++});
  channel.push('match', {}); channel.push('signal', {});
  assert.equal(channel.push('result', {}), false);
  assert.equal(channel.closed, true); assert.equal(channel.queuedEvents, 0); assert.equal(overflow, 1);
  assert.equal(channel.push('result', {}), false); assert.equal(overflow, 1);
  assert.throws(() => channel.poll(0), error => error.code === 'poll-connection-not-active');
  const bytes = createOnlinePollChannel({maximumBytes: 50});
  assert.equal(bytes.push('state', {payload: 'x'.repeat(100)}), false); assert.equal(bytes.closed, true);
});

test('poll stable birth baselines stay FIFO while movement and ordinary rooms independently replace',async()=>{
  const channel=createOnlinePollChannel();
  channel.push('owned-state',{full:true,actor:'a'},{critical:true,replaceKey:null});
  channel.push('state',{birth:true},{critical:true,replaceKey:null});
  for(let i=0;i<200;i++){
    channel.push('owned-state',{frame:i,actor:'a'},{critical:false,replaceKey:'owner:a'});
    channel.push('owned-state',{frame:i,actor:'b'},{critical:false,replaceKey:'owner:b'});
    channel.push('state',{frame:i},{critical:false,replaceKey:'room'});
  }
  channel.push('input',{hit:1},{critical:true,replaceKey:null});
  const batch=await channel.poll(0).promise;assert.equal(batch.events.length,6);
  assert.equal(batch.events[0].data.full,true);assert.equal(batch.events[1].data.birth,true);
  assert.deepEqual(batch.events.slice(2,5).map(row=>row.data.frame),[199,199,199]);assert.equal(batch.events[5].type,'input');channel.close();
});

test('poll total envelope stays bounded when retained replaceable keys cross room boundaries',()=>{
  const channel=createOnlinePollChannel();
  for(let i=0;i<134;i++)assert.equal(channel.push('owned-state',{i},{critical:false,replaceKey:'owner:'+i}),true);
  assert.equal(channel.push('owned-state',{i:134},{critical:false,replaceKey:'owner:134'}),false);assert.equal(channel.closed,true);
});

test('poll timeout replies with unchanged acknowledged cursor; cancel/close retire only their pending handle', async () => {
  const timers = new Map();
  const channel = createOnlinePollChannel({timers: {
    setTimeout(callback, delay) {const timer = {callback, delay}; timers.set(timer, callback); return timer;},
    clearTimeout(timer) {timers.delete(timer);},
  }});
  const first = channel.poll(0), timer = [...timers.keys()][0];
  assert.equal(timer.delay, 10_000); timer.callback();
  assert.deepEqual(await first.promise, {events: [], cursor: 0});
  const second = channel.poll(0); first.cancel(); assert.equal(channel.pending, true);
  second.cancel(); assert.deepEqual(await second.promise, {error: 'poll-request-cancelled'});
  const third = channel.poll(0); channel.close();
  assert.deepEqual(await third.promise, {error: 'poll-connection-closed'}); assert.equal(timers.size, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {buffRoom,settle} from '../helpers/network-buff-room-v38.mjs';
const aux=row=>row.value.type==='buff-sync';
const snapshots=row=>aux(row)&&row.value.kind==='snapshot';
const actorBuff=(room,recipient,owner)=>room.endpoints[recipient].sim.actor(owner).buffs;

test('four owners restore simultaneous ally-authored Buffs to the owner, independently of requester and author',async t=>{
  const r=await buffRoom(t);await r.bootstrap();
  for(const [index,id]of r.ids.entries())r.addBuff(id,r.ids[(index+2)%r.ids.length]);
  for(const id of r.ids)await r.send(id);
  await r.drain(row=>row.label==='input');
  // All twelve directed links lose the first application repair. This is
  // decoder/connection job loss; reliable SCTP itself does not drop messages.
  r.wire.splice(0);await r.advance(300);await r.drain();
  for(const [index,id]of r.ids.entries())for(const observer of r.ids){
    assert.equal(actorBuff(r,observer,id).length,1,`${observer} observes ${id}`);
    assert.equal(actorBuff(r,observer,id)[0].sourceActorId,r.ids[(index+2)%4]);
    assert.equal(actorBuff(r,observer,id)[0].targetActorId,id);
  }
  for(const row of r.history.filter(snapshots)){
    assert.equal(row.value.v,2);assert.equal(row.value.ownerId,row.from);assert.equal(row.value.requesterId,row.to);
  }
  assert.deepEqual(r.errors,[]);
});

test('idle recovery retries lost request/snapshot and blocked ACK without a new owner send; duplicates preserve timer',async t=>{
  const r=await buffRoom(t);await r.bootstrap();r.addBuff('a','c');await r.send('a');
  await r.drain(row=>row.label==='input');r.wire.splice(0);
  // Deliberately block ACK only; a snapshot must still apply to each observer.
  const reverse=r.endpoints.b.channels.get('a:control');reverse.bufferedAmount=50000;
  await r.advance(300);await r.drain();assert.equal(actorBuff(r,'b','a').length,1);
  const timer=actorBuff(r,'b','a')[0].finalizers.find(row=>row.kind==='time');assert.ok(timer);
  timer.remaining=Math.fround(timer.remaining-.5);const aged=structuredClone(actorBuff(r,'b','a'));
  const before=r.history.filter(row=>row.from==='a'&&row.to==='b'&&snapshots(row)).length;
  await r.advance(300);await r.drain();
  assert.ok(r.history.filter(row=>row.from==='a'&&row.to==='b'&&snapshots(row)).length>before);
  assert.deepEqual(actorBuff(r,'b','a'),aged,'a duplicate anchor cannot refill elapsed Buff time');
  reverse.bufferedAmount=0;await r.advance(50);await r.drain();
  const acked=r.history.filter(row=>row.from==='a'&&row.to==='b'&&snapshots(row)).length;
  await r.advance(1000);await r.drain();
  assert.equal(r.history.filter(row=>row.from==='a'&&row.to==='b'&&snapshots(row)).length,acked,'heartbeat stops after ACK');
  assert.deepEqual(r.errors,[]);
});

test('wrong owner/requester, old life, old room and a superseded compact cannot poison another player',async t=>{
  const r=await buffRoom(t);await r.bootstrap();r.addBuff('a','c');await r.send('a');await r.advance(300);await r.drain();
  const sample=r.history.filter(row=>row.from==='a'&&row.to==='b'&&snapshots(row)).at(-1);assert.ok(sample);
  const current=structuredClone(actorBuff(r,'b','a')),other=structuredClone(actorBuff(r,'b','c'));
  for(const patch of [{ownerId:'c'},{requesterId:'d'},{matchId:'previous-room'}, {snapshot:{...sample.value.snapshot,epoch:0}}]){
    const value={...sample.value,...patch};await r.deliver({...sample,value,text:JSON.stringify(value)});
  }
  assert.deepEqual(actorBuff(r,'b','a'),current);assert.deepEqual(actorBuff(r,'b','c'),other);
  const oldCompact=r.history.find(row=>row.from==='a'&&row.to==='b'&&row.value.buffStatus);
  r.endpoints.a.sim.actor('a').buffs=[];await r.send('a');await r.advance(300);await r.drain();
  const sent=r.endpoints.b.client.performance().ownerBuffSync.requestsSent;
  await r.deliver(oldCompact);await r.advance(300);await r.drain();
  assert.equal(r.endpoints.b.client.performance().ownerBuffSync.requestsSent,sent);
  assert.deepEqual(actorBuff(r,'b','a'),[]);
  assert.ok(r.endpoints.b.client.performance().ownerBuffSync.rejected>=4);
});

test('server life boundary rejects requests before next owner report and reconnect restores independent peer baselines',async t=>{
  const r=await buffRoom(t);await r.bootstrap();r.addBuff('a','c');await r.send('a');await r.advance(300);await r.drain();
  const old=r.history.filter(row=>row.from==='a'&&row.to==='b'&&snapshots(row)).at(-1);
  r.epochs.a=2;r.endpoints.a.sim.actor('a').buffs=[];r.state();
  const count=r.history.filter(snapshots).length;
  const request={type:'buff-sync',v:2,matchId:r.match.id,ownerId:'a',requesterId:'b',kind:'request',epoch:1};
  await r.deliver({from:'b',to:'a',label:'control',text:JSON.stringify(request)});await r.advance(300);await r.drain();
  assert.equal(r.history.filter(row=>row.from==='a'&&snapshots(row)).filter(row=>row.at>=600).length,0,'old life snapshot not retried');
  assert.ok(r.history.filter(snapshots).length>=count);
  await r.send('a');await r.drain();await r.deliver(old);
  assert.deepEqual(actorBuff(r,'b','a'),[]);
  r.addBuff('a','c');await r.send('a');await r.advance(300);await r.drain();
  await r.reconnect();for(const id of r.ids)await r.send(id);await r.advance(300);await r.drain();
  for(const observer of ['b','c','d'])assert.equal(actorBuff(r,observer,'a').length,1);
  assert.deepEqual(r.errors,[]);
});

test('created/intro/settling/result boundaries close every fast channel and cannot regress on reconnect',async t=>{
  const r=await buffRoom(t);await r.bootstrap();r.addBuff('a');await r.send('a');await r.advance(300);await r.drain();
  const samples=r.history.filter(row=>row.from==='a'&&row.to==='b'&&(row.label==='input'||snapshots(row)));
  const b=r.endpoints.b;await b.client.refreshMatch({...r.match,status:'settling'},'b');
  const count=b.events.filter(row=>['owner-buffs','owner-status','owner-protection','owner-motion','peer-owned-state','owner-actions','peer-input'].includes(row.type)).length;
  for(const row of samples)await r.deliver(row);
  b.source.emit('owned-state',{matchId:r.match.id,playerId:'a',report:{}});
  b.source.emit('owner-status',{matchId:r.match.id,playerId:'a',status:{}});
  b.source.emit('input',{matchId:r.match.id,playerId:'a',actions:[{}]});await settle();
  assert.equal(b.events.filter(row=>['owner-buffs','owner-status','owner-protection','owner-motion','peer-owned-state','owner-actions','peer-input'].includes(row.type)).length,count);
  await b.client.refreshMatch(r.match,'b');await b.client.setMatch(r.match,'b');
  const report=await r.send('b');assert.equal(b.client.send({held:[],pressed:[],released:[]},report),undefined);
  b.source.emit('state',{matchId:r.match.id,sequence:10000,pvp:{phase:'created'},snapshot:{actors:[]}});
  assert.notEqual(b.events.filter(row=>row.type==='state').at(-1).data.pvp.phase,'created');
  b.client.clearMatch();b.source.emit('input',{matchId:r.match.id,playerId:'a',actions:[{}]});
  assert.equal(b.events.filter(row=>row.type==='owner-actions').length,0);assert.deepEqual(r.errors,[]);
});

for(const phase of ['created','intro'])test(`${phase} does not admit a queued owner packet before authoritative fight`,async t=>{
  const r=await buffRoom(t,{phase}),b=r.endpoints.b;const report=await r.send('a');
  const packet={matchId:r.match.id,sequence:report.frameSeq,packet:{held:[]},owner:report,buffSyncVersion:2,motionVersion:1,motionMaxVersion:2};
  const row={from:'a',to:'b',label:'input',text:JSON.stringify(packet)};
  await r.deliver(row);assert.equal(b.events.filter(row=>row.type==='peer-owned-state').length,0);
  b.source.emit('owned-state',{matchId:r.match.id,playerId:'a',report});
  assert.equal(b.events.filter(row=>row.type==='peer-owned-state').length,0);
  r.state('fight');await r.bootstrap();
  assert.ok(b.events.some(row=>row.type==='peer-owned-state'));assert.deepEqual(r.errors,[]);
});

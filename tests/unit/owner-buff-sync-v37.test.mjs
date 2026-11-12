import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerBuffSender,createOwnerBuffReceiver} from '../../packages/online/owner-buff-sync.mjs';
import {createOwnerStatusClock} from '../../packages/online/owner-status-clock.mjs';
const f=Math.fround,dt=f(1/60);
const buff=()=>({schemaVersion:1,templateId:1,skillLevel:1,accumulationLimit:1,resistance:0,durationMultiplier:1,
  behaviors:[],finalizers:[{kind:'time',remaining:f(20),sourceDuration:f(20)}],displayer:{},sourceActorId:'b',targetActorId:'b',factorId:1,accumulationCount:1});
function fixture(){
  const clock=createOwnerStatusClock(),sender=createOwnerBuffSender(),receiver=createOwnerBuffReceiver();
  let frame=0,buffs=[buff()],armor=false;
  const status=()=>({protocol:'owner-status-v1',epoch:2,frameSeq:frame,actor:clock.encode({buffs,invincible:false,superArmor:armor,superArmorNotRed:false},2,frame).actor});
  return {sender,receiver,status,step(n=1){for(let i=0;i<n;i++){frame++;for(const b of buffs)for(const row of b.finalizers)if(row.kind==='time')row.remaining=f(row.remaining-dt);}},
    armor(v){armor=v;},clear(){buffs=[];},renew(){buffs=[buff()];},buffs:()=>structuredClone(buffs)};
}
test('Buff mutation revision is independent of protection changes and thirty-frame checkpoints',()=>{
  const x=fixture(),first=x.sender.capture(x.status());
  x.step(30);x.armor(true);const current=x.sender.capture(x.status());
  assert.equal(current.revision,first.revision);assert.equal(current.changed,false);
  x.clear();assert.equal(x.sender.capture(x.status()).revision,first.revision+1);
});
test('snapshot recovery advances float32 timers on source frames, with independent protection anchor',()=>{
  const x=fixture();x.sender.capture(x.status());x.receiver.install(x.sender.snapshot());
  x.step(47);x.armor(true);x.sender.capture(x.status());
  const decoded=x.receiver.decode(x.sender.compact());
  assert.deepEqual(decoded.actor.buffs,x.buffs());assert.equal(decoded.actor.superArmor,true);
  assert.equal(decoded.actor.sourceStatusClock.frameSeq,47);
});
test('missing revision asks for repair and cannot resurrect a removed Buff',()=>{
  const x=fixture();x.sender.capture(x.status());const old=x.sender.snapshot();x.receiver.install(old);
  x.step(3);x.clear();x.sender.capture(x.status());assert.equal(x.receiver.decode(x.sender.compact()),null);
  x.receiver.install(x.sender.snapshot());assert.deepEqual(x.receiver.decode(x.sender.compact()).actor.buffs,[]);
  assert.equal(x.receiver.install(old),false);assert.deepEqual(x.receiver.decode(x.sender.compact()).actor.buffs,[]);
});
test('periodic timer calibration refreshes snapshot anchor without a fake Buff mutation',()=>{
  const x=fixture();const first=x.sender.capture(x.status());
  for(let frame=1;frame<=300;frame++){x.step();x.sender.capture(x.status());}
  const snapshot=x.sender.snapshot();assert.equal(snapshot.revision,first.revision);assert.equal(snapshot.frameSeq,300);
  assert.equal(x.receiver.install(snapshot),true);assert.deepEqual(x.receiver.decode(x.sender.compact()).actor.buffs,x.buffs());
});
test('out-of-order same-revision snapshots cannot rewind the timer anchor',()=>{
  const x=fixture();x.sender.capture(x.status());const old=x.sender.snapshot();
  for(let i=0;i<300;i++){x.step();x.sender.capture(x.status());}
  x.receiver.install(x.sender.snapshot());assert.equal(x.receiver.install(old),false);
});

test('a reliable refresh overtaking the previous compact still decodes the previous source anchor',()=>{
  const x=fixture();x.sender.capture(x.status());x.receiver.install(x.sender.snapshot());
  x.step(299);x.sender.capture(x.status());const before=x.sender.compact(),expected=x.buffs();
  x.step();x.sender.capture(x.status());x.receiver.install(x.sender.snapshot());
  x.receiver.install(x.sender.snapshot()); // Duplicate ACK repair must retain the preceding anchor.
  assert.deepEqual(x.receiver.decode(before).actor.buffs,expected);
  assert.deepEqual(x.receiver.decode(x.sender.compact()).actor.buffs,x.buffs());
});
test('foreign life, malformed Buff and resource smuggling are rejected',()=>{
  const x=fixture();x.sender.capture(x.status());const snapshot=x.sender.snapshot();
  assert.throws(()=>x.receiver.install({...snapshot,buffs:[{...buff(),accumulationCount:-1}]}));x.receiver.install(snapshot);
  const compact=x.sender.compact();assert.equal(x.receiver.decode({...compact,epoch:1}),null);
  assert.throws(()=>x.receiver.decode({...compact,actor:{...compact.actor,hp:0}}));
  assert.throws(()=>x.receiver.decode({...compact,extra:1}));
});
test('compact status omits definitions after snapshot acknowledgment and preserves immutable source',()=>{
  const x=fixture(),status=x.status(),before=structuredClone(status);x.sender.capture(status);
  assert.equal(Object.hasOwn(x.sender.compact().actor,'buffs'),false);
  const snapshot=x.sender.snapshot();snapshot.buffs.length=0;
  assert.equal(x.sender.snapshot().buffs.length,1);assert.deepEqual(status,before);
});

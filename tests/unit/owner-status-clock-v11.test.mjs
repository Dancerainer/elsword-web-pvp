/** Frozen profession declarations + the production Buff create/merge/tick
 * executor. The explicit numeric bridge below is a lightweight fixture, not
 * Native WASM, original-client measurements or a network latency benchmark. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBuffFromFactor,mergeBuffs,tickBuffs,consumeBuffHit,buffControls} from '../../packages/combat-core/buffs.mjs';
import {projectRemoteBuffResources} from '../../packages/combat-core/buff-network-view.mjs';
import {createOwnerStatusClock,decodeOwnerStatusClock,validateSourceStatusClock,MAX_OWNER_STATUS_CLOCK_FRAMES} from '../../packages/online/owner-status-clock.mjs';

const f=Math.fround,dt=1/60;
const nativeValues={
  buffFixed(value,resistance){return f(f(value)*f(1-resistance));},
  buffRelation(attack,multiplier,resistance){return f(f(f(attack)*f(multiplier))*f(1-resistance));},
  buffPercent(value,resistance){return f(f(value)*f(1-resistance));},
  buffInterval(sum,interval,elapsed){const next=f(f(sum)+f(elapsed));return next>=f(interval)?{sum:0,triggered:true}:{sum:next,triggered:false};},
};
const factors={RF:42,BM:146,VC:84,LK:321,RS:236,IS:629,GM:143,BH:143,CA:143,LP:357,MM:369,DE:347};
const profiles=Object.fromEntries(Object.keys(factors).map(id=>[id,JSON.parse(readFileSync(new URL(`../../packages/combat-core/${id.toLowerCase()}-profile.json`,import.meta.url)))]));
const inlineFactors=JSON.parse(readFileSync(new URL('../../contracts/rf-buff-source.json',import.meta.url))).inlineFactors;
const sourceActor={id:'source',stats:{physicalAttack:2000,magicAttack:1500}};
const targetActor={id:'target',hp:5000,hpMax:10000,mp:100,mpMax:300,stateSerial:1,buffResistances:{0:0,1:0},debuffDurationMultiplier:1};
function make(id,factor=factors[id],extra={}){
  const result=createBuffFromFactor(profiles[id],{factor,sourceActor,targetActor,roll:0,nativeValues,...extra});
  assert.equal(result.supported,true,JSON.stringify(result.unsupported));assert.equal(result.accepted,true);return result.buff;
}
const projected=buffs=>buffs.map(projectRemoteBuffResources);
const actor=buffs=>({x:123,hp:5000,mp:100,state:'local-state',buffs:projected(buffs),invincible:false,superArmor:buffs.some(buff=>buff.behaviors.some(row=>row.kind==='superArmor')),superArmorNotRed:true,
  showInvincible:{remaining:0,swapRemaining:.05,white:false},forceInvincible:0});
function step(profile,buffs,frames){let result=buffs;for(let n=0;n<frames;n++)result=tickBuffs(profile,result,dt,{targetActor,nativeValues,advanceIntervals:false}).buffs;return result;}
const timers=buffs=>buffs.flatMap(buff=>buff.finalizers.filter(row=>row.kind==='time').map(row=>row.remaining));

for(const id of Object.keys(factors))test(`${id} actual authored Buff retains its source-frame timer through compact ordinary packets`,()=>{
  const clock=createOwnerStatusClock(),initial=actor([make(id)]),before=structuredClone(initial);
  const first=clock.encode(initial,1,100);assert.equal(first.changed,true);assert.equal(first.checkpoint,true);
  const current=actor(step(profiles[id],initial.buffs,9));current.x=999;
  const encoded=clock.encode(current,1,109);assert.equal(encoded.changed,false);assert.equal(encoded.checkpoint,false);
  assert.deepEqual(encoded.actor.buffs,first.actor.buffs,'ordinary packet retains its stable time baseline');
  const decoded=decodeOwnerStatusClock(encoded.actor,109);assert.deepEqual(timers(decoded.buffs),timers(current.buffs));
  assert.equal(decoded.x,999);assert.equal(decoded.hp,5000);assert.equal(decoded.mp,100);
  assert.deepEqual(initial,before,'neither the owner actor nor its Buff arrays are changed');
});

test('every 30 source frames creates a current calibration while intermediate marker and Buff payload stay stable',()=>{
  const clock=createOwnerStatusClock({checkpointFrames:30}),buffs=[make('LK')],initial=clock.encode(actor(buffs),1,0);
  const normal=clock.encode(actor(step(profiles.LK,buffs,29)),1,29);assert.equal(normal.changed,false);assert.equal(normal.checkpoint,false);
  assert.deepEqual(normal.actor.sourceStatusClock,initial.actor.sourceStatusClock);
  const calibrated=clock.encode(actor(step(profiles.LK,buffs,30)),1,30);assert.equal(calibrated.changed,false);assert.equal(calibrated.checkpoint,true);
  assert.ok(calibrated.actor.sourceStatusClock.revision>initial.actor.sourceStatusClock.revision);
  assert.equal(calibrated.actor.sourceStatusClock.frameSeq,30);
  assert.deepEqual(decodeOwnerStatusClock(calibrated.actor,30).buffs,actor(step(profiles.LK,buffs,30)).buffs);
});

test('actual native-merge continuation renews the timer immediately; later empty owner list publishes a terminal revision',()=>{
  const clock=createOwnerStatusClock(),firstBuff=make('RF'),initial=clock.encode(actor([firstBuff]),3,0);
  const elapsed=step(profiles.RF,[firstBuff],12),ongoing=clock.encode(actor(elapsed),3,12);assert.equal(ongoing.changed,false);
  const renewed=mergeBuffs(profiles.RF,elapsed,make('RF')),event=clock.encode(actor(renewed),3,13);
  assert.equal(event.changed,true);assert.equal(event.checkpoint,false);assert.ok(event.actor.sourceStatusClock.revision>initial.actor.sourceStatusClock.revision);
  assert.deepEqual(event.actor.buffs,projected(renewed));
  const empty=clock.encode(actor([]),3,14);assert.equal(empty.changed,true);assert.deepEqual(empty.actor.buffs,[]);
  assert.ok(empty.actor.sourceStatusClock.revision>event.actor.sourceStatusClock.revision);
  assert.throws(()=>clock.encode(actor([firstBuff]),3,13),/old-owner-status-source-frame/,'source-side older active state cannot rewind an ended baseline');
  const later=clock.encode(actor([]),3,17);assert.equal(later.changed,false);assert.equal(later.actor.sourceStatusClock.revision,empty.actor.sourceStatusClock.revision);
});

test('real time expiry is an immediate empty replacement and does not leave a live observer stun',()=>{
  const buff=make('RF',inlineFactors.stun),clock=createOwnerStatusClock();clock.encode(actor([buff]),1,0);
  const frames=Math.ceil(buff.finalizers.find(row=>row.kind==='time').remaining/dt)+2;
  const expired=step(profiles.RF,[buff],frames);assert.deepEqual(expired,[]);
  const ended=clock.encode(actor(expired),1,frames);assert.equal(ended.changed,true);
  const restored=decodeOwnerStatusClock(ended.actor,frames);assert.deepEqual(restored.buffs,[]);assert.equal(buffControls(restored.buffs).inputBlock,false);
});

test('BM actual stackable HP row retains kind/value and merge behavior, while only its private interval sum becomes constant',()=>{
  const original=make('BM',146),active=structuredClone(original);active.behaviors.find(row=>row.kind==='hpInterval').sum=.6;
  const clock=createOwnerStatusClock(),owner=actor([active]),before=structuredClone(owner),packet=clock.encode(owner,2,1);
  const sourceRow=owner.buffs[0].behaviors.find(row=>row.kind==='hpInterval'),wireRow=packet.actor.buffs[0].behaviors.find(row=>row.kind==='hpInterval');
  assert.equal(sourceRow.sum,.6);assert.equal(wireRow.sum,0);assert.equal(wireRow.kind,sourceRow.kind);assert.equal(wireRow.value,sourceRow.value);assert.deepEqual(owner,before);
  const incoming=projectRemoteBuffResources(make('BM',146));
  const fullMerged=mergeBuffs(profiles.BM,owner.buffs,incoming),compactMerged=mergeBuffs(profiles.BM,packet.actor.buffs,incoming);
  assert.equal(compactMerged[0].accumulationCount,2);
  assert.equal(compactMerged[0].behaviors[0].value,fullMerged[0].behaviors[0].value);
  assert.deepEqual(compactMerged[0].finalizers,fullMerged[0].finalizers);
  const stacked=clock.encode(actor(fullMerged),2,2);assert.equal(stacked.changed,true);
  const ordinary=actor(step(profiles.BM,fullMerged,3));ordinary.buffs[0].behaviors.find(row=>row.kind==='hpInterval').sum=.9;
  assert.equal(clock.encode(ordinary,2,5).changed,false,'an observer never uses the owner interval accumulator');
});

test('received-hit finalizer consumption, identity clearing and exact rate/stat changes bypass timer suppression',()=>{
  const original=make('RF',inlineFactors.stun),clock=createOwnerStatusClock();clock.encode(actor([original]),1,1);
  const consumed=consumeBuffHit(profiles.RF,[original],{kind:'received',count:1}).buffs;
  assert.equal(clock.encode(actor(consumed),1,1).changed,true,'non-time counters have no floating tolerance');
  consumed[0].behaviors.find(row=>row.kind==='stun').identityCleared=true;
  assert.equal(clock.encode(actor(consumed),1,1).changed,true);
  const stat=actor([make('RF')]),next=createOwnerStatusClock();next.encode(stat,1,1);
  stat.buffs[0].behaviors[0].value+=5e-7;assert.equal(next.encode(stat,1,1).changed,true,'a small real multiplier change is still real');
  stat.buffs[0].skillLevel=2;assert.equal(next.encode(stat,1,1).changed,true,'source skill-level identity remains exact');
});

test('frozen real factor probability rejection never invents a Buff to sync',()=>{
  const result=createBuffFromFactor(profiles.BM,{factor:146,sourceActor,targetActor:{...targetActor,buffResistances:{0:1,1:1}},roll:1,nativeValues});
  assert.equal(result.supported,true);assert.equal(result.accepted,false);
  const encoded=createOwnerStatusClock().encode(actor([]),1,1);assert.deepEqual(encoded.actor.buffs,[]);
});

test('current protection flags stay semantic while precise STOP/partial invulnerability clocks do not create redundant revisions',()=>{
  const clock=createOwnerStatusClock(),initial=actor([]);initial.forceInvincible=1;clock.encode(initial,1,0);
  const moving=actor([]);moving.forceInvincible=1-dt;
  const ordinary=clock.encode(moving,1,1);assert.equal(ordinary.changed,false);assert.equal(decodeOwnerStatusClock(ordinary.actor,1).forceInvincible,1-dt);
  const stopped=actor([]);stopped.forceInvincible=moving.forceInvincible;
  const actual=clock.encode(stopped,1,2);assert.equal(actual.changed,false);assert.equal(decodeOwnerStatusClock(actual.actor,2).forceInvincible,stopped.forceInvincible);
  assert.deepEqual(actual.actor.sourceStatusClock,ordinary.actor.sourceStatusClock);
  const partial=actor([]);partial.forceInvincible=stopped.forceInvincible-.00325;
  const partialPacket=clock.encode(partial,1,3);assert.equal(partialPacket.changed,false);assert.equal(decodeOwnerStatusClock(partialPacket.actor,3).forceInvincible,partial.forceInvincible);
  partial.superArmor=true;assert.equal(clock.encode(partial,1,3).changed,true);
  delete partial.superArmorNotRed;assert.equal(clock.encode(partial,1,3).changed,true);
  partial.showInvincible={remaining:1,swapRemaining:.02,white:true};assert.equal(clock.encode(partial,1,3).changed,true);
});

test('ordinary show-invincible countdown and white swaps retain exact packet metadata without redundant status events',()=>{
  const clock=createOwnerStatusClock(),initial=actor([]);initial.showInvincible={remaining:1,swapRemaining:.05,white:false};
  const first=clock.encode(initial,1,0),current=actor([]);current.showInvincible={remaining:.9,swapRemaining:.02,white:true};
  const packet=clock.encode(current,1,6);assert.equal(packet.changed,false);assert.equal(packet.checkpoint,false);
  assert.deepEqual(packet.actor.sourceStatusClock,first.actor.sourceStatusClock);
  assert.deepEqual(decodeOwnerStatusClock(packet.actor,6).showInvincible,current.showInvincible);
  const checkpoint=clock.encode(current,1,30);assert.equal(checkpoint.checkpoint,true);assert.equal(checkpoint.changed,false);
  assert.deepEqual(checkpoint.actor.showInvincible,current.showInvincible,'protection resend uses current metadata, never a cached clock');
});

test('exact invulnerability end zero cannot be revived by the cached Buff time baseline or decoder',()=>{
  const clock=createOwnerStatusClock(),initial=actor([make('LK')]);initial.forceInvincible=.1;initial.showInvincible={remaining:.1,swapRemaining:.02,white:true};
  const first=clock.encode(initial,1,0),ended=actor(step(profiles.LK,initial.buffs,6));ended.forceInvincible=0;ended.showInvincible={remaining:0,swapRemaining:.02,white:true};
  const terminal=clock.encode(ended,1,6);assert.equal(terminal.changed,true);assert.ok(terminal.actor.sourceStatusClock.revision>first.actor.sourceStatusClock.revision);
  const next=actor(step(profiles.LK,initial.buffs,9));next.forceInvincible=0;next.showInvincible={remaining:0,swapRemaining:.02,white:true};
  const packet=clock.encode(next,1,9);assert.equal(packet.changed,false);assert.equal(packet.actor.sourceStatusClock.frameSeq,6);
  const decoded=decodeOwnerStatusClock(packet.actor,9);assert.equal(decoded.forceInvincible,0);assert.equal(decoded.showInvincible.remaining,0);
  assert.deepEqual(timers(decoded.buffs),timers(next.buffs));
});

test('epoch reset and explicit clear never reuse a pre-end revision; regressions fail closed',()=>{
  const clock=createOwnerStatusClock(),first=clock.encode(actor([make('RF')]),1,80),ended=clock.encode(actor([]),1,81);
  const newLife=clock.encode(actor([make('RF')]),2,0);assert.equal(newLife.changed,true);assert.equal(newLife.checkpoint,true);
  assert.ok(newLife.actor.sourceStatusClock.revision>ended.actor.sourceStatusClock.revision);
  assert.throws(()=>clock.encode(actor([]),1,82),/old-owner-status-source-frame/);
  clock.clear();const reset=clock.encode(actor([]),2,0);assert.ok(reset.actor.sourceStatusClock.revision>newLife.actor.sourceStatusClock.revision);
  assert.ok(reset.actor.sourceStatusClock.revision>first.actor.sourceStatusClock.revision);
});

test('ordinary historical decode uses exactly its source frame; no receive-time age or hidden arrival clock enters the API',()=>{
  const clock=createOwnerStatusClock(),start=actor([make('LK')]);clock.encode(start,1,10);
  const sample=clock.encode(actor(step(profiles.LK,start.buffs,9)),1,19).actor;
  const actual=decodeOwnerStatusClock(sample,19);assert.deepEqual(timers(actual.buffs),timers(step(profiles.LK,start.buffs,9)));
  assert.deepEqual(sample.buffs,start.buffs,'decoder does not mutate the cached packet');
  assert.deepEqual(decodeOwnerStatusClock(start,19),start,'legacy unmarked actor remains lossless');
});

test('skipped and repeated source calls preserve native timer continuation and detect a same-frame reapply',()=>{
  const clock=createOwnerStatusClock({checkpointFrames:60}),initial=[make('RF')];
  const first=clock.encode(actor(initial),1,0),afterSkip=step(profiles.RF,initial,11);
  const skipped=clock.encode(actor(afterSkip),1,11);assert.equal(skipped.changed,false);assert.equal(skipped.checkpoint,false);
  assert.deepEqual(skipped.actor.buffs,first.actor.buffs);assert.deepEqual(timers(decodeOwnerStatusClock(skipped.actor,11).buffs),timers(afterSkip));
  const repeated=clock.encode(actor(afterSkip),1,11);assert.equal(repeated.changed,false);assert.deepEqual(repeated.actor.sourceStatusClock,skipped.actor.sourceStatusClock);
  const refreshed=mergeBuffs(profiles.RF,afterSkip,make('RF'));
  const reapply=clock.encode(actor(refreshed),1,11);assert.equal(reapply.changed,true);assert.equal(reapply.actor.sourceStatusClock.frameSeq,11);
  assert.ok(reapply.actor.sourceStatusClock.revision>first.actor.sourceStatusClock.revision);
  const same=clock.encode(actor(refreshed),1,11);assert.equal(same.changed,false);assert.deepEqual(same.actor.sourceStatusClock,reapply.actor.sourceStatusClock);
  const next=step(profiles.RF,refreshed,7),packet=clock.encode(actor(next),1,18);assert.equal(packet.changed,false);
  assert.deepEqual(timers(decodeOwnerStatusClock(packet.actor,18).buffs),timers(next));
});

test('incremental prediction stays equal to actual Buff tick sequence across checkpoints and report skips without mutating its wire base',()=>{
  const clock=createOwnerStatusClock({checkpointFrames:30}),initial=[make('LK')];let current=initial,baseline=clock.encode(actor(current),1,0).actor;
  const sealed=structuredClone(baseline);
  for(let frame=1;frame<=180;frame++){
    current=step(profiles.LK,current,1);if(frame%7!==0&&frame%30!==0)continue;
    const own=actor(current),before=structuredClone(own),packet=clock.encode(own,1,frame);
    assert.equal(packet.changed,false,'deterministic native time advancement remains a projection, not a semantic event');
    assert.deepEqual(timers(decodeOwnerStatusClock(packet.actor,frame).buffs),timers(current));assert.deepEqual(own,before);
  }
  assert.deepEqual(baseline,sealed,'the initial reliable time base is never advanced in place');
});

test('a steady source stream advances only new elapsed frames instead of replaying the full checkpoint window',t=>{
  const originals=[make('LK')],frames=[actor(originals)];for(let frame=1;frame<=12;frame++)frames.push(actor(step(profiles.LK,originals,frame)));
  const actualFround=Math.fround;let operations=0;
  t.mock.method(Math,'fround',value=>{operations++;return actualFround(value);});
  const clock=createOwnerStatusClock({checkpointFrames:30});
  for(let frame=0;frame<frames.length;frame++)clock.encode(frames[frame],1,frame);
  assert.ok(operations<=40,`12 actual new frames should not re-run the 78 frame baseline history (${operations} float32 calls)`);
});

test('status clock metadata and bounded frame work reject corrupt, future, unknown and non-safe values',()=>{
  const marker={version:1,revision:1,frameSeq:10};assert.equal(validateSourceStatusClock(marker,11),true);
  for(const bad of [null,[],{}, {...marker,extra:true},{...marker,version:2},{...marker,revision:0},{...marker,revision:1.5},
    {...marker,revision:Number.MAX_SAFE_INTEGER+1},{...marker,frameSeq:-1},{...marker,frameSeq:NaN},{...marker,frameSeq:11}])
    assert.throws(()=>validateSourceStatusClock(bad,10),/invalid-owner-status-clock/);
  assert.throws(()=>validateSourceStatusClock(marker,Number.MAX_SAFE_INTEGER),/invalid-owner-status-clock-frame/);
  const withMarker={...actor([]),sourceStatusClock:marker};assert.throws(()=>decodeOwnerStatusClock(withMarker,9),/invalid-owner-status-clock-frame/);
  assert.throws(()=>decodeOwnerStatusClock(withMarker),/invalid-owner-status-clock-frame/);
  for(const checkpointFrames of [0,-1,1.5,Infinity,MAX_OWNER_STATUS_CLOCK_FRAMES+1])assert.throws(()=>createOwnerStatusClock({checkpointFrames}),/checkpoint/);
  const clock=createOwnerStatusClock();assert.throws(()=>clock.encode(actor([]),-1,0),/source-frame/);
  assert.throws(()=>clock.encode(withMarker,1,10),/already-encoded/);
  const bad=actor([make('RF')]);bad.buffs[0].finalizers[0].remaining=NaN;assert.throws(()=>clock.encode(bad,1,10),/finalizer/);
  clock.encode(actor([]),1,0);assert.equal(clock.encode(actor([]),1,Number.MAX_SAFE_INTEGER).checkpoint,true,'a large source gap performs a bounded fresh calibration');
});

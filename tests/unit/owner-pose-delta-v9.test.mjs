import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerPoseDelta} from '../../packages/online/owner-pose-delta.mjs';
const codec=options=>createOwnerPoseDelta({validate:value=>value,...options});
const initial=()=>({protocol:'local-owner-v1',epoch:1,frameSeq:1,actor:{x:0,state:'WAIT',buffs:[{templateId:10,remaining:20,behaviors:[{kind:'stat',value:2}],description:'a'.repeat(100)}],
 awakening:{remaining:30,full:true},nested:{a:1,b:2},history:'f'.repeat(300)},effects:[{id:1,name:'visual',elapsed:0,birthAnchor:{position:[0,0,0]},definitionMember:1,stable:'s'.repeat(300)}],hits:[],actions:[]});
function transfer(sender,receiver,report,base){const packet=sender.encode(report,{acknowledgedEpoch:report.epoch,acknowledgedFrameSeq:base});const decoded=receiver.decode(packet);assert.deepEqual(decoded.report,report);decoded.commit();return packet;}
test('Buff/effect definitions occur once; independent updates exactly restore lifetime, state, and removals',()=>{
 const s=codec(),r=codec(),a=initial();assert.equal(transfer(s,r,a,-1).full,true);
 const b=structuredClone(a);b.frameSeq=4;b.actor.buffs[0].remaining-=.05;b.effects[0].elapsed=.05;b.actor.x=10;
 const p=transfer(s,r,b,1);assert.equal(p.full,false);const text=JSON.stringify(p);assert.ok(!text.includes('description'));assert.ok(!text.includes('birthAnchor'));assert.ok(!text.includes('behaviors'));
 const c=structuredClone(b);c.frameSeq=7;c.actor.buffs=[];c.effects=[];delete c.actor.nested;
 assert.equal(transfer(s,r,c,1).full,false);
});
test('dropping a birth pose or losing ACK does not prevent the next independent pose restoring it',()=>{
 const s=codec(),r=codec(),a=initial();transfer(s,r,a,-1);
 const b=structuredClone(a);b.frameSeq=4;b.effects.push({...b.effects[0],id:2,name:'new'});s.encode(b,{acknowledgedEpoch:1,acknowledgedFrameSeq:1});
 const c=structuredClone(b);c.frameSeq=7;c.effects[1].elapsed=.05;
 transfer(s,r,c,1);const d=structuredClone(c);d.frameSeq=10;transfer(s,r,d,1);
});
test('ordered duplicate Buff identities 97/98 and list reordering remain distinct',()=>{
 const s=codec(),r=codec(),a=initial();a.actor.buffs=[{templateId:97,remaining:1,source:'one'},{templateId:97,remaining:2,source:'two'},{templateId:98,remaining:3}];transfer(s,r,a,-1);
 const b=structuredClone(a);b.frameSeq=4;b.actor.buffs.reverse();b.actor.buffs[1].remaining=.5;transfer(s,r,b,1);
});
test('codec snapshot is detached from mutation during validation/application',()=>{
 const s=codec(),r=codec(),a=initial(),p=s.encode(a),decoded=r.decode(p);decoded.report.actor.x=999;decoded.report.actor.buffs[0].remaining=0;decoded.commit();a.actor.x=123;
 decoded.report.effects[0].elapsed=999;p.report.actor.nested.a=999;
 const b=initial();b.frameSeq=4;b.actor.x=10;transfer(s,r,b,1);
});
test('missing base is a recoverable error and periodic full repairs it',()=>{
 const s=codec({fullEveryFrames:9}),r=codec(),a=initial();transfer(s,r,a,-1);r.reset();
 const b=structuredClone(a);b.frameSeq=4;const patch=s.encode(b,{acknowledgedEpoch:1,acknowledgedFrameSeq:1});assert.throws(()=>r.decode(patch),/base/);
 b.frameSeq=10;const full=s.encode(b,{acknowledgedEpoch:1,acknowledgedFrameSeq:1});assert.equal(full.full,true);const decoded=r.decode(full);decoded.commit();
});
test('cache pressure falls back to full and both caches stay bounded',()=>{
 const s=codec({maximumSnapshots:2}),r=codec({maximumSnapshots:2});const a=initial();transfer(s,r,a,-1);
 for(let frame=4;frame<=19;frame+=3){const b=structuredClone(a);b.frameSeq=frame;transfer(s,r,b,1);}
 assert.ok(s.performance().sentSnapshots<=2);assert.ok(r.performance().receivedSnapshots<=2);
 const b=structuredClone(a);b.frameSeq=22;assert.equal(transfer(s,r,b,1).full,true);
});
test('new life clears baselines; old life and conflicting equal frame cannot poison cache',()=>{
 const s=codec(),r=codec(),a=initial();transfer(s,r,a,-1);const newer={...a,epoch:2,frameSeq:1};transfer(s,r,newer,1);
 assert.throws(()=>r.decode({v:1,full:true,epoch:1,frameSeq:2,report:{...a,frameSeq:2}}),/old-life/);
 const conflict=structuredClone(newer);conflict.actor.x=22;const row=r.decode({v:1,full:true,epoch:2,frameSeq:1,report:conflict});assert.throws(()=>row.commit(),/conflicting-frame/);
});
test('malformed indices, forbidden keys and invented source clocks are rejected',()=>{
 const s=codec(),r=codec(),a=initial();transfer(s,r,a,-1);const b=structuredClone(a);b.frameSeq=4;const p=s.encode(b,{acknowledgedEpoch:1,acknowledgedFrameSeq:1});
 const bad=structuredClone(p);bad.effects=[{b:999,p:{s:{},d:[]}}];assert.throws(()=>r.decode(bad),/list/);
 const poisoned=JSON.parse(JSON.stringify(p));poisoned.actor.s=JSON.parse('{"__proto__":{"polluted":true}}');assert.throws(()=>r.decode(poisoned),/key/);
 const clock={...p,base:4};assert.throws(()=>r.decode(clock),/base/);
});
test('optional top-level frontier and empty-action presence restore exactly rather than silently disappearing',()=>{
 const s=codec(),r=codec(),a=initial();delete a.actions;transfer(s,r,a,-1);
 const b=structuredClone(a);b.frameSeq=4;b.actions=[];b.actionFrontierComplete=false;transfer(s,r,b,1);
 const c=structuredClone(b);c.frameSeq=7;delete c.actions;delete c.actionFrontierComplete;transfer(s,r,c,4);
});
test('optional Buff list presence is exact, including deletion after a previously empty list',()=>{
 const s=codec(),r=codec(),a=initial();delete a.actor.buffs;transfer(s,r,a,-1);
 const b=structuredClone(a);b.frameSeq=4;b.actor.buffs=[];transfer(s,r,b,1);
 const c=structuredClone(b);c.frameSeq=7;delete c.actor.buffs;transfer(s,r,c,4);
});
test('heavy 67KB poses retain enough raw history for delayed 300ms ACK rather than reverting every packet to full',()=>{
 const s=codec(),r=codec(),a=initial();a.actor.history=Array(170).fill('x'.repeat(390));transfer(s,r,a,-1);
 for(let frame=2;frame<=20;frame++){const b=structuredClone(a);b.frameSeq=frame;b.actor.x=frame;
  const p=s.encode(b,{acknowledgedEpoch:1,acknowledgedFrameSeq:1});assert.equal(p.full,false);const d=r.decode(p);assert.deepEqual(d.report,b);d.commit();}
 assert.equal(s.performance().sentSnapshots,20);assert.ok(s.performance().sentBytes<s.performance().maximumBytes);
});

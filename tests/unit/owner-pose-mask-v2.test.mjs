import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerPoseDelta,OWNER_POSE_MASK_VERSION,OWNER_POSE_DELTA_VERSION,OWNER_POSE_MASK_FIELDS} from '../../packages/online/owner-pose-delta.mjs';
import {encodeNetworkBinary,decodeNetworkBinary} from '../../packages/online/network-binary.mjs';
const codec=options=>createOwnerPoseDelta({validate:value=>value,...options});
const initial=()=>({protocol:'local-owner-v1',epoch:1,frameSeq:1,actor:{x:0,y:1,state:'WAIT',stateTime:0,animationTime:0,grounded:true,
 buffs:[{templateId:97,remaining:20,behaviors:[{kind:'stat',value:2}],description:'a'.repeat(100)},{templateId:97,remaining:30,description:'b'.repeat(100)}],
 awakening:{remaining:30,full:true},nested:{a:1,b:2},history:'f'.repeat(300)},effects:[{id:1,name:'visual',elapsed:0,birthAnchor:{position:[0,0,0]},definitionMember:1,stable:'s'.repeat(300)}],hits:[],actions:[]});
function transfer(sender,receiver,report,base,{version=2}={}){
 const packet=sender.encode(report,{acknowledgedEpoch:report.epoch,acknowledgedFrameSeq:base,version});
 const decoded=receiver.decode(decodeNetworkBinary(encodeNetworkBinary(packet)));assert.deepEqual(decoded.report,report);decoded.commit();return packet;
}
test('pose v2 fixed-field mask has an independent literal primitive vector and v1 default is retained',()=>{
 assert.equal(OWNER_POSE_MASK_VERSION,2);assert.equal(OWNER_POSE_DELTA_VERSION,1);
 for(const fields of Object.values(OWNER_POSE_MASK_FIELDS))assert.equal(new Set(fields).size,fields.length);
 const s=codec(),r=codec(),a=initial();assert.equal(s.encode(a).v,1);transfer(s,r,a,-1);
 const b=structuredClone(a);b.frameSeq=2;b.actor.x=3.25;b.actor.stateTime=.1;delete b.actor.grounded;
 const p=transfer(s,r,b,1);assert.equal(p.v,2);assert.equal(p.full,false);
 // x is field 0 => set bit0; stateTime field7 => set bit14;
 // grounded is field13 => delete operation(2) at bit26.
 assert.deepEqual(p.actor,{m:[0x08004001],v:[3.25,.1]});
 assert.ok(!JSON.stringify(p.actor).includes('stateTime'));
});
test('all actor/effect/buff mask slots preserve changes and deletion, including high unsigned mask bits',()=>{
 for(const scope of ['actor','effect','buff']){
  const fields=OWNER_POSE_MASK_FIELDS[scope];
  for(let index=0;index<fields.length;index++){
   const key=fields[index];if(['buffs','id','templateId'].includes(key))continue;
   const s=codec(),r=codec(),a=initial();const target=value=>scope==='actor'?value.actor:scope==='effect'?value.effects[0]:value.actor.buffs[0];
   target(a)[key]=1;transfer(s,r,a,-1);const b=structuredClone(a);b.frameSeq=2;target(b)[key]=2;transfer(s,r,b,1);
   const c=structuredClone(b);c.frameSeq=3;delete target(c)[key];transfer(s,r,c,2);
  }
 }
});
test('unknown extension fields and nested known fields retain changes, deletions and empty containers',()=>{
 const s=codec(),r=codec(),a=initial();a.actor.extension={counter:1,data:[1,2],optional:3};transfer(s,r,a,-1);
 const b=structuredClone(a);b.frameSeq=2;b.actor.awakening.remaining=29.9;b.actor.extension.counter=2;delete b.actor.extension.optional;
 b.actor.extension.data=[];b.actor.newExtension={nested:{remaining:2}};b.effects[0].brandNew='extra';b.actor.nested={};
 const p=transfer(s,r,b,1);assert.ok(p.actor.n.extension);assert.ok(p.actor.s.newExtension);assert.ok(p.actor.m.length);
 const c=structuredClone(b);c.frameSeq=3;delete c.actor.extension;delete c.actor.newExtension;transfer(s,r,c,2);
});
test('lost delta and duplicate Buff template slots restore from the acknowledged baseline only',()=>{
 const s=codec(),r=codec(),a=initial();transfer(s,r,a,-1);
 const b=structuredClone(a);b.frameSeq=4;b.actor.buffs.reverse();b.actor.buffs[0].remaining=15;b.effects.push({...b.effects[0],id:2,name:'birth'});
 s.encode(b,{acknowledgedEpoch:1,acknowledgedFrameSeq:1,version:2}); // lost
 const c=structuredClone(b);c.frameSeq=7;c.actor.buffs[1].remaining=4;c.effects[1].elapsed=.05;
 const packet=transfer(s,r,c,1);assert.equal(packet.base,1);assert.equal(packet.full,false);
 const d=structuredClone(c);d.frameSeq=10;d.effects.reverse();transfer(s,r,d,1);
});
test('v1 and v2 can switch in either direction over the same acknowledged raw baseline',()=>{
 const s=codec(),r=codec(),a=initial();transfer(s,r,a,-1,{version:1});
 const b=structuredClone(a);b.frameSeq=2;b.actor.x=1;assert.equal(transfer(s,r,b,1,{version:2}).full,false);
 const c=structuredClone(b);c.frameSeq=3;c.actor.x=2;assert.equal(transfer(s,r,c,2,{version:1}).full,false);
 const d=structuredClone(c);d.frameSeq=4;d.actor.x=3;transfer(s,r,d,3,{version:2});
 const newer=structuredClone(d);newer.epoch=2;newer.frameSeq=1;assert.equal(transfer(s,r,newer,4).full,true);
 assert.throws(()=>s.encode(d,{version:2}),/old-life/);
});
test('optional Buff lists and action-frontier metadata preserve absence versus empty values',()=>{
 const s=codec(),r=codec(),a=initial();delete a.actor.buffs;delete a.actions;transfer(s,r,a,-1);
 const b=structuredClone(a);b.frameSeq=2;b.actor.buffs=[];b.actions=[];b.actionFrontierComplete=false;transfer(s,r,b,1);
 const c=structuredClone(b);c.frameSeq=3;delete c.actor.buffs;delete c.actions;delete c.actionFrontierComplete;transfer(s,r,c,2);
});
test('periodic full, missing bases, delayed commit isolation and conflicting frame checks survive masks',()=>{
 const s=codec({fullEveryFrames:5}),r=codec(),a=initial();transfer(s,r,a,-1);const b=structuredClone(a);b.frameSeq=2;b.actor.x=1;
 const packet=s.encode(b,{acknowledgedEpoch:1,acknowledgedFrameSeq:1,version:2});const decoded=r.decode(packet);
 decoded.report.actor.x=999;decoded.commit();const c=structuredClone(b);c.frameSeq=3;c.actor.x=2;transfer(s,r,c,2);
 r.reset();assert.throws(()=>r.decode(packet),/base/);c.frameSeq=6;assert.equal(transfer(s,r,c,1).full,true);
 const conflict=structuredClone(c);conflict.actor.x=17;assert.throws(()=>r.decode({v:2,full:true,epoch:1,frameSeq:6,report:conflict}).commit(),/conflicting-frame/);
});
test('v2 preserves exact -0 and array/nested number changes while refusing non-finite report values',()=>{
 const s=codec(),r=codec(),a=initial();a.actor.vector=[0,1/3];transfer(s,r,a,-1);
 const b=structuredClone(a);b.frameSeq=2;b.actor.x=-0;b.actor.vector=[-0,.1];transfer(s,r,b,1);
 for(const value of [NaN,Infinity,-Infinity]){const bad=structuredClone(a);bad.actor.x=value;assert.throws(()=>codec().encode(bad,{version:2}),/object/);assert.throws(()=>codec().decode({v:2,full:true,epoch:1,frameSeq:1,report:bad}),/object/);}
});
test('mask payload, scope, field, nesting and fallback ambiguity are rejected',()=>{
 const s=codec(),r=codec(),a=initial();transfer(s,r,a,-1);const b=structuredClone(a);b.frameSeq=2;b.actor.x=3;
 const packet=s.encode(b,{acknowledgedEpoch:1,acknowledgedFrameSeq:1,version:2});
 const invalid=[{m:[1],v:[]},{m:[0],v:[]},{m:[-1],v:[]},{m:[2**32],v:[]},{m:[1],v:[1,2]},
  {m:[],v:[],s:{x:2}},{m:[3],v:[{m:[],v:[]}]},{m:[],v:[],s:JSON.parse('{"__proto__":1}')},
  {m:[],v:[],d:['unknown','unknown']},{m:[],v:[],z:1},
  {m:[...Array(Math.ceil(OWNER_POSE_MASK_FIELDS.actor.length/16)).fill(0),1],v:[2]}];
 for(const actor of invalid)assert.throws(()=>r.decode({...packet,actor}),/mask|key/);
 assert.throws(()=>s.encode(b,{version:3}),/version/);
});

/** Current Web pending-anchor policy over original Blood FX declarations.
 * Real Native assets exercise the producer/owner roundtrip; this is not a
 * measured original-client deferred-render or fallback trajectory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {createOwnerPoseDelta} from '../../packages/online/owner-pose-delta.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

const dt=1/60,setName='EffectSet_SI_SA_SCA_BLOOD_CUTTER_FX';
const wire=value=>JSON.parse(JSON.stringify(value));
const near=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<1e-6);
for(const facing of [-1,1])test(`Blood FX ${facing}: pending target retains original particle age and every owner frame remains valid`,()=>{
 const f=elesisFixture('CA',{skillId:28023,gap:5000,facing}),receiver=elesisFixture('CA',{skillId:28023,gap:5000,facing});
 receiver.sim.networkOwnerId=receiver.b.id;
 const raw=f.profile.effectSets[setName].raw,earlyNames=[1,2,3].map(i=>raw['EFFECT'+i].NAME),
  sender=createOwnerPoseDelta(),decoder=createOwnerPoseDelta(),pendingAges=new Map(),born=new Set();
 assert.equal(raw.EFFECT0.START_TIME,.2);for(let i=4;i<=8;i++)assert.equal(raw['EFFECT'+i].START_TIME,.3);
 for(let i=1;i<=3;i++)assert.equal(raw['EFFECT'+i].START_TIME,undefined);
 let previousFrame,pendingFrames=0,checkedFrames=0,strictRejection=false;
 for(let frame=0;frame<80;frame++){
  f.sim.step(dt,frame===0?{[f.a.id]:{pressed:['A']}}:{},{snapshot:false});
  const group=f.sim.state.effects.filter(e=>e.setName===setName),target=group.find(e=>e.sourceBoneEffectSetId===e.id),events=f.sim.drainEvents();
  for(const child of group.filter(e=>earlyNames.includes(e.name))){
   assert.equal(child.start,0);assert.equal(child.setStartAnimation,target.setStartAnimation);
   if(!target.active){
    assert.equal(child.active,false,'a pending target cannot supply a valid visual birth');
    assert.equal(child.birthAnchor,null);assert.equal(child.currentAnchor,null);
    const expected=(pendingAges.get(child.id)??0)+dt;
    assert.equal(child.elapsed,expected,'source game-frame age advances while binding waits');
    assert.equal(child.animationTime,expected);pendingAges.set(child.id,expected);pendingFrames++;
    assert.ok(!events.some(e=>e.type==='effectStarted'&&e.effectId===child.id));
   }else if(child.active){
    assert.ok(child.birthAnchor?.position&&child.currentAnchor?.position);
    if(!born.has(child.id)){
     assert.ok(child.elapsed>pendingAges.get(child.id),'binding availability does not restart particle age');
     const actual=f.sim.effectBoneSampler(target,f.a,child.definition.BONE_NAME);
     assert.ok(near(child.birthAnchor.position,actual),'first birth uses the original target bone rather than the caster');born.add(child.id);
    }
   }
  }
  const packet=validateOwnedState(encodeOwnedState(f.sim,f.a.id,{epoch:1,frameSeq:f.sim.state.step}));
  const action=encodeCriticalAction(packet,{id:frame+1,effectIds:new Set(packet.effects.map(e=>e.id))});
  validateOwnedReferences(validateOwnedState({...packet,actions:[action]}),receiver.a,receiver.profile,receiver.map,
   {actors:receiver.sim.state.actors,profiles:receiver.sim.profiles});
  const pending=packet.effects.find(e=>e.setName===setName&&earlyNames.includes(e.name)&&!e.active);
  if(pending&&!strictRejection){const invalid=wire(packet);invalid.effects.find(e=>e.id===pending.id).active=true;
   assert.throws(()=>validateOwnedState(invalid),/invalid-owner-effect-bone-anchor/,'strict active-anchor validation remains unchanged');strictRejection=true;}
  const decoded=decoder.decode(wire(sender.encode(packet,previousFrame===undefined?{}:{acknowledgedEpoch:1,acknowledgedFrameSeq:previousFrame})));
  assert.deepEqual(decoded.report,packet);decoded.commit();previousFrame=packet.frameSeq;
  applyOwnedState(receiver.sim,receiver.a.id,decoded.report);checkedFrames++;
 }
 assert.equal(checkedFrames,80);assert.ok(pendingFrames>=6);assert.equal(born.size,3);assert.equal(strictRejection,true);
 assert.ok(sender.performance().deltaSent>0);
});

/** Actual production owner envelopes and roster reconciliation. Target values
 * come from the separate2016 contract; these are Web delivery regressions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {addFixture} from '../helpers/add-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState,encodeCriticalAction,mergeOwnedActionActor} from '../../packages/online/owned-state.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';

function fixture(){
  const source=addFixture('DE',{skillId:29215,targetProfession:'LK',networkOwnerId:'add'});
  const receiver=addFixture('DE',{skillId:29215,targetProfession:'LK',networkOwnerId:'target'});
  source.sim.networkEpochFor=()=>1;receiver.sim.networkEpochFor=()=>1;
  source.a.sourceAddTargetNotice={serial:1,kind:'force-finger',skillId:29215,targets:[{id:'target',epoch:1}]};
  const packet=()=>JSON.parse(JSON.stringify(encodeOwnedState(source.sim,'add',{epoch:1,frameSeq:10})));
  const check=value=>{
    const report=validateOwnedState(value);
    validateOwnedReferences(report,receiver.a,receiver.profile,receiver.sim.map,{actors:receiver.sim.state.actors,profiles:receiver.sim.profiles});
    return report;
  };
  const receive=(value,options)=>applyOwnedState(receiver.sim,'add',check(value),options);
  return {source,receiver,packet,check,receive};
}

test('real owner packet drains recipient15 once, historical collision replay never drains MP',()=>{
  const f=fixture(),before=f.receiver.b.mp,p=f.packet();
  f.receive(p,{endMissing:false});assert.equal(f.receiver.b.mp,before);
  f.receive(p);assert.equal(f.receiver.b.mp,before-15);
  f.receive(p);assert.equal(f.receiver.b.mp,before-15);
  f.receiver.sim.restore(JSON.parse(JSON.stringify(f.receiver.sim.snapshot())));
  f.receive(p);assert.equal(f.receiver.sim.actor('target').mp,before-15);
});

test('target notice participates in captured action lifecycle and rejects peer amounts or foreign source',()=>{
  const f=fixture();delete f.source.a.sourceAddTargetNotice;
  const earlier=encodeCriticalAction(f.packet(),{id:1,frameSeq:1});
  f.source.a.sourceAddTargetNotice={serial:1,kind:'force-finger',skillId:29215,targets:[{id:'target',epoch:1}]};
  assert.equal(Object.hasOwn(mergeOwnedActionActor(f.packet().actor,earlier.actor),'sourceAddTargetNotice'),false);
  for(const change of [n=>n.amount=999,n=>n.targets.push({...n.targets[0]}),n=>n.targets[0].id='add']){
    const value=f.packet();change(value.actor.sourceAddTargetNotice);assert.throws(()=>f.check(value));
  }
  const value=f.packet();f.receiver.a.loadout=[];assert.throws(()=>f.check(value));
});

for(const casterFirst of [false,true])test('Force Finger room delivery waits for all life epochs, casterFirst='+casterFirst,()=>{
  const f=fixture(),sync=createLocalOwnershipSync(),snapshot=f.receiver.sim.snapshot(),before=f.receiver.b.mp;
  if(casterFirst)snapshot.actors.sort((a,b)=>Number(b.id==='add')-Number(a.id==='add'));
  const value={snapshot,ownership:{mode:'local-owner-v1',actors:{add:{epoch:1},target:{epoch:1}}},owners:{add:f.packet()},
    pvp:{phase:'fight',fightTime:1,players:snapshot.actors.map(a=>({id:a.id,alive:true,connected:true,lockUntil:null,invincibleUntil:null}))}};
  sync.reconcile(f.receiver.sim,value,'target');assert.equal(f.receiver.sim.actor('target').mp,before-15);
  sync.reconcile(f.receiver.sim,value,'target');assert.equal(f.receiver.sim.actor('target').mp,before-15);
  assert.equal(f.receiver.sim.pendingAddTargetNotices,undefined);
});

test('a rejected roster discards deferred resource transfers before any recipient mutation',()=>{
  const f=fixture(),sync=createLocalOwnershipSync(),snapshot=f.receiver.sim.snapshot(),before=f.receiver.b.mp;
  snapshot.actors.sort((a,b)=>Number(b.id==='add')-Number(a.id==='add'));
  const value={snapshot,ownership:{mode:'local-owner-v1',actors:{add:{epoch:1}}},owners:{add:f.packet()},pvp:{phase:'fight',fightTime:1,players:[]}};
  assert.throws(()=>sync.reconcile(f.receiver.sim,value,'target'),/invalid-life-epoch/);
  assert.equal(f.receiver.sim.actor('target').mp,before);assert.equal(f.receiver.sim.pendingAddTargetNotices,undefined);
  assert.equal(f.receiver.sim.deferAddTimeRingNotices,false);
});

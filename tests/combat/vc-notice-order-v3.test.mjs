import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture} from '../helpers/vc-fixture.mjs';
import {encodeOwnedState,applyOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';

function fixture(){
  const source=vcFixture({skillId:24034}),target=vcFixture({skillId:24034});
  for(let i=0;i<120&&!source.a.sourceVeteranCommander?.overheatNotice;i++)source.sim.step(1/60,{vc:i%2===0?{pressed:['A'],held:['A']}:{}},{snapshot:false});
  const packet=encodeOwnedState(source.sim,'vc',{frameSeq:100});target.sim.drainEvents();
  return {source,target,packet};
}
const notices=f=>f.sim.drainEvents().filter(e=>e.type==='overheatIcon');
test('temporary critical actor restoration cannot replay an overheat notice; live state shares its receipt',()=>{
  const {target,packet}=fixture(),consumer=createRemoteActionConsumer({clock:()=>0});
  for(const id of [1,2]){
    const action=encodeCriticalAction(packet,{id});consumer.receive('vc',[action],0,100);
    consumer.consume(target.sim,'target',()=>0);assert.equal(notices(target).length,id===1?1:0);
  }
  applyOwnedState(target.sim,'vc',packet);assert.equal(notices(target).length,0);
});
test('critical notice older than its remaining lifetime never births; expired receipt stays consumed',()=>{
  const {target,packet}=fixture(),consumer=createRemoteActionConsumer({clock:()=>0});
  consumer.receive('vc',[encodeCriticalAction(packet,{id:1})],0,135);consumer.consume(target.sim,'target',()=>0);
  assert.equal(notices(target).length,0);
  applyOwnedState(target.sim,'vc',packet);assert.equal(notices(target).length,0);
});
test('notice order is monotonic within a life and resets only with a newer life',()=>{
  const {target,packet}=fixture();
  const apply=(epoch,serial,age=0)=>{const p=structuredClone(packet);p.epoch=epoch;p.actor.sourceVeteranCommander.overheatNotice.serial=serial;
    applyOwnedState(target.sim,'vc',p,{presentationAge:age});return notices(target);};
  const first=apply(0,5,.1);assert.equal(first.length,1);
  assert.ok(Math.abs(first[0].remaining-(packet.actor.sourceVeteranCommander.overheatNotice.remaining-.1))<1e-9);
  assert.equal(apply(0,3).length,0);assert.equal(apply(0,5).length,0);assert.equal(apply(1,1).length,1);
  assert.equal(apply(0,6).length,0);assert.equal(apply(1,2).length,1);
});

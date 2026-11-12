import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRoomWorkerFactory} from '../../apps/server/room-worker-factory.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const workerEntry=fileURLToPath(new URL('./fixtures/room-worker-seed-entry.mjs',import.meta.url));
const metadataFactory=Object.assign(()=>{}, {ownership:'local-owner-v1',professions:{RF:true},versions:{fixture:true},maps:[]});

async function room(t){
  const events=[],factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry});
  const driver=await factory({match:{id:'life-seed',players:[{id:'a'},{id:'b'}]},emit:(type,data)=>events.push({type,data}),finish(){}});
  t.after(()=>{driver.stop();factory.close();});
  let sequence=0;
  return {driver,events,send:(frameSeq,pressed)=>driver.submitInput('a',{matchId:'life-seed',sequence:sequence++,frames:[{held:[],pressed,released:[],frameSeq}]})};
}

test('production room worker seed never relabels an old-life action when frames remain adjacent and action IDs restart',async t=>{
  const f=await room(t);
  await f.send(100,['Z']);
  assert.deepEqual(f.driver.snapshot().recentActions.a.actions.map(action=>[action.id,action.frameSeq]),[[1,100]]);
  await f.send(101,['X','Z']);
  const row=f.driver.snapshot().recentActions.a;
  assert.equal(row.epoch,2);assert.equal(row.frameSeq,101);
  assert.deepEqual(row.actions.map(action=>[action.id,action.frameSeq]),[[1,101]],'the new life first action survives, the old life action does not');
  const emitted=f.events.filter(event=>event.type==='input').map(event=>event.data);
  assert.deepEqual(emitted.map(value=>[value.epoch,value.actions[0].id,value.actions[0].frameSeq]),[[1,1,100],[2,1,101]],'both original reliable deliveries remain intact');
});

test('production room worker state clears old-life seed before new actions while same-life relay renewal retains history',async t=>{
  const f=await room(t),binding={generation:1,token:'retained',splitDeltas:true,deltaVersion:3};
  f.driver.bindRelay('b',binding);await f.send(100,['Z']);
  f.driver.bindRelay('b',{...binding,generation:2});await f.send(101,[]);
  assert.deepEqual(f.driver.snapshot().recentActions.a.actions.map(action=>action.frameSeq),[100]);
  await f.send(102,['C']);assert.equal(f.driver.snapshot().recentActions.a,undefined);
  await f.send(103,['Z']);
  const row=f.driver.snapshot().recentActions.a;
  assert.equal(row.epoch,2);assert.deepEqual(row.actions.map(action=>[action.id,action.frameSeq]),[[1,103]]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {updateRoomRelayBinding,isCurrentRoomPacket} from '../../apps/server/room-worker-relays.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
const binding=(generation,token='same')=>({generation,token,splitDeltas:true,deltaVersion:3});
const report=(frameSeq,x)=>({protocol:'local-owner-v1',epoch:1,frameSeq,actor:{x,buffs:[]},effects:[],hits:[]});
const actions=(frameSeq,x)=>({matchId:'fixture',playerId:'source',epoch:1,frameSeq,actions:[{id:frameSeq,frameSeq,actor:{x,buffs:[]},effects:[]}]});
test('same-token mailbox rotation fences generation while preserving independent owner and reliable-action baselines',()=>{
  const peers=new Map(),client=createOwnedRelayDelta(),first=updateRoomRelayBinding(peers,'receiver',binding(1));
  const initial=first.deltas.encodeSplit('source',report(1,100),{deltaVersion:3});client.decode(initial.baseline);assert.equal(client.decode(initial.value).actor.x,100);
  assert.deepEqual(client.decodeActions(first.deltas.encodeActions('source',actions(1,100))),actions(1,100));
  first.epochs.set('source',1);first.lives.set('source','alive');
  const second=updateRoomRelayBinding(peers,'receiver',binding(2));assert.equal(second,first);assert.equal(second.generation,2);
  assert.equal(second.epochs.get('source'),1);assert.equal(second.lives.get('source'),'alive');
  const updated=second.deltas.encodeSplit('source',report(2,200),{deltaVersion:3});assert.equal(updated.baseline,null);
  assert.equal(client.decode(updated.value).actor.x,200);
  const action=second.deltas.encodeActions('source',actions(2,200));assert.equal(action.actionActorBaseline,undefined);
  assert.deepEqual(client.decodeActions(action),actions(2,200));
});
test('a new stream token starts fresh owner/action tables, while removing one peer leaves other peers intact',()=>{
  const peers=new Map(),first=updateRoomRelayBinding(peers,'receiver',binding(1));
  first.deltas.encodeSplit('source',report(1,100),{deltaVersion:3});first.deltas.encodeActions('source',actions(1,100));
  const survivor=updateRoomRelayBinding(peers,'other',binding(1,'other'));
  const next=updateRoomRelayBinding(peers,'receiver',binding(2,'replacement'));assert.notEqual(next,first);assert.equal(next.epochs.size,0);
  const client=createOwnedRelayDelta(),encoded=next.deltas.encodeSplit('source',report(2,200),{deltaVersion:3});assert.ok(encoded.baseline.actorBaseline);
  client.decode(encoded.baseline);assert.equal(client.decode(encoded.value).actor.x,200);
  assert.deepEqual(client.decodeActions(next.deltas.encodeActions('source',actions(2,200))),actions(2,200));
  updateRoomRelayBinding(peers,'receiver',null);assert.equal(peers.has('receiver'),false);assert.equal(peers.get('other'),survivor);
});
test('in-flight reliable definitions survive same-mailbox generation rotation but cannot enter a new stream token',()=>{
  const old={generation:1,token:'mailbox'},current={bindingGeneration:2,token:'mailbox'};
  assert.equal(isCurrentRoomPacket(old,current),true);
  assert.equal(isCurrentRoomPacket(old,{bindingGeneration:1,token:'new-mailbox'}),false);
  assert.equal(isCurrentRoomPacket({generation:2},current),false);
});

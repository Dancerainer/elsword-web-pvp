import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePeerReceipts,pruneAcknowledgedPeerActions,hasPeerActionBaselines,MAX_PEER_CONTROL_IDS} from '../../packages/online/peer-receipts.mjs';

const receipt={playerId:'source',epoch:4,frameSeq:100,controlIds:[2,8,21]};
test('explicit peer control IDs preserve legacy receipts and detach their bounded ordered window',()=>{
 assert.deepEqual(normalizePeerReceipts([{playerId:'source',epoch:4,frameSeq:100}]),[{playerId:'source',epoch:4,frameSeq:100}]);
 const original=structuredClone(receipt),result=normalizePeerReceipts([original]);original.controlIds.push(99);
 assert.deepEqual(result,[receipt]);
 for(const controlIds of [null,{},[2,2],[2,1],[-1],[NaN],[1.1],[Number.MAX_SAFE_INTEGER+1],Array.from({length:MAX_PEER_CONTROL_IDS+1},(_,i)=>i)])
  assert.throws(()=>normalizePeerReceipts([{...receipt,controlIds}]),/invalid-peer-receipts/);
 assert.throws(()=>normalizePeerReceipts([{...receipt,watermark:100}]),/invalid-peer-receipts/);
 assert.throws(()=>normalizePeerReceipts([receipt,receipt]),/invalid-peer-receipts/);
 assert.deepEqual(normalizePeerReceipts([{...receipt,controlIds:[]}])[0].controlIds,[]);
});

test('same receiver/life evidence removes only explicit action IDs with no assumed intervening ACKs',()=>{
 const actions=[{id:1},{id:2},{id:3},{id:8},{id:20},{id:21}];
 const event={matchId:'room',playerId:'source',epoch:4,frameSeq:120,actions,actionEffectBaselines:[{id:42}]};
 const filtered=pruneAcknowledgedPeerActions(event,{...receipt,at:100},{now:101});
 assert.equal(filtered.skipped,3);assert.deepEqual(filtered.value.actions.map(row=>row.id),[1,3,20]);
 assert.equal(event.actions,actions);assert.equal(filtered.value.actionEffectBaselines,event.actionEffectBaselines);
 for(const stale of [{...receipt,playerId:'other',at:100},{...receipt,epoch:3,at:100},{...receipt,at:-650},{...receipt,at:102},
  {playerId:'source',epoch:4,frameSeq:100,at:100}])assert.equal(pruneAcknowledgedPeerActions(event,stale,{now:101}).skipped,0);
 assert.equal(pruneAcknowledgedPeerActions(event,{...receipt,at:100},{now:850}).skipped,0);
 assert.equal(pruneAcknowledgedPeerActions(event,{...receipt,at:100},{now:849}).skipped,3);
});

test('worker action codec definitions remain distinguishable from skippable established action rows',()=>{
 assert.equal(hasPeerActionBaselines({actions:[],actionActorBaseline:{x:0}}),true);
 assert.equal(hasPeerActionBaselines({actions:[],actionEffectBaselines:[{id:1}]}),true);
 assert.equal(hasPeerActionBaselines({actions:[],actionBuffBaselines:[{templateId:1}]}),true);
 assert.equal(hasPeerActionBaselines({actions:[{id:1}],actionEffectBaselines:[],actionBuffBaselines:[]}),false);
});

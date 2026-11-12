import test from 'node:test';
import assert from 'node:assert/strict';
import {createResultReceipt} from '../../apps/web/result-receipt.mjs';
test('ended reconnect skips only its account/match across duplicate delivery and reload',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  const packet={matchId:'ended',result:{players:[{id:'self'},{id:'other'}]}},receipts=createResultReceipt({storage});
  assert.equal(receipts.dismiss({matchId:'ended',playerId:'self'}),false);
  assert.equal(receipts.skipEndedReconnect({matchId:'ended',playerId:'self'}),true);
  assert.equal(receipts.accept(packet,{playerId:'self'}),null);
  assert.equal(createResultReceipt({storage}).accept(packet,{playerId:'self'}),null);
  assert.ok(createResultReceipt({storage}).accept(packet,{playerId:'other'}));
  assert.ok(receipts.accept({...packet,matchId:'next'},{playerId:'self'}));
});
test('ended reconnect receipt validates identities and tolerates unavailable storage',()=>{
  const receipts=createResultReceipt({storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}}});
  for(const value of [{},{matchId:'x'},{matchId:'x',playerId:''}])assert.equal(receipts.skipEndedReconnect(value),false);
  assert.equal(receipts.skipEndedReconnect({matchId:'x',playerId:'a'}),true);
  assert.equal(receipts.accept({matchId:'x',result:{players:[{id:'a'}]}},{playerId:'a'}),null);
});

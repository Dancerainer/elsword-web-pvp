import test from 'node:test';
import assert from 'node:assert/strict';
import {createResultReceipt} from '../../apps/web/result-receipt.mjs';
const packet={matchId:'match-1',result:{winnerTeam:0,players:[{id:'self',team:0,kills:4,assists:1,deaths:2},{id:'opponent',team:1,kills:2,deaths:4}]}};
test('reconnecting lobby accepts durable participant result once across SSE/poll object copies',()=>{
  const receipts=createResultReceipt(),context={mode:'lobby',playerId:'self'};
  assert.equal(receipts.accept(packet,context).recovered,true);
  for(let i=0;i<8;i++)assert.equal(receipts.accept(structuredClone(packet),context),null);
});
test('prior result cannot interrupt another match, practice, or another account',()=>{
  const receipts=createResultReceipt();
  for(const context of [{activeMatchId:'match-2',playerId:'self',mode:'online'},
    {playerId:'self',mode:'practice'},{playerId:'outsider',mode:'lobby'}])assert.equal(receipts.accept(packet,context),null);
  assert.equal(receipts.accept(packet,{activeMatchId:'match-1',playerId:'self',mode:'online'}).recovered,false);
});

const memoryStorage=()=>{const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
test('presentation alone survives reload; only explicit dismissal acknowledges the account result',()=>{
  const storage=memoryStorage(),context={mode:'lobby',playerId:'self'};
  const first=createResultReceipt({storage});assert.equal(first.accept(packet,context).recovered,true);
  assert.equal(storage.values.size,0,'receiving or showing a result is not acknowledgment');
  const afterReload=createResultReceipt({storage}),receipt=afterReload.accept(packet,context);assert.ok(receipt);
  assert.equal(afterReload.dismiss(receipt),true);
  assert.equal(createResultReceipt({storage}).accept(packet,context),null,'explicit return persists across page reconstruction');
  assert.ok(createResultReceipt({storage}).accept(packet,{mode:'lobby',playerId:'opponent'}),'one account cannot acknowledge another participant result');
  const next={...packet,matchId:'match-2'};assert.ok(createResultReceipt({storage}).accept(next,context));
});

test('unknown or unpresented results cannot be acknowledged, and two signed-in identities remain isolated',()=>{
  const storage=memoryStorage(),receipts=createResultReceipt({storage});
  assert.equal(receipts.dismiss({matchId:'match-1',playerId:'self'}),false);
  receipts.accept(packet,{playerId:'self'});
  assert.equal(receipts.dismiss({matchId:'match-1',playerId:'outsider'}),false);
  assert.equal(receipts.dismiss({matchId:'other',playerId:'self'}),false);assert.equal(storage.values.size,0);
  const other=receipts.accept(packet,{playerId:'opponent'});assert.ok(other);
  assert.equal(receipts.dismiss(other),true);
  assert.ok(createResultReceipt({storage}).accept(packet,{playerId:'self'}));
  assert.equal(createResultReceipt({storage}).accept(packet,{playerId:'opponent'}),null);
});

test('unavailable or malformed local storage never blocks results or return navigation',()=>{
  for(const storage of [null,{getItem(){throw Error('denied');},setItem(){throw Error('quota');}},
    {getItem:()=>'{invalid',setItem(){throw Error('quota');}},
    {getItem:()=>JSON.stringify({version:1,matchIds:[null,{},1]}),setItem(){}}]){
    const receipts=createResultReceipt({storage}),receipt=receipts.accept(packet,{playerId:'self'});
    assert.ok(receipt);assert.equal(receipts.dismiss(receipt),true);assert.equal(receipts.accept(packet,{playerId:'self'}),null);
  }
});

test('dismissal identities remain bounded and merge prior acknowledgments from another page',()=>{
  const storage=memoryStorage(),one=createResultReceipt({storage,limit:2}),two=createResultReceipt({storage,limit:2});
  const a=one.accept(packet,{playerId:'self'}),b=two.accept({...packet,matchId:'match-2'},{playerId:'self'});
  one.dismiss(a);two.dismiss(b);
  const three=createResultReceipt({storage,limit:2});assert.equal(three.accept(packet,{playerId:'self'}),null);
  assert.equal(three.accept({...packet,matchId:'match-2'},{playerId:'self'}),null);
  three.dismiss(three.accept({...packet,matchId:'match-3'},{playerId:'self'}));
  assert.equal(JSON.parse([...storage.values.values()][0]).matchIds.length,2);
  assert.equal(createResultReceipt({storage,limit:2}).accept({...packet,matchId:'match-3'},{playerId:'self'}),null);
});

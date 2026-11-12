import test from 'node:test';
import assert from 'node:assert/strict';
import {createPeerFailureEvidence} from '../../tools/network-peer-failure-v5.mjs';

test('no failure means no snapshot work, first failure is captured once with stack and actor context',()=>{
  let calls=0;const simulation={snapshot(){calls++;return {actors:[{id:'local',professionId:'BM',state:'RSI_DAMAGE_BIG_FRONT',loadout:[{skillId:24218}],buffs:[{name:'Burning',key:9}],sourceShadowStep:{key:null}}]};}};
  const capture=createPeerFailureEvidence({clock:()=>123});assert.equal(capture.serialized,null);assert.equal(capture.byteLength,0);assert.equal(calls,0);
  assert.equal(capture.capture(Error('first'),{simulation,localPlayerId:'local',eventType:'peer-owned-state',value:{playerId:'remote',report:{epoch:2,frameSeq:60}},presets:{BM:{passives:[24407],guildPassives:[500]}}}),true);
  assert.equal(capture.capture(Error('second'),{simulation}),false);assert.equal(calls,1);
  const row=JSON.parse(capture.serialized);assert.equal(row.error.message,'first');assert.match(row.error.stack,/Error: first/);
  assert.equal(row.trigger.epoch,2);assert.deepEqual(row.actors[0].sourceShadowStep,{key:null});assert.deepEqual(row.actors[0].configuredPreset.passives,[24407]);
});

test('oversized evidence stays valid JSON under its byte budget and states explicit omissions',()=>{
  const capture=createPeerFailureEvidence({maximumBytes:4096}),large='\uad00'.repeat(100000);
  capture.capture(Error('actual trigger'),{localPlayerId:'local',simulation:{snapshot:()=>({actors:[{id:'local',professionId:'VC',buffs:[{name:large}],loadout:[{skillId:24221}]}]})},eventType:'state',value:{actions:[large]}});
  assert.ok(capture.byteLength<=4096);const row=JSON.parse(capture.serialized);assert.equal(row.error.message,'actual trigger');
  assert.ok(row.omitted.length);assert.ok(row.omitted.every(item=>typeof item.reason==='string'));assert.equal(row.actors[0].id,'local');
});

test('credentials and headers are excluded or redacted, including nested triggering owner fields',()=>{
  const capture=createPeerFailureEvidence();capture.capture(Error('trigger'),{cookie:'PRIVATE_COOKIE',password:'PRIVATE_PASSWORD',headers:{authorization:'PRIVATE_AUTH'},
    simulation:{snapshot:()=>({actors:[{id:'a',professionId:'RS',password:'PRIVATE_PASSWORD',buffs:[{name:'burn',cookie:'PRIVATE_COOKIE',raw:{authorization:'PRIVATE_AUTH',accessToken:'PRIVATE_TOKEN'}}]}]})},
    value:{playerId:'a',headers:{cookie:'PRIVATE_COOKIE'},report:{actor:{password:'PRIVATE_PASSWORD'},secret:'PRIVATE_SECRET'},snapshot:{actors:[{id:'a',cookie:'PRIVATE_COOKIE'}]}},presets:{RS:{passives:[1],password:'PRIVATE_PASSWORD'}}});
  for(const value of ['PRIVATE_COOKIE','PRIVATE_PASSWORD','PRIVATE_AUTH','PRIVATE_TOKEN','PRIVATE_SECRET'])assert.ok(!capture.serialized.includes(value));
  const row=JSON.parse(capture.serialized);assert.equal(row.trigger.payload.report.secret,'[redacted]');assert.equal(row.actors[0].buffs[0].name,'burn');
});

test('snapshot failure retains the original triggering error',()=>{
  const capture=createPeerFailureEvidence();capture.capture(Error('original'),{simulation:{snapshot(){throw Error('snapshot unavailable');}}});
  const row=JSON.parse(capture.serialized);assert.equal(row.error.message,'original');assert.equal(row.snapshotError,'snapshot unavailable');
});

test('multibyte and JSON-escaped error text cannot exceed the strict file limit',()=>{
  const capture=createPeerFailureEvidence({maximumBytes:4096});const error=Error('\uad00\n'.repeat(20000));error.stack='\uad0e\n'.repeat(20000);
  capture.capture(error);assert.ok(capture.byteLength<=4096);assert.ok(JSON.parse(capture.serialized).omitted.length);
});

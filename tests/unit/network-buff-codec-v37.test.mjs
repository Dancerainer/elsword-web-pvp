import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeNetworkBinary,decodeNetworkBinary,NETWORK_BINARY_VERSION,NETWORK_BINARY_BUFF_FIELDS,NETWORK_BINARY_DICTIONARY,NETWORK_BINARY_DICTIONARY_V2} from '../../packages/online/network-binary.mjs';
import {createOwnerPoseDelta} from '../../packages/online/owner-pose-delta.mjs';
import {authoredBuffFixtures} from '../helpers/network-buff-codec-v37.mjs';
const source=await authoredBuffFixtures(),hex=value=>Uint8Array.from(Buffer.from(value.replaceAll(' ',''),'hex'));
const packet=buffs=>({protocol:'local-owner-v1',epoch:1,frameSeq:1,actor:{x:0,history:'x'.repeat(300),buffs},effects:[],hits:[],actions:[]});

test('v2 covers all actual top-level Buff fields and keeps legacy dictionary immutable',()=>{
 assert.ok(NETWORK_BINARY_VERSION>=2);assert.deepEqual(NETWORK_BINARY_DICTIONARY_V2.slice(0,NETWORK_BINARY_DICTIONARY.length),NETWORK_BINARY_DICTIONARY);
 for(const fields of NETWORK_BINARY_BUFF_FIELDS){assert.equal(new Set(fields).size,fields.length);assert.equal(Object.isFrozen(fields),true);}
 for(const {buff}of source.rows)for(const key of Object.keys(buff))assert.ok(NETWORK_BINARY_BUFF_FIELDS[0].includes(key),key);
});

for(const row of source.rows)test(`${row.id} production Buff factory output roundtrips exactly through typed v2 and legacy v1`,()=>{
 const status={type:'owner-status',actor:{buffs:[row.buff],invincible:false,superArmor:false,superArmorNotRed:true}};
 const previous=structuredClone(status),legacy=encodeNetworkBinary(status,{version:1}),typed=encodeNetworkBinary(status,{version:2});
 assert.deepEqual(decodeNetworkBinary(typed),status);assert.deepEqual(decodeNetworkBinary(legacy),status);assert.deepEqual(status,previous);
 assert.equal(JSON.stringify(decodeNetworkBinary(typed)),JSON.stringify(status),'property order remains exact');assert.ok(typed.length<legacy.length);
});

test('literal v2 record vectors specify fields, ordered nested rows, extensions and null prototypes',()=>{
 // tag15, schema1, one key: field2(templateId), unsigned7. This is a generic
 // transport record; domain validation still belongs to the owner contract.
 assert.deepEqual(decodeNetworkBinary(hex('45574e4202 0f0101 02 0307')),{templateId:7});
 assert.deepEqual(decodeNetworkBinary(hex('45574e4202 100101 02 0307')),Object.assign(Object.create(null),{templateId:7}));
 const buff=structuredClone(source.rows[0].buff);buff.futureCounter={now:-0,optional:undefined,sparse:[,1/3],nil:null};
 buff.behaviors.push({type:999,kind:'future',extension:['\uad00\uad09','\ud800',NaN]});buff.finalizers.push({kind:'time',remaining:.1,sourceDuration:1,newClock:42});
 Object.setPrototypeOf(buff,null);const decoded=decodeNetworkBinary(encodeNetworkBinary(buff));assert.deepEqual(decoded,buff);
 assert.deepEqual(Object.keys(decoded),Object.keys(buff));assert.equal(Object.getPrototypeOf(decoded),null);
});

test('v2 records reject unknown schemas, field overflow, duplicate keys, aliases and malformed expansions',()=>{
 for(const wire of ['0f0000','0f0400','0f0101ff00','0f0102020301020302'])assert.throws(()=>decodeNetworkBinary(hex('45574e4202'+wire)));
 // A known templateId key must use its field ID, never an ambiguous extension.
 const key=Buffer.from('templateId').toString('hex');assert.throws(()=>decodeNetworkBinary(hex('45574e4202 0f0101 00 070a'+key+'00')),/extension/);
 assert.throws(()=>decodeNetworkBinary(hex('45574e4201 0f0101020307')),/tag/);
 assert.throws(()=>encodeNetworkBinary({}, {version:NETWORK_BINARY_VERSION+1}),/version/);
 const encoded=encodeNetworkBinary({buffs:source.rows.map(row=>row.buff)});
 for(let length=0;length<encoded.length;length++)assert.throws(()=>decodeNetworkBinary(encoded.subarray(0,length)));
 assert.throws(()=>decodeNetworkBinary(encoded,{maximumDecodedBytes:encoded.length}),/decoded-size/);
});

test('typed Buff births and array replacements coexist with frozen pose v2 masks and lost packets',()=>{
 const sender=createOwnerPoseDelta({validate:value=>value}),receiver=createOwnerPoseDelta({validate:value=>value});
 const send=(report,base,wireVersion)=>{const wire=sender.encode(report,{version:2,acknowledgedEpoch:1,acknowledgedFrameSeq:base});const decoded=receiver.decode(decodeNetworkBinary(encodeNetworkBinary(wire,{version:wireVersion})));assert.deepEqual(decoded.report,report);decoded.commit();return wire;};
 const first=packet(source.rows.map(row=>row.buff));send(first,-1,1);
 const lost=structuredClone(first);lost.frameSeq=2;lost.actor.buffs.reverse();sender.encode(lost,{version:2,acknowledgedEpoch:1,acknowledgedFrameSeq:1});
 const next=structuredClone(lost);next.frameSeq=3;next.actor.buffs[0].finalizers[0].remaining-=.125;next.actor.buffs.push(structuredClone(source.rows[0].buff));send(next,1,2);
 const deleted=structuredClone(next);deleted.frameSeq=4;deleted.actor.buffs.splice(1,2);send(deleted,3,1);
});

test('pose candidate accounting retains bounded private bytes after public mutation and cache eviction',()=>{
 const source=packet([]),sender=createOwnerPoseDelta({validate:value=>value,maximumSnapshots:2}),receiver=createOwnerPoseDelta({validate:value=>value,maximumSnapshots:2});let base=-1;
 for(let frame=1;frame<=4;frame++){
  const report=structuredClone(source);report.frameSeq=frame;report.actor.x=frame;
  const candidate=receiver.decode(sender.encode(report,{version:2,acknowledgedEpoch:1,acknowledgedFrameSeq:base}));
  candidate.report.actor.history='mutated'.repeat(20000);candidate.commit();base=frame;
 }
 const expected=[3,4].reduce((total,frameSeq)=>total+Buffer.byteLength(JSON.stringify({...source,frameSeq,actor:{...source.actor,x:frameSeq}})),0);
 assert.equal(receiver.performance().receivedBytes,expected);assert.equal(sender.performance().sentBytes,expected);
 assert.equal(receiver.performance().receivedSnapshots,2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encodeNetworkBinary,decodeNetworkBinary,NETWORK_BINARY_VERSION,NETWORK_BINARY_DICTIONARY,NETWORK_BINARY_DICTIONARY_V2,NETWORK_BINARY_DICTIONARY_V3,networkJsonByteLength} from '../../packages/online/network-binary.mjs';
import {networkCodecCorpus} from '../helpers/network-codec-v59.mjs';
const hex=value=>Uint8Array.from(Buffer.from(value.replaceAll(' ',''),'hex'));
const packet=body=>hex('45574e4203'+body);
const roundtrip=value=>decodeNetworkBinary(encodeNetworkBinary(value));

test('v3 literal vectors define exact small integers, key-only records and local string references',()=>{
  assert.equal(NETWORK_BINARY_VERSION,3);
  for(const [value,body]of [[0,'20'],[127,'9f'],[-1,'a0'],[-32,'bf'],[-33,'0421'],[128,'038001'],[-0,'0500000080'],
    [{},'1100'],[Object.create(null),'1200'],[{epoch:1},'1101 03 21'],[['abcd','abcd'],'0b02 070461626364 1300']]){
    assert.deepEqual(encodeNetworkBinary(value),packet(body));assert.deepEqual(decodeNetworkBinary(packet(body)),value);
  }
  for(const version of [1,2])for(const body of ['20','9f','a0','bf','1100','1200','1300'])assert.throws(()=>decodeNetworkBinary(hex(`45574e420${version}`+body)),/tag/);
});

test('v1/v2 dictionary bytes remain frozen and v3 only appends independent static words',()=>{
  const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  // Constants are filled from the archived declarations, not from
  // runtime-generated gameplay expectations.
  assert.equal(sha(NETWORK_BINARY_DICTIONARY),'1aa8c8038d4ccf831275d4582ef45232ec81dfe077dcb2fa52cdf22f13d985a6');
  assert.equal(sha(NETWORK_BINARY_DICTIONARY_V2),'b602a155a946edd6a529c1338f566e91c6f17f12d76fa6795b67c8cb84210dbd');
  assert.deepEqual(NETWORK_BINARY_DICTIONARY_V3.slice(0,NETWORK_BINARY_DICTIONARY_V2.length),NETWORK_BINARY_DICTIONARY_V2);
  assert.equal(new Set(NETWORK_BINARY_DICTIONARY_V3).size,NETWORK_BINARY_DICTIONARY_V3.length);
  assert.equal(Object.isFrozen(NETWORK_BINARY_DICTIONARY_V3),true);
});

test('legacy Buff, behavior and finalizer bytes retain v1 objects and v2 typed records exactly',()=>{
  const value={schemaVersion:1,templateId:7,behaviors:[{type:3,kind:'new'}],finalizers:[{kind:'time',remaining:2}]};
  // Independently specified field encodings: legacy WORD IDs are templateId
  // 166, type 18, kind 235, time 206 and remaining 167. V1's remaining names
  // are UTF8 literals; all three object levels use OBJECT (09), never RECORD.
  const v1=hex('45574e4201 0904 070d736368656d6156657273696f6e 0301 0aa601 0307 '
    +'07096265686176696f7273 0b01 0902 0a12 0303 0aeb01 07036e6577 '
    +'070a66696e616c697a657273 0b01 0902 0aeb01 0ace01 0aa701 0302');
  // V2's schema 1 fields are schemaVersion=1/templateId=2/behaviors=7/
  // finalizers=8. Nested behavior/finalizer schemas are 2/3, respectively.
  const v2=hex('45574e4202 0f0104 01 0301 02 0307 07 0b01 0f0202 01 0303 02 07036e6577 '
    +'08 0b01 0f0302 01 0ace01 02 0302');
  for(const [version,wire]of [[1,v1],[2,v2]]){
    assert.deepEqual(encodeNetworkBinary(value,{version}),wire);assert.deepEqual(decodeNetworkBinary(wire),value);
    const nullRoot=Object.assign(Object.create(null),value),nullWire=wire.slice();nullWire[5]=version===1?14:16;
    assert.deepEqual(encodeNetworkBinary(nullRoot,{version}),nullWire);assert.deepEqual(decodeNetworkBinary(nullWire),nullRoot);
  }
});

test('v3 keeps arbitrary UTF16, sparse arrays, undefined, null prototypes and IEEE754 exactly',()=>{
  const uncommon='repeat-\ud800-\udfff-\uad00\uad09-🗡️',unknownKey='newField-\ud800',object=Object.assign(Object.create(null),{[unknownKey]:uncommon,z:undefined});
  const value={first:uncommon,second:uncommon,object,again:object,values:[0,-0,1/3,.1,Math.fround(.1),Number.MIN_VALUE,Number.MAX_VALUE,
    Number.MAX_SAFE_INTEGER,-Number.MAX_SAFE_INTEGER,2**53,-(2**53),NaN,Infinity,-Infinity,undefined,,null]};
  const decoded=roundtrip(value);assert.deepEqual(decoded,value);assert.deepEqual(Object.keys(decoded.object),Object.keys(object));
  for(let index=0;index<value.values.length;index++)assert.ok(Object.is(value.values[index],decoded.values[index]));
  assert.equal(networkJsonByteLength(decoded),Buffer.byteLength(JSON.stringify(value)));
});

test('packet-local references cannot cross packets and remain bounded after 1024 unique strings',()=>{
  const values=Array.from({length:1100},(_,index)=>`custom-string-${index}`);values.push(values[0],values[1023],values[1024],values[1099]);
  assert.deepEqual(roundtrip(values),values);
  const wires=values.slice(0,8).map(value=>encodeNetworkBinary([value,value]));
  for(const wire of wires.reverse())assert.equal(decodeNetworkBinary(wire)[0],decodeNetworkBinary(wire)[1]);
  assert.throws(()=>decodeNetworkBinary(packet('1300')),/string-reference/);
  assert.throws(()=>decodeNetworkBinary(packet('0b02 070461626364 1301')),/string-reference/);
  assert.throws(()=>decodeNetworkBinary(packet('0b02 070461626364 138000')),/integer/);
});

test('v3 malformed keys, alias extensions, duplicate references and reserved tags are rejected',()=>{
  for(const body of ['1101 ffff7f 00','1101 8300 00','1101 00 070565706f6368 00','1102 0321 0322',
    '1101 00 07095f5f70726f746f5f5f 00','1102 00 070461626364 20 00 1300 21','14','1f','c0','ff'])assert.throws(()=>decodeNetworkBinary(packet(body)));
  assert.throws(()=>encodeNetworkBinary(JSON.parse('{"constructor":1}')),/key/);
});

test('each reference spends full expansion budget and every truncation stays invalid',()=>{
  const value={extension:'unique-text'.repeat(10),copies:Array(400).fill('unique-text'.repeat(10))},wire=encodeNetworkBinary(value);
  assert.deepEqual(decodeNetworkBinary(wire),value);assert.ok(wire.length<2000);
  assert.throws(()=>decodeNetworkBinary(wire,{maximumDecodedBytes:4096}),/decoded-size/);
  assert.throws(()=>decodeNetworkBinary(wire,{maximumBytes:wire.length-1}),/size/);
  for(let length=0;length<wire.length;length++)assert.throws(()=>decodeNetworkBinary(wire.subarray(0,length)));
  assert.throws(()=>decodeNetworkBinary(Uint8Array.from([...wire,0])),/trailing/);
});

test('current movement, action, effect, twelve-profession Buff and four-player packets roundtrip and shrink',async()=>{
  const corpus=await networkCodecCorpus();assert.equal(corpus.rows.length,25);
  for(const row of corpus.rows){
    const original=structuredClone(row.value),wire=encodeNetworkBinary(row.value),v2=encodeNetworkBinary(row.value,{version:2});
    assert.deepEqual(decodeNetworkBinary(wire),original,row.name);assert.deepEqual(decodeNetworkBinary(v2),original,row.name);
    assert.equal(JSON.stringify(decodeNetworkBinary(wire)),JSON.stringify(original),row.name+': order');
    assert.deepEqual(row.value,original,row.name+': immutable');assert.ok(wire.length<v2.length,row.name+': raw bytes');
  }
});

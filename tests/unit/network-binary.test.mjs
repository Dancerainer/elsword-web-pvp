import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeNetworkBinary,decodeNetworkBinary,isNetworkBinary,networkJsonByteLength,NETWORK_BINARY_DICTIONARY} from '../../packages/online/network-binary.mjs';
const bytes=hex=>Uint8Array.from(Buffer.from(hex.replaceAll(' ',''),'hex'));
const prefix='45574e4201';
const roundtrip=value=>decodeNetworkBinary(encodeNetworkBinary(value));
test('binary envelope has a stable independently specified magic/version and scalar encodings',()=>{
 const vectors=[[null,'00'],[false,'01'],[true,'02'],[0,'0300'],[127,'037f'],[128,'038001'],[-1,'0401'],
  [1.5,'050000c03f'],[-0,'0500000080'],['Q','070151'],[[], '0b00'],[{},'0900'],['epoch','0a02']];
 for(const [value,hex]of vectors){const wire=bytes(prefix+hex);assert.deepEqual(encodeNetworkBinary(value,{version:1}),wire);assert.deepEqual(decodeNetworkBinary(wire),value);}
 assert.equal(new Set(NETWORK_BINARY_DICTIONARY).size,NETWORK_BINARY_DICTIONARY.length);
});
test('every JS numeric value retains exact precision, sign and exceptional values',()=>{
 const values=[0,-0,Number.MIN_VALUE,Number.MAX_VALUE,Number.MAX_SAFE_INTEGER,-Number.MAX_SAFE_INTEGER,2**53,-(2**53),2**32-1,2**32,
  1/3,Math.PI,.1,Math.fround(.1),1e-30,-1e30,Infinity,-Infinity,NaN];
 const result=roundtrip(values);for(let i=0;i<values.length;i++)assert.ok(Object.is(result[i],values[i]),String(values[i]));
});
test('UTF8, BOM, escaped controls and unpaired UTF16 code units retain their exact values',()=>{
 const cases=['','\uad00\uad09\uad11\uad10\uad07','🗡️','\ufeffprefix','a\u0000\n\t\b\\"','\ud800','\udfff','\ud800z','\ud800\ud800\udc00','x'.repeat(20000)];
 for(const value of cases)assert.equal(roundtrip(value),value);
 const obj={'\ud800': '\udfff','\uad00\uad09':'🗡️'};assert.deepEqual(roundtrip(obj),obj);
});
test('undefined, missing properties, null, empty collections, sparse arrays and null prototypes stay distinct',()=>{
 const value={present:undefined,nil:null,list:[],obj:{},sparse:[1,,undefined,3],nested:Object.assign(Object.create(null),{x:1})};
 assert.deepEqual(roundtrip(value),value);assert.equal(Object.hasOwn(roundtrip(value),'absent'),false);
});
test('self-contained packets decode out of order without an adaptive/shared dictionary',()=>{
 const messages=Array.from({length:8},(_,frameSeq)=>({type:'owner-pose',epoch:2,frameSeq,actor:{x:frameSeq+.1,y:2,state:'skill'},effects:[],unique:'different'+frameSeq}));
 const encoded=messages.map(message=>encodeNetworkBinary(message));for(let i=7;i>=0;i--)assert.deepEqual(decodeNetworkBinary(encoded[i]),messages[i]);
 const padded=new Uint8Array(encoded[0].length+10);padded.set(encoded[0],5);assert.deepEqual(decodeNetworkBinary(padded.subarray(5,-5)),messages[0]);
 assert.deepEqual(decodeNetworkBinary(new DataView(padded.buffer,5,encoded[0].length)),messages[0]);
});
test('exact JSON UTF8 byte counts match scalar and full production-shaped payloads',()=>{
 const values=[null,true,-0,NaN,1e21,1e-7,'\ud800','\ufeff\uad00\uad09🗡️','"\\\b\t\n\f\r\0',
  [undefined,,1],{ignored:undefined,x:1,list:[undefined,,null]},
  {protocol:'local-owner-v1',epoch:1,frameSeq:17,actor:{x:1/3,y:0,state:29,buffs:[]},actions:[],effects:[]}];
 for(const value of values){const expected=new TextEncoder().encode(JSON.stringify(value)).length;assert.equal(networkJsonByteLength(value),expected);assert.equal(networkJsonByteLength(value,{maximumBytes:expected}),expected);assert.throws(()=>networkJsonByteLength(value,{maximumBytes:expected-1}),/decoded-size|limit/);}
});
test('malformed versions, trailing bytes, duplicate keys, dangerous keys, noncanonical and huge varints are rejected',()=>{
 for(const hex of ['','45574e4200 00','45574e4204 00',prefix+'00 00',prefix+'ff',prefix+'03 8000',prefix+'03 ffffffffffffffff',prefix+'0a ffff7f',prefix+'07 01 ff',prefix+'0d',prefix+'09 02 07016100 07016101'])assert.throws(()=>decodeNetworkBinary(bytes(hex)));
 const key=Buffer.from('__proto__').toString('hex');assert.throws(()=>decodeNetworkBinary(bytes(prefix+'09 01 07 09'+key+'00')),/key/);
 for(const key of ['__proto__','constructor','prototype'])assert.throws(()=>encodeNetworkBinary(JSON.parse(`{"${key}":null}`)),/key/);
 assert.equal(isNetworkBinary(bytes(prefix+'00')),true);assert.equal(isNetworkBinary(bytes('45574e4202 00')),true);assert.equal(isNetworkBinary(bytes('45574e4203 00')),true);assert.equal(isNetworkBinary(bytes('45574e4204 00')),false);assert.equal(isNetworkBinary(null),false);
});
test('all truncations and bounded encoded/decoded expansion are rejected before allocating large output',()=>{
 const wire=encodeNetworkBinary({actor:{x:.1,y:100,state:29,buffs:[{templateId:98,remaining:1/3}]},effects:[]});
 for(let length=0;length<wire.length;length++)assert.throws(()=>decodeNetworkBinary(wire.subarray(0,length)));
 assert.throws(()=>encodeNetworkBinary({x:'a'.repeat(1000)},{maximumBytes:50}),/size/);
 assert.throws(()=>decodeNetworkBinary(wire,{maximumBytes:wire.length-1}),/size/);
 const dictionaryExpansion=encodeNetworkBinary(Array(1000).fill('acknowledgedStatusRevision'));
 assert.throws(()=>decodeNetworkBinary(dictionaryExpansion,{maximumDecodedBytes:1000}),/decoded-size/);
 assert.throws(()=>decodeNetworkBinary(bytes(prefix+'0b ffff7f')),/entries/);
 assert.throws(()=>decodeNetworkBinary(bytes(prefix+'07 ffff7f')),/truncated/);
 const deep={};let child=deep;for(let i=0;i<50;i++)child=child.x={};assert.throws(()=>encodeNetworkBinary(deep),/depth/);
 const cyclic={};cyclic.self=cyclic;assert.throws(()=>encodeNetworkBinary(cyclic),/value/);
 for(const value of [new Date(),new Map(),new Set(),()=>1,Symbol('x'),1n])assert.throws(()=>encodeNetworkBinary(value));
});
test('deterministic generated JSON trees retain exact structure through binary and byte accounting',()=>{
 let seed=17;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 const tree=depth=>{const n=rand()%8;if(depth>4)return (rand()%2?rand()/13:'value'+rand());if(n<2)return rand()%2===0;if(n===2)return null;if(n===3)return rand()/7;if(n===4)return '\uad00\uad09'+rand();if(n<6)return Array.from({length:rand()%5},()=>tree(depth+1));const obj={};for(let i=0;i<rand()%5;i++)obj['key'+i]=tree(depth+1);return obj;};
 for(let i=0;i<400;i++){const value=tree(0);assert.deepEqual(roundtrip(value),value);assert.equal(networkJsonByteLength(value),Buffer.byteLength(JSON.stringify(value)));}
});

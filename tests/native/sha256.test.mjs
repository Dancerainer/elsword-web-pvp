import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sha256Hex,sha256HexFallback} from '../../packages/native-source/sha256.mjs';

const encoded=text=>new TextEncoder().encode(text);
const expected=bytes=>createHash('sha256').update(bytes).digest('hex');
test('pure JavaScript SHA256 matches published known vectors including multiple padding blocks',async()=>{
  for(const [text,hash]of [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['a'.repeat(1_000_000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
  ]){assert.equal(sha256HexFallback(encoded(text)),hash);assert.equal(await sha256Hex(encoded(text),{}),hash);}
});
test('fallback and WebCrypto match independent Node SHA256 at block/padding boundaries and random lengths',async()=>{
  const lengths=[0,1,2,7,31,32,55,56,57,63,64,65,119,120,121,127,128,129,255,256,257,1023,1024,1025,65535,65536];
  for(let index=0;index<32;index++)lengths.push(randomBytes(2).readUInt16BE());
  for(const length of lengths){const bytes=randomBytes(length),hash=expected(bytes);assert.equal(sha256HexFallback(bytes),hash,'fallback length '+length);assert.equal(await sha256Hex(bytes,webcrypto),hash,'WebCrypto length '+length);}
});
test('byte offsets, subarray lengths, DataView and ArrayBuffer inputs hash exactly their bytes without mutation',async()=>{
  const backing=randomBytes(200),before=Buffer.from(backing),view=new Uint8Array(backing.buffer,backing.byteOffset+17,73),hash=expected(view);
  for(const input of [view,view.subarray(0),new DataView(view.buffer,view.byteOffset,view.byteLength),view.slice().buffer]){
    assert.equal(sha256HexFallback(input),hash);assert.equal(await sha256Hex(input,{}),hash);assert.equal(await sha256Hex(input,webcrypto),hash);
  }
  assert.deepEqual(backing,before);assert.equal(sha256HexFallback(view.subarray(10,10)),expected(new Uint8Array()));
  for(const input of [null,undefined,'abc',[1,2,3],{}])assert.throws(()=>sha256HexFallback(input),TypeError);
});
test('available WebCrypto retains its receiver and an operational error never bypasses integrity verification',async()=>{
  let calls=0;const bytes=encoded('module integrity'),subtle={async digest(algorithm,value){calls++;assert.equal(this,subtle);assert.equal(algorithm,'SHA-256');assert.deepEqual(value,bytes);return Uint8Array.from(createHash('sha256').update(value).digest()).buffer;}};
  assert.equal(await sha256Hex(bytes,{subtle}),expected(bytes));assert.equal(calls,1);
  await assert.rejects(sha256Hex(bytes,{subtle:{digest(){throw Error('hash operation failed');}}}),/hash operation failed/);
});
test('browser-like HTTP environment without crypto.subtle or Node APIs still computes SHA256',async()=>{
  const source=readFileSync(new URL('../../packages/native-source/sha256.mjs',import.meta.url),'utf8').replace(/^export /gm,'');
  const context=vm.createContext({crypto:{},Uint8Array,Uint32Array,ArrayBuffer,DataView});vm.runInContext(source,context);
  assert.equal(await context.sha256Hex(encoded('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  delete context.crypto;assert.equal(await context.sha256Hex(encoded('')),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

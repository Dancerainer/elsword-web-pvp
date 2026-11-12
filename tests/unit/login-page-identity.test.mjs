import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../apps/web/login.mjs',import.meta.url),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const run=new AsyncFunction('document','crypto','window','fetch',source);
async function load(crypto){
  const app={dataset:{}},requests=[],listeners=new Map();
  const form={addEventListener(type,callback){listeners.set(type,callback);}};
  const document={querySelector(selector){return selector==='#app'?app:form;}};
  await run(document,crypto,{addEventListener(){}},async(url,options)=>{requests.push({url,options});return {ok:false};});
  return {app,requests,listeners};
}
test('login page identity works on HTTP without secure-context randomUUID',async()=>{
  let generated=0;
  const f=await load({getRandomValues(value){generated++;assert.equal(value.length,16);for(let index=0;index<16;index++)value[index]=index*17;return value;}});
  assert.equal(generated,1);assert.equal(f.app.dataset.pageInitToken,'00112233445566778899aabbccddeeff');
  assert.match(f.app.dataset.pageInitToken,/^[A-Za-z0-9_-]{8,100}$/);
  assert.equal(f.requests[0].options.headers['X-RF-Page-Init'],f.app.dataset.pageInitToken);
  assert.equal(typeof f.listeners.get('submit'),'function');
});
test('login uses native randomUUID when available',async()=>{
  const f=await load({randomUUID:()=> '01234567-89ab-4cde-8fab-0123456789ab',getRandomValues(){assert.fail('fallback should not run');}});
  assert.equal(f.app.dataset.pageInitToken,'01234567-89ab-4cde-8fab-0123456789ab');
});

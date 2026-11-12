import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourceTimingSummary} from '../../apps/web/resource-timing-summary.mjs';
const entry=(file,bytes)=>({name:'http://localhost/'+file,transferSize:bytes,decodedBodySize:bytes+20});
test('observer drains each preload/new map entry once and retains only the three largest transfers',()=>{
  let callback,pending=[entry('assets/one',200),entry('game/js',10000),entry('assets/two',0)];
  class Observer{constructor(fn){callback=fn;}observe(value){assert.deepEqual(value,{type:'resource',buffered:true});}takeRecords(){return pending.splice(0);}disconnect(){}}
  const summary=createResourceTimingSummary({PerformanceObserver:Observer});
  assert.equal(summary.snapshot().requests,2);assert.equal(summary.snapshot().requests,2);
  callback({getEntries:()=>[entry('assets/three',300),entry('assets/four',100),entry('assets/five',400)]});
  const data=summary.snapshot();assert.equal(data.requests,5);assert.equal(data.reused,1);assert.equal(data.transferredBytes,1000);
  assert.deepEqual(data.largestTransfers.map(row=>row.bytes),[400,300,200]);data.largestTransfers.length=0;
  assert.equal(summary.snapshot().largestTransfers.length,3);
});
test('unsupported observer falls back to consuming only appended entries',()=>{
  const rows=[entry('assets/one',1)];
  const summary=createResourceTimingSummary({performance:{getEntriesByType:()=>rows}});
  assert.equal(summary.snapshot().requests,1);assert.equal(summary.snapshot().requests,1);
  rows.push(entry('assets/two',2));assert.equal(summary.snapshot().transferredBytes,3);
});

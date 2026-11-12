import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputStageTrace} from '../../apps/web/input-stage-trace.mjs';
const actor=(stateSerial=1)=>({id:'local',state:'RSI_WAIT',stateSerial});
test('repeated edges of one key in a single device sample count only its final accepted press',()=>{
  const trace=createInputStageTrace();
  const elapsed=trace.record({input:{pressed:['Z'],edges:[{key:'Z',down:true,time:.001},{key:'Z',down:false,time:.002},{key:'Z',down:true,time:.003}]},
    sampledAt:10,completedAt:12,before:actor(),after:actor(2),step:1});
  assert.deepEqual(elapsed,[9]);assert.deepEqual(trace.snapshot().rows.map(row=>row.pressed),[false,false,true]);
  assert.equal(trace.snapshot().inputToSample.count,1);assert.equal(trace.snapshot().inputToSample.p95Ms,7);
});
test('two physical presses retain their own sampling timestamps instead of the most recent key overwriting the first',()=>{
  const trace=createInputStageTrace();
  trace.record({input:{pressed:['X','Z'],edges:[{key:'X',down:true,time:.01},{key:'Z',down:true,time:.018}]},
    sampledAt:20,completedAt:24,before:actor(),after:actor(2),step:1,reportFrame:7});
  trace.presented(actor(2),29);
  const value=trace.snapshot();assert.deepEqual(value.rows.map(row=>row.sampledAt-row.inputAt),[10,2]);
  assert.deepEqual(value.rows.map(row=>row.completedAt-row.inputAt),[14,6]);
  assert.deepEqual(value.rows.map(row=>row.renderSubmittedAt-row.completedAt),[5,5]);
  assert.equal(value.rows[0].reportFrame,7);assert.equal(value.rows[0].beforeSerial,1);
  value.rows[0].key='mutated';assert.equal(trace.snapshot().rows[0].key,'X');
});
test('catch-up states skipped before rendering are not assigned a fictitious visible timestamp; context resets retire pending rows',()=>{
  const trace=createInputStageTrace({capacity:2});
  for(let step=1;step<=3;step++)trace.record({input:{pressed:['Z'],edges:[{key:'Z',down:true,time:step/1000}]},
    sampledAt:step+1,completedAt:step+2,before:actor(step-1),after:actor(step),step});
  trace.presented(actor(3),10);
  assert.deepEqual(trace.snapshot().rows.map(row=>row.renderStatus),['superseded-before-render','submitted']);
  assert.equal(trace.snapshot().rows[0].renderSubmittedAt,null);
  trace.record({input:{pressed:['Z'],edges:[{key:'Z',down:true,time:.02}]},sampledAt:21,completedAt:22,before:actor(3),after:actor(4),step:4});
  trace.reset();trace.presented(actor(4),30);assert.equal(trace.snapshot().rows.at(-1).renderStatus,'context-reset');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOwnedTargetViews} from '../../packages/online/owned-state.mjs';
const reference=()=>({playerId:'victim',epoch:2,frameSeq:6,position:[123,456,0],
  positionSamples:[{frameSeq:3,weight:.25},{frameSeq:6,weight:.5},{frameSeq:9,weight:.25}]});
test('observed interpolation names only 2–4 ordered bounded known source poses, preserving exact-frame compatibility',()=>{
  const view=reference(),actual=validateOwnedTargetViews([view]);
  assert.deepEqual(actual,[view]);actual[0].positionSamples[0].weight=.4;
  assert.equal(view.positionSamples[0].weight,.25);
  const {positionSamples,...legacy}=view;assert.deepEqual(validateOwnedTargetViews([legacy]),[legacy]);
  const start={...reference(),frameSeq:0,positionSamples:[{frameSeq:0,weight:.5},{frameSeq:3,weight:.5}]};
  assert.deepEqual(validateOwnedTargetViews([start]),[start]);
});
test('observed interpolation rejects fabricated, unbounded or malformed witnesses',()=>{
  const mutations=[
    row=>row.positionSamples=[],row=>row.positionSamples=[{frameSeq:6,weight:1}],
    row=>row.positionSamples=Array.from({length:5},(_,index)=>({frameSeq:index*3,weight:.2})),
    row=>row.positionSamples[0].frameSeq=6,row=>row.positionSamples.reverse(),
    row=>row.positionSamples[1].frameSeq=7,row=>row.positionSamples[2].frameSeq=40,
    row=>row.positionSamples[0].weight=0,row=>row.positionSamples[0].weight=-.25,
    row=>row.positionSamples[0].weight=Infinity,row=>row.positionSamples[0].weight=NaN,
    row=>row.positionSamples[0].weight=.2,row=>row.positionSamples[0].x=123,
    row=>row.positionSamples=null,row=>row.positionSamples[0]=null,
  ];
  for(const mutate of mutations){const row=reference();mutate(row);assert.throws(()=>validateOwnedTargetViews([row]),/invalid-owner-target-views/);}
});

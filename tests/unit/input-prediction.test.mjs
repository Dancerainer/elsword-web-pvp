import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInputPredictionHistory} from '../../apps/web/input-prediction.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';

const raw=(held=[],pressed=[])=>({held:[...held],pressed:[...pressed],released:[],sampledDevice:true,pureDouble:[],oneDouble:[],edges:[]});
const snapshot={schemaVersion:1,versions:{referenceVersion:'target-static',presetVersion:'unit',programVersion:'unit'},actors:[{id:'local'},{id:'remote'}],stateMarker:{untouched:[1,2,3]}};
function stub(){return {restored:null,steps:[],restore(value){this.restored=value;},step(dt,inputs,options){this.steps.push({dt,inputs,options});}};}

test('server acknowledgement discards executed local frames and replays pending in recorded order',()=>{
  const history=createInputPredictionHistory(),sim=stub();history.record(1,raw(['RIGHT'],['RIGHT']));history.record(2,raw(['Z'],['Z']));history.record(3,raw());
  assert.equal(history.reconcile(sim,snapshot,'local',{local:{frameSeq:1},remote:{held:['LEFT'],pressed:['Z'],released:['RIGHT'],pureDouble:['LEFT']}}),2);
  assert.deepEqual(sim.restored,snapshot);assert.notEqual(sim.restored,snapshot);assert.deepEqual(sim.steps.map(s=>s.inputs.local.held),[['Z'],[]]);
  for(const step of sim.steps){assert.equal(step.dt,1/60);assert.deepEqual(step.options,{snapshot:false});assert.deepEqual(step.inputs.remote,{held:['LEFT'],pressed:[],released:[],sampledDevice:true,pureDouble:[],oneDouble:[]});}
});
test('record and replay clone nested sampled packets and received full snapshot seals',()=>{
  const history=createInputPredictionHistory(),input=raw(['RIGHT'],['RIGHT']);input.edges=[{key:'RIGHT',down:true,time:1}];input.pureDouble=['RIGHT'];history.record(5,input);
  input.held.push('X');input.edges[0].time=99;const sim=stub();history.reconcile(sim,snapshot,'local',{});
  assert.deepEqual(sim.steps[0].inputs.local.held,['RIGHT']);assert.equal(sim.steps[0].inputs.local.edges[0].time,1);assert.deepEqual(sim.steps[0].inputs.local.pureDouble,['RIGHT']);
  sim.restored.versions.programVersion='changed';sim.steps[0].inputs.local.edges[0].time=80;assert.equal(snapshot.versions.programVersion,'unit');
  const second=stub();history.reconcile(second,snapshot,'local',{});assert.equal(second.steps[0].inputs.local.edges[0].time,1);
});
test('all acknowledged frames require only restore; SSE pressed does not trigger a phantom step',()=>{
  const history=createInputPredictionHistory(),sim=stub();history.record(1,raw(['Z'],['Z']));assert.equal(history.reconcile(sim,snapshot,'local',{local:{frameSeq:1},remote:{held:['Z'],pressed:['Z']}}),0);assert.equal(sim.steps.length,0);assert.equal(history.pending,0);
});
test('invalid/non-increasing sequences, reverse acknowledgements and malformed held lists fail before restore',()=>{
  const history=createInputPredictionHistory(),sim=stub();for(const seq of [-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>history.record(seq,raw()));
  history.record(5,raw());assert.throws(()=>history.record(5,raw()),/strictly increase/);assert.throws(()=>history.record(4,raw()),/strictly increase/);
  history.reconcile(sim,snapshot,'local',{local:{frameSeq:5}});const before=sim.restored;assert.throws(()=>history.reconcile(sim,snapshot,'local',{local:{frameSeq:4}}),/backwards/);assert.equal(sim.restored,before);
  assert.throws(()=>history.reconcile(sim,snapshot,'local',{local:{frameSeq:5},remote:{held:['LEFT','LEFT']}}),/distinct/);assert.throws(()=>history.reconcile(sim,snapshot,'missing',{}),/local actor/);
  const resumed=createInputPredictionHistory();resumed.reconcile(stub(),snapshot,'local',{local:{frameSeq:100}});assert.throws(()=>resumed.record(99,raw()),/acknowledged/);resumed.record(101,raw());
});
test('bounded history clears old continuation on overflow, keeps newest, and clear resets match-local counters',()=>{
  const history=createInputPredictionHistory({maxFrames:2});history.record(1,raw());history.record(2,raw());assert.deepEqual(history.record(3,raw(['Z'],['Z'])),{frameSeq:3,overflow:true,pending:1});assert.equal(history.overflowCount,1);
  const sim=stub();assert.equal(history.reconcile(sim,snapshot,'local',{}),1);assert.deepEqual(sim.steps[0].inputs.local.held,['Z']);history.clear();assert.equal(history.pending,0);assert.equal(history.overflowCount,0);assert.equal(history.lastRecorded,null);history.record(1,raw());
});
test('actual pure combat core replay equals direct continuation for the same sampled inputs',()=>{
  // This tests the adapter against the present core, not a target-client golden.
  const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
  const map={sceneId:'prediction-unit-fixture',lines:[{lineId:0,start:[-2000,0,0],end:[2000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
  const make=()=>createSimulation({profile,map,seed:91,actors:[{id:'local',team:0,x:0,y:0},{id:'remote',team:1,x:900,y:0}]});
  const expected=make(),actual=make(),base=expected.snapshot(),history=createInputPredictionHistory();
  const inputs=[raw(['RIGHT'],['RIGHT']),raw(['RIGHT']),raw(['RIGHT','Z'],['Z']),raw(['RIGHT']),raw()];
  inputs.forEach((input,index)=>{history.record(index+1,input);expected.step(1/60,{local:input,remote:raw(['LEFT'])},{snapshot:false});});
  assert.equal(history.reconcile(actual,base,'local',{local:{frameSeq:0},remote:{held:['LEFT'],pressed:['Z']}}),5);
  assert.deepEqual(actual.snapshot(),expected.snapshot());
});

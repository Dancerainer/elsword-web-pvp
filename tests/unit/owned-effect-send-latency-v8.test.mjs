/** Web owner-send scheduling, not original-client behavior or WAN evidence.
 * The fixture supplies exact active-effect frames; no network or renderer runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'owner-send-scheduling',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(){
  const simulation=createSimulation({profile,map,networkOwnerId:'local',actors:[{id:'local',team:0,position:[0,0,0]}]});
  const sync=createLocalOwnershipSync();
  return {simulation,sync};
}
function effect(id,{react=1}={}){
  return {id,ownerId:'local',name:'SchedulingFixture',active:true,dead:false,animationTime:.1,elapsed:.1,
    damage:{DAMAGE_DATA:{REACT_TYPE:react},ATTACK_TIME_START:0,ATTACK_TIME_END:10}};
}
function trace({frames=120,starts=[],moving=false,urgentAt=0,react=1}={}){
  const {simulation,sync}=fixture(),reports=[];
  for(let frame=1;frame<=frames;frame++){
    for(let index=0;index<starts.length;index++)if(starts[index]===frame)simulation.state.effects.push(effect(index+1,{react}));
    if(moving)simulation.actor('local').x=frame;
    const events=frame===urgentAt?[{type:'worldStop',actorId:'local'}]:[];
    const report=sync.afterStep(simulation,'local',events);if(report)reports.push(report);
  }
  return reports;
}
const actions=reports=>reports.flatMap(report=>report.actions.map(action=>({sent:report.frameSeq,...action})));

for(const first of [4,5])test(`effect sampled at source frame ${first} leaves that frame, removing the old ${6-first}-frame periodic wait`,()=>{
  const reports=trace({frames:12,starts:[first]}),samples=actions(reports);
  const expected=first===4?[4,7,10]:[5,8,11];
  assert.deepEqual(samples.map(action=>action.frameSeq),expected,'same independently specified three-frame capture cadence');
  assert.deepEqual(samples.map(action=>action.sent),expected,'each existing critical sample leaves in its own source tick');
  assert.ok(samples.every(action=>action.ageFrames===0));
  assert.deepEqual(samples.map(action=>action.effects.map(row=>row.id)),expected.map(()=>[1]));
});

for(const moving of [false,true])test(`${moving?'steady movement':'idle'} stays at the original 20 Hz budget and never leaves a gap above three source frames`,()=>{
  const reports=trace({frames:120,moving}),frames=reports.map(report=>report.frameSeq);
  assert.ok(reports.length<=41,'v7 sends frame 1 plus the forty modulo-three reports');
  assert.ok(reports.length>=40,'ordinary pose heartbeat remains 20 Hz');
  assert.ok(frames.every((frame,index)=>index===0||frame-frames[index-1]<=3));
  assert.equal(actions(reports).length,0);
  if(moving)for(const report of reports)assert.equal(report.actor.x,report.frameSeq);
});

test('an immediate controller/control report restarts the ordinary pose deadline instead of adding a redundant next-frame report',()=>{
  const reports=trace({frames:11,urgentAt:2});
  assert.deepEqual(reports.map(report=>report.frameSeq),[1,2,5,8,11]);
  assert.deepEqual(actions(reports).map(action=>[action.frameSeq,action.sent]),[[2,2]]);
});

for(const start of [1,2,3])test(`a sustained single effect at phase ${start} keeps every sample and does not add a second 20 Hz report stream`,()=>{
  const reports=trace({frames:300,starts:[start]}),samples=actions(reports);
  const expected=Array.from({length:100},(_,index)=>start+3*index);
  assert.deepEqual(samples.map(action=>action.frameSeq),expected);
  assert.deepEqual(samples.map(action=>action.sent),expected);
  assert.ok(reports.length<=101,'old trace: frame 1 plus 100 periodic reports, with only a possible coincident sample');
  assert.ok(reports.every(report=>report.actions.length<=1));
});

test('staggered effect phases preserve every captured effect and have a hard ceiling of one report per source step',()=>{
  const starts=[4,5,6,4,5,6,4,5],reports=trace({frames:90,starts}),samples=actions(reports);
  assert.deepEqual(samples.map(action=>action.frameSeq),Array.from({length:87},(_,index)=>index+4));
  assert.ok(reports.length<=90);
  assert.equal(new Set(reports.map(report=>report.frameSeq)).size,reports.length);
  for(let index=0;index<starts.length;index++){
    const expected=Array.from({length:Math.floor((90-starts[index])/3)+1},(_,n)=>starts[index]+3*n);
    const observed=samples.filter(action=>action.effects.some(row=>row.id===index+1));
    assert.deepEqual(observed.map(action=>action.frameSeq),expected);
    assert.deepEqual(observed.map(action=>action.sent),expected);
  }
});

test('non-damaging active effects do not turn the ordinary pose heartbeat into critical traffic',()=>{
  const reports=trace({frames:120,starts:[2,3,4],react:0});
  assert.ok(reports.length<=41);assert.equal(actions(reports).length,0);
});

test('clearing a match also clears the prior send deadline',()=>{
  const {simulation,sync}=fixture();for(let frame=1;frame<=5;frame++)sync.afterStep(simulation,'local',[]);
  sync.clear();const frames=[];for(let frame=1;frame<=7;frame++){const report=sync.afterStep(simulation,'local',[]);if(report)frames.push(report.frameSeq);}
  assert.deepEqual(frames,[1,4,7]);
});

test('a new authoritative life restarts the ordinary deadline in that life even when its initial pose is unchanged',()=>{
  const {simulation,sync}=fixture();
  const room=epoch=>({snapshot:simulation.snapshot(),pvp:{phase:'fight',fightTime:0,players:[{id:'local',alive:true,connected:true}]},
    ownership:{mode:'local-owner-v1',actors:{local:{epoch,frameSeq:0}}},owners:{}});
  sync.reconcile(simulation,room(1),'local');for(let frame=1;frame<=8;frame++)sync.afterStep(simulation,'local',[]);
  sync.reconcile(simulation,room(2),'local');const reports=[];
  for(let frame=1;frame<=7;frame++){const report=sync.afterStep(simulation,'local',[]);if(report)reports.push(report);}
  assert.deepEqual(reports.map(report=>[report.epoch,report.frameSeq]),[[2,3],[2,6]]);
});

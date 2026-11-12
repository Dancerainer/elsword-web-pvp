import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';

/** Engineering invariants with deliberate latency/position errors, not original-client evidence. */
function fixture(){
  let now=0;
  const actor={id:'source',state:'WAIT',stateSerial:0,animationName:'WAIT',animationTime:0,stateTime:0,
    x:0,y:0,z:0,vx:0,vy:0,vz:0,grounded:true,lineId:2,lastTouchLineId:2,landPosition:[0,0,0],hp:100,mp:100,facing:1};
  const local={...structuredClone(actor),id:'local',x:10000};
  const sim={state:{actors:[actor,local],effects:[]},profile:{states:{WAIT:{},MOVE:{},HIT:{}},physics:{RUN_SPEED:600}},
    enter(a,state){Object.assign(a,{state,stateSerial:a.stateSerial+1,stateTime:0,animationTime:0,animationName:state});}};
  const playback=createRemoteCombatPlayback({clock:()=>now});playback.bind(sim,'local',()=>1);
  const action=(frame,{state='MOVE',serial=2,...fields}={})=>({id:frame,frameSeq:frame,
    actor:{...structuredClone(actor),state,stateSerial:serial,stateTime:0,animationName:state,...fields},effects:[],playback:{version:1,start:true,held:[]}});
  const pose=(frame,{state=actor.state,serial=actor.stateSerial,time=actor.stateTime,...fields}={})=>({epoch:1,frameSeq:frame,
    actor:{...structuredClone(actor),state,stateSerial:serial,stateTime:time,animationName:state,...fields}});
  const step=()=>{now+=1000/60;const before=actor.x;playback.beforeStep(sim,'local',()=>1);const correction=actor.x-before;
    actor.x+=actor.vx/60;actor.stateTime+=1/60;actor.animationTime+=1/60;playback.afterStep(sim);return correction;};
  return {actor,local,sim,playback,action,pose,step};
}

test('an admitted 12-tick late start cannot compare its phase zero against a global source-frame prediction',()=>{
  const f=fixture();f.playback.receiveActions('source',[f.action(1,{state:'WAIT',serial:1})],1,1);
  for(let i=0;i<20;i++)f.step();
  f.playback.observeState(f.sim,'source',f.pose(20),'local');
  // 200ms source age stays inside the new default 250ms admission window.
  for(let i=0;i<12;i++)f.step();
  f.playback.receiveActions('source',[f.action(21,{vx:600})],1,33);
  f.playback.observeState(f.sim,'source',f.pose(33,{state:'MOVE',serial:2,time:12/60,x:120}),'local');
  for(let i=1;i<=25;i++){assert.equal(f.step(),0,'latency alone is not spatial drift');assert.ok(Math.abs(f.actor.x-i*10)<1e-8);}
  assert.ok(f.playback.diagnostics.calibratedPoses>0);assert.equal(f.playback.diagnostics.positionCorrectionDistance,0);
  assert.equal(f.playback.diagnostics.expired,0);
});

test('a 20-tick late attacking start is expired instead of playing or teleporting to its old pose',()=>{
  const f=fixture(),local=structuredClone(f.local);
  f.playback.receiveActions('source',[f.action(1,{state:'WAIT',serial:1})],1,1);f.step();
  const starts=f.playback.diagnostics.starts;assert.equal(starts,1);
  // 333ms is outside the production window. An attacking pose cannot be a
  // motion recovery checkpoint that admits this rejected controller indirectly.
  f.playback.receiveActions('source',[f.action(21,{state:'HIT',serial:2,vx:600})],1,41);
  f.playback.observeState(f.sim,'source',f.pose(41,{state:'HIT',serial:2,time:20/60,x:200,vx:600}),'local');
  for(let i=0;i<25;i++){assert.equal(f.step(),0);assert.equal(f.actor.x,0);assert.equal(f.actor.state,'WAIT');}
  assert.equal(f.playback.diagnostics.expired,1);assert.equal(f.playback.diagnostics.starts,starts);
  assert.equal(f.playback.diagnostics.motionRecoveries,0);assert.equal(f.playback.diagnostics.positionCorrectionDistance,0);
  assert.equal(f.sim.state.effects.length,0);assert.deepEqual(f.local,local);
});

test('remaining correction from a previous controller cannot move a new reaction',()=>{
  const f=fixture();f.playback.receiveActions('source',[f.action(1,{serial:1,vx:0})],1,1);
  for(let i=0;i<5;i++)f.step();
  f.playback.observeState(f.sim,'source',f.pose(5,{x:100}),'local');assert.ok(f.step()>0);
  f.playback.receiveActions('source',[f.action(7,{state:'HIT',serial:2,vx:0})],1,7);
  const x=f.actor.x;assert.equal(f.step(),0);assert.equal(f.actor.x,x);
  assert.ok(f.playback.diagnostics.invalidatedCorrections>0);
});

test('a genuine large same-phase displacement converges at continuous bounded recovery speed and never moves the local owner',()=>{
  const f=fixture(),local=structuredClone(f.local);f.playback.receiveActions('source',[f.action(1,{serial:1,vx:0})],1,1);
  for(let i=0;i<5;i++)f.step();
  f.playback.observeState(f.sim,'source',f.pose(5,{x:500}),'local');
  const corrections=[];for(let i=0;i<110;i++)corrections.push(f.step());
  assert.ok(corrections.every(value=>value>=0&&value<=10+1e-8));
  for(let i=1;i<corrections.length;i++)assert.ok(Math.abs(corrections[i]-corrections[i-1])<=2.5+1e-8);
  assert.ok(Math.abs(f.actor.x-500)<.002);assert.deepEqual(f.local,local);
  assert.ok(Math.abs(f.actor.stateTime-115/60)<1e-8,'native clock is never installed or accelerated by calibration');
});

test('source grounded line and landing point cannot replace receiver spatial caches without its position',()=>{
  const f=fixture();Object.assign(f.actor,{x:-1250,y:3080,landPosition:[-1250,3080,0]});
  f.playback.receiveActions('source',[f.action(1,{state:'WAIT',serial:1,x:-1250,y:3320,grounded:true,lineId:3,lastTouchLineId:3,landPosition:[-1250,3320,0]})],1,1);
  f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(f.actor.y,3080);assert.equal(f.actor.lineId,2);assert.equal(f.actor.lastTouchLineId,2);
  assert.deepEqual(f.actor.landPosition,[-1250,3080,0]);
});

test('airborne reaction intent still releases local ground without importing a foreign platform',()=>{
  const f=fixture();f.playback.receiveActions('source',[f.action(1,{state:'HIT',serial:1,grounded:false,lineId:null,lastTouchLineId:8,landPosition:[500,2000,0],vy:730})],1,1);
  f.playback.beforeStep(f.sim,'local',()=>1);assert.equal(f.actor.grounded,false);assert.equal(f.actor.lineId,null);
  assert.equal(f.actor.lastTouchLineId,2);assert.deepEqual(f.actor.landPosition,[0,0,0]);assert.equal(f.actor.vy,730);
});
import {loadPlaybackNativeAssets,playbackNativeSimulation,nativeDt} from '../../tools/validation/measure-combat-playback-v12.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';

test('original Native Garpai physics does not snap the remote body 240 units onto the sender platform',async()=>{
  const assets=await loadPlaybackNativeAssets(),source=playbackNativeSimulation(assets,'source'),receiver=playbackNativeSimulation(assets,'target');
  for(const [sim,y,lineId]of [[source,3320,3],[receiver,3080,2]]){
    const actor=sim.actor('source');Object.assign(actor,{x:-1250,y,z:0,lineId,lastTouchLineId:lineId,landPosition:[-1250,y,0],grounded:true,vx:0,vy:0,vz:0});
    sim.enter(actor,'RSI_WAIT','explicit-two-original-platforms');
  }
  source.enter(source.actor('source'),'RSI_WAIT','source-next-controller');
  const report=encodeOwnedState(source,'source',{epoch:1,frameSeq:1}),action=encodeCriticalAction(report,{id:1});
  action.playback={version:1,start:true,held:[]};
  const playback=createRemoteCombatPlayback({clock:()=>0});playback.bind(receiver,'target',()=>1);
  try{
    const local=structuredClone(receiver.actor('target'));playback.receiveActions('source',[action],1,1);
    playback.beforeStep(receiver,'target',()=>1);assert.deepEqual(receiver.actor('target'),local);
    receiver.step(nativeDt,{}, {snapshot:false});playback.afterStep(receiver);
    const actor=receiver.actor('source');assert.equal(actor.y,3080,'lineId must belong to the receiver position, not the sender phase');
    assert.equal(actor.lineId,2);assert.equal(actor.lastTouchLineId,2);assert.equal(actor.landPosition[1],3080);
  }finally{playback.clear();}
});


test('an expired control frontier releases held input and recovers only a verified current non-attacking motion',()=>{
  const f=fixture();f.sim.profile.states.RSI_WAIT={};
  const start=f.action(1,{serial:1,vx:600});start.playback.held=['RIGHT'];f.playback.receiveActions('source',[start],1,1);f.step();
  const oldStop=f.action(10,{state:'RSI_WAIT',serial:3,vx:0});
  f.playback.receiveActions('source',[oldStop],1,100);
  f.playback.observeState(f.sim,'source',f.pose(100,{state:'RSI_WAIT',serial:3,time:1,x:40,vx:0}),'local');
  f.step();assert.equal(f.actor.state,'RSI_WAIT');assert.equal(f.actor.stateSerial,3);
  assert.deepEqual(f.playback.remoteInputs(f.sim,'local').source.held,[]);assert.equal(f.playback.diagnostics.expired,1);
  assert.equal(f.playback.diagnostics.motionRecoveries,1);assert.equal(f.sim.state.effects.length,0);
  f.playback.receiveActions('source',[f.action(50,{state:'HIT',serial:2})],1,100);
  assert.equal(f.playback.diagnostics.pending,0,'recovered frontier retires later arrivals of older attacks');
  for(let i=0;i<45;i++)f.step();assert.ok(Math.abs(f.actor.x-40)<.002);
});


test('an expired attacking state cannot be used as a recovery checkpoint or perform its old collision',()=>{
  const f=fixture();f.playback.receiveActions('source',[f.action(1,{serial:1})],1,1);f.step();
  const oldAttack=f.action(10,{state:'HIT',serial:2});f.playback.receiveActions('source',[oldAttack],1,100);
  f.playback.observeState(f.sim,'source',f.pose(100,{state:'HIT',serial:2,time:1,x:100}),'local');
  f.step();assert.equal(f.actor.state,'MOVE');assert.equal(f.actor.stateSerial,1);
  assert.equal(f.playback.diagnostics.motionRecoveries,0);assert.equal(f.playback.diagnostics.expired,1);
  assert.equal(f.sim.state.effects.length,0);
});


test('motion recovery maps its current checkpoint phase once without importing a clock or disabling later drift correction',()=>{
  const f=fixture();f.sim.profile.states.RSI_DASH={};
  f.playback.receiveActions('source',[f.action(1,{serial:1,vx:0})],1,1);f.step();
  f.playback.receiveActions('source',[f.action(10,{state:'RSI_DASH',serial:2,vx:600})],1,100);
  f.playback.observeState(f.sim,'source',f.pose(100,{state:'RSI_DASH',serial:2,time:4,x:400,vx:600}),'local');
  for(let i=1;i<=300;i++){
    if(i>1&&i%6===1)f.playback.observeState(f.sim,'source',f.pose(100+i-1,{state:'RSI_DASH',serial:2,time:4+(i-1)/60,x:400+(i-1)*10+(i>=181?30:0),vx:600}),'local');
    assert.ok(f.step()>=-1e-7,'the restored checkpoint cannot later become a spurious backward correction');
  }
  assert.ok(Math.abs(f.actor.x-3430)<.002,'new same-phase drift remains observable after recovery');
  assert.ok(Math.abs(f.actor.stateTime-5)<1e-8,'the four-second source phase was not installed into the Native clock');
});

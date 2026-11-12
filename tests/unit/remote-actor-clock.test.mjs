import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRemoteActorClock} from '../../apps/web/remote-actor-clock.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';

const actor=(x=0,extra={})=>({id:'remote',x,y:0,z:0,state:'walk',stateSerial:1,facing:1,
  animationName:'Walk',animationTime:x/1000,animationLoop:true,animationTransitionSerial:1,
  lineId:0,lastTouchLineId:0,grounded:true,hp:100,core:{phase:'idle',x,y:20,z:0},...extra});
const local=()=>({...actor(),id:'local'});
const near=(a,b,epsilon=1e-7)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);

test('source-time interpolation is smooth at 144Hz despite 20Hz packet arrivals and never samples local history',()=>{
  const clock=createRemoteActorClock(),own=local(),input=actor();let frame=0;const trace=[];
  for(let render=0;render<288;render++){
    const now=render*1000/144;
    while((frame+3)*1000/60<=now){frame+=3;clock.observe(actor(frame*1000/60),{epoch:1,frameSeq:frame,at:frame*1000/60});}
    const shown=clock.sample([own,input],'local',{now});assert.equal(shown[0],own);
    if(now>300)trace.push(shown[1].x);
  }
  for(let i=1;i<trace.length;i++)near(trace[i]-trace[i-1],1000/144);
  assert.deepEqual(own,local());assert.deepEqual(input,actor());
  assert.ok(clock.diagnostics().peers.remote.samples<=32);
});

test('duplicate and reordered reports cannot rewind a source track; copied poses cannot be mutated by simulation',()=>{
  const clock=createRemoteActorClock({minDelayMs:0,maxDelayMs:0}),a=actor(50);
  clock.observe(a,{epoch:1,frameSeq:3,at:50});a.x=999;a.core.x=999;
  assert.equal(clock.observe(actor(-100),{epoch:1,frameSeq:2,at:55}),false);
  assert.equal(clock.observe(actor(-100),{epoch:1,frameSeq:3,at:55}),false);
  const shown=clock.sample([actor()],'local',{now:50})[0];near(shown.x,50);near(shown.core.x,50);
  assert.equal(clock.diagnostics().stale,2);
});

test('missing traffic holds the last confirmed remote position and animation indefinitely without advancing combat',()=>{
  const clock=createRemoteActorClock();clock.observe(actor(50),{epoch:1,frameSeq:3,at:50});
  clock.observe(actor(100),{epoch:1,frameSeq:6,at:100});
  for(let now=100;now<=5000;now+=10){const a=clock.sample([actor(10000,{animationTime:99})],'local',{now})[0];assert.ok(a.x<=100);assert.ok(a.animationTime<=.1);}
  const shown=clock.sample([actor(10000)],'local',{now:5010})[0];near(shown.x,100);near(shown.animationTime,.1);
  assert.ok(clock.diagnostics().peers.remote.heldMs>=4900);
});

test('a long outage rebases within 100ms instead of playing seconds of history, with continuous position on recovery',()=>{
  const clock=createRemoteActorClock();clock.observe(actor(50),{epoch:1,frameSeq:3,at:50});
  for(let now=50;now<=1500;now+=10)clock.sample([actor()],'local',{now});
  clock.observe(actor(500),{epoch:1,frameSeq:90,at:1500});
  const first=clock.sample([actor()],'local',{now:1500})[0];near(first.x,50);
  for(let now=1510;now<=1700;now+=10)clock.sample([actor()],'local',{now});
  const last=clock.sample([actor()],'local',{now:1700})[0];near(last.x,500);
  assert.equal(clock.diagnostics().rebases,1);assert.equal(clock.diagnostics().peers.remote.recovering,false);
});

test('adaptive allowance remains bounded and playback never reverses across a jitter increase',()=>{
  const clock=createRemoteActorClock();const packets=[];let cursor=-Infinity;
  for(let frame=3;frame<=600;frame+=3)packets.push({frame,time:frame*1000/60+(frame%12===0?110:frame%9===0?40:0)});
  packets.sort((a,b)=>a.time-b.time);
  for(let now=0;now<11000;now+=10){
    while(packets[0]?.time<=now){const p=packets.shift();clock.observe(actor(p.frame),{epoch:1,frameSeq:p.frame,at:p.time});}
    clock.sample([actor()],'local',{now});const proof=clock.diagnostics().peers.remote;if(!proof)continue;
    assert.ok(proof.sourceCursorMs>=cursor);cursor=proof.sourceCursorMs;
    assert.ok(proof.bufferMs>=50&&proof.bufferMs<=120);assert.ok(proof.samples<=32);
  }
});

test('state, facing, line and animation transitions are discrete source boundaries; live vitals and protection remain current',()=>{
  const clock=createRemoteActorClock({minDelayMs:0,maxDelayMs:0});
  clock.observe(actor(0),{epoch:1,frameSeq:3,at:50});
  clock.observe(actor(50,{state:'attack',stateSerial:2,animationName:'Z',animationTime:0,facing:-1,lineId:1}),{epoch:1,frameSeq:6,at:100});
  const live=actor(99,{hp:17,mp:2,forceInvincible:8,worldStop:3,buffs:[{id:5}]});
  const halfway=clock.sample([live],'local',{now:75})[0];near(halfway.x,25);
  assert.equal(halfway.state,'walk');assert.equal(halfway.facing,1);assert.equal(halfway.lineId,0);
  assert.equal(halfway.hp,17);assert.equal(halfway.forceInvincible,8);assert.equal(halfway.buffs,live.buffs);
  const end=clock.sample([live],'local',{now:100})[0];assert.equal(end.state,'attack');assert.equal(end.animationTime,0);assert.equal(end.facing,-1);
});

test('life changes, explicit warps, death, disconnect and reset never interpolate through an obsolete location',()=>{
  const clock=createRemoteActorClock();clock.observe(actor(0),{epoch:1,frameSeq:3,at:50});
  clock.observe(actor(10000),{epoch:2,frameSeq:3,at:100});near(clock.sample([actor()],'local',{now:100})[0].x,10000);
  assert.equal(clock.observe(actor(-500),{epoch:1,frameSeq:999,at:110}),false);
  clock.observe(actor(-10000),{epoch:2,frameSeq:6,at:150});near(clock.sample([actor()],'local',{now:150})[0].x,-10000);
  assert.equal(clock.diagnostics().discontinuities,1);
  const dead=actor(25,{pvpDead:true});assert.equal(clock.sample([dead],'local',{now:160})[0],dead);
  assert.deepEqual(clock.diagnostics().peers,{});
  clock.observe(actor(50),{epoch:3,frameSeq:3,at:200});const disconnected=actor(60,{pvpDisconnected:true});
  assert.equal(clock.sample([disconnected],'local',{now:210})[0],disconnected);
  clock.observe(actor(),{epoch:4,frameSeq:3,at:220});clock.reset('remote');assert.deepEqual(clock.diagnostics().peers,{});
  clock.clear();assert.equal(clock.diagnostics().accepted,0);
});

test('an authored animation loop or seek happens only at the next source boundary, never prematurely',()=>{
  const clock=createRemoteActorClock({minDelayMs:0,maxDelayMs:0});
  clock.observe(actor(0,{animationTime:.95,core:{phase:'idle',animationName:'Wait',animationTime:.95}}),{epoch:1,frameSeq:3,at:50});
  clock.observe(actor(50,{animationTime:.01,core:{phase:'idle',animationName:'Wait',animationTime:.01}}),{epoch:1,frameSeq:6,at:100});
  const before=clock.sample([actor()],'local',{now:75})[0];near(before.animationTime,.95);near(before.core.animationTime,.95);
  const after=clock.sample([actor()],'local',{now:100})[0];near(after.animationTime,.01);near(after.core.animationTime,.01);
});

test('a source that stops producing ticks regains its buffer promptly after resuming, without rewinding',()=>{
  const clock=createRemoteActorClock();let frame=0,cursor=-Infinity;const shown=[];
  for(let render=0;render<720;render++){
    const now=render*1000/144;
    while((frame+3)*1000/60+((frame+3)>60?1000:0)<=now){
      frame+=3;const source=frame*1000/60,arrival=source+(frame>60?1000:0);
      clock.observe(actor(source),{epoch:1,frameSeq:frame,at:arrival});
    }
    const a=clock.sample([actor()],'local',{now})[0],proof=clock.diagnostics().peers.remote;
    if(proof){assert.ok(proof.sourceCursorMs>=cursor);cursor=proof.sourceCursorMs;}
    if(now>=2300&&now<3300)shown.push(a.x);
  }
  for(let i=1;i<shown.length;i++)near(shown[i]-shown[i-1],1000/144);
  assert.equal(clock.diagnostics().clockRebases,1);
});

test('independent Nasod flight stays continuous across an owner combo or facing change',()=>{
  const clock=createRemoteActorClock({minDelayMs:0,maxDelayMs:0});
  clock.observe(actor(0,{core:{phase:'attack',animationName:'Attack2',animationTime:.1,x:100,y:20,z:0}}),{epoch:1,frameSeq:3,at:50});
  clock.observe(actor(50,{state:'attack',stateSerial:2,facing:-1,core:{phase:'attack',animationName:'Attack2',animationTime:.15,x:200,y:20,z:0}}),{epoch:1,frameSeq:6,at:100});
  const shown=clock.sample([actor()],'local',{now:75})[0];near(shown.x,25);near(shown.core.x,150);near(shown.core.animationTime,.125);
});

test('frame zero loading seeds do not start a clock, and exact inspection bypasses playback',()=>{
  const clock=createRemoteActorClock(),actors=[actor(),local()];
  assert.equal(clock.observe(actor(),{epoch:1,frameSeq:0,at:0}),false);
  clock.observe(actor(50),{epoch:1,frameSeq:3,at:50});assert.equal(clock.sample(actors,'local',{now:50,exact:true}),actors);
});

test('actual ownership coordinator feeds validated remote states on both channels without altering own state or hit receipts',()=>{
  const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
  const map={sceneId:'remote-clock-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
  const sim=createSimulation({profile,map,networkOwnerId:'local',actors:[{id:'local',team:0,position:[0,0,0]},{id:'remote',team:1,position:[1000,0,0]}]});
  let now=0;const remotePresentation=createRemoteActorClock({clock:()=>now}),sync=createLocalOwnershipSync({remotePresentation});
  const room={snapshot:sim.snapshot(),pvp:{phase:'fight',fightTime:0,players:['local','remote'].map(id=>({id,alive:true,connected:true}))},
    ownership:{mode:'local-owner-v1',actors:{local:{epoch:1,frameSeq:0},remote:{epoch:1,frameSeq:0}}},owners:{}};
  sync.reconcile(sim,room,'local');const own=structuredClone(sim.actor('local'));
  now=50;const report=encodeOwnedState(sim,'remote',{epoch:1,frameSeq:3});report.actor.x=1010;
  assert.equal(sync.receivePeer(sim,'remote',report,'local'),true);assert.equal(sync.receivePeer(sim,'remote',report,'local'),false);
  now=100;room.owners.remote={...report,frameSeq:6,actor:{...report.actor,x:1020}};sync.reconcile(sim,room,'local');
  assert.equal(remotePresentation.diagnostics().accepted,2);assert.deepEqual(sim.actor('local'),own);
  const before=sim.snapshot();remotePresentation.sample(sim.view().actors,'local',{now:150});assert.deepEqual(sim.snapshot(),before);
  room.ownership.actors.remote.epoch=2;delete room.owners.remote;sync.reconcile(sim,room,'local');assert.deepEqual(remotePresentation.diagnostics().peers,{});
  sync.clear();assert.deepEqual(remotePresentation.diagnostics().peers,{});
});

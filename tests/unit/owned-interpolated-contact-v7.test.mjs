/** Current Web contact adapters, not an original-client network golden. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRemoteActorClock} from '../../apps/web/remote-actor-clock.mjs';
import {validateOwnedTargetViews} from '../../packages/online/owned-state.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const actor=(x,extra={})=>({id:'remote',x,y:0,z:0,state:'walk',stateSerial:1,facing:1,
  animationName:'Walk',animationTime:x/1000,animationLoop:true,animationTransitionSerial:1,
  grounded:true,lineId:0,lastTouchLineId:0,hp:100,...extra});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
for(const hz of [60,144])test(`${hz} Hz display produces verifiable contact witnesses throughout a normal 20 Hz source stream`,()=>{
  const clock=createRemoteActorClock({captureContacts:true}),samples=new Map();let frame=0,count=0,blends=0;
  for(let render=0;render<hz*3;render++){
    const now=render*1000/hz;
    while((frame+3)*1000/60<=now){frame+=3;const input=actor(frame*1000/60);samples.set(frame,input);
      clock.observe(input,{epoch:1,frameSeq:frame,at:frame*1000/60,actor:input});}
    clock.contacts([actor(999)],'local',{now});if(now<300)continue;
    const reference=clock.observationReference('remote');assert.ok(reference,'ordinary interpolated movement must retain a source witness');
    const weights=reference.positionSamples??[{frameSeq:reference.frameSeq,weight:1}];
    assert.ok(weights.length<=4);near(weights.reduce((sum,row)=>sum+row.weight,0),1);
    for(let axis=0;axis<3;axis++)near(reference.position[axis],weights.reduce((sum,row)=>sum+samples.get(row.frameSeq)[['x','y','z'][axis]]*row.weight,0));
    near(reference.position[0],clock.sample([actor(999)],'local',{now})[0].x);count++;if(weights.length>1)blends++;
  }
  assert.ok(count>=hz*2);assert.ok(blends>count/2,'most real render cursors lie between source frames');
});
test('urgent one-tick steps expose the exact symmetric position filter with no more than four source samples',()=>{
  const clock=createRemoteActorClock({captureContacts:true,minDelayMs:0,maxDelayMs:0}),positions=new Map();
  for(let frame=1;frame<=6;frame++){const x=frame<4?0:100,source=actor(x,{animationTime:frame/60});positions.set(frame,x);
    clock.observe(source,{epoch:1,frameSeq:frame,at:frame*1000/60,actor:source});}
  const now=3.5*1000/60;clock.contacts([actor(999)],'local',{now});const reference=clock.observationReference('remote');
  assert.ok(reference);assert.equal(reference.frameSeq,3);assert.equal(reference.positionSamples.length,4);
  near(reference.position[0],reference.positionSamples.reduce((sum,sample)=>sum+positions.get(sample.frameSeq)*sample.weight,0));
  assert.deepEqual(reference.positionSamples.map(row=>row.frameSeq),[2,3,4,5]);
});
test('arrival-projected bodies and active recovery never fabricate source-position witnesses',()=>{
  const clock=createRemoteActorClock({captureContacts:true,minDelayMs:0,maxDelayMs:0});
  const raw=actor(100);clock.observe(actor(80),{epoch:1,frameSeq:3,at:50,actor:raw});
  clock.contacts([actor(80)],'local',{now:50});assert.equal(clock.observationReference('remote'),null);
  clock.observe(actor(200),{epoch:1,frameSeq:6,at:100,actor:actor(200)});
  clock.contacts([actor(200)],'local',{now:100});assert.ok(clock.observationReference('remote'));
  clock.contacts([actor(200)],'local',{now:1500});clock.observe(actor(500),{epoch:1,frameSeq:90,at:1500,actor:actor(500)});
  clock.contacts([actor(500)],'local',{now:1500});assert.equal(clock.observationReference('remote'),null);
});
test('a recovered display crossing a source gap larger than retained contact history never emits a fatal oversized witness',()=>{
  const clock=createRemoteActorClock({captureContacts:true,minDelayMs:120,maxDelayMs:120}),live=actor(500);
  clock.observe(actor(50),{epoch:1,frameSeq:3,at:50});clock.contacts([live],'local',{now:50});
  clock.contacts([live],'local',{now:1500});clock.observe(live,{epoch:1,frameSeq:90,at:1500});
  clock.contacts([live],'local',{now:1500});clock.observe(actor(550),{epoch:1,frameSeq:93,at:1550});
  clock.contacts([live],'local',{now:1550});clock.contacts([live],'local',{now:1600});
  assert.equal(clock.diagnostics().peers.remote.recovering,false);
  assert.equal(clock.observationReference('remote'),null,'display may blend across a gap, but unsupported history never enters attack encoding');
  for(let now=1610;now<=1800;now+=10){
    clock.contacts([live],'local',{now});const reference=clock.observationReference('remote');
    if(reference)assert.doesNotThrow(()=>validateOwnedTargetViews([{playerId:'remote',...reference}]));
  }
});
test('pause/resume across87owner frames reaches actual afterStep critical encoding without a frame fault',()=>{
  const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
  const map={sceneId:'source-frame-gap-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
  const sim=createSimulation({profile,map,networkOwnerId:'local',actors:[{id:'local',team:0,position:[0,0,0],lineId:0},{id:'remote',team:1,position:[2000,0,0],lineId:0}]});
  const clock=createRemoteActorClock({captureContacts:true,minDelayMs:120,maxDelayMs:120}),sync=createLocalOwnershipSync({remotePresentation:clock});
  sync.reconcile(sim,{snapshot:sim.snapshot(),ownership:{mode:'local-owner-v1',actors:{local:{epoch:1},remote:{epoch:1}}},
    pvp:{phase:'fight',fightTime:1,players:[]}},'local');
  const initial=structuredClone(sim.actor('remote'));clock.observe(initial,{epoch:1,frameSeq:3,at:50});clock.contacts(sim.state.actors,'local',{now:50});
  clock.contacts(sim.state.actors,'local',{now:1500});clock.observe({...initial,x:2500},{epoch:1,frameSeq:90,at:1500});
  clock.contacts(sim.state.actors,'local',{now:1500});clock.observe({...initial,x:2550},{epoch:1,frameSeq:93,at:1550});
  clock.contacts(sim.state.actors,'local',{now:1550});clock.contacts(sim.state.actors,'local',{now:1600});
  assert.equal(clock.observationReference('remote'),null);
  // A source-shaped outward event exercises the real owner encoder; it is
  // an explicit Web regression marker, not evidence of a native skill cast.
  let report;assert.doesNotThrow(()=>{report=sync.afterStep(sim,'local',[{type:'worldStop',actorId:'local',duration:.2}]);});
  assert.equal(report.actions.length,1);assert.equal(report.actions[0].targetViews,undefined);sync.clear();
});

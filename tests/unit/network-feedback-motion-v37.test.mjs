/** Production receiver and combat with disclosed synthetic geometry/delivery.
 * This is a deterministic Web regression, not a WAN/original-client trace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {encodeOwnedMotion,validateOwnedMotion} from '../../packages/online/owned-motion.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';

const base=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
// Optional independent historical checkouts are read-only inputs for the
// controlled comparison. Normal CI needs no extra checkout or asset export.
const historical=await Promise.all((process.env.RF_MOTION_COMPARE_ROOTS??'').split('|').filter(Boolean).map(async root=>({
  name:root,simulation:await import(pathToFileURL(resolve(root,'packages/combat-core/index.mjs')).href),
  ownership:await import(pathToFileURL(resolve(root,'apps/web/input-prediction.mjs')).href),
  sourceHashes:Object.fromEntries(['packages/combat-core/index.mjs','apps/web/input-prediction.mjs','apps/web/remote-combat-playback.mjs'].map(file=>
    [file,createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')]))})));
const dt=1/60,map={sceneId:'motion-v37-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture({networkOwnerId='local',simulationFactory=createSimulation,...options}={}){
  const profile=structuredClone(base);
  profile.states.TEST_ATTACK={animationName:'Wait',raw:{ANIM_NAME:'Wait',ANIM_SPEED:1,PLAY_TYPE:2,APPLY_ANIM_MOVE:0,
    ATTACK_TIME0:{1:.12,2:.22},DAMAGE_DATA:structuredClone(base.damageEffects.RAVEN_NASOD_BALL.raw.DAMAGE_DATA)}};
  const sim=simulationFactory({profile,map,networkOwnerId,seed:2016,preset:{passives:[],guildPassives:[]},
    collisionSampler:actor=>[{kind:'sphere',center:[actor.x+30,50,0],radius:30}],
    defenderSampler:actor=>[{kind:'sphere',center:[actor.x,actor.y+50,actor.z],radius:20}],
    actors:[{id:'remote',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
      {id:'local',team:1,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','fixture');}
  sim.drainEvents();let now=0;
  const playback=createRemoteCombatPlayback({clock:()=>now,...options});playback.bind(sim,networkOwnerId,()=>1);
  const report=(frameSeq,changes={})=>{const value=encodeOwnedState(sim,'remote',{epoch:1,frameSeq});Object.assign(value.actor,changes);return value;};
  const action=(frameSeq,changes={})=>{const value=encodeCriticalAction(report(frameSeq),{id:frameSeq});
    Object.assign(value.actor,{state:'TEST_ATTACK',stateSerial:100+frameSeq,animationName:'Wait',animationPlaybackSpeed:1,animationSpeedRamp:null},changes);
    value.playback={version:1,start:true,held:[]};return value;};
  function step(count=1){for(let i=0;i<count;i++){playback.beforeStep(sim,'local',()=>1);sim.step(dt,playback.remoteInputs(sim,'local'),{snapshot:false});playback.afterStep(sim);now+=1000/60;}}
  return {sim,playback,report,action,step,setNow(value){now=value;},motion:(frame,changes={},held=[])=>encodeOwnedMotion(report(frame,changes),{held})};
}

test('motion has a strict small schema: resources, attacks, invalid lines, nonfinite values and attack-held keys cannot enter',()=>{
  const f=fixture(),motion=f.motion(1,{x:120},['RIGHT','Z','Q']);
  assert.deepEqual(motion.movementHeld,['RIGHT']);assert.ok(Buffer.byteLength(JSON.stringify(motion))<400);
  assert.deepEqual(validateOwnedMotion(motion,map),motion);
  for(const invalid of [{...motion,actor:{...motion.actor,hp:1}},{...motion,actions:[]},
    {...motion,actor:{...motion.actor,x:Infinity}},{...motion,actor:{...motion.actor,lineId:99}},
    {...motion,movementHeld:['Z']},{...motion,movementHeld:['RIGHT','RIGHT']}])assert.throws(()=>validateOwnedMotion(invalid,map));
});

test('independent motion updates remote geometry during blocked controls without state-enter, HP/MP or local-owner writes',()=>{
  const f=fixture(),remote=f.sim.actor('remote'),local=structuredClone(f.sim.actor('local')),before=structuredClone(remote);
  const motion=f.motion(30,{x:120,vx:60,facing:-1});
  assert.equal(f.playback.observeMotion(f.sim,'remote',motion,'local'),true);
  motion.actor.x=9000;
  f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(remote.x,78);assert.equal(remote.vx,60);assert.equal(remote.facing,-1);
  for(const key of ['hp','mp','state','stateSerial','animationTime','skillId','fired','hits','core','buffs'])assert.deepEqual(remote[key],before[key],key);
  assert.deepEqual(f.sim.actor('local'),local);assert.equal(f.playback.diagnostics.starts,0);assert.equal(f.playback.diagnostics.pending,0);
  for(let i=0;i<5;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  assert.ok(Math.abs(remote.x-120)<.25);assert.equal(f.playback.diagnostics.owners.remote.motionAppliedFrame,30);
});

test('motion does not advance owner/full-pose settlement frontier or control IDs',()=>{
  const f=fixture(),sync=createLocalOwnershipSync({combatPlaybackVersion:1});
  const room={snapshot:f.sim.snapshot(),ownership:{mode:'local-owner-v1',combatPlaybackVersion:1,
    actors:{local:{epoch:1,frameSeq:0},remote:{epoch:1,frameSeq:0}}},owners:{}};
  sync.reconcile(f.sim,room,'local');
  const before=structuredClone(f.sim.actor('local'));
  assert.equal(sync.receiveMotion(f.sim,'local',f.motion(100),'local'),false);
  assert.equal(sync.receiveMotion(f.sim,'remote',{...f.motion(100),epoch:0},'local'),false);
  assert.equal(sync.receiveMotion(f.sim,'remote',f.motion(100,{x:300}),'local'),true);
  const receipt=f.report(90,{hp:12345,mp:123});
  assert.equal(sync.receivePeerResult(f.sim,'remote',receipt,'local').applied,true,'real owner vitals may arrive after a newer movement-only sample');
  assert.equal(f.sim.actor('remote').hp,12345);assert.equal(f.sim.actor('remote').mp,123);
  assert.deepEqual(f.sim.actor('local'),before);
  assert.equal(sync.combatPlaybackDiagnostics.receiver.admitted,0);sync.clear();
});

test('duplicates and reordering do not rewind motion; old control cannot restore a direction already released on the motion path',()=>{
  const f=fixture();assert.equal(f.playback.observeMotion(f.sim,'remote',f.motion(20,{x:150},[]),'local'),true);
  for(const frame of [20,10])assert.equal(f.playback.observeMotion(f.sim,'remote',f.motion(frame,{x:-500},['RIGHT']),'local'),false);
  const old=f.action(15);old.playback={version:1,start:false,held:['RIGHT','Z']};
  f.playback.receiveActions('remote',[old],1,20);f.playback.beforeStep(f.sim,'local',()=>1);
  assert.deepEqual(f.playback.remoteInputs(f.sim,'local').remote.held,['Z']);assert.equal(f.sim.actor('remote').x,97.5);
  assert.equal(f.playback.diagnostics.motionStale,2);
});

test('a current motion already consumed still overrides a late controller velocity without rewinding its position',()=>{
  const f=fixture();f.playback.observeMotion(f.sim,'remote',f.motion(15,{x:100,vx:0,vy:0,facing:-1,grounded:true}),'local');
  for(let i=0;i<12;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  f.sim.actor('remote').x=200;
  f.playback.receiveActions('remote',[f.action(10,{vx:500,vy:750,facing:1,grounded:false})],1,15);
  f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(f.sim.actor('remote').vx,0);assert.equal(f.sim.actor('remote').vy,0);assert.equal(f.sim.actor('remote').facing,-1);
  assert.equal(f.sim.actor('remote').grounded,true);assert.equal(f.sim.actor('remote').x,200);assert.equal(f.playback.diagnostics.starts,1);
});

test('a blocked old attack cannot become a new late collision after a newer motion frontier arrives; terminals still retire',()=>{
  for(const age of [300,500,800]){
    const f=fixture(),old=f.action(1);old.effects=[{id:99,dead:true,endEmitted:true}];old.playback.held=['Z'];
    f.sim.actor('local').x=30;const hp=f.sim.actor('local').hp;
    f.playback.observeMotion(f.sim,'remote',f.motion(1+Math.round(age*60/1000)),'local');
    f.playback.receiveActions('remote',[old],1,old.frameSeq);f.step(15);
    assert.equal(f.sim.actor('local').hp,hp,`${age}ms superseded attack cannot hit`);
    assert.equal(f.playback.diagnostics.starts,0);assert.equal(f.playback.diagnostics.expiredAdditionalAge,1);
    assert.equal(f.playback.diagnostics.owners.remote.tombstones,1);assert.deepEqual(f.playback.remoteInputs().remote.held,[]);
  }
  // Explicit comparison to the previous one-second admission policy. It
  // starts the old window now and damages the current nearby owner later.
  const old=fixture({maxAdditionalAgeMs:1000});old.sim.actor('local').x=30;const hp=old.sim.actor('local').hp;
  old.playback.observeSource('remote',1,31);old.playback.receiveActions('remote',[old.action(1)],1,1);old.step(15);
  assert.ok(old.sim.actor('local').hp<hp);assert.equal(old.playback.diagnostics.starts,1);
});

test('fresh actions at stable long one-way latency and after a stalled source clock remain playable',()=>{
  const f=fixture();f.setNow(600);
  f.playback.receiveActions('remote',[f.action(1)],1,1);f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(f.playback.diagnostics.starts,1);
  // The next source tick is newly generated after a long app pause. A
  // fixed60Hz wall-time extrapolation would incorrectly call it3500ms old.
  f.setNow(4100);f.playback.receiveActions('remote',[f.action(2)],1,2);f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(f.playback.diagnostics.starts,2);assert.equal(f.playback.diagnostics.expired,0);
});

test('local receive-queue stalls also expire attack starts while ordinary current receipts remain independent',()=>{
  const f=fixture();f.playback.receiveActions('remote',[f.action(1)],1,1);f.setNow(300);
  f.playback.beforeStep(f.sim,'local',()=>1);assert.equal(f.playback.diagnostics.expiredAdditionalAge,1);
  assert.equal(f.playback.diagnostics.starts,0);
});

test('asymmetric motion loss and jitter stay independent of a 700ms action blockage',()=>{
  const f=fixture(),packets=[],samples=[];let accepted=0;
  // Every third frame samples the real latest geometry. Two of seven motion
  // datagrams drop; a deterministic1/2/5-frame delay causes reordering.
  for(let frame=0;frame<180;frame++){
    f.setNow(frame*1000/60);
    if(frame%3===0){const seq=frame/3;if(seq%7!==1&&seq%7!==4)packets.push({due:frame+[1,5,2][seq%3],motion:f.motion(frame,{x:frame*2,vx:0})});}
    for(const packet of packets.filter(packet=>packet.due===frame))accepted+=Number(f.playback.observeMotion(f.sim,'remote',packet.motion,'local'));
    if(frame===42){const old=f.action(1);f.playback.receiveActions('remote',[old],1,1);}
    f.playback.beforeStep(f.sim,'local',()=>1);
    if(frame>15)samples.push({frame,sourceFrame:f.playback.diagnostics.owners.remote.motionAppliedFrame,x:f.sim.actor('remote').x,error:frame*2-f.sim.actor('remote').x});
  }
  assert.ok(accepted>=35);assert.equal(f.playback.diagnostics.expiredAdditionalAge,1);assert.equal(f.playback.diagnostics.starts,0);
  assert.ok(Math.max(...samples.map(sample=>sample.frame-sample.sourceFrame))<=10,'pose age stays bounded despite one blocked reliable direction');
  assert.ok(Math.max(...samples.map(sample=>sample.error))<23,'no stationary remote body throughout control blockage');
  assert.equal(f.playback.diagnostics.pending,0);
});

test('motion correction respects body obstruction and never stores a rejected push for later release',()=>{
  const f=fixture(),local=structuredClone(f.sim.actor('local'));f.sim.actor('local').x=100;
  const actualLocal=structuredClone(f.sim.actor('local'));
  f.playback.observeMotion(f.sim,'remote',f.motion(1,{x:200}),'local');f.playback.beforeStep(f.sim,'local',()=>1);
  assert.ok(f.sim.actor('remote').x<100);assert.deepEqual(f.sim.actor('local'),actualLocal);
  const stopped=f.sim.actor('remote').x;f.sim.actor('local').x=2000;
  for(let i=0;i<5;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(f.sim.actor('remote').x,stopped,'blocked residual is discarded');
});

test('constant-speed grounded samples use relative motion age instead of pulling to each jittered arrival position',()=>{
  const f=fixture(),packets=[],deltas=[];let previous=0;
  // Deliberate kinematic probe of the receiver mapping, separate from the
  // real dual-combat movement test below. No absolute source wall clock.
  for(let frame=1;frame<=120;frame++){
    if(frame%6===0)packets.push({due:frame+[1,5,2][frame/6%3],motion:f.motion(frame,{x:frame*10,vx:600},['RIGHT'])});
    for(const packet of packets.filter(packet=>packet.due===frame))f.playback.observeMotion(f.sim,'remote',packet.motion,'local');
    f.playback.beforeStep(f.sim,'local',()=>1);f.sim.actor('remote').x+=10;
    if(frame>40)deltas.push(f.sim.actor('remote').x-previous);
    previous=f.sim.actor('remote').x;
  }
  assert.ok(deltas.every(value=>Math.abs(value-10)<.01),'steady source speed stays steady under reordered1/2/5-frame arrival delays');
  assert.ok(f.playback.diagnostics.motionProjected>0);assert.ok(f.playback.diagnostics.maxMotionProjectionFrames<=6);
  assert.equal(f.playback.diagnostics.starts,0);assert.equal(f.sim.actor('local').x,2000);
});

test('a long source pause resets motion mapping rather than treating its newly generated sample as old',()=>{
  const f=fixture();f.playback.observeMotion(f.sim,'remote',f.motion(1,{x:10,vx:600}),'local');
  for(let i=0;i<65;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  f.playback.observeMotion(f.sim,'remote',f.motion(2,{x:20,vx:600}),'local');
  for(let i=0;i<12;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  assert.ok(Math.abs(f.sim.actor('remote').x-20)<.01);assert.equal(f.playback.diagnostics.motionClockRebases,1);
  assert.equal(f.playback.diagnostics.maxMotionProjectionFrames,0);
});

test('extra jitter projection stops at six frames and never grows throughout a prolonged motion outage',()=>{
  const f=fixture();f.playback.observeMotion(f.sim,'remote',f.motion(1,{x:10,vx:600}),'local');
  for(let i=0;i<20;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  f.playback.observeMotion(f.sim,'remote',f.motion(10,{x:100,vx:600}),'local');
  for(let i=0;i<120;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  assert.ok(Math.abs(f.sim.actor('remote').x-160)<.01,'only100ms of geometry projection; no repeated extrapolation without a new packet');
  assert.equal(f.playback.diagnostics.maxMotionProjectionFrames,6);
  assert.equal(f.playback.observeMotion(f.sim,'remote',f.motion(9,{x:-500,vx:600}),'local'),false);
  assert.ok(Math.abs(f.sim.actor('remote').x-160)<.01,'an old packet cannot rewind the projected anchor');
});

test('current stop and reversal replace the projection without replaying a controller or local owner state',()=>{
  const f=fixture(),local=structuredClone(f.sim.actor('local'));
  f.playback.observeMotion(f.sim,'remote',f.motion(1,{x:10,vx:600},['RIGHT']),'local');
  for(let i=0;i<20;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  f.playback.observeMotion(f.sim,'remote',f.motion(10,{x:100,vx:600},['RIGHT']),'local');f.playback.beforeStep(f.sim,'local',()=>1);
  f.playback.observeMotion(f.sim,'remote',f.motion(11,{x:110,vx:0},[]),'local');
  for(let i=0;i<12;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  assert.ok(Math.abs(f.sim.actor('remote').x-110)<.01);assert.deepEqual(f.playback.remoteInputs().remote.held,[]);
  f.playback.observeMotion(f.sim,'remote',f.motion(12,{x:120,vx:-600,facing:-1},['LEFT']),'local');
  for(let i=0;i<12;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  assert.ok(Math.abs(f.sim.actor('remote').x-60)<.01);assert.deepEqual(f.playback.remoteInputs().remote.held,['LEFT']);
  assert.deepEqual(f.sim.actor('local'),local);assert.equal(f.playback.diagnostics.starts,0);
});

test('grounded jitter projection cannot cross an unconfirmed map endpoint or retain blocked body displacement',()=>{
  const f=fixture();f.sim.map.lines[0].end[0]=130;
  f.playback.observeMotion(f.sim,'remote',f.motion(1,{x:10,vx:600}),'local');
  for(let i=0;i<20;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  f.playback.observeMotion(f.sim,'remote',f.motion(10,{x:120,vx:600}),'local');
  for(let i=0;i<12;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  assert.ok(f.sim.actor('remote').x<=130);assert.ok(f.sim.actor('remote').x>129.99);
  const body=fixture();body.sim.actor('local').x=100;
  body.playback.observeMotion(body.sim,'remote',body.motion(1,{x:10,vx:600}),'local');
  for(let i=0;i<20;i++)body.playback.beforeStep(body.sim,'local',()=>1);
  body.playback.observeMotion(body.sim,'remote',body.motion(10,{x:90,vx:600}),'local');body.playback.beforeStep(body.sim,'local',()=>1);
  assert.ok(body.sim.actor('remote').x<100);const blocked=body.sim.actor('remote').x;body.sim.actor('local').x=2000;
  for(let i=0;i<12;i++)body.playback.beforeStep(body.sim,'local',()=>1);
  assert.equal(body.sim.actor('remote').x,blocked);
});

test('airborne samples never acquire guessed gravity or animation displacement from motion jitter correction',()=>{
  const f=fixture();f.playback.observeMotion(f.sim,'remote',f.motion(1,{x:10,vx:600}),'local');
  for(let i=0;i<20;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  f.playback.observeMotion(f.sim,'remote',f.motion(10,{x:100,y:300,vx:600,vy:700,grounded:false,lineId:null}),'local');
  for(let i=0;i<12;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  assert.ok(Math.abs(f.sim.actor('remote').x-100)<.01);assert.ok(Math.abs(f.sim.actor('remote').y-300)<.01);
  assert.equal(f.playback.diagnostics.motionProjected,0);assert.equal(f.playback.diagnostics.starts,0);
});

function dual({motion=true,maximumAge=250,runtime}={}){
  let now=0;
  const simulationFactory=runtime?.simulation.createSimulation??createSimulation,ownershipFactory=runtime?.ownership.createLocalOwnershipSync??createLocalOwnershipSync;
  const sims=[fixture({networkOwnerId:'remote',simulationFactory}).sim,fixture({simulationFactory}).sim],ids=['remote','local'];
  const syncs=ids.map(()=>ownershipFactory({clock:()=>now,combatPlaybackVersion:1,playbackMaxAdditionalAgeMs:maximumAge}));
  const state={snapshot:sims[0].snapshot(),ownership:{mode:'local-owner-v1',combatPlaybackVersion:1,
    actors:Object.fromEntries(ids.map(id=>[id,{epoch:1,frameSeq:0}]))},owners:{}};
  for(const [index,sim]of sims.entries())syncs[index].reconcile(sim,state,ids[index]);
  const pending=[],trace=[],receipts=[];let reportCount=0,motionCount=0,motionAccepted=0;
  function deliver(frame){
    for(let i=0;i<pending.length;){const packet=pending[i];if(packet.due>frame){i++;continue;}pending.splice(i,1);
      const to=1-packet.from,sim=sims[to],sync=syncs[to],before=structuredClone(sim.actor(ids[to]));
      if(packet.motion){motionCount++;motionAccepted+=Number(sync.receiveMotion(sim,ids[packet.from],packet.motion,ids[to]));}
      else {sync.receivePeerResult(sim,ids[packet.from],packet.report,ids[to]);receipts.push({from:packet.from,report:packet.report});}
      assert.deepEqual(sim.actor(ids[to]),before,'receiving remote state never replaces the real local owner');
    }
  }
  function step(frame,inputs){
    now=frame*1000/60;deliver(frame);
    for(let index=0;index<2;index++){
      const sim=sims[index],sync=syncs[index],input=inputs[index]??{held:[],pressed:[],released:[]};
      sync.beforeStep(sim,ids[index]);sim.step(dt,{...sync.remoteInputs(sim,ids[index]),[ids[index]]:input},{snapshot:false});
      const report=sync.afterStep(sim,ids[index],sim.drainEvents(),input);if(!report)continue;reportCount++;
      // online-client removes this local capture bookkeeping before wire
      // validation and rebases the same source frame into its match epoch.
      report.actions=report.actions.map(({ageFrames,...action})=>action);
      // Deliberately asymmetric reliable delivery. The second direction
      // confirms owner-side vitals in50ms; the first is blocked for700ms.
      pending.push({from:index,due:frame+(index===0?42:3),report});
      if(motion){const seq=report.frameSeq;
        if(index===1||seq%7!==1&&seq%7!==4)pending.push({from:index,due:frame+(index===0?[1,5,2][seq%3]:2),motion:encodeOwnedMotion(report,{held:input.held})});}
    }
    trace.push({frame,sourceX:sims[0].actor('remote').x,observedX:sims[1].actor('remote').x,
      sourceState:sims[0].actor('remote').state,observedState:sims[1].actor('remote').state,
      sourceTime:sims[0].actor('remote').stateTime,observedTime:sims[1].actor('remote').stateTime,
      localSourceX:sims[1].actor('local').x,localObserverX:sims[0].actor('local').x});
  }
  return {sims,syncs,ids,pending,trace,receipts,step,metrics:()=>({reportCount,motionCount,motionAccepted,
    receivers:syncs.map(sync=>sync.combatPlaybackDiagnostics.receiver)}),clear:()=>syncs.forEach(sync=>sync.clear())};
}

test('two actual simulations keep movement/stop/reversal current under asymmetric blocked controls and lost jittered motion',t=>{
  const references=historical.length?historical:[{name:'previous-policy-on-current-core'}];
  const runs=[...references.map(runtime=>dual({motion:false,maximumAge:1000,runtime:runtime.simulation?runtime:undefined})),dual()];
  for(const run of runs){
    for(let frame=1;frame<=240;frame++){
      const direction=frame<=30?'RIGHT':frame>=61&&frame<=90?'LEFT':null,
        other=frame>=121&&frame<=150?'LEFT':null;
      run.step(frame,[{held:direction?[direction]:[],pressed:[1,61].includes(frame)?[direction]:[],released:[31,91].includes(frame)?[frame===31?'RIGHT':'LEFT']:[]},
        {held:other?[other]:[],pressed:frame===121?['LEFT']:[],released:frame===151?['LEFT']:[]}]);
    }
  }
  for(const run of runs.slice(0,-1))assert.deepEqual(run.trace.map(row=>[row.sourceX,row.localSourceX]),runs.at(-1).trace.map(row=>[row.sourceX,row.localSourceX]),'real local movement is identical across network variants');
  const metrics=runs.map(run=>{const samples=run.trace.filter(row=>row.frame<=110),errors=samples.map(row=>Math.abs(row.sourceX-row.observedX)).sort((a,b)=>a-b);
    return {maximumError:errors.at(-1),p95Error:errors[Math.floor(errors.length*.95)],stopError:Math.abs(run.trace[49].sourceX-run.trace[49].observedX),
      reversalError:Math.abs(run.trace[104].sourceX-run.trace[104].observedX),finalError:Math.abs(run.trace.at(-1).sourceX-run.trace.at(-1).observedX),
      receivedMotion:run.metrics().motionAccepted,expired:run.metrics().receivers[1].expiredAdditionalAge??0};});
  const candidate=metrics.at(-1),evidence={scenario:'two-simulations-asymmetric700ms-loss-jitter',
    scope:'Actual Web combat/ownership modules; synthetic map, input and transport faults; excludes RTC bandwidth, GPU and WAN claims',
    baselines:metrics.slice(0,-1).map((value,index)=>({...value,name:references[index].name,sourceHashes:references[index].sourceHashes})),candidate};
  t.diagnostic(JSON.stringify(evidence));
  if(process.env.RF_MOTION_COMPARE_OUTPUT)writeFileSync(process.env.RF_MOTION_COMPARE_OUTPUT,JSON.stringify(evidence,null,2)+'\n');
  for(const baseline of metrics.slice(0,-1)){assert.ok(candidate.p95Error<baseline.p95Error*.5);assert.ok(candidate.maximumError<baseline.maximumError*.5);}
  assert.ok(candidate.stopError<2);assert.ok(candidate.reversalError<2);assert.ok(candidate.finalError<1);
  assert.ok(candidate.receivedMotion>20);assert.ok(candidate.expired>0);
  for(const run of runs)run.clear();
});

test('two actual owner simulations reject a genuinely generated old missed attack but retain a genuinely settled victim receipt',()=>{
  const run=dual();
  const attacker=run.sims[0].actor('remote');
  run.sims[0].enter(attacker,'TEST_ATTACK','fixture-source-attack');attacker.animationPlaybackSpeed=1;attacker.animationSpeedRamp=null;
  const victim=run.sims[1].actor('local'),hp=victim.hp;
  // The attacker originally sees the victim2000units away and misses. The
  // victim later approaches before that old reliable start arrives.
  for(let frame=1;frame<=80;frame++){
    if(frame===30)victim.x=30;
    run.step(frame,[{held:[],pressed:[],released:[]},{held:[],pressed:[],released:[]}]);
  }
  assert.equal(victim.hp,hp);assert.ok(run.metrics().receivers[1].expiredAdditionalAge>0);
  assert.equal(run.sims[1].state.events.filter(event=>event.type==='hit'&&event.targetId==='local').length,0);
  run.clear();

  // A separate fresh attack does hit through the real local collision
  // pipeline. Its victim-owned result remains valid even when motion is newer.
  const settled=dual(),source=settled.sims[0],target=settled.sims[1],targetOwner=target.actor('local');
  targetOwner.x=30;const initialHp=targetOwner.hp;
  source.enter(source.actor('remote'),'TEST_ATTACK','fixture-fresh-attack');
  Object.assign(source.actor('remote'),{animationPlaybackSpeed:1,animationSpeedRamp:null});
  settled.step(1,[{held:[],pressed:[],released:[]},{held:[],pressed:[],released:[]}]);
  for(const packet of settled.pending)if(packet.from===0&&packet.report)packet.due=2;
  for(let frame=2;frame<=22;frame++)settled.step(frame,[{held:[],pressed:[],released:[]},{held:[],pressed:[],released:[]}]);
  assert.ok(targetOwner.hp<initialHp,'current positive-dt local collision settles the hit');
  const hits=settled.receipts.filter(packet=>packet.from===1).flatMap(packet=>packet.report.hits);
  assert.ok(hits.length>0,'the actual locally settled hit remains in the victim report');
  assert.ok(hits.every(hit=>hit.damage>0&&hit.attackerId==='remote'));
  assert.equal(source.actor('local').hp,targetOwner.hp,'attacker receives victim-authoritative HP, with no later phantom replay');
  settled.clear();
});

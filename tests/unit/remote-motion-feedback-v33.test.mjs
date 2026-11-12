/** Synthetic motion isolates the transport timeline from combat tables.
 * These fixed invariants are engineering checks, not original-client traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';
import {createCombatPlaybackProducer} from '../../packages/online/combat-playback.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {readFileSync} from 'node:fs';

function fixture(){
  let now=0;
  const remote={id:'source',state:'MOVE',stateSerial:0,animationName:'Run',animationTransitionSerial:0,
    animationTime:0,stateTime:0,x:0,y:0,z:0,vx:600,vy:0,vz:0,facing:1,hp:100,mp:100},
    local={...structuredClone(remote),id:'local',x:10000};
  const sim={state:{actors:[remote,local],effects:[]},profile:{states:{MOVE:{},HIT:{}}},
    enter(actor,state){actor.state=state;actor.stateSerial++;actor.animationTime=0;actor.stateTime=0;}};
  const playback=createRemoteCombatPlayback({clock:()=>now});playback.bind(sim,'local',()=>1);
  const action=(frame,{state='MOVE',serial=frame,start=true,held=['RIGHT'],...fields}={})=>({id:frame,frameSeq:frame,
    actor:{...structuredClone(remote),state,stateSerial:serial,...fields},effects:[],playback:{version:1,start,held}});
  const pose=(frame,{x=frame*10,serial=1,...fields}={})=>({epoch:1,frameSeq:frame,
    actor:{...structuredClone(remote),stateSerial:serial,stateTime:frame/60,x,...fields}});
  function step(){now+=1000/60;playback.beforeStep(sim,'local',()=>1);
    remote.x+=remote.vx/60;remote.animationTime+=1/60;remote.stateTime+=1/60;playback.afterStep(sim);}
  return {remote,local,sim,playback,action,pose,step};
}

test('10Hz moving snapshots calibrate a matching source frame and never pull a correctly running actor back',()=>{
  const f=fixture();f.playback.receiveActions('source',[f.action(1,{serial:1})],1,1);
  for(let frame=1;frame<=120;frame++){
    // Real reports are captured after the source step. This zero-jitter
    // fixture delivers each 10Hz report before the following receiver step.
    if(frame>6&&frame%6===1)f.playback.observeState(f.sim,'source',f.pose(frame-1),'local');
    f.step();assert.equal(f.remote.x,frame*10,'a correct Native trajectory needs zero position correction');
  }
  assert.ok(f.playback.diagnostics.calibratedPoses>=18);assert.equal(f.playback.diagnostics.positionCorrectionDistance,0);
  assert.equal(f.local.x,10000);
});

test('late source-frame position errors are applied as bounded offsets while current motion continues',()=>{
  const f=fixture();f.playback.receiveActions('source',[f.action(1,{serial:1})],1,1);
  for(let frame=1;frame<=20;frame++)f.step();
  f.playback.observeState(f.sim,'source',f.pose(15,{x:170}),'local');
  const clocks=[f.remote.stateTime,f.remote.animationTime],local=structuredClone(f.local);
  f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(f.remote.x,202.5,'v34 recovery ramps toward the proven offset without pulling to old x=170');
  assert.deepEqual([f.remote.stateTime,f.remote.animationTime],clocks);assert.deepEqual(f.local,local);
  for(let frame=0;frame<20;frame++)f.step();
  assert.ok(Math.abs(f.remote.x-420)<.01,'the correction converges without changing the running trajectory');
});

test('future poses wait for the corresponding local positive-dt prediction instead of pulling a delayed controller ahead',()=>{
  const f=fixture();f.playback.receiveActions('source',[f.action(1,{serial:1})],1,1);for(let frame=0;frame<5;frame++)f.step();
  f.playback.observeState(f.sim,'source',f.pose(8,{x:1000}),'local');
  for(let frame=6;frame<=8;frame++){f.step();assert.equal(f.remote.x,frame*10);}
  f.step();assert.ok(f.remote.x>90);assert.equal(f.playback.diagnostics.calibratedPoses,1);
});

test('repeated delayed starts cannot accumulate more than three additional frames of scheduling latency',()=>{
  const f=fixture();const packets=[];
  for(let frame=1;frame<=180;frame++){
    if(frame===1||frame%10===0)packets.push({due:frame+(frame===1?0:frame%30===0?9:5),action:f.action(frame)});
    for(const packet of packets.filter(packet=>packet.due===frame))f.playback.receiveActions('source',[packet.action],1,packet.action.frameSeq);
    f.step();assert.ok(f.playback.diagnostics.owners.source.schedulingDelayFrames<=3);
  }
  for(let frame=0;frame<20;frame++)f.step();
  assert.ok(f.playback.diagnostics.rebasedStarts>0);assert.ok(f.playback.diagnostics.maxSchedulingDelayFrames<=3);
});

test('new remote reactions retain the owning victim launch and stop intent without changing any local owner field',()=>{
  const f=fixture(),local=structuredClone(f.local);
  const action=f.action(1,{state:'HIT',vx:-420,vy:730,vz:0,grounded:false,lineId:null,lastAttackerFront:false,hitStop:.12,worldStop:0});
  f.playback.observeState(f.sim,'source',{epoch:1,frameSeq:1,actor:structuredClone(action.actor)},'local');
  for(const key of ['vz','hitStop','worldStop','lastAttackerFront'])delete action.actor[key];
  f.playback.receiveActions('source',[action],1,1);f.playback.beforeStep(f.sim,'local',()=>1);
  for(const key of ['vx','vy','grounded','lineId'])assert.equal(f.remote[key],action.actor[key],key);
  assert.equal(f.remote.lastAttackerFront,false);assert.equal(f.remote.hitStop,.12);assert.equal(f.remote.worldStop,0);
  assert.deepEqual(f.local,local);
});

test('an old same-controller animation loop cannot restart StateStart, clear contacts or rewind the displayed phase',()=>{
  const f=fixture();Object.assign(f.remote,{stateSerial:1,animationTransitionSerial:4,animationTime:.3,hits:{local:1}});
  const action=f.action(1,{serial:1,animationTransitionSerial:2});
  f.playback.receiveActions('source',[action],1,1);f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(f.remote.animationTransitionSerial,4);assert.equal(f.remote.animationTime,.3);assert.deepEqual(f.remote.hits,{local:1});
  assert.equal(f.playback.diagnostics.starts,0);assert.equal(f.playback.diagnostics.adoptedStarts,1);
});

test('real reliable producer includes stop edges once and preserves the complete reaction movement header',()=>{
  const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url))),
    map={sceneId:'motion-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},
    sim=createSimulation({profile,map,preset:{passives:[],guildPassives:[]},actors:[{id:'a',team:0,position:[0,0,0],lineId:0},{id:'b',team:1,position:[1000,0,0],lineId:0}]}),
    actor=sim.actor('a'),producer=createCombatPlaybackProducer({version:1});
  producer.capture(sim,'a',{epoch:1,frameSeq:1});actor.hitStop=.1;actor.vx=-420;actor.vy=730;actor.lastAttackerFront=false;
  const stop=producer.capture(sim,'a',{epoch:1,frameSeq:2});assert.ok(stop);assert.equal(stop.playback.start,false);
  for(const key of ['vx','vy'])assert.equal(stop.actor[key],actor[key]);
  assert.equal(stop.actor.hitStop,.1,'the exact reaction intent survives a later merged relay envelope');
  actor.hitStop=.05;assert.equal(producer.capture(sim,'a',{epoch:1,frameSeq:3}),null,'timer countdown does not flood reliable controls');
  actor.hitStop=0;assert.ok(producer.capture(sim,'a',{epoch:1,frameSeq:4}),'release is a reliable control boundary');
  sim.startAnimationTransition(actor,profile.states[actor.state],{loop:true});
  assert.equal(producer.capture(sim,'a',{epoch:1,frameSeq:5}),null,'a display loop must not become a new StateStart event');
});

test('a confirmed direct-change reaction retains its original no-blend policy rather than adding a fresh zero-speed ramp',()=>{
  const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url))),
    map={sceneId:'reaction-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},
    make=()=>createSimulation({profile,map,preset:{passives:[],guildPassives:[]},actors:[{id:'a',team:0,position:[0,0,0],lineId:0},{id:'b',team:1,position:[1000,0,0],lineId:0}]}),
    source=make(),receiver=make(),actor=source.actor('a');
  source.enter(actor,'RSI_DAMAGE_SMALL_FRONT','explicit-original-reaction-start',{directChange:true});actor.hitStop=.12;
  const report=encodeOwnedState(source,'a',{epoch:1,frameSeq:1}),action=encodeCriticalAction(report,{id:1});
  action.playback={version:1,start:true,held:[]};
  const playback=createRemoteCombatPlayback({clock:()=>0});playback.bind(receiver,'b',()=>1);
  playback.observeState(receiver,'a',report,'b');playback.receiveActions('a',[action],1,1);playback.beforeStep(receiver,'b',()=>1);
  const remote=receiver.actor('a');assert.equal(actor.presentationTransition.enabled,false);assert.equal(actor.animationSpeedRamp,null);
  assert.equal(remote.presentationTransition.enabled,false);assert.equal(remote.animationSpeedRamp,null);
  assert.equal(remote.animationPlaybackSpeed,actor.animationPlaybackSpeed);assert.equal(remote.hitStop,.12);playback.clear();
});

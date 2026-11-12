/** Production playback/rendering with disclosed geometry and state setup.
 * RF_PHASE_IMPLEMENTATION_ROOT is an optional read-only historical checkout
 * for a red/green A/B. These are Web invariants, not original-client answers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {encodeOwnedMotion} from '../../packages/online/owned-motion.mjs';

const implementation=process.env.RF_PHASE_IMPLEMENTATION_ROOT;
const moduleUrl=file=>implementation?pathToFileURL(resolve(implementation,file)):new URL('../../'+file,import.meta.url);
const {createRemoteCombatPlayback}=await import(moduleUrl('apps/web/remote-combat-playback.mjs'));
const {captureActorPresentation,interpolateActorPresentation,createActorRenderClock}=await import(moduleUrl('apps/web/actor-render-clock.mjs'));
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const dt=1/60,map={sceneId:'phase-v51-disclosed-line',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const empty={held:[],pressed:[],released:[]},motionKeys=['vx','vy','vz','facing','grounded','lineId','landPosition'];
const motionOf=actor=>structuredClone(Object.fromEntries(motionKeys.map(key=>[key,actor[key]])));
const experimental={experimentalEvolvedMotionContinuation:true};
function fixture(options={},createPlayback=createRemoteCombatPlayback){
  const sim=createSimulation({profile,map,networkOwnerId:'local',seed:2016,preset:{passives:[],guildPassives:[]},actors:[
    {id:'remote',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
    {id:'local',team:1,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','fixture');}
  sim.networkCombatPlaybackVersion=1;
  const playback=createPlayback({clock:()=>sim.state.time*1000,...options});playback.bind(sim,'local',()=>1);
  const remote=sim.actor('remote'),report=frame=>encodeOwnedState(sim,'remote',{epoch:1,frameSeq:frame});
  const action=(frame,{start=false,fields={}}={})=>{const packet=report(frame);Object.assign(packet.actor,fields);
    const value=encodeCriticalAction(packet,{id:frame});value.playback={version:1,start,held:[]};return value;};
  const step=()=>{playback.beforeStep(sim,'local',()=>1);sim.step(dt,{...playback.remoteInputs(sim,'local'),local:empty},{snapshot:false});playback.afterStep(sim);};
  const launch=()=>{
    sim.enter(remote,'RSI_JUMP_UP','disclosed-airborne-setup');
    Object.assign(remote,{x:0,y:400,grounded:false,lineId:null,landPosition:[0,0,0],vy:600,vx:0,vz:0,facing:-1});
    const motion=encodeOwnedMotion(report(20),{held:[]});
    playback.observeMotion(sim,'remote',motion,'local');playback.beforeStep(sim,'local',()=>1);
    return motion;
  };
  return {sim,remote,playback,report,action,step,launch};
}

for(const start of [false,true])test(`opt-in old reliable ${start?'StateStart':'control'} preserves the consumed motion's positive-dt gravity continuation`,()=>{
  const f=fixture(experimental),packet=f.launch();for(let i=0;i<3;i++)f.step();
  const before=motionOf(f.remote),position=[f.remote.x,f.remote.y,f.remote.z],local=structuredClone(f.sim.actor('local'));
  assert.ok(before.vy<packet.actor.vy,'real positive steps have already applied gravity');
  const action=f.action(15,{start,fields:{stateSerial:start?f.remote.stateSerial+1:f.remote.stateSerial,
    vx:500,vy:900,vz:4,facing:1,grounded:true,lineId:0,landPosition:[300,0,0]}});
  f.playback.receiveActions('remote',[action],1,20);f.playback.beforeStep(f.sim,'local',()=>1);
  assert.deepEqual(motionOf(f.remote),before,'old packet velocity cannot rewind the current physical phase');
  assert.deepEqual([f.remote.x,f.remote.y,f.remote.z],position);assert.deepEqual(f.sim.actor('local'),local);
});

test('opt-in old control cannot re-launch a remote unit after real positive physics has landed it',()=>{
  const f=fixture(experimental);f.launch();for(let i=0;i<100;i++)f.step();
  assert.equal(f.remote.grounded,true);const before=motionOf(f.remote),y=f.remote.y;
  f.playback.receiveActions('remote',[f.action(15,{fields:{vy:900,grounded:false,lineId:null}})],1,20);
  f.playback.beforeStep(f.sim,'local',()=>1);
  assert.deepEqual(motionOf(f.remote),before);assert.equal(f.remote.y,y);
});

test('opt-in old control keeps current STOP-frozen physics while its genuine STOP edge remains independent',()=>{
  const f=fixture(experimental);f.launch();for(let i=0;i<3;i++)f.step();
  f.remote.hitStop=.1;const before=motionOf(f.remote);f.step();
  assert.deepEqual(motionOf(f.remote),before,'STOP really prevented this positive step from moving');
  const action=f.action(15,{fields:{vy:900,hitStop:.2}});
  f.playback.receiveActions('remote',[action],1,20);f.playback.beforeStep(f.sim,'local',()=>1);
  assert.deepEqual(motionOf(f.remote),before);assert.ok(f.remote.hitStop>0,'movement preservation does not clear STOP');
});

for(const frame of [20,21])test(`a StateStart at source frame ${frame} keeps its legal new velocity at/after motion frame 20`,()=>{
  const f=fixture(experimental);f.launch();for(let i=0;i<3;i++)f.step();
  const action=f.action(frame,{start:true,fields:{stateSerial:f.remote.stateSerial+1,vy:900,vx:120,facing:1,
    grounded:false,lineId:null,hitStop:0,worldStop:0}});
  f.playback.receiveActions('remote',[action],1,frame);f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(f.remote.vy,900);assert.equal(f.remote.vx,120);assert.equal(f.remote.facing,1);
});

test('render reaction boundaries use current XYZ with the current animation; within-phase motion stays interpolated',()=>{
  const f=fixture(),clock=createActorRenderClock(),actor=f.remote;
  clock.reset([actor]);let last=captureActorPresentation(actor);
  for(const state of ['RSI_DAMAGE_AIR_UP','RSI_DAMAGE_AIR_FALL','RSI_DAMAGE_AIR_DOWN_LANDING','RSI_DAMAGE_STANDUP_FRONT','RSI_WAIT']){
    f.sim.enter(actor,state,'disclosed-reaction-boundary');actor.x+=10;actor.y+=20;actor.z+=3;clock.push([actor]);
    for(const alpha of [0,.1,.5,.9]){
      const shown=clock.sample([actor],alpha)[0];
      assert.equal(shown.state,state);assert.equal(shown.animationTime,actor.animationTime);
      for(const key of ['x','y','z'])assert.equal(shown[key],actor[key],state+' '+key);
    }
    last=captureActorPresentation(actor);actor.x+=8;actor.y+=4;actor.z+=2;actor.animationTime+=dt;clock.push([actor]);
    const shown=clock.sample([actor],.25)[0];
    assert.equal(shown.x,last.x+2);assert.equal(shown.y,last.y+1);assert.equal(shown.z,last.z+.5);
  }
});

test('ordinary movement, attack changes, loop seeks, and STOP do not become general XYZ snapping',()=>{
  const pose=(state,serial,x,animationTime)=>({id:'actor',state,stateSerial:serial,x,y:0,z:0,animationName:state,
    animationTransitionSerial:serial,animationTime});
  for(const [previous,current]of [
    [pose('RSI_WAIT',1,0,.2),pose('RSI_WALK',2,10,0)],
    [pose('RSI_COMBO_Z',3,0,.2),pose('RSI_COMBO_ZZ',4,10,0)],
    [pose('RSI_DAMAGE_AIR_UP',5,0,.2),pose('RSI_DAMAGE_AIR_UP',5,10,.01)],
    [pose('RSI_DAMAGE_AIR_UP',5,0,.2),pose('RSI_DAMAGE_AIR_UP',5,10,.2)],
  ])assert.equal(interpolateActorPresentation(previous,current,.3).x,3);
});

test('reaction display sampling is immutable and keeps attached core position with the actor boundary',()=>{
  const previous={id:'actor',state:'RSI_WAIT',stateSerial:1,animationName:'Wait',animationTime:.2,x:0,y:0,z:0,
    core:{phase:'idle',animationName:'Wait',animationTime:.2,x:0,y:100,z:0}};
  const current={...previous,state:'RSI_DAMAGE_AIR_UP',stateSerial:2,animationName:'DamageAirUp',animationTime:.01,x:10,y:40,z:5,
    core:{...previous.core,animationTime:.3,x:10,y:140,z:5}};
  const before=structuredClone(current),shown=interpolateActorPresentation(previous,current,.5);
  assert.deepEqual([shown.core.x,shown.core.y,shown.core.z],[10,140,5]);assert.equal(shown.core.animationTime,.25);
  assert.deepEqual(current,before);assert.equal(shown.y,40);
});

test('opt-in delayed control trajectory equals the same positive-dt simulation without the obsolete motion replay',t=>{
  const reference=fixture(experimental),candidate=fixture(experimental);reference.launch();candidate.launch();
  let maximumPositionError=0,maximumVelocityError=0,referenceLanding=null,candidateLanding=null;
  for(let frame=1;frame<=100;frame++){
    if([3,6,9,12].includes(frame))candidate.playback.receiveActions('remote',[candidate.action(10+frame/3)],1,20);
    reference.step();candidate.step();
    maximumPositionError=Math.max(maximumPositionError,Math.abs(reference.remote.y-candidate.remote.y));
    maximumVelocityError=Math.max(maximumVelocityError,Math.abs(reference.remote.vy-candidate.remote.vy));
    if(reference.remote.grounded&&referenceLanding===null)referenceLanding=frame;
    if(candidate.remote.grounded&&candidateLanding===null)candidateLanding=frame;
  }
  const result={implementation:implementation??'current',maximumPositionError,maximumVelocityError,referenceLanding,candidateLanding};
  t.diagnostic(JSON.stringify(result));
  assert.equal(maximumPositionError,0);assert.equal(maximumVelocityError,0);assert.equal(candidateLanding,referenceLanding);
});

for(const options of [{},{experimentalEvolvedMotionContinuation:false}])test(`new StateStart ${Object.keys(options).length?'explicit false':'default'} retains conservative packet intent`,()=>{
  // V54 ordinary non-Start controls preserve evolved movement instead; see
  // network-control-continuity-v54. Only new enter intent keeps this policy.
  for(const start of [true]){
    const f=fixture(options),packet=f.launch();for(let i=0;i<3;i++)f.step();
    assert.notEqual(f.remote.vy,packet.actor.vy,'gravity has genuinely advanced before the old action');
    f.playback.receiveActions('remote',[f.action(15,{start,fields:{stateSerial:start?f.remote.stateSerial+1:f.remote.stateSerial,
      vy:900,vx:500,grounded:true,lineId:0}})],1,20);
    f.playback.beforeStep(f.sim,'local',()=>1);
    assert.deepEqual(motionOf(f.remote),motionOf(packet.actor),'default continuation remains the V50 packet-intent policy');
  }
});

test('experimental movement continuation requires an explicit boolean',()=>{
  for(const value of [1,'true',{},null])assert.throws(()=>createRemoteCombatPlayback({experimentalEvolvedMotionContinuation:value}),/invalid-playback-bounds/);
});

test('new Start default and false continuation match the read-only V50 positive-step trajectory',{skip:!process.env.RF_PHASE_BASELINE_ROOT},async t=>{
  const {createRemoteCombatPlayback:createBaseline}=await import(pathToFileURL(resolve(process.env.RF_PHASE_BASELINE_ROOT,'apps/web/remote-combat-playback.mjs')).href);
  for(const options of [{},{experimentalEvolvedMotionContinuation:false}]){
    const reference=fixture({},createBaseline),candidate=fixture(options);reference.launch();candidate.launch();
    let maximumPositionError=0,maximumVelocityError=0;
    for(let frame=1;frame<=100;frame++){
      if([3,6,9,12].includes(frame))for(const f of [reference,candidate])f.playback.receiveActions('remote',[f.action(10+frame/3,{start:true})],1,20);
      reference.step();candidate.step();
      maximumPositionError=Math.max(maximumPositionError,Math.abs(reference.remote.y-candidate.remote.y));
      maximumVelocityError=Math.max(maximumVelocityError,Math.abs(reference.remote.vy-candidate.remote.vy));
      assert.deepEqual(motionOf(candidate.remote),motionOf(reference.remote));
      assert.deepEqual([candidate.remote.state,candidate.remote.stateTime,candidate.remote.y],
        [reference.remote.state,reference.remote.stateTime,reference.remote.y]);
    }
    t.diagnostic(JSON.stringify({options,maximumPositionError,maximumVelocityError,baseline:process.env.RF_PHASE_BASELINE_ROOT}));
  }
});

test('positive-dt LK fall and landing display boundaries retain one current simulation phase',t=>{
  const f=fixture();f.launch();f.sim.enter(f.remote,'RSI_DAMAGE_AIR_UP','disclosed-launch-setup');
  Object.assign(f.remote,{vy:600,y:400,grounded:false,lineId:null});
  const rows=[];let previous=captureActorPresentation(f.remote);
  for(let frame=1;frame<=180;frame++){
    f.step();const current=f.remote;
    if(previous.state!==current.state){
      const errors=[.05,.25,.5,.75,.95].map(alpha=>{
        const shown=interpolateActorPresentation(previous,current,alpha);
        assert.equal(shown.animationTime,current.animationTime);
        return Math.hypot(...['x','y','z'].map(key=>shown[key]-current[key]));
      });
      rows.push({frame,from:previous.state,to:current.state,maximumBoundaryPositionError:Math.max(...errors)});
    }
    previous=captureActorPresentation(current);
  }
  t.diagnostic(JSON.stringify({implementation:implementation??'current',rows}));
  assert.ok(rows.some(row=>row.to==='RSI_DAMAGE_AIR_FALL'));
  assert.ok(rows.some(row=>row.to==='RSI_DAMAGE_AIR_DOWN_LANDING'));
  assert.equal(Math.max(...rows.map(row=>row.maximumBoundaryPositionError)),0);
});

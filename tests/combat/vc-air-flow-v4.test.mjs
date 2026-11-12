import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {vcCommandSkillCancelAllowed,vcCommandAirDashCancelDirection,vcReferenceCommandSkillCancelAllowed} from '../../packages/combat-core/vc-commands.mjs';
const oracle=JSON.parse(readFileSync(new URL('../../contracts/vc-air-flow-source-v4.json',import.meta.url)));
const ZXX='RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX', FINISH='RVC_DASH_JUMP_COMBO_XX_FINISH';
const dt=1/60,empty=()=>({held:new Set(),pressed:new Set()});

test('compiled full CommonEvent has no hidden movement/normal-attack cancel; target follow-up is a separately identified user requirement',()=>{
  assert.equal(oracle.targetClientMeasured,false);
  assert.equal(oracle.cases.length,4320);
  assert.ok(oracle.fragments.some(f=>f.file==='X2Lib/X2GUUser.cpp'&&f.method==='CommonEventProcess'));
  for(const state of [0,1,2,5])for(const input of [0,1,2,3,4,5,6]){
    assert.equal(oracle.cases.filter(c=>c.state===state&&c.input===input&&c.requested!==0).length,0);
  }
});

test('six air phases consume independent compiled Common speed/gravity/passive trajectories up to a source transition request',()=>{
  let checked=0;
  for(let state=0;state<6;state++)for(let input=0;input<7;input++){
    const n=oracle.states[state],{sim,a}=vcFixture({position:[-700,9000,0],gap:2500});
    a.grounded=false;a.lineId=null;sim.enter(a,n,'v4-physics-probe');
    a.vx=750;a.vy=-100;
    if(state===2){a.vx=725;a.vy=175;}
    if(state===3){a.vx=0;a.vy=200;}
    if(state===4){a.vx=0;a.vy=450;}
    if(state===5){a.vx=0;a.vy=300;}
    const rows=oracle.cases.filter(c=>c.state===state&&c.input===input);
    for(const c of rows){
      const keys=empty();
      if(input===1||input===4)keys.held.add('RIGHT');
      if(input===2)keys.held.add('LEFT');
      if(input===3||input===4)keys.held.add('DOWN');
      // Source-only double/Z cases establish absence of the old branch; the
      // target adapter is checked below using complete physical key chains.
      sim.step(dt,{vc:keys},{snapshot:false});sim.drainEvents();
      if(c.requested)break;
      assert.equal(a.state,n,JSON.stringify(c));
      assert.ok(Math.abs(a.vx-c.vx)<.004,`vx ${a.vx} / ${JSON.stringify(c)}`);
      assert.ok(Math.abs(a.vy-c.vy)<.004,`vy ${a.vy} / ${JSON.stringify(c)}`);
      assert.equal(!!a.skillDisableGravity,c.gravityDisabled,JSON.stringify(c));
      assert.ok(Math.abs(a.animationTime-c.time)<.000004,`clock ${a.animationTime} / ${JSON.stringify(c)}`);
      checked++;
    }
  }
  assert.ok(checked>2500);
});

for(const [state,threshold] of [[ZXX,.24],['RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX',.42],
  ['RVC_DASH_JUMP_COMBO_X',.433],['RVC_DASH_JUMP_COMBO_XX_LOOP',.001],[FINISH,.3]])
test(`user follow-up ${state} opens strictly after existing source threshold and remains open at stopped end`,()=>{
  const def=vcProfile.states[state],a={state,grounded:false,facing:1,animationTime:threshold,animationStopped:false};
  const keys={held:new Set(['RIGHT']),pressed:new Set(),pureDoubleRight:true};
  assert.equal(vcCommandSkillCancelAllowed(a,def),false);
  assert.equal(vcCommandAirDashCancelDirection(a,def,keys),0);
  a.animationTime=threshold+.00001;
  assert.equal(vcCommandSkillCancelAllowed(a,def),true);
  // v8 user adapter opens ordinary66 at this same early window. Its separate
  // positive-lift guard is verified by physical multi-cycle production tests.
  assert.equal(vcCommandAirDashCancelDirection(a,def,keys),1);
  a.animationTime=def.clip.durationSeconds;a.animationStopped=true;a.stateTime=def.clip.durationSeconds;
  assert.equal(vcCommandSkillCancelAllowed(a,def),true);
  assert.equal(vcCommandAirDashCancelDirection(a,def,keys),1);
  // A held direction, Z, or X alone must not invent an extra aerial dash.
  assert.equal(vcCommandAirDashCancelDirection(a,def,{held:keys.held,pressed:new Set(['Z'])}),0);
  assert.equal(vcReferenceCommandSkillCancelAllowed(a,def),false);
});

function change(buffer,key,down,time){buffer[down?'down':'up'](key,time);}
function takeoff(buffer,time,i,facing,mode){
  const d=facing>0?'RIGHT':'LEFT';
  if(i===0||i===2)change(buffer,d,true,time);if(i===1||i===10)change(buffer,d,false,time);
  if(i===3)change(buffer,'UP',true,time);if(i===4)change(buffer,'UP',false,time);
  const shots=mode==='zxx'?[[10,'Z'],[20,'X'],[30,'X']]:[[10,'X'],[20,'X'],...(mode==='xx'?[]:mode==='xxxx'?[[40,'X'],[70,'X']]:Array.from({length:10},(_,n)=>[36+n*12,'X']))];
  for(const [frame,key]of shots){if(i===frame)change(buffer,key,true,time);if(i===frame+1)change(buffer,key,false,time);}
}

for(const facing of [-1,1])for(const mode of ['zxx','xx','xxxx','longX'])for(const nextMode of ['zxx','xx'])for(const turn of [1,-1])
test(`physical ${mode} → air 66${nextMode==='zxx'?'ZXX':'X~X'} facing ${facing}, turn ${turn}`,()=>{
  const {sim,a}=vcFixture({position:[facing*-700,3080,0],gap:2500,facing});
  const buffer=createInputBuffer({sampledLevels:true});const events=[];let cancelAt=-1,followAt=-1;
  const from=mode==='zxx'?ZXX:FINISH,into=nextMode==='zxx'?ZXX:FINISH,direction=facing*turn>0?'RIGHT':'LEFT';
  for(let i=0;i<360;i++){
    const time=sim.state.time+.001;
    if(cancelAt<0){
      takeoff(buffer,time,i,facing,mode);
      if(a.state===from&&a.animationTime>(mode==='zxx'?.25:.31)&&!a.grounded)cancelAt=i;
    }
    if(cancelAt>=0){
      const j=i-cancelAt;
      if(j===0||j===2)buffer.down(direction,time);
      if(j===1||j===3)buffer.up(direction,time);
      const shots=nextMode==='zxx'?[[2,'Z'],[12,'X'],[22,'X']]:[[2,'X'],[12,'X']];
      for(const [at,key]of shots){if(j===at)buffer.down(key,time);if(j===at+1)buffer.up(key,time);}
      if(j===2)followAt=i;
    }
    sim.step(dt,{vc:buffer.consume(sim.state.time+dt)},{snapshot:false});events.push(...sim.drainEvents());
    if(i===followAt){assert.equal(a.grounded,false);assert.equal(a.facing,facing*turn);assert.equal(a.state,nextMode==='zxx'?'RSI_DASH_JUMP_COMBO_Z':'RSI_DASH_JUMP_COMBO_X');}
  }
  assert.ok(cancelAt>0,'complete first chain reaches its open aerial cancel window');
  const cancel=events.find(e=>e.type==='stateChanged'&&e.reason==='user-target2016-vc-air-followup');
  assert.ok(cancel,'physical second double tap cancels without first landing');
  const firstHot=events.filter(e=>e.type==='overheatHpChanged'&&e.actorId==='vc'&&e.time<cancel.time).length;
  if(mode==='xx')assert.equal(firstHot,0);
  if(mode==='xxxx')assert.equal(firstHot,2);
  if(mode==='longX')assert.ok(firstHot>=6,'long X tests repeated hot phases, not just an early finish');
  assert.ok(events.some(e=>e.type==='stateChanged'&&e.state===into&&e.time>cancel.time),'complete second aerial chain');
  assert.equal(events.filter(e=>e.type==='stateChanged'&&e.actorId==='vc'&&e.state==='RSI_JUMP_LANDING'&&e.time<cancel.time).length,0);
  assert.equal(a.state,'RSI_WAIT');assert.equal(!!a.skillDisableGravity,false);
});

for(const facing of[-1,1])test(`physical ZXX rejects 66 before its window, then accepts stopped-pose 66X without a new jump, facing ${facing}`,()=>{
  const {sim,a}=vcFixture({position:[facing*-700,3080,0],gap:2500,facing});
  const buffer=createInputBuffer({sampledLevels:true}),events=[];const direction=facing>0?'RIGHT':'LEFT';
  let early=-1,late=-1,beforeCancel=null;
  for(let i=0;i<200;i++){
    const time=sim.state.time+.001;takeoff(buffer,time,i,facing,'zxx');
    if(early<0&&a.state===ZXX&&a.animationTime>.03)early=i;
    if(early>=0&&i<=early+3){
      if(i===early||i===early+2)buffer.down(direction,time);
      else buffer.up(direction,time);
    }
    if(late<0&&a.state===ZXX&&a.animationStopped&&!a.grounded)late=i;
    if(late>=0){
      const j=i-late;
      if(j===0||j===2)buffer.down(direction,time);if(j===1||j===3)buffer.up(direction,time);
      if(j===2)beforeCancel={y:a.y,vy:a.vy};
      if(j===3)buffer.down('X',time);if(j===4)buffer.up('X',time);
    }
    sim.step(dt,{vc:buffer.consume(sim.state.time+dt)},{snapshot:false});events.push(...sim.drainEvents());
    if(i===early+2&&early>=0)assert.equal(a.state,ZXX,'before window cannot restart the attack');
    if(i===late+2&&late>=0){
      assert.equal(a.state,'RSI_DASH_JUMP');assert.equal(a.grounded,false);
      assert.ok(Math.abs(a.vy-(beforeCancel.vy-vcProfile.physics.G_ACCEL*dt))<.0001,'66 only preserves the current falling trajectory');
      assert.ok(a.y<beforeCancel.y,'the cancellation does not teleport upward');
    }
    if(i===late+3&&late>=0)assert.equal(a.state,'RSI_DASH_JUMP_COMBO_X');
  }
  assert.ok(early>0&&late>early);assert.equal(events.filter(e=>e.type==='stateChanged'&&e.reason==='user-target2016-vc-air-followup').length,1);
});

for(const facing of[-1,1])for(const mode of['zxx','xxxx'])test(`physical ${mode} stopped airborne pose still accepts Haze, facing ${facing}`,()=>{
  const {sim,a}=vcFixture({skillId:24221,position:[facing*-700,3080,0],gap:2500,facing});
  const buffer=createInputBuffer({sampledLevels:true}),events=[];let sent=false;
  for(let i=0;i<230;i++){
    const time=sim.state.time+.001;takeoff(buffer,time,i,facing,mode);
    if(!sent&&a.state===(mode==='zxx'?ZXX:FINISH)&&a.animationStopped&&!a.grounded){buffer.down('A',time);sent=true;}
    else if(sent)buffer.up('A',time);
    sim.step(dt,{vc:buffer.consume(sim.state.time+dt)},{snapshot:false});events.push(...sim.drainEvents());
  }
  assert.ok(sent);assert.equal(events.filter(e=>e.type==='skillStarted'&&e.skillId===24221).length,1);
  assert.ok(events.some(e=>e.type==='stateChanged'&&e.state==='RSI_A_RWT_BARRAGE_ATTACK_AIR'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {encodeOwnedMotion} from '../../packages/online/owned-motion.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';

// Current production receiver over disclosed geometry; no old executable or
// original-client result is used as an oracle. Expected velocity comes from
// the positive-step simulation immediately before delivering the old control.
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const map={sceneId:'v54-control-continuity',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const movement=a=>Object.fromEntries(['vx','vy','vz','facing','grounded','lineId','landPosition'].map(k=>[k,structuredClone(a[k])]));
function fixture(){
  const sim=createSimulation({profile,map,networkOwnerId:'local',seed:2016,preset:{passives:[],guildPassives:[]},actors:[
    {id:'remote',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
    {id:'local',team:1,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  for(const a of sim.state.actors){a.inputLock=0;sim.enter(a,'RSI_WAIT','fixture');}
  sim.networkCombatPlaybackVersion=1;
  const playback=createRemoteCombatPlayback({clock:()=>sim.state.time*1000});playback.bind(sim,'local',()=>1);
  const actor=sim.actor('remote');sim.enter(actor,'RSI_JUMP_UP','fixture-launch');
  Object.assign(actor,{y:400,grounded:false,lineId:null,landPosition:[0,0,0],vy:600,vx:0,vz:0,facing:-1});
  const report=frameSeq=>encodeOwnedState(sim,'remote',{epoch:1,frameSeq});
  const motion=encodeOwnedMotion(report(20),{held:['LEFT']});
  playback.observeMotion(sim,'remote',motion,'local');playback.beforeStep(sim,'local',()=>1);
  function step(){playback.beforeStep(sim,'local',()=>1);sim.step(1/60,playback.remoteInputs(sim,'local'),{snapshot:false});playback.afterStep(sim);}
  function control(frame,{start=false,fields={},held=[]}={}){
    const value=report(frame);Object.assign(value.actor,fields);
    const action=encodeCriticalAction(value,{id:frame});action.playback={version:1,start,held};
    playback.receiveActions('remote',[action],1,Math.max(20,frame));playback.beforeStep(sim,'local',()=>1);
  }
  return {sim,actor,playback,motion,step,control,report};
}
test('a delayed non-Start preserves evolved gravity, direction and source input release',()=>{
  const f=fixture();for(let i=0;i<4;i++)f.step();
  const before=movement(f.actor),position=[f.actor.x,f.actor.y,f.actor.z],local=structuredClone(f.sim.actor('local'));
  assert.ok(before.vy<f.motion.actor.vy);
  f.control(15,{fields:{vy:999,facing:1},held:[]});
  assert.deepEqual(movement(f.actor),before);assert.deepEqual([f.actor.x,f.actor.y,f.actor.z],position);
  assert.deepEqual(f.sim.actor('local'),local);assert.deepEqual(f.playback.remoteInputs().remote.held,['LEFT']);
  assert.equal(f.playback.diagnostics.staleControlMotionPreserved,1);
});
test('a delayed ordinary control cannot reinstall an airborne sample after landing',()=>{
  const f=fixture();for(let i=0;i<100;i++)f.step();assert.equal(f.actor.grounded,true);
  const before=movement(f.actor);f.control(15,{fields:{vy:999,grounded:false,lineId:null}});
  assert.deepEqual(movement(f.actor),before);assert.equal(f.actor.grounded,true);
});
test('old non-Start retains independent stop edges and does not advance animation or resources',()=>{
  const f=fixture();for(let i=0;i<3;i++)f.step();
  const before=movement(f.actor),phase=f.actor.animationTime,hp=f.actor.hp,mp=f.actor.mp;
  f.control(15,{fields:{hitStop:.2,worldStop:.1}});
  assert.deepEqual(movement(f.actor),before);assert.ok(f.actor.hitStop>0);assert.ok(f.actor.worldStop>0);
  assert.equal(f.actor.animationTime,phase);assert.equal(f.actor.hp,hp);assert.equal(f.actor.mp,mp);
});
test('new StateStart retains its distinct conservative motion admission',()=>{
  const f=fixture();for(let i=0;i<3;i++)f.step();
  f.control(15,{start:true,fields:{stateSerial:f.actor.stateSerial+1,vy:900}});
  assert.deepEqual(movement(f.actor),movement(f.motion.actor));
  assert.equal(f.playback.diagnostics.staleControlMotionPreserved,0);
});
test('newer motion remains authoritative after a late control was preserved',()=>{
  const f=fixture();for(let i=0;i<3;i++)f.step();f.control(15);
  const report=f.report(24);Object.assign(report.actor,{vx:90,vy:200,facing:1});
  f.playback.observeMotion(f.sim,'remote',encodeOwnedMotion(report,{held:['RIGHT']}),'local');
  f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(f.actor.vx,90);assert.equal(f.actor.vy,200);assert.equal(f.actor.facing,1);
});

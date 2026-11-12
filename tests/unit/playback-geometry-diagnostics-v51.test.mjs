import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import {encodeOwnedMotion} from '../../packages/online/owned-motion.mjs';

test('motion receipt, real application and correction diagnostics are distinct and reset by life',()=>{
  const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
  const map={sceneId:'diagnostic-line',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
  const sim=createSimulation({profile,map,networkOwnerId:'local',seed:2016,preset:{passives:[],guildPassives:[]},actors:[
    {id:'remote',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
    {id:'local',team:1,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','fixture');}
  let now=10;
  const playback=createRemoteCombatPlayback({clock:()=>now});playback.bind(sim,'local',()=>1);
  const motion=encodeOwnedMotion(encodeOwnedState(sim,'remote',{epoch:1,frameSeq:1}),{held:[]});
  motion.actor.x=100;
  assert.equal(playback.diagnostics.owners.remote.geometryTiming.receiveSilenceMs,null);
  assert.equal(playback.observeMotion(sim,'remote',motion,'local'),true);
  now=17;
  let row=playback.diagnostics.owners.remote.geometryTiming;
  assert.equal(sim.actor('remote').x,0,'receipt has not moved the actor');
  assert.equal(row.pendingAgeMs,7);assert.equal(row.appliedAgeMs,null);
  playback.beforeStep(sim,'local',()=>1);
  row=playback.diagnostics.owners.remote.geometryTiming;
  assert.equal(row.pendingAgeMs,null);assert.equal(row.maximumAdmissionToApplyMs,7);
  assert.equal(row.largestNetworkStep.distance,sim.actor('remote').x);
  assert.ok(row.largestNetworkStep.distance>0);assert.equal(sim.actor('local').x,2000);
  row.largestNetworkStep.delta[0]=9999;
  assert.notEqual(playback.diagnostics.owners.remote.geometryTiming.largestNetworkStep.delta[0],9999);
  now=510;
  assert.equal(playback.observeMotion(sim,'remote',{...motion,frameSeq:2},'local'),true);
  assert.equal(playback.diagnostics.owners.remote.geometryTiming.maximumReceiveGapMs,500);
  now=520;
  assert.equal(playback.observeMotion(sim,'remote',motion,'local'),false,'stale motion cannot refresh liveness');
  assert.equal(playback.diagnostics.owners.remote.geometryTiming.receiveSilenceMs,10);
  playback.reset('remote',2);
  row=playback.diagnostics.owners.remote.geometryTiming;
  assert.equal(row.receiveSilenceMs,null);assert.equal(row.maximumReceiveGapMs,0);assert.equal(row.largestNetworkStep,null);
});

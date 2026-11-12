import test from 'node:test';
import assert from 'node:assert/strict';
import {addFixture,tick} from '../helpers/add-fixture.mjs';

test('Phase Shift returns to its surviving source dummy and preserves first-cast cooldown and DP',()=>{
 const {sim,a}=addFixture('LP',{skillId:29216});a.sourceAdd.dp=4000;
 sim.step(1/60,{add:{pressed:['A']}});tick(sim,.8);
 assert.ok(a.sourceAddCombat.phase);const point=[...a.sourceAddCombat.phase.position];
 a.x+=180;const gate=sim.skillAvailability(a.id,0),dp=a.sourceAdd.dp,mp=a.mp,cd=a.cooldowns[29216];
 assert.equal(gate.available,true);assert.equal(gate.mode,'phase-return');assert.equal(gate.mpCost,5);assert.equal(gate.cooldownRemaining,0);
 sim.processInput(a,{pressed:new Set(['A']),held:new Set(),released:new Set(),ordered:[]});
 assert.ok(Math.abs(a.x-point[0])<1);assert.equal(a.sourceAddCombat.phase,null);
 assert.equal(a.mp,mp-5);assert.equal(a.sourceAdd.dp,dp);assert.ok(a.cooldowns[29216]>cd-.1);
 assert.equal(sim.skillAvailability(a.id,0).reason,'state-or-ground-condition');
});

test('Quicksilver back-flash accepts only the original open-left closed-right input window',()=>{
 for(const [time,expected]of [[.25,false],[.26,true],[.75,true],[.751,false]]){
  const {sim,a}=addFixture('LP',{skillId:29011});a.sourceAdd.dp=4000;
  sim.step(1/60,{add:{pressed:['A']}});a.animationTime=time;a.inputLock=0;a.worldStop=0;
  const gate=sim.skillAvailability(a.id,0);assert.equal(gate.available,expected,String(time));
  if(!expected)continue;
  const mp=a.mp,dp=a.sourceAdd.dp,cd=a.cooldowns[29011];
  // Execute the normal input consumer at the independently specified window.
  sim.processInput(a,{pressed:new Set(['A']),held:new Set(),released:new Set(),ordered:[]});
  assert.equal(a.state,'ANSI_SA_ALP_QUICKSILVER_ACCEL_BACK');assert.equal(a.mp,mp-10);
  assert.equal(a.sourceAdd.dp,dp);assert.equal(a.cooldowns[29011],cd);
 }
});

test('Stasis release preserves stored cost, cooldown and DP while executing the original release state',()=>{
 const {sim,a}=addFixture('LP',{skillId:29007});a.sourceAdd.dp=3000;
 sim.step(1/60,{add:{pressed:['A']}});tick(sim,3.5);
 assert.ok(a.sourceAddCombat.stasis?.remaining>0);
 const gate=sim.skillAvailability(a.id,0),mp=a.mp,dp=a.sourceAdd.dp,cd=a.cooldowns[29007];
 assert.equal(gate.available,true);assert.equal(gate.mode,'stasis-release');assert.equal(gate.mpCost,0);
 sim.processInput(a,{pressed:new Set(['A']),held:new Set(),released:new Set(),ordered:[]});
 assert.equal(a.state,'ANSI_SA_APT_STASIS_FIELD_ACTIVE');assert.equal(a.mp,mp);
 assert.equal(a.sourceAdd.dp,dp);assert.equal(a.cooldowns[29007],cd);
 assert.equal(a.sourceAddCombat.stasis.remaining,0,'original167 freezes M on enter and clears A/B only at the .3 factory event');
 tick(sim,.5);assert.equal(a.sourceAddCombat.stasis,null);
});

test('Apocalypse finish goes through the shared input gate without paying or restarting cooldown',()=>{
 const {sim,a}=addFixture('MM',{skillId:29604});
 a.sourceAddSummon={kind:'apocalypse',serial:9,state:'APOCALYPSE_WAIT',stateSerial:1,position:[a.x,a.y,a.z],remaining:40,hp:100,hpMax:100,skillId:29604};
 a.cooldowns[29604]=170;a.mp=0;a.sourceAdd.dp=0;a.sourceAdd.mutation=0;
 const key={pressed:new Set(['A']),held:new Set(),released:new Set(),ordered:[]};
 a.worldStop=.2;assert.equal(sim.skillAvailability(a.id,0).available,false);
 a.worldStop=0;const gate=sim.skillAvailability(a.id,0);
 assert.equal(gate.available,true);assert.equal(gate.mode,'apocalypse-finish');assert.equal(gate.cooldownRemaining,0);
 sim.processInput(a,key);assert.equal(a.sourceAddSummon.state,'APOCALYPSE_FINISH_ATTACK');
 assert.equal(a.cooldowns[29604],170);assert.equal(a.mp,0);assert.equal(a.sourceAdd.dp,0);
 assert.equal(sim.skillAvailability(a.id,0).available,false);
});

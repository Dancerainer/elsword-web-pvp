/** Authored Garpai tier fixtures. Entry starts from a legal captured target;
 * it tests pursuit/support, not a claim that a fabricated hit was original. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
for(const [facing,x,line]of [[1,1300,5],[-1,-1300,3]])for(const vy of [0,-5200])
 test(`LP NA pursuit stays on captured target tier ${line}, incoming vertical speed ${vy}`,()=>{
  const {sim,a,b}=originalAddFixture('LP');a.sourceAdd.formation=true;
  Object.assign(a,{x:0,y:3080,z:0,grounded:false,lineId:null,lastTouchLineId:2,landPosition:[0,3080,0],vx:750*facing,vy,facing});
  Object.assign(b,{x,y:3320,z:0,grounded:true,lineId:line,lastTouchLineId:line,landPosition:[x,3320,0],vx:0,vy:0});
  a.sourceAddCombat={pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1,nasodTargetId:b.id};
  sim.enter(a,'ANSI_COMBO_NASOD_ARMOR_ATTACK','captured-platform-target');
  const attempt=sim.state.events.find(e=>e.type==='addNasodPursuitAttempt');assert.equal(attempt?.targetId,b.id);
  assert.equal(attempt.position[1],3320,'pursuit must use target height, independent of the caster old floor');
  for(let i=0;i<12;i++)sim.step(1/60,{}, {snapshot:false});
  assert.equal(a.lastTouchLineId,line);assert.equal(a.y,3320);assert.equal(a.grounded,true);
 });
test('LP pursuit to an airborne target preserves falling speed instead of manufacturing a grounded support',()=>{
 const {sim,a,b}=originalAddFixture('LP');a.sourceAdd.formation=true;
 Object.assign(a,{x:0,y:3080,z:0,grounded:false,lineId:null,lastTouchLineId:2,landPosition:[0,3080,0],vx:0,vy:-5200});
 Object.assign(b,{x:1300,y:3420,z:0,grounded:false,lineId:null,lastTouchLineId:5,landPosition:[1300,3320,0],vx:0,vy:0});
 a.sourceAddCombat={pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1,nasodTargetId:b.id};
 sim.enter(a,'ANSI_COMBO_NASOD_ARMOR_ATTACK','captured-airborne-target');
 assert.equal(a.y,3420);assert.equal(a.vy,-5200);assert.equal(a.grounded,false);assert.deepEqual(a.landPosition,[0,3080,0]);
});
test('LP grounded-target support rebase survives an ordinary snapshot and continues identically',()=>{
 const {sim,a,b}=originalAddFixture('LP');a.sourceAdd.formation=true;
 Object.assign(a,{x:0,y:3080,z:0,grounded:false,lineId:null,lastTouchLineId:2,landPosition:[0,3080,0],vx:750,vy:-5200});
 Object.assign(b,{x:1300,y:3320,z:0,grounded:true,lineId:5,lastTouchLineId:5,landPosition:[1300,3320,0],vx:0,vy:0});
 a.sourceAddCombat={pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1,nasodTargetId:b.id};
 sim.enter(a,'ANSI_COMBO_NASOD_ARMOR_ATTACK','captured-platform-roundtrip');
 const second=originalAddFixture('LP');second.sim.restore(JSON.parse(JSON.stringify(sim.snapshot())));
 for(let i=0;i<12;i++){sim.step(1/60,{}, {snapshot:false});second.sim.step(1/60,{}, {snapshot:false});}
 assert.deepEqual(second.sim.snapshot(),sim.snapshot());assert.equal(a.y,3320);assert.equal(a.lastTouchLineId,5);
});

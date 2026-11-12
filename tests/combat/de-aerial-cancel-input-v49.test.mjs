/**60Hz physical sampled input; original map, poses and native geometry.
 * Expected cancellation fields are freshly decoded independently of core. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import source from '../../contracts/de-aerial-cancel-v49.json' with {type:'json'};
import {addCommands} from '../../packages/combat-core/add-commands.mjs';
import {replayDeAerialCancels} from '../helpers/de-aerial-input-v49.mjs';
for(const facing of [1,-1])for(const extraX of [false,true])test(`DE physical66/8/Z/${extraX?'XX':'X'} can repeat after first grounded walk-cancel facing=${facing}`,()=>{
 const posts=new Map(),commands={...addCommands,runEvent(a,keys,p,...args){
  const result=addCommands.runEvent(a,keys,p,...args);
  if(a.state===source.state.name){const rows=posts.get(a.stateSerial)??[];rows.push({time:a.animationTime,grounded:a.grounded,direction:keys.held.has('LEFT')||keys.held.has('RIGHT'),request:result.state});posts.set(a.stateSerial,rows);}
  return result;
 }};
 const r=replayDeAerialCancels({facing,extraX,commands});assert.equal(r.rounds.length,2);assert.equal(r.attacks.length,2);assert.equal(posts.size,2);
 assert.deepEqual(r.profile.states[source.state.name].raw,source.state.raw,'production retains fresh original declarations');
 assert.ok(r.packets.filter(p=>p.pureDouble.includes(facing===1?'RIGHT':'LEFT')).length>=2,'both commands use physical double-direction samples');
 for(const [index,round]of r.rounds.entries()){
  assert.ok(round.entered);assert.ok(round.landing);assert.ok(round.exit);
  // Original242 entry now performs the real eight-step landing prediction.
  // Early ground contact does not override the independent strict walk gate.
  assert.ok(round.landing.frame<=round.exit.frame);assert.equal(round.exit.state,'RSI_WAIT');
  const samples=[...posts.values()][index],gate=Math.fround(source.state.raw.WALK_CANCEL_AFTER);
  const first=samples.find(row=>row.grounded&&row.direction&&Math.fround(row.time)>gate);assert.ok(first);
  for(const row of samples.slice(0,samples.indexOf(first)))if(row.grounded&&row.direction&&Math.fround(row.time)<=gate)assert.equal(row.request,null,'ground contact before the original strict gate must retain242');
  assert.equal(first.request,'RSI_WAIT','the first eligible real post requests original WAIT13');assert.equal(samples.at(-1),first,'no later post is needed after that request');
  // trace.before is the preceding animation clock. The real post samples its
  // advanced clock; pending application must not add another242 animation step.
  assert.ok(Math.fround(round.exit.before.time)<=Math.fround(first.time));
  const duration=r.profile.states[source.state.name].clip.durationSeconds,end=duration-Math.max(duration/10,.03);
  assert.ok(first.time<end);assert.ok(round.exit.before.time<end,'the real input chain cancels before source animation end');
 }
});
test('source grounded DASH/WALK thresholds are strict and an airborne DE ZX cannot bypass the original grounded gate',()=>{
 const p=originalAddFixture('DE').sim.profileFor({professionId:'DE'}),n=source.state.name;
 const a={professionId:'DE',state:n,grounded:true,animationTime:source.state.raw.DASH_CANCEL_AFTER,passiveSpeed:{},vx:0,vy:0,y:0};
 const keys={held:new Set(['RIGHT']),pressed:new Set(),pureDoubleRight:true,pureDoubleLeft:false};
 assert.equal(addCommands.runEvent(a,keys,p).state,null);a.animationTime=.251;assert.equal(addCommands.runEvent(a,keys,p).state,'DASH_REQUEST');
 a.animationTime=source.state.raw.WALK_CANCEL_AFTER;keys.pureDoubleRight=false;assert.equal(addCommands.runEvent(a,keys,p).state,null);
 a.animationTime=.301;assert.equal(addCommands.runEvent(a,keys,p).state,'RSI_WAIT');a.grounded=false;assert.equal(addCommands.runEvent(a,keys,p).state,null);
});

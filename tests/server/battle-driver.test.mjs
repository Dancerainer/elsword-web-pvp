/** Driver/network contract tests. Small lifecycle substitutes intentionally
 * isolate scheduling from native combat; no original-client trajectory claim.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerifiedBattleDriver} from '../../apps/server/battle-driver.mjs';
const ids=['r0','r1','b0','b1'];
const frame=(frameSeq,held=[],extras={})=>({frameSeq,held,...extras});
function fixture(t,{serviceHandlesTimeout=false,resultOnAdvance=null}={}){
  const emitted=[],finished=[],steps=[],starts=[],disconnects=[],hits=[];
  const sim={state:{actors:ids.map(id=>({id,hp:100,hidden:false,pvpDisconnected:false,deathComplete:false,core:{phase:'absent'}})),effects:ids.map(id=>({ownerId:id})),events:[]},
    snapshot(){return structuredClone(this.state);},
    step(dt,inputs){steps.push({dt,inputs:structuredClone(inputs)});},
    drainEvents(){return this.state.events.splice(0);}};
  const state={phase:'created',score:[0,0],result:null},pvpEvents=[];
  let advances=0,driver;
  const pvp={get timeScale(){return state.phase==='fight'?1:state.phase==='slow'?.2:0;},snapshot:()=>structuredClone(state),
    start(simulation){assert.equal(simulation,sim);starts.push(true);state.phase='fight';},
    advance(dt,simulation){assert.equal(simulation,sim);advances++;
      if(advances===resultOnAdvance){state.phase='result';state.result={winnerTeam:0,score:[4,1],players:ids.map(id=>({id}))};pvpEvents.push({type:'result'});}},
    recordHit(value){hits.push(value);},
    drainEvents(){return pvpEvents.splice(0);},
    disconnect(id,simulation){disconnects.push(id);const actor=simulation.state.actors.find(a=>a.id===id);
      actor.pvpDisconnected=true;actor.hidden=true;actor.hp=0;actor.deathComplete=true;pvpEvents.push({type:'disconnect',playerId:id});}};
  driver=createVerifiedBattleDriver({match:{id:'contract-match',players:ids.map((id,i)=>({id,team:i<2?0:1}))},simulation:sim,pvp,
    manual:true,clock:()=>1000,
    emit(type,value){emitted.push({type,value:structuredClone(value)});
      // Production service releases the session and re-enters the driver's
      // disconnect synchronously. Fallback must notice the removed actor.
      if(type==='player-timeout'&&serviceHandlesTimeout)driver.disconnect(value.playerId);},
    finish(value){finished.push(structuredClone(value));}});
  t.after(()=>driver.stop());
  return {driver,sim,pvp,state,emitted,finished,steps,starts,disconnects,hits,
    readyAll(){for(const id of ids)driver.ready(id);},
    ticks(count){for(let i=0;i<count;i++)driver.tick();}};
}

test('all four ready messages are required; duplicate ready never starts or advances twice',t=>{
  const f=fixture(t);
  for(const id of ids.slice(0,3))f.driver.ready(id);
  f.driver.ready('r0');f.ticks(60);
  assert.equal(f.starts.length,0);assert.equal(f.steps.length,0);assert.equal(f.state.phase,'created');
  f.driver.ready('b1');assert.equal(f.starts.length,1);assert.equal(f.state.phase,'fight');
  f.driver.ready('b1');f.driver.ready('r1');assert.equal(f.starts.length,1);
  f.driver.tick();assert.equal(f.steps.length,1);assert.equal(f.steps[0].dt,1/60);
  assert.throws(()=>f.driver.ready('outsider'),/player-not-in-match/);
});

test('server reconstructs edges and double taps from held levels, ignoring forged client action flags',t=>{
  const f=fixture(t);f.readyAll();
  const fake={pressed:['Z'],released:['X'],pureDouble:['RIGHT'],oneDouble:['RIGHT'],sampledDevice:false};
  f.driver.submitInput('r0',{frames:[frame(1,[],fake),frame(2,['RIGHT'],fake),frame(3,['RIGHT'],fake),frame(4,[],fake),frame(5,['RIGHT'],{pressed:[],pureDouble:[]})]});
  f.ticks(5);const inputs=f.steps.map(step=>step.inputs.r0);
  assert.deepEqual(inputs[0].held,[]);assert.deepEqual(inputs[0].pressed,[]);assert.deepEqual(inputs[0].pureDouble,[]);
  assert.deepEqual(inputs[1].pressed,['RIGHT']);assert.deepEqual(inputs[1].pureDouble,[]);
  assert.deepEqual(inputs[2].pressed,[]);assert.deepEqual(inputs[2].pureDouble,[]);
  assert.deepEqual(inputs[3].released,['RIGHT']);assert.deepEqual(inputs[3].pureDouble,[]);
  assert.deepEqual(inputs[4].pressed,['RIGHT']);assert.deepEqual(inputs[4].pureDouble,['RIGHT']);assert.deepEqual(inputs[4].oneDouble,['RIGHT']);
  assert.ok(inputs.every(input=>input.sampledDevice===true));assert.ok(inputs.every(input=>!input.pressed.includes('Z')));
  f.driver.tick();assert.deepEqual(f.steps.at(-1).inputs.r0.pureDouble,['RIGHT'],'server sampled double remains a held level');
});

test('exactly32 queued frames are allowed; overflow is rejected without consuming or extending the queue',t=>{
  const f=fixture(t);f.readyAll();
  assert.deepEqual(f.driver.submitInput('r0',{frames:Array.from({length:32},(_,i)=>frame(i+1,['LEFT']))}),{accepted:true});
  assert.throws(()=>f.driver.submitInput('r0',{frames:[frame(33,['RIGHT'])]}),/input-queue-overflow/);
  f.driver.tick();assert.deepEqual(f.steps[0].inputs.r0.held,['LEFT']);
  assert.deepEqual(f.driver.submitInput('r0',{frames:[frame(33,['RIGHT'])]}),{accepted:true});
  assert.throws(()=>f.driver.submitInput('r0',{frames:[frame(34)]}),/input-queue-overflow/);
  f.ticks(31);assert.deepEqual(f.steps.at(-1).inputs.r0.held,['LEFT']);
  f.driver.tick();assert.deepEqual(f.steps.at(-1).inputs.r0.held,['RIGHT']);
  assert.throws(()=>f.driver.submitInput('outsider',{frames:[]}),/player-not-in-match/);
});

test('10Hz state broadcasts acknowledge each player consumed frameSeq, never merely the queued tail',t=>{
  const f=fixture(t);f.readyAll();f.emitted.length=0;
  f.driver.submitInput('r0',{frames:Array.from({length:8},(_,i)=>frame(101+i,['RIGHT']))});
  f.driver.submitInput('r1',{frames:[frame(201,['Z']),frame(202,[])]});
  f.driver.submitInput('b0',{frames:[frame(301,['LEFT'])]});
  f.ticks(5);assert.equal(f.emitted.filter(e=>e.type==='state').length,0);
  f.driver.tick();const first=f.emitted.filter(e=>e.type==='state');assert.equal(first.length,1);
  assert.deepEqual(Object.fromEntries(ids.map(id=>[id,first[0].value.inputs[id].frameSeq])),{r0:106,r1:202,b0:301,b1:0});
  assert.deepEqual(first[0].value.inputs.r0.held,['RIGHT']);assert.equal(first[0].value.matchId,'contract-match');
  f.ticks(6);const broadcasts=f.emitted.filter(e=>e.type==='state');assert.equal(broadcasts.length,2);
  assert.equal(broadcasts[1].value.inputs.r0.frameSeq,108);assert.ok(broadcasts[1].value.sequence>broadcasts[0].value.sequence);
  assert.equal(f.steps.length,12);assert.equal(f.driver.snapshot().stats.broadcasts,3); // ready + two periodic states.
});

test('loading timeout at30 seconds emits once and synchronous service disconnect cannot remove twice',t=>{
  for(const serviceHandlesTimeout of [true,false]){
    const f=fixture(t,{serviceHandlesTimeout});for(const id of ids.slice(0,3))f.driver.ready(id);
    f.driver.submitInput('b1',{frames:[frame(1,['RIGHT'])]});
    f.driver.tick(29);assert.equal(f.emitted.filter(e=>e.type==='player-timeout').length,0);assert.equal(f.starts.length,0);
    f.driver.tick(1);
    assert.deepEqual(f.emitted.filter(e=>e.type==='player-timeout').map(e=>e.value),[{playerId:'b1',reason:'loading-timeout'}]);
    assert.deepEqual(f.disconnects,['b1']);assert.equal(f.starts.length,1);
    const actor=f.sim.state.actors.find(a=>a.id==='b1');assert.equal(actor.hidden,true);assert.equal(actor.hp,0);assert.equal(actor.deathComplete,true);
    assert.equal(f.sim.state.effects.some(e=>e.ownerId==='b1'),false);
    f.ticks(12);assert.equal(f.emitted.filter(e=>e.type==='player-timeout').length,1);assert.deepEqual(f.disconnects,['b1']);
    assert.deepEqual(f.steps[0].inputs.b1.held,[],'timed-out queued action must be cleared');
  }
});

test('result calls finish exactly once, sends final state and stops stepping/input admission',t=>{
  const f=fixture(t,{resultOnAdvance:2});f.readyAll();f.emitted.length=0;
  f.driver.tick();assert.equal(f.finished.length,0);f.driver.tick();
  assert.equal(f.finished.length,1);assert.deepEqual(f.finished[0],{winnerTeam:0,score:[4,1],players:ids.map(id=>({id}))});
  const states=f.emitted.filter(e=>e.type==='state');assert.equal(states.length,1);assert.equal(states[0].value.pvp.phase,'result');
  assert.ok(states[0].value.events.some(e=>e.type==='result'));
  f.ticks(60);f.driver.ready('r0');assert.equal(f.steps.length,2);assert.equal(f.finished.length,1);
  assert.equal(f.emitted.filter(e=>e.type==='state').length,1);
  assert.deepEqual(f.driver.submitInput('r0',{frames:[frame(9,['Z'])]}),{accepted:false});
  f.driver.stop();f.driver.stop();assert.equal(f.finished.length,1);
});

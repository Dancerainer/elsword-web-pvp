import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';

function fixture({budget=2}={}){
  let now=0;const ids=['first','second','third'],epochs=Object.fromEntries(ids.map(id=>[id,1]));
  const actors=[...ids,'local'].map(id=>({id,state:'WAIT',stateSerial:0,animationName:'WAIT',stateTime:0,animationTime:0,
    hp:100,mp:100,x:0,y:0,z:0,facing:1})),enters=[];
  const sim={state:{actors,effects:[]},profile:{states:{WAIT:{},MOVE:{}}},
    enter(actor,state){enters.push({id:actor.id,state});Object.assign(actor,{state,stateSerial:actor.stateSerial+1,stateTime:0,animationTime:0,animationName:state});}};
  // This fixture isolates round-robin fairness across an intentionally old
  // backlog; production's independent250ms expiry is covered separately.
  const playback=createRemoteCombatPlayback({clock:()=>now,maxEventsPerStep:budget,maxSourceLagFrames:1000,maxAdditionalAgeMs:1000});
  const life=id=>epochs[id]??1;playback.bind(sim,'local',life);
  const send=(id,actions,frame=Math.max(...actions.map(action=>action.frameSeq)))=>playback.receiveActions(id,actions,life(id),frame);
  const action=(id,{start=false,state='WAIT',serial=0,stop=0,terminal=false}={})=>({id,frameSeq:id,
    actor:{state,stateSerial:serial,animationName:state,facing:id%2?1:-1,hitStop:stop},
    effects:terminal?[{id:1000+id,dead:true,endEmitted:true}]:[],playback:{version:1,start,held:id%2?['RIGHT']:[]}});
  const step=()=>{now+=1000/60;return playback.beforeStep(sim,'local',life);};
  // Establish each owner's clock, then receive an overdue transport burst.
  // The burst uses one distinct action per source frame, as production does.
  for(const id of ids)send(id,[action(0)]);for(let i=0;i<24;i++)step();
  return {sim,playback,ids,epochs,enters,send,action,step};
}

test('three owners with continuous control, STOP and terminal traffic each receive a bounded turn',()=>{
  const f=fixture();
  for(const id of f.ids)f.send(id,Array.from({length:12},(_,i)=>f.action(i+1,{stop:i%2?.2:0,terminal:i===1})));
  for(let round=0;round<6;round++){
    for(let tick=0;tick<3;tick++)assert.equal(f.step(),2,'global event budget never increases');
    for(const id of f.ids){const row=f.playback.diagnostics.owners[id];assert.equal(row.queued,12-(round+1)*2,'no fixed Map owner can monopolize the budget');
      assert.equal(f.sim.state.actors.find(actor=>actor.id===id).facing,-1,'each owner keeps ascending source frame order');}
  }
  for(const id of f.ids){assert.equal(f.playback.diagnostics.owners[id].tombstones,1);assert.equal(f.sim.state.actors.find(actor=>actor.id===id).hitStop,.2);}
  assert.equal(f.playback.diagnostics.pending,0);assert.equal(f.playback.diagnostics.played,39);
});

test('a later owner start is not starved by a first-owner backlog and same-owner starts still receive separate steps',()=>{
  const f=fixture();f.send('first',Array.from({length:16},(_,i)=>f.action(i+1)));
  f.send('second',[f.action(1,{start:true,state:'MOVE',serial:1}),f.action(2,{start:true,state:'WAIT',serial:2})]);
  f.send('third',[f.action(1,{start:true,state:'MOVE',serial:1})]);
  f.step();assert.equal(f.enters.length,0);
  f.step();assert.deepEqual(f.enters.map(entry=>entry.id),['second','third']);assert.equal(f.playback.diagnostics.owners.second.queued,1);
  f.step();f.step();assert.equal(f.enters.filter(entry=>entry.id==='second').length,2);
  assert.deepEqual(f.enters.filter(entry=>entry.id==='second').map(entry=>entry.state),['MOVE','WAIT']);
});

test('rotation safely skips a retired owner and reset/clear cannot consume its old life',()=>{
  const f=fixture();for(const id of f.ids)f.send(id,Array.from({length:4},(_,i)=>f.action(i+1)));
  f.step();f.epochs.second=2;f.playback.reset('second',2);
  assert.equal(f.playback.receiveActions('second',[f.action(1,{start:true,state:'MOVE',serial:1})],1,1),true);
  f.step();assert.equal(f.playback.diagnostics.owners.second.epoch,2);assert.equal(f.playback.diagnostics.owners.second.queued,0);
  assert.equal(f.playback.diagnostics.owners.third.queued,2);assert.equal(f.enters.length,0);
  f.playback.clear();assert.equal(f.playback.diagnostics.budgetRotations,0);assert.equal(f.playback.diagnostics.pending,0);
  f.send('first',[f.action(1)]);assert.equal(f.step(),1);
});

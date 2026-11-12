import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedPresentation} from '../../apps/web/owned-presentation.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {advanceActorStops} from '../../packages/combat-core/source-stop-queues-v53.mjs';

test('mixed remote live and delayed action sounds resolve the frozen actor profession',()=>{
  const sounds=[],presentation=createOwnedPresentation();
  const local={id:'local',professionId:'RF',x:0,y:0,z:0,worldStop:0};
  const remote={id:'remote',professionId:'LK',state:'attack',stateSerial:1,animationTime:.15,animationPlaybackSpeed:1,fired:[],x:10,y:0,z:0,hits:{},hitGaps:{},buffs:[],core:{}};
  const profiles={RF:{states:{attack:{raw:{SOUND_PLAY1:['Raven.ogg']}}}},LK:{states:{attack:{raw:{SOUND_PLAY1:['Elsword.ogg']}},WAIT:{raw:{}}}}};
  const sim={state:{actors:[local,remote],effects:[]},profile:profiles.RF,profileFor:actor=>profiles[actor.professionId],
    soundEvent:(actor,field,value)=>sounds.push({actor:actor.id,field,value}),emit(){},checkCharacterAttack(){},tickEffects(){},tickCore(){}};
  const before=presentation.capture(sim,'local');remote.fired=['SOUND_PLAY1'];presentation.consume(sim,before,'local',()=>1);
  assert.deepEqual(sounds.map(row=>row.value),[['Elsword.ogg']]);
  const action={id:1,frameSeq:5,actor:{...structuredClone(remote),stateSerial:2},effects:[]};delete action.actor.id;delete action.actor.professionId;
  remote.state='WAIT';remote.stateSerial=3;remote.fired=[];
  const consumer=createRemoteActionConsumer({presentation,clock:()=>0});consumer.receive('remote',[action],1,8);
  assert.equal(consumer.consume(sim,'local',()=>1),1);assert.deepEqual(sounds.map(row=>row.value),[['Elsword.ogg'],['Elsword.ogg']]);
  assert.equal(remote.professionId,'LK');assert.equal(remote.state,'WAIT');
});

test('live state and delayed history share canonical sound/stop receipts across remote return to WAIT',()=>{
  const events=[],sounds=[],presentation=createOwnedPresentation(),consumer=createRemoteActionConsumer({presentation,clock:()=>0});
  const remote={id:'remote',state:'attack',stateSerial:1,animationTime:.15,animationPlaybackSpeed:1,fired:[],x:10,y:0,z:0,hits:{},hitGaps:{},buffs:[],core:{}};
  const local={id:'local',x:0,y:0,z:0,worldStop:0};
  const sim={state:{actors:[local,remote],effects:[]},profile:{states:{attack:{raw:{SOUND_PLAY1:{canonical:'sound'},STOP_OTHER_UNIT1:{'1':.1,'2':.4}}},WAIT:{raw:{}}}},
    soundEvent:(actor,field,value)=>sounds.push({actor:actor.id,field,value}),emit:(type,id,data)=>events.push({type,id,data}),
    checkCharacterAttack(){},tickEffects(){},tickCore(){}};
  const before=presentation.capture(sim,'local');remote.fired=['SOUND_PLAY1','STOP_OTHER_UNIT1'];
  presentation.consume(sim,before,'local',()=>1);advanceActorStops(local,0);assert.equal(sounds.length,1);assert.ok(Math.abs(local.worldStop-.35)<1e-6);
  const action={id:1,frameSeq:5,actor:structuredClone(remote),effects:[]};delete action.actor.id;
  remote.state='WAIT';remote.stateSerial=2;remote.fired=[];local.worldStop=0;
  consumer.receive('remote',[action],1,8);assert.equal(consumer.consume(sim,'local',()=>1),1);
  assert.equal(sounds.length,1,'historical serial remains seen after live remote changed state');assert.equal(local.worldStop,0);
  assert.equal(events.filter(event=>event.type==='worldStop').length,1);assert.equal(remote.state,'WAIT');
  consumer.receive('remote',[{...action,id:2}],2,8);consumer.consume(sim,'local',()=>2);
  assert.equal(sounds.length,2,'a server-issued new life has its own canonical receipt');
});

test('historical collision does not rewind the newest remote live effect object or clock',()=>{
  const remote={id:'remote',state:'WAIT',stateSerial:2,animationTime:1,x:10,y:0,z:0,hits:{},hitGaps:{},buffs:[],core:{}},local={id:'local',x:0,y:0,z:0};
  const live={id:100,networkId:1,networkEpoch:1,ownerId:'remote',name:'mesh',setName:null,ownerStateSerial:1,active:true,stage:0,elapsed:1,animationTime:1,x:100,hits:{},hitGaps:{}};
  const sim={state:{actors:[local,remote],effects:[live]},profile:{states:{attack:{raw:{}},WAIT:{raw:{}}},damageEffects:{mesh:{raw:{}}}},
    emit(){},checkCharacterAttack(){},tickEffects(){},tickCore(){}};
  const action={id:1,frameSeq:5,actor:{...remote,state:'attack',stateSerial:1},effects:[{id:1,name:'mesh',setName:null,ownerStateSerial:1,active:true,stage:0,elapsed:.1,animationTime:.1,x:5}]};delete action.actor.id;
  const consumer=createRemoteActionConsumer({clock:()=>0});consumer.receive('remote',[action],1,8);consumer.consume(sim,'local',()=>1);
  assert.equal(sim.state.effects[0],live);assert.equal(live.elapsed,1);assert.equal(live.animationTime,1);assert.equal(live.x,100);
  assert.equal(sim.state.actors[1],remote);assert.equal(remote.state,'WAIT');
});

/** Current Web adapter regressions. Expectations name independent inputs and
 * arrival orders; no result here is an original-client behavioral golden. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {createOwnedPresentation} from '../../apps/web/owned-presentation.mjs';
import {ownedContactGeometry} from '../../packages/combat-core/contact-observation.mjs';
import {advanceActorStops} from '../../packages/combat-core/source-stop-queues-v53.mjs';
// Original User setters append a float32 request without updating the scalar
// cache. The next ordinary outer callback ages the queue before its gate.
const requestedStop=actor=>actor.sourceStopQueues?.world.at(-1)?.remaining;
function fixture(options={}){
  let now=0;
  const local={id:'local',team:0,state:'WAIT',stateSerial:40,stateTime:1,animationTime:1,animationName:'Wait',
    x:0,y:0,z:0,vx:0,vy:0,hp:100,mp:20,invincible:false,forceInvincible:0,buffs:[],cooldowns:{A:2},fired:[]};
  const remote={id:'remote',team:1,state:'WAIT',stateSerial:9,stateTime:0,animationTime:0,
    x:10,y:0,z:0,facing:-1,hp:100,mp:20,hits:{},hitGaps:{},fired:[],buffs:[],core:{}};
  const profile={states:{WAIT:{raw:{}},attack:{raw:{}},cast:{raw:{STOP_OTHER_UNIT1:{'1':.1,'2':.4}}}},damageEffects:{}};
  const calls=[],sim={state:{actors:[local,remote],effects:[],events:[]},profile,networkOwnerId:'local',
    contactGeometry(actor,attacker){return ownedContactGeometry(actor,sim.receiverContactGeometry,attacker.id,sim.networkOwnerId);},
    emit:(type,id,data)=>sim.state.events.push({type,actorId:id,...data}),soundEvent(){},tickEffects(){},tickCore(){},
    checkCharacterAttack(a){calls.push(a.stateSerial);const b=sim.state.actors.find(row=>row.id==='local');
      const posed=sim.contactGeometry(b,a);
      if(a.state==='attack'&&!a.hits.local&&!b.invincible&&!b.forceInvincible&&Math.abs(a.x-posed.x)<=30){
        a.hits.local=1;b.hp-=10;b.mp+=2;b.state='damage';b.stateSerial++;b.animationTime=0;b.animationName='Damage';
        b.cooldowns.A=1;sim.emit('hit',a.id,{targetId:b.id,amount:10});}
    }};
  const presentation=createOwnedPresentation({clock:()=>now}),consumer=createRemoteActionConsumer({clock:()=>now,presentation,...options});
  const action=(id,frameSeq,state='attack')=>({id,frameSeq,actor:{...structuredClone(remote),state,stateSerial:id,animationTime:.15,fired:state==='cast'?['STOP_OTHER_UNIT1']:[]},effects:[]});
  return {sim,local,remote,calls,presentation,consumer,action,setNow:value=>{now=value;}};
}
test('source frame order survives reversed reliable and relay arrival without rewinding the newest remote body',()=>{
  const f=fixture();f.consumer.receive('remote',[f.action(2,10)],1,10);f.consumer.receive('remote',[f.action(1,5)],1,10);
  f.consumer.consume(f.sim,'local',()=>1);assert.deepEqual(f.calls,[1,2]);assert.equal(f.remote.state,'WAIT');assert.equal(f.remote.stateSerial,9);
});
test('a pose admitted after a reliable control cannot spend the pending stop receipt before the source sample executes',()=>{
  const f=fixture(),action=f.action(1,5,'cast');assert.equal(f.consumer.receive('remote',[action],1,5),true);
  Object.assign(f.remote,structuredClone(action.actor),{animationTime:.45});
  f.presentation.consume(f.sim,new Map(),'local',()=>1);assert.equal(f.local.worldStop,undefined);
  f.consumer.consume(f.sim,'local',()=>1);assert.equal(requestedStop(f.local),Math.fround(.35));
  assert.equal(f.local.worldStop,undefined,'admission cannot write the original scalar cache early');
  assert.equal(f.sim.state.events.filter(event=>event.type==='worldStop').length,1);
  assert.equal(advanceActorStops(f.local,.05),0,'the next ordinary actor callback consumes the request and freezes');
  assert.equal(f.local.worldStop,Math.fround(Math.fround(.35)-Math.fround(.05)));
  const requests=f.local.sourceStopQueues.world.length;
  f.local.worldStop=0;f.consumer.receive('remote',[action],1,5);f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(f.local.worldStop,0,'duplicate admission cannot rewrite a reset scalar cache');
  assert.equal(f.local.sourceStopQueues.world.length,requests,'the duplicate cannot append a second request');
});
test('newest observed source frame ages delayed stops and an expired trigger never restarts at full duration',()=>{
  const f=fixture(),action=f.action(1,5,'cast');f.consumer.receive('remote',[action],1,5);f.consumer.observeSource('remote',1,35);
  f.consumer.consume(f.sim,'local',()=>1);assert.equal(f.local.worldStop,undefined);
  f.consumer.receive('remote',[action],1,5);f.consumer.consume(f.sim,'local',()=>1);assert.equal(f.local.worldStop,undefined);
});
test('source frontier progress and admission wait age a stop once rather than twice',()=>{
  const f=fixture(),action=f.action(1,50,'cast');f.consumer.receive('remote',[action],1,50);
  f.setNow(100);f.consumer.observeSource('remote',1,56);
  f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(requestedStop(f.local),Math.fround(.25),'authored .4s minus .05s captured animation and .1s elapsed = .25s');
  assert.equal(f.sim.state.events.filter(event=>event.type==='worldStop').length,1);
});
test('frontier projection includes only the time since that frontier and ignores duplicate arrival refreshes',()=>{
  const f=fixture(),action=f.action(1,50,'cast');f.consumer.receive('remote',[action],1,50);
  f.setNow(100);f.consumer.observeSource('remote',1,62);
  f.setNow(150);f.consumer.observeSource('remote',1,62);
  f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(requestedStop(f.local),Math.fround(.10),'latest source age .2s plus .05s since frontier, not .15s since action');
});
test('an advancing frontier no longer makes a still-active stop disappear behind its own queue wait',()=>{
  const f=fixture(),action=f.action(1,50,'cast');f.consumer.receive('remote',[action],1,50);
  f.setNow(200);f.consumer.observeSource('remote',1,62);
  f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(requestedStop(f.local),Math.fround(.15),'the .35s remaining stop still has .15s after a .2s admission stall');
});
test('real elapsed queue time still expires a stop when source poses stop arriving',()=>{
  const f=fixture(),action=f.action(1,50,'cast');f.consumer.receive('remote',[action],1,50);
  f.setNow(400);f.consumer.consume(f.sim,'local',()=>1);assert.equal(f.local.worldStop,undefined);
  assert.equal(f.sim.state.events.filter(event=>event.type==='worldStop').length,0);
});
test('an expired replaceable pose cannot swallow a reliable earlier STOP sample with remaining time',()=>{
  const f=fixture(),action=f.action(1,5,'cast');action.actor.animationTime=.12;
  Object.assign(f.remote,structuredClone(action.actor),{animationTime:.6});
  const before=f.presentation.capture(f.sim,'local');
  f.presentation.consume(f.sim,before,'local',()=>1);assert.equal(f.local.worldStop,undefined);
  f.consumer.receive('remote',[action],1,5);f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(requestedStop(f.local),Math.fround(.38));
  assert.equal(f.sim.state.events.filter(e=>e.type==='worldStop').length,1);
});
test('a better source sample only supplements its original STOP deadline and duplicate delivery cannot refresh it',()=>{
  const f=fixture(),action=f.action(1,5,'cast');action.actor.animationTime=.12;
  Object.assign(f.remote,structuredClone(action.actor),{animationTime:.3});
  f.presentation.consume(f.sim,new Map(),'local',()=>1);assert.equal(requestedStop(f.local),Math.fround(.2));
  f.setNow(100);f.local.worldStop=.1;
  f.consumer.receive('remote',[action],1,5);f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(requestedStop(f.local),Math.fround(.3),'same stop cannot last past first applied clock plus authored .4s');
  const requests=f.local.sourceStopQueues.world.length;
  f.setNow(200);f.local.worldStop=0;
  Object.assign(f.remote,structuredClone(action.actor));f.presentation.consume(f.sim,new Map(),'local',()=>1);
  assert.equal(f.local.worldStop,0,'equal elapsed pose never refreshes the already applied reliable event');
  assert.equal(f.local.sourceStopQueues.world.length,requests,'equal elapsed pose cannot append another request');
  assert.equal(f.sim.state.events.filter(e=>e.type==='worldStop').length,2);
});
test('an expired reliable sample cannot supplement an earlier applied STOP deadline',()=>{
  const f=fixture(),action=f.action(1,5,'cast');action.actor.animationTime=.12;
  Object.assign(f.remote,structuredClone(action.actor),{animationTime:.3});f.presentation.consume(f.sim,new Map(),'local',()=>1);
  f.local.worldStop=0;f.consumer.receive('remote',[action],1,5);f.consumer.observeSource('remote',1,35);
  f.consumer.consume(f.sim,'local',()=>1);assert.equal(f.local.worldStop,0);
  assert.equal(f.sim.state.events.filter(e=>e.type==='worldStop').length,1);
});
test('bounded admission keeps accepted events, reserves controls, and a rejected sample can be retried after consumption',()=>{
  const f=fixture();let rejected;
  for(let i=0;i<6;i++){const actions=Array.from({length:16},(_,j)=>f.action(i*16+j+1,1));if(!f.consumer.receive('remote',actions,1,1))rejected=actions;}
  assert.ok(rejected);assert.equal(f.consumer.pending,80);
  const stop=f.action(1000,1,'cast');assert.equal(f.consumer.receive('remote',[stop],1,1),true);assert.equal(f.consumer.pending,81);
  assert.ok(f.consumer.diagnostics.overflowed>0);
  while(f.consumer.pending)f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(f.calls.length,81,'none of the accepted eighty collision samples vanished behind its receipt');
  assert.equal(f.consumer.receive('remote',rejected,1,1),true);f.consumer.consume(f.sim,'local',()=>1);
  assert.ok(f.calls.includes(rejected[0].id),'rejected sample was not prematurely marked executed');
});
test('a stop-bearing independent source receives priority while earlier events from its own source remain ordered',()=>{
  const f=fixture();f.sim.state.actors.push({...structuredClone(f.remote),id:'other'});
  f.consumer.receive('remote',[f.action(30,30)],1,30);
  f.setNow(1);
  f.consumer.receive('other',[f.action(11,11),f.action(12,12,'cast')],1,12);
  f.consumer.consume(f.sim,'local',()=>1);assert.deepEqual(f.calls,[30,11,12]);
  // Its first head is an earlier collision. It never jumps over it merely to
  // apply the later freeze. A source with a control as its head wins priority.
  const g=fixture();g.sim.state.actors.push({...structuredClone(g.remote),id:'other'});
  g.consumer.receive('remote',[g.action(30,30)],1,30);g.consumer.receive('other',[g.action(12,12,'cast')],1,12);
  g.consumer.consume(g.sim,'local',()=>1);assert.deepEqual(g.calls,[12,30]);
});
test('an exact old observed body admits one moving-target hit, keeps current HP/MP, current position and a fresh reaction serial',()=>{
  const f=fixture();f.consumer.rememberVictim(f.sim,'local',1,6);
  Object.assign(f.local,{x:300,hp:70,mp:40,state:'jump',stateSerial:50,animationTime:.6,invincible:false});
  f.consumer.rememberVictim(f.sim,'local',1,12);
  const action=f.action(1,6);action.targetViews=[{playerId:'local',epoch:1,frameSeq:6,position:[0,0,0]}];
  f.consumer.receive('remote',[action],1,12);f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(f.local.hp,60);assert.equal(f.local.mp,42);assert.equal(f.local.x,300);
  assert.equal(f.local.state,'damage');assert.equal(f.local.stateSerial,51);assert.equal(f.local.animationTime,0);
  assert.equal(f.consumer.diagnostics.compensatedVictimContacts,1);
  f.consumer.receive('remote',[action],1,12);f.consumer.consume(f.sim,'local',()=>1);assert.equal(f.local.hp,60);
});
test('an interpolated observed body admits one hit at the actually displayed position while live resources and position stay current',()=>{
  const f=fixture();f.consumer.rememberVictim(f.sim,'local',1,6);
  Object.assign(f.local,{x:40,animationTime:1.05});f.consumer.rememberVictim(f.sim,'local',1,9);
  Object.assign(f.local,{x:300,hp:70,mp:40,state:'jump',stateSerial:50,invincible:false});f.consumer.rememberVictim(f.sim,'local',1,12);
  const action=f.action(1,6);action.actor.x=20;
  action.targetViews=[{playerId:'local',epoch:1,frameSeq:6,position:[20,0,0],positionSamples:[{frameSeq:6,weight:.5},{frameSeq:9,weight:.5}]}];
  f.consumer.receive('remote',[action],1,12);f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(f.local.hp,60);assert.equal(f.local.mp,42);assert.equal(f.local.x,300);assert.equal(f.local.stateSerial,51);
  assert.equal(f.consumer.diagnostics.compensatedVictimContacts,1);
  f.consumer.receive('remote',[action],1,12);f.consumer.consume(f.sim,'local',()=>1);assert.equal(f.local.hp,60);
});
test('interpolated geometry never carries an ended historical invincibility into the current owner decision',()=>{
  const f=fixture();f.local.invincible=true;f.consumer.rememberVictim(f.sim,'local',1,6);
  f.local.x=40;f.local.invincible=false;f.consumer.rememberVictim(f.sim,'local',1,9);
  f.local.x=300;f.consumer.rememberVictim(f.sim,'local',1,12);
  const action=f.action(1,6);action.actor.x=20;
  action.targetViews=[{playerId:'local',epoch:1,frameSeq:6,position:[20,0,0],positionSamples:[{frameSeq:6,weight:.5},{frameSeq:9,weight:.5}]}];
  f.consumer.receive('remote',[action],1,12);f.consumer.consume(f.sim,'local',()=>1);assert.equal(f.local.hp,90);
  assert.equal(f.local.invincible,false);assert.equal(f.local.x,300);assert.equal(f.consumer.diagnostics.compensatedVictimContacts,1);
});
for(const invalid of ['position-mismatch','missing-sample','expired-sample','bad-cursor','negative-weight'])test('interpolated contact rejects '+invalid+' without searching for replacement history',()=>{
  const f=fixture({victimHistoryFrames:30,victimHistoryMs:500});f.consumer.rememberVictim(f.sim,'local',1,6);f.local.x=40;f.consumer.rememberVictim(f.sim,'local',1,9);
  f.local.x=300;f.consumer.rememberVictim(f.sim,'local',1,12);
  const action=f.action(1,6),reference={playerId:'local',epoch:1,frameSeq:6,position:[20,0,0],positionSamples:[{frameSeq:6,weight:.5},{frameSeq:9,weight:.5}]};
  action.targetViews=[reference];
  if(invalid==='position-mismatch')reference.position[0]=21;
  if(invalid==='missing-sample')reference.positionSamples[1].frameSeq=8;
  if(invalid==='expired-sample')f.setNow(501);
  if(invalid==='bad-cursor')reference.frameSeq=9;
  if(invalid==='negative-weight'){reference.positionSamples[0].weight=-.5;reference.positionSamples[1].weight=1.5;}
  f.consumer.receive('remote',[action],1,12);f.consumer.consume(f.sim,'local',()=>1);assert.equal(f.local.hp,100);assert.equal(f.local.x,300);
  assert.equal(f.consumer.diagnostics.rejectedVictimAnchors,1);
  assert.equal(f.consumer.diagnostics.victimRejections[{'position-mismatch':'positionMismatch','missing-sample':'missingHistory',
    'expired-sample':'expiredSamples','bad-cursor':'animationWitness','negative-weight':'invalidWitness'}[invalid]],1);
});
test('an invincible historical pose cannot override a currently vulnerable local owner',()=>{
  const f=fixture();f.local.invincible=true;f.consumer.rememberVictim(f.sim,'local',1,6);
  f.local.invincible=false;f.consumer.rememberVictim(f.sim,'local',1,12);
  const action=f.action(1,6);action.targetViews=[{playerId:'local',epoch:1,frameSeq:6,position:[0,0,0]}];
  f.consumer.receive('remote',[action],1,12);f.consumer.consume(f.sim,'local',()=>1);assert.equal(f.local.hp,90);assert.equal(f.local.invincible,false);
});

for(const guard of ['invincible','forceInvincible'])test('current owner '+guard+' wins over an older vulnerable skill witness',()=>{
  const f=fixture();f.consumer.rememberVictim(f.sim,'local',1,6);
  Object.assign(f.local,{state:'ordinary-skill',stateSerial:50,hp:70,mp:40,x:300,skillContext:{committed:true}});
  f.local[guard]=guard==='invincible'?true:2;const before=structuredClone(f.local);
  const action=f.action(1,6);action.targetViews=[{playerId:'local',epoch:1,frameSeq:6,position:[0,0,0]}];
  f.consumer.receive('remote',[action],1,12);f.consumer.consume(f.sim,'local',()=>1);
  assert.deepEqual(f.local,before);assert.equal(f.consumer.diagnostics.victimProtection.localInvincibility,1);
  assert.equal(f.sim.receiverContactGeometry,undefined);
});

test('the real local actor survives a scoped old pose and only the locally evaluated hit writes its reaction',()=>{
  const f=fixture();f.local.facing=1;f.consumer.rememberVictim(f.sim,'local',1,6);
  Object.assign(f.local,{x:300,facing:-1,state:'current-skill',stateSerial:50,hp:70,mp:40,skillContext:{current:true},
    superArmor:true,buffs:[{id:'current-buff'}]});
  const identity=f.local,context=f.local.skillContext,buffs=f.local.buffs;
  const original=f.sim.checkCharacterAttack;let calls=0;
  f.sim.checkCharacterAttack=a=>{calls++;assert.equal(f.sim.state.actors[0],identity);
    assert.equal(identity.state,'current-skill');assert.equal(identity.facing,-1);assert.equal(identity.superArmor,true);
    assert.equal(identity.skillContext,context);assert.equal(identity.buffs,buffs);assert.equal(f.sim.contactGeometry(identity,a).x,0);original(a);};
  const action=f.action(1,6);action.targetViews=[{playerId:'local',epoch:1,frameSeq:6,position:[0,0,0]}];
  f.consumer.receive('remote',[action],1,12);f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(calls,1);assert.equal(f.sim.state.actors[0],identity);assert.equal(identity.state,'damage');assert.equal(identity.stateSerial,51);
  assert.equal(identity.facing,-1);assert.equal(identity.x,300);assert.equal(identity.mp,42);
  assert.equal(identity.skillContext,context);assert.equal(identity.buffs,buffs);assert.equal(f.sim.receiverContactGeometry,undefined);
});

test('a failing historical query restores its previous geometry scope without replacing either real actor',()=>{
  const f=fixture();f.consumer.rememberVictim(f.sim,'local',1,6);f.local.x=300;
  const oldScope={playerId:'another',attackerId:'another-source',epoch:1,pose:{x:1,y:2,z:3}};
  f.sim.receiverContactGeometry=oldScope;f.sim.checkCharacterAttack=()=>{assert.equal(f.sim.state.actors[0],f.local);throw Error('fixture-query-failure');};
  const action=f.action(1,6);action.targetViews=[{playerId:'local',epoch:1,frameSeq:6,position:[0,0,0]}];
  f.consumer.receive('remote',[action],1,12);assert.throws(()=>f.consumer.consume(f.sim,'local',()=>1),/fixture-query-failure/);
  assert.equal(f.sim.state.actors[0],f.local);assert.equal(f.sim.state.actors[1],f.remote);assert.equal(f.local.x,300);
  assert.equal(f.sim.receiverContactGeometry,oldScope);
});

for(const state of ['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_DOWN_INVINCIBLE','RSI_DAMAGE_AIR_DOWN_LANDING',
  'ESSI_STANDUP_ATTACK_FRONT','RSI_STANDUP_ATTACK_BACK_NO_DOWN','ESI_QUICK_STANDUP_ATTACK_FRONT_ADVANCED','ANSI_STANDUP_ROLLING_FRONT_BACK'])
test('current protected recovery cannot be replaced by an old vulnerable witness: '+state,()=>{
  const f=fixture();f.consumer.rememberVictim(f.sim,'local',1,6);
  Object.assign(f.local,{state,invincible:true,mp:120,stateSerial:50,effectiveBlackHoleIds:[]});
  const before=structuredClone(f.local),action=f.action(1,6);
  action.targetViews=[{playerId:'local',epoch:1,frameSeq:6,position:[0,0,0]}];
  f.consumer.receive('remote',[action],1,6);f.consumer.consume(f.sim,'local',()=>1);
  assert.deepEqual(f.local,before);assert.equal(f.consumer.diagnostics.victimProtection.reactionInvincibility,1);
});

test('rolling off a ledge clears protection and still permits a valid historical hit',()=>{
  const f=fixture();f.consumer.rememberVictim(f.sim,'local',1,6);
  Object.assign(f.local,{state:'ANSI_STANDUP_ROLLING_FRONT_BACK',invincible:false,forceInvincible:0,grounded:false,mp:120});
  const action=f.action(1,6);action.targetViews=[{playerId:'local',epoch:1,frameSeq:6,position:[0,0,0]}];
  f.consumer.receive('remote',[action],1,6);f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(f.local.hp,90);assert.equal(f.consumer.diagnostics.victimProtection.reactionInvincibility,0);
});
for(const invalid of ['old-life','position-mismatch','expired','missing-frame','room-protection'])test('no historical pose search or lifecycle bypass for '+invalid,()=>{
  const f=fixture({victimHistoryFrames:30,victimHistoryMs:500});f.consumer.rememberVictim(f.sim,'local',1,6);f.local.x=300;f.consumer.rememberVictim(f.sim,'local',1,12);
  const action=f.action(1,6),reference={playerId:'local',epoch:1,frameSeq:6,position:[0,0,0]};action.targetViews=[reference];
  if(invalid==='old-life')reference.epoch=0;
  if(invalid==='position-mismatch')reference.position[0]=20;
  if(invalid==='expired')f.setNow(501);
  if(invalid==='missing-frame')reference.frameSeq=7;
  if(invalid==='room-protection')f.local.pvpInvincibleRemaining=1;
  f.consumer.receive('remote',[action],1,12);f.consumer.consume(f.sim,'local',()=>1);assert.equal(f.local.hp,100);assert.equal(f.local.x,300);
  assert.equal(f.consumer.diagnostics.rejectedVictimAnchors,1);
  assert.equal(f.consumer.diagnostics.victimRejections[{'old-life':'life','position-mismatch':'positionMismatch','expired':'expiredSamples',
    'missing-frame':'missingHistory','room-protection':'currentProtection'}[invalid]],1);
});
for(const kind of ['roomPresentation','roomInvincibility'])test('bounded diagnosis identifies current '+kind+' without weakening protection',()=>{
  const f=fixture();f.consumer.rememberVictim(f.sim,'local',1,6);
  f.local.x=300;
  if(kind==='roomPresentation')f.local.pvpPresentation={state:'fixture-intro'};else f.local.pvpInvincibleRemaining=1;
  const action=f.action(1,6);action.targetViews=[{playerId:'local',epoch:1,frameSeq:6,position:[0,0,0]}];
  f.consumer.receive('remote',[action],1,6);f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(f.local.hp,100);assert.equal(f.consumer.diagnostics.victimRejections.currentProtection,1);
  assert.equal(f.consumer.diagnostics.victimProtection[kind],1);
  const saved=f.consumer.diagnostics;saved.victimRejections.currentProtection=99;assert.equal(f.consumer.diagnostics.victimRejections.currentProtection,1);
  f.consumer.clear();assert.ok(Object.values(f.consumer.diagnostics.victimRejections).every(value=>value===0));
  assert.ok(Object.values(f.consumer.diagnostics.victimProtection).every(value=>value===0));
});
function delayedFourSampleFixture(options){
  const f=fixture(options);
  for(let index=0;index<4;index++){
    f.setNow(index*50);Object.assign(f.local,{x:index*20,animationTime:1+index*.05});
    f.consumer.rememberVictim(f.sim,'local',1,6+index*3);
  }
  f.setNow(600);Object.assign(f.local,{x:300,hp:70,mp:40,state:'jump',stateSerial:50,buffs:[{id:'current-live-buff'}]});
  f.consumer.rememberVictim(f.sim,'local',1,42);
  const action=f.action(1,6);action.actor.x=30;
  action.targetViews=[{playerId:'local',epoch:1,frameSeq:9,position:[30,0,0],
    positionSamples:[{frameSeq:6,weight:.125},{frameSeq:9,weight:.375},{frameSeq:12,weight:.375},{frameSeq:15,weight:.125}]}];
  return {...f,action};
}
test('default45frame/750ms bound accepts the measured600ms named four-sample body and keeps live position/resources/buffs',()=>{
  const f=delayedFourSampleFixture();f.consumer.receive('remote',[f.action],1,6);f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(f.consumer.diagnostics.compensatedVictimContacts,1);assert.equal(f.local.hp,60);assert.equal(f.local.mp,42);
  assert.equal(f.local.x,300);assert.deepEqual(f.local.buffs,[{id:'current-live-buff'}]);assert.equal(f.local.stateSerial,51);
});
test('explicit legacy30frame/500ms bound still rejects the same measured delayed body after pruning',()=>{
  const f=delayedFourSampleFixture({victimHistoryFrames:30,victimHistoryMs:500});
  f.consumer.receive('remote',[f.action],1,6);f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(f.local.hp,70);assert.equal(f.consumer.diagnostics.victimRejections.missingHistory,1);
});
for(const invalid of ['expired751ms','source46frames','futureSample','newLife','roomProtection','dead'])test('750ms named-history bound rejects '+invalid+' and never searches for a substitute pose',()=>{
  const f=delayedFourSampleFixture(),reference=f.action.targetViews[0];
  if(invalid==='expired751ms')f.setNow(751);
  if(invalid==='source46frames')f.consumer.rememberVictim(f.sim,'local',1,52);
  if(invalid==='futureSample')reference.positionSamples[3].frameSeq=45;
  if(invalid==='newLife')reference.epoch=0;
  if(invalid==='roomProtection')f.local.pvpInvincibleRemaining=1;
  if(invalid==='dead'){f.local.hp=0;f.local.pvpDead=true;}
  const hp=f.local.hp;f.consumer.receive('remote',[f.action],1,6);f.consumer.consume(f.sim,'local',()=>1);
  assert.equal(f.local.hp,hp);assert.equal(f.local.x,300);assert.equal(f.consumer.diagnostics.compensatedVictimContacts,0);
  assert.equal(f.consumer.diagnostics.rejectedVictimAnchors,1);
});
test('victim history configuration remains capped at45frames and750ms',()=>{
  assert.throws(()=>createRemoteActionConsumer({victimHistoryFrames:46}),/invalid-remote-action-bounds/);
  assert.throws(()=>createRemoteActionConsumer({victimHistoryMs:751}),/invalid-remote-action-bounds/);
});

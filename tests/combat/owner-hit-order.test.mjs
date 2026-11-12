/** Receiver collision identity across history/live arrival orders. These are
 * Web ownership regressions with native helpers, not original-client traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {canRepeatHit,tickSourceHitMemory2016} from '../../packages/combat-core/hit-gap-memory.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const assets=await loadServerCombatAssets({root,assetRoot:path.join(root,'artifacts')});
async function make(owner){
  const {native,samplers}=await assets.createRuntime();
  const sim=createSimulation({profile:assets.profile,map:assets.map,preset:{...assets.preset,onlineMatch:true},seed:2016,networkOwnerId:owner,
    actors:[{id:'sender',team:0,position:[2022.98,2840,0],lineId:6,facing:-1},{id:'receiver',team:1,position:[1920,2840,0],lineId:6,facing:1}],...samplers,
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:assets.versions});
  for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','arrival-order-fixture');}
  sim.drainEvents();return sim;
}
async function fixture(route='peer'){
  const source=await make('sender'),victim=await make('receiver'),sourceSync=createLocalOwnershipSync(),sync=createLocalOwnershipSync();
  const initial={snapshot:source.snapshot(),ownership:{mode:'local-owner-v1',actors:{sender:{epoch:1},receiver:{epoch:1}}}};
  sourceSync.reconcile(source,initial,'sender');sync.reconcile(victim,initial,'receiver');
  const reports=new Map();
  for(let frame=1;frame<=12;frame++){
    sourceSync.beforeStep(source,'sender');source.step(1/60,{sender:{held:frame===1?['Z']:[],pressed:frame===1?['Z']:[]}},{snapshot:false});
    const report=sourceSync.afterStep(source,'sender',source.drainEvents());
    if(report){report.actions=report.actions.map(({ageFrames,...action})=>action);reports.set(frame,report);}
  }
  const hits=[];
  const step=(count=1)=>{for(let i=0;i<count;i++){sync.beforeStep(victim,'receiver');victim.step(1/60,{}, {snapshot:false});hits.push(...victim.drainEvents().filter(event=>event.type==='hit'));}};
  const live=frame=>{
    const report=reports.get(frame);assert.ok(report,'live arrival requires an emitted source report at frame '+frame);
    if(route==='peer')return sync.receivePeer(victim,'sender',report,'receiver');
    const snapshot=victim.snapshot();Object.assign(snapshot.actors.find(actor=>actor.id==='sender'),report.actor);
    return sync.reconcile(victim,{snapshot,owners:{sender:report},ownership:{mode:'local-owner-v1',actors:{sender:{epoch:1},receiver:{epoch:1}}}},'receiver');
  };
  const history=frame=>{const report=reports.get(frame);assert.ok(report,'history arrival requires an emitted source report at frame '+frame);sync.receiveActions('sender',report.actions,1,report.frameSeq);};
  return {source,victim,sync,reports,hits,step,live,history,initial};
}

for(const route of ['peer','server'])for(const order of ['history-first','live-first','state-history-state'])test(`single native Z charges HP once for ${route} ${order}`,async t=>{
  const f=await fixture(route),hp=f.victim.actor('receiver').hp;
  if(order==='history-first'){f.history(6);f.step();f.live(6);}
  if(order==='live-first'){f.live(6);f.history(6);f.step();}
  if(order==='state-history-state'){
    // Immediate controller reports restart the ordinary heartbeat. Select the
    // real preceding state packet instead of assuming absolute frame3 exists.
    const preceding=[...f.reports.keys()].filter(frame=>frame<6).at(-1);
    assert.ok(preceding,'a live source state precedes the collision history');
    f.live(preceding);f.history(6);f.step();f.live(9);
  }
  f.step(20);f.history(6);f.history(9);f.step(2);f.live(12);f.step(20);
  assert.equal(f.hits.length,1,'one source effect must retain the receiver hit across temporary and live objects');
  assert.ok(f.hits[0].damageNumber);assert.equal(f.hits[0].origin.kind,'effect');
  assert.equal(f.victim.actor('receiver').hp,hp-f.hits[0].amount);
  t.diagnostic(JSON.stringify({route,order,hitCount:f.hits.length,eventIds:f.hits.map(event=>event.eventId),initialHp:hp,finalHp:f.victim.actor('receiver').hp,damage:f.hits[0].amount}));
});

test('a new native source effect ID can hit the same victim again',async()=>{
  const f=await fixture();f.history(6);f.step();f.live(6);f.step(2);
  const report=structuredClone(f.reports.get(9));report.effects=report.effects.map(effect=>({...effect,id:effect.id+100}));report.actions=[];
  f.sync.receivePeer(f.victim,'sender',report,'receiver');f.step(12);
  assert.equal(f.hits.length,2,'different source effects retain separate collision identities');
  assert.equal(f.victim.actor('receiver').hp,f.victim.actor('receiver').hpMax-f.hits.reduce((sum,event)=>sum+event.amount,0));
});

test('native next life may reuse the same source effect ID',async()=>{
  const f=await fixture();f.history(6);f.step();f.live(6);f.step(2);
  const next={snapshot:f.victim.snapshot(),ownership:{mode:'local-owner-v1',actors:{sender:{epoch:2},receiver:{epoch:1}}}};
  f.sync.reconcile(f.victim,next,'receiver');
  const report=structuredClone(f.reports.get(6));report.epoch=2;
  f.sync.receiveActions('sender',report.actions,2,report.frameSeq);f.step();f.sync.receivePeer(f.victim,'sender',report,'receiver');f.step(12);
  assert.equal(f.hits.length,2,'life epochs must not suppress a genuinely new attack');
});

test('late previous-life histories cannot erase current-life native hit receipts',async()=>{
  const f=await fixture();
  f.sync.reconcile(f.victim,{snapshot:f.victim.snapshot(),ownership:{mode:'local-owner-v1',actors:{sender:{epoch:2},receiver:{epoch:1}}}},'receiver');
  const report=structuredClone(f.reports.get(6));report.epoch=2;
  f.sync.receiveActions('sender',report.actions,2,report.frameSeq);f.step();f.sync.receivePeer(f.victim,'sender',report,'receiver');f.step(2);
  assert.equal(f.sync.receiveActions('sender',f.reports.get(9).actions,1,9),false,'old life is rejected before trimming the new ledger');
  const next=structuredClone(f.reports.get(9));next.epoch=2;
  f.sync.receiveActions('sender',next.actions,2,9);f.step();f.sync.receivePeer(f.victim,'sender',next,'receiver');f.step(20);
  assert.equal(f.hits.length,1);assert.equal(f.victim.actor('receiver').hp,f.victim.actor('receiver').hpMax-f.hits[0].amount);
});

function memoryFixture(){
  const actor={id:'sender',state:'ATTACK',stateSerial:7,hits:{receiver:1},hitGaps:{receiver:.25}};
  const effect={ownerId:'sender',networkId:1,networkEpoch:1,stage:0,damage:{},hits:{receiver:1},hitGaps:{receiver:.25}};
  const simulation={profile:{states:{ATTACK:{raw:{}}}},state:{actors:[actor],effects:[effect]}};
  const consumer=createRemoteActionConsumer();consumer.remember(simulation,'receiver',()=>1);
  return {simulation,consumer,actor,effect};
}
test('live character and effect replacements adopt receipts, preserving subsequent reattack gap',()=>{
  const {simulation,consumer}=memoryFixture();
  const actor={...simulation.state.actors[0],hits:{},hitGaps:{}},effect={...simulation.state.effects[0],hits:{},hitGaps:{}};
  simulation.state.actors=[actor];simulation.state.effects=[effect];consumer.remember(simulation,'receiver',()=>1);
  assert.equal(actor.hits.receiver,1);assert.equal(effect.hits.receiver,1);assert.equal(effect.hitGaps.receiver,.25);
  assert.equal(canRepeatHit(effect.hits,effect.hitGaps,'receiver',1.2,{RE_ATTACK:1,HIT_GAP:0}),false);
  assert.equal(canRepeatHit(effect.hits,effect.hitGaps,'receiver',1.25,{RE_ATTACK:1,HIT_GAP:100}),true);
  simulation.state.effects=[{...effect,hits:{receiver:1.3},hitGaps:{receiver:.4}}];consumer.remember(simulation,'receiver',()=>1);
  simulation.state.effects=[{...effect,hits:{},hitGaps:{}}];consumer.remember(simulation,'receiver',()=>1);
  assert.equal(simulation.state.effects[0].hits.receiver,1.3);assert.equal(simulation.state.effects[0].hitGaps.receiver,.4);
});

test('collision entry restores CLEAR stage receipts before body/GroundHit and retains legitimate stage hits',async()=>{
  const sim=await make('receiver'),consumer=createRemoteActionConsumer(),a=sim.actor('sender'),target=sim.actor('receiver');
  const effect={id:9001,ownerId:'sender',networkId:1,networkEpoch:1,stage:0,damage:{CLEAR_HIT_UNIT_ON_DAMAGE_DATA_CHANGE:1},hits:{},hitGaps:{}};
  sim.state.effects=[effect];consumer.remember(sim,'receiver',()=>1);
  const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:0,ATTACK_TYPE:2,HIT_TYPE:1};
  // Explicit broad attack shape; defender helpers/ground geometry are native.
  // This isolates receipt policy rather than claiming an authored attack pose.
  const shapes=[{kind:'sphere',center:[target.x,target.y+100,target.z],radius:200}],origin={kind:'effect',id:effect.id,powerMultiplier:1,attackPosition:[target.x,target.y,target.z]};
  // A real CLEAR stage resets the native carrier list as well as its legacy
  // diagnostic maps; receiver binding then reconnects this stage's receipt.
  const clear=()=>{effect.hits={};effect.hitGaps={};effect.sourceHitMemory2016=[];};
  assert.equal(sim.checkHits(a,shapes,data,effect.hits,origin),1);clear();
  assert.equal(sim.checkGroundHits(a,{...data,HIT_TYPE:26},effect.hits,origin),0,'body and ground share the same accepted receipt');
  effect.stage=1;clear();assert.equal(sim.checkHits(a,shapes,data,effect.hits,origin),1,'a declared CLEAR stage has a new legal hit');
  effect.stage=0;clear();assert.equal(sim.checkHits(a,shapes,data,effect.hits,origin),0,'old stage reentry cannot erase its hit');
  effect.stage=1;clear();assert.equal(sim.checkHits(a,shapes,data,effect.hits,origin),0,'stage clear must reconnect history before collision');
  assert.equal(sim.drainEvents().filter(event=>event.type==='hit').length,2);
});

test('collision entry preserves RE_ATTACK birth gaps instead of permanently suppressing later hits',async()=>{
  const sim=await make('receiver'),consumer=createRemoteActionConsumer(),a=sim.actor('sender'),target=sim.actor('receiver');
  const effect={id:9001,ownerId:'sender',networkId:1,networkEpoch:1,stage:0,damage:{},hits:{},hitGaps:{}};
  sim.state.effects=[effect];consumer.remember(sim,'receiver',()=>1);
  const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:0,ATTACK_TYPE:2,HIT_TYPE:1,RE_ATTACK:1,HIT_GAP:.1};
  const shapes=[{kind:'sphere',center:[target.x,target.y+100,target.z],radius:200}],origin={kind:'effect',id:effect.id,powerMultiplier:1};
  // This fixture calls collision entry directly, outside tickEffects. Supply
  // the actual carrier update delta explicitly; changing wall time alone does
  // not expire original hit-memory rows. These are Web inputs, not a trace.
  const advanceTo=time=>{tickSourceHitMemory2016(effect.sourceHitMemory2016,time-sim.state.time,{repeat:1});sim.state.time=time;};
  assert.equal(sim.checkHits(a,shapes,data,effect.hits,origin),1);
  effect.hits={};effect.hitGaps={};advanceTo(.05);
  assert.equal(sim.checkHits(a,shapes,{...data,HIT_GAP:0},effect.hits,origin),0,'a new declaration cannot shorten the existing accepted gap');
  effect.hits={};effect.hitGaps={};advanceTo(.1);
  assert.equal(sim.checkHits(a,shapes,{...data,HIT_GAP:.2},effect.hits,origin),1);
  effect.hits={};effect.hitGaps={};advanceTo(.25);
  assert.equal(sim.checkHits(a,shapes,data,effect.hits,origin),0,'the second hit installed its own .2 birth gap');
  advanceTo(.3);assert.equal(sim.checkHits(a,shapes,data,effect.hits,origin),1);
  assert.equal(sim.drainEvents().filter(event=>event.type==='hit').length,3);
});

test('receiver hook leaves own hits and fresh core cycles alone and clear restores the previous hook',async()=>{
  const sim=await make('receiver'),consumer=createRemoteActionConsumer(),local=sim.actor('receiver'),remote=sim.actor('sender');
  assert.equal(sim.receiverHitMemory,null);consumer.remember(sim,'receiver',()=>1);
  for(const [attacker,record,origin]of [[local,local,{kind:'character'}],[remote,remote.core,{kind:'core'}]]){
    const fresh={};assert.equal(sim.collisionReceipts(attacker,record,origin,fresh).hits,fresh);
    assert.deepEqual(fresh,{},'fresh source/core hit maps cannot adopt an old receiver record');
  }
  consumer.clear();assert.equal(sim.receiverHitMemory,null);
});
test('receipt scopes distinguish player, life, source ID and CLEAR damage stage',()=>{
  for(const kind of ['player','epoch','id','clear-stage','non-clear-stage']){
    const {simulation,consumer,effect}=memoryFixture();
    const next={...effect,hits:{},hitGaps:{}};let epoch=1;
    if(kind==='player'){next.ownerId='other';simulation.state.actors.push({...simulation.state.actors[0],id:'other',hits:{},hitGaps:{}});}
    if(kind==='epoch'){epoch=2;next.networkEpoch=2;}
    if(kind==='id')next.networkId=2;
    if(kind==='clear-stage'){effect.damage.CLEAR_HIT_UNIT_ON_DAMAGE_DATA_CHANGE=1;next.stage=1;}
    if(kind==='non-clear-stage')next.stage=1;
    simulation.state.effects=[next];consumer.remember(simulation,'receiver',()=>epoch);
    assert.equal(next.hits.receiver,kind==='non-clear-stage'?1:undefined,kind);
  }
});

/** Current Web ownership/lifecycle regressions, not original-client goldens. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {createOnlineService,validateInputBatch,registerLocalOwnerInputConsumer} from '../../packages/online/service.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const players=['a','b','c','d'].map((id,index)=>({id,username:id,team:index<2?0:1,loadout:Array(8).fill(null)}));
const map={sceneId:'owner-protocol-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
  starts:players.map((player,index)=>({index,kind:'SetTeamStartPos',teamFlag:player.team===0,position:[index*1000,0,0],lineId:0,facingRight:true}))};
function fixture(t,continuousAuraVersion){
  const sim=createSimulation({profile,map,actors:players.map((player,index)=>({...player,position:[index*1000,0,0]})),seed:16,
    versions:{referenceVersion:'fixture',presetVersion:'fixture',programVersion:'fixture'}});
  const templates=structuredClone(sim.state.actors),events=[],results=[];let combatSteps=0;
  sim.step=()=>{combatSteps++;throw Error('room must not run full combat');};
  const pvp=new PvpMatch({players,map,seed:16,versions:sim.versions,onRespawn(id){const index=sim.state.actors.findIndex(actor=>actor.id===id);sim.state.actors[index]=structuredClone(templates[index]);return sim.state.actors[index];}});
  const driver=createLocalOwnerBattleDriver({match:{id:'owner-fixture',players,...(continuousAuraVersion===1?{continuousAuraVersion}: {})},simulation:sim,pvp,manual:true,clock:()=>0,
    emit:(type,data)=>events.push({type,data}),finish:result=>results.push(result)});t.after(()=>driver.stop());
  const start=()=>{for(const player of players)driver.ready(player.id);driver.tick(10);assert.equal(driver.snapshot().pvp.phase,'fight');};
  const report=(id,seq,patch={},hits=[])=>{const state=driver.snapshot();const value=encodeOwnedState(sim,id,{epoch:state.ownership.actors[id].epoch,frameSeq:seq});Object.assign(value.actor,patch);value.hits=hits;return value;};
  const submit=(id,value)=>driver.submitInput(id,{frames:[{held:[],frameSeq:value.frameSeq}],owner:value});
  return {sim,pvp,driver,events,results,start,report,submit,get combatSteps(){return combatSteps;}};
}

test('negotiated continuous aura survives room lifecycle metadata and exact action receipts',t=>{
  const f=fixture(t,1);assert.equal(f.driver.snapshot().ownership.continuousAuraVersion,1);f.start();
  Object.assign(f.sim.actor('a').awakening,{full:true,remaining:8});
  f.sim.spawnSet(f.sim.actor('a'),'EffectSet_RAVEN_HYPER_AURA');
  const aura=f.sim.state.effects.find(effect=>effect.name==='RAVEN_HYPER_AURA');
  assert.ok(aura);Object.assign(aura,{active:true,sourceContinuousAura:{version:1,revision:1,phase:'active'}});
  const report=f.report('a',100);report.actions=[encodeCriticalAction(report,{id:1,effectIds:new Set([aura.id])})];
  const receipt=f.submit('a',report);assert.deepEqual(receipt.consumedActionIds,[1]);
  assert.equal(f.driver.snapshot().owners.a.effects.find(effect=>effect.id===aura.id).sourceContinuousAura.version,1);
  assert.equal(f.submit('a',report).ignored,'old-state');assert.equal(f.events.filter(event=>event.type==='input').length,1);
});

test('a legacy room rejects marked lifecycle reports before relaying them',t=>{
  const f=fixture(t);f.start();f.sim.spawnSet(f.sim.actor('a'),'EffectSet_RAVEN_HYPER_AURA');
  const aura=f.sim.state.effects.find(effect=>effect.name==='RAVEN_HYPER_AURA');
  assert.ok(aura);Object.assign(aura,{active:true,sourceContinuousAura:{version:1,revision:1,phase:'active'}});
  assert.throws(()=>f.submit('a',f.report('a',100)),/continuous-aura-not-negotiated/);
  assert.equal(f.events.filter(event=>event.type==='input').length,0);assert.equal(f.driver.snapshot().ownership.continuousAuraVersion,undefined);
});

test('pending final death accepts corpse fade and later trade reports, resolves original tie priority only after both models disappear',t=>{
  const f=fixture(t);f.start();f.pvp.state.score=[3,3];
  f.submit('c',f.report('c',1,{hp:0,hidden:false,deathComplete:false},[{id:1,attackerId:'a',damage:100}]));f.driver.tick(.1);
  assert.equal(f.driver.snapshot().pvp.phase,'slow');assert.equal(f.driver.snapshot().pvp.result,null);
  assert.equal(f.sim.actor('a').forceInvincible,0);f.driver.tick(1.6);assert.equal(f.results.length,0);
  f.submit('a',f.report('a',2,{hp:0,hidden:false,deathComplete:false},[{id:2,attackerId:'c',damage:100}]));f.driver.tick(.1);
  assert.deepEqual(f.driver.snapshot().pvp.score,[4,4]);assert.equal(f.results.length,0);
  f.submit('c',f.report('c',3,{hidden:true,deathComplete:true}));f.driver.tick(.1);
  assert.equal(f.sim.actor('c').hidden,true,'room must accept its authenticated owner completing the corpse fade');assert.equal(f.results.length,0);
  f.submit('a',f.report('a',3,{hidden:true,deathComplete:true}));f.driver.tick(.1);
  assert.equal(f.results.length,1);assert.equal(f.results[0].winnerTeam,0);assert.equal(f.results[0].tieBreak,'v5-first-team');
  assert.equal(f.sim.actor('b').forceInvincible,9999);f.driver.tick(10);assert.equal(f.results.length,1);
});
test('default owner room advances wall clock without running a combat step and installs intro once',t=>{
  const f=fixture(t);assert.equal(f.driver.snapshot().ownership.actors.a.epoch,0);f.start();
  assert.equal(f.driver.snapshot().ownership.actors.a.epoch,1);assert.equal(f.sim.actor('a').mp,0);assert.equal(f.sim.actor('a').awakening.gauge,50);
  f.driver.ready('a');assert.equal(f.driver.snapshot().ownership.actors.a.epoch,1);
  for(let i=0;i<300;i++)f.driver.tick(.1);assert.equal(f.combatSteps,0);assert.equal(f.driver.snapshot().stats.combatSteps,0);
  assert.ok(f.driver.snapshot().pvp.fightTime>=30);
});

test('delayed loading, prior-life and stale input frames cannot seed a playable life or rewind held input',t=>{
  const f=fixture(t),loading=f.report('a',900,{x:777});
  const send=(owner,held)=>f.driver.submitInput('a',{frames:[{held,frameSeq:owner.frameSeq}],owner});
  assert.equal(send(loading,['RIGHT']).ignored,'room-locked');assert.equal(f.driver.snapshot().inputs.a,undefined);
  for(const player of players)f.driver.ready(player.id);
  const intro=f.report('a',1,{x:800});assert.equal(send(intro,['X']).ignored,'room-locked');
  assert.equal(f.driver.snapshot().inputs.a,undefined);f.driver.tick(10);
  assert.equal(send(loading,['RIGHT']).ignored,'old-life');assert.equal(f.driver.snapshot().inputs.a,undefined);
  const fresh=f.report('a',20,{x:123});send(fresh,['LEFT']);
  const stale=f.report('a',19,{x:456});assert.equal(send(stale,['RIGHT']).ignored,'old-state');
  assert.deepEqual(f.driver.snapshot().inputs.a,{held:['LEFT'],frameSeq:20});assert.equal(f.sim.actor('a').x,123);
  const death=f.report('a',21,{hp:0,deathComplete:true});send(death,[]);f.driver.tick(.1);f.driver.tick(12);
  assert.equal(f.driver.snapshot().ownership.actors.a.epoch,2);assert.equal(f.driver.snapshot().inputs.a,undefined);
  assert.equal(send({...death,frameSeq:999},['X']).ignored,'old-life');assert.equal(f.driver.snapshot().inputs.a,undefined);
});
test('authenticated owner updates only its actor; state sequence rejects rollback and static configuration is rejected',t=>{
  const f=fixture(t);f.start();const before=structuredClone(f.sim.actor('b'));
  const value=f.report('a',100,{x:145,mp:50});assert.equal(f.submit('a',value).accepted,true);
  assert.equal(f.sim.actor('a').x,145);assert.deepEqual(f.sim.actor('b'),before);
  const old=f.report('a',99,{x:900});assert.equal(f.submit('a',old).ignored,'old-state');assert.equal(f.sim.actor('a').x,145);
  for(const field of ['team','loadout','stats','pvpModifiers','id']){
    const forged=structuredClone(value);forged.actor[field]=field==='id'?'b':{};assert.throws(()=>f.submit('a',forged),/invalid-owner-state/);
  }
  const invalid=f.report('a',101,{hp:f.sim.actor('a').hpMax+1});assert.throws(()=>f.submit('a',invalid),/out-of-range/);
  assert.throws(()=>f.submit('a',f.report('a',101,{skillId:24025})),/unconfigured-owner-skill/);
});
test('consumed reliable action references are not re-evaluated while every fresh action and current actor remains checked',t=>{
  const f=fixture(t);f.start();const value=f.report('a',100);
  value.actions=[encodeCriticalAction(value,{id:7,frameSeq:100})];f.submit('a',value);
  const repeated=f.report('a',101);repeated.actions=structuredClone(value.actions);
  // This already consumed action cannot change the simulation or be relayed
  // again. Its shape stays valid while its stale configuration is ignored.
  repeated.actions[0].actor.skillId=99999;
  assert.equal(f.submit('a',repeated).accepted,true);assert.equal(f.events.filter(row=>row.type==='input').length,1);
  const fresh=f.report('a',102);fresh.actions=structuredClone(repeated.actions);fresh.actions[0].id=8;
  assert.throws(()=>f.submit('a',fresh),/unconfigured-owner-skill/);
  const current=f.report('a',103,{skillId:99999});assert.throws(()=>f.submit('a',current),/unconfigured-owner-skill/);
  const malformed=f.report('a',100);malformed.actions=structuredClone(value.actions);malformed.actions[0].actor.x=Infinity;
  assert.throws(()=>f.submit('a',malformed),/invalid-owner/);
});
test('same-step victim deaths are batched; death and hit receipts are idempotent and respawn rejects old life',t=>{
  const f=fixture(t);f.start();const a=f.report('a',1,{hp:0,deathComplete:true},[{id:1,attackerId:'c',damage:50000}]);
  f.submit('a',a);f.submit('a',a);f.driver.tick(.1);let state=f.driver.snapshot();
  assert.deepEqual(state.pvp.score,[0,1]);assert.equal(state.pvp.players.find(player=>player.id==='c').kills,1);
  f.submit('a',{...a,frameSeq:2});f.driver.tick(.1);assert.deepEqual(f.driver.snapshot().pvp.score,[0,1]);
  f.driver.tick(12);state=f.driver.snapshot();assert.equal(state.ownership.actors.a.epoch,2);assert.equal(f.sim.actor('a').hp,f.sim.actor('a').hpMax);
  assert.equal(f.submit('a',{...a,frameSeq:100}).ignored,'old-life');assert.equal(f.sim.actor('a').hp,f.sim.actor('a').hpMax);
  const invincible=f.report('a',101,{hp:0});f.submit('a',invincible);f.driver.tick(.1);assert.deepEqual(f.driver.snapshot().pvp.score,[0,1]);
  f.driver.tick(6);f.submit('a',f.report('a',102,{hp:0,deathComplete:true}));f.submit('c',f.report('c',1,{hp:0,deathComplete:true}));f.driver.tick(.1);
  assert.deepEqual(f.driver.snapshot().pvp.score,[1,2]);
});

for(const lead of [1,2])test(`respawn epoch preserves the ${lead===1?'halved':'cleared'} MP penalty against delayed old owner reports`,t=>{
  const f=fixture(t);f.start();
  // This deliberate score fixture produces the requested lead AFTER the
  // opponent gains one point for this death. It is not a native runtime gold.
  f.pvp.state.score=[lead+1,0];
  const old=f.report('a',1,{mp:200,hp:0,deathComplete:true},[{id:1,attackerId:'c',damage:50000}]);
  f.submit('a',old);f.driver.tick(.1);f.driver.tick(24);
  const spawned=f.driver.snapshot();assert.equal(spawned.ownership.actors.a.epoch,2);
  const expected=lead===1?100:0;assert.equal(spawned.snapshot.actors.find(actor=>actor.id==='a').mp,expected);
  const receiver=createSimulation({profile,map,actors:players.map((player,index)=>({...player,position:[index*1000,0,0]})),seed:16,versions:f.sim.versions});
  const sync=createLocalOwnershipSync(),delayedRoom={...spawned,ownership:{...spawned.ownership,actors:{...spawned.ownership.actors,a:{epoch:1,frameSeq:1}}},snapshot:{...spawned.snapshot,actors:spawned.snapshot.actors.map(actor=>actor.id==='a'?{...actor,mp:200}:actor)}};
  sync.reconcile(receiver,delayedRoom,'a');
  sync.reconcile(receiver,spawned,'a');assert.equal(receiver.actor('a').mp,expected);
  sync.reconcile(receiver,delayedRoom,'a');assert.equal(receiver.actor('a').mp,expected,'old server life cannot reset the new-life penalty');
  const delayed={...old,frameSeq:1000};assert.equal(f.submit('a',delayed).ignored,'old-life');assert.equal(f.sim.actor('a').mp,expected);
  assert.equal(sync.receivePeer(receiver,'a',delayed,'a'),false);assert.equal(receiver.actor('a').mp,expected);
  // Unknown future pools remain unsupported by the network actor schema.
  const forged=f.report('a',1001);forged.actor.specialResources={invented:200};assert.throws(()=>f.submit('a',forged),/invalid-owner-state/);
  assert.equal(f.sim.actor('a').mp,expected);
});
test('disconnect removes an owner immediately, clears state relay and finishes exactly once',t=>{
  const f=fixture(t);f.start();f.submit('a',f.report('a',1));f.driver.disconnect('a');f.driver.disconnect('a');
  assert.equal(f.sim.actor('a').hidden,true);assert.equal(f.driver.snapshot().owners.a,undefined);
  assert.equal(f.sim.actor('b').pvpModifiers.hitMpBonus,3);f.driver.disconnect('b');f.driver.tick(2);
  assert.equal(f.results.length,1);assert.equal(f.results[0].winnerTeam,1);f.driver.tick(2);assert.equal(f.results.length,1);
  assert.equal(f.submit('c',f.report('c',2)).accepted,false);
});
test('a departed owner cannot revive through a late valid owned report while the remaining 2v2 room keeps fighting',t=>{
  const f=fixture(t);f.start();const owned=f.report('a',3,{x:120,mp:70});f.submit('a',owned);
  f.driver.disconnect('a');const before=f.driver.snapshot();
  assert.equal(before.pvp.phase,'fight');assert.equal(before.pvp.result,null);
  assert.equal(before.pvp.players.find(row=>row.id==='a').connected,false);
  assert.equal(before.owners.a,undefined);assert.equal(f.sim.actor('a').pvpDisconnected,true);
  const late={...owned,frameSeq:999};assert.equal(f.submit('a',late).accepted,false);
  const after=f.driver.snapshot();assert.deepEqual(after.snapshot,before.snapshot);assert.deepEqual(after.owners,before.owners);
  assert.equal(after.ownership.actors.a.frameSeq,3);assert.equal(f.sim.actor('a').hidden,true);assert.equal(f.sim.actor('a').hp,0);
  assert.equal(f.submit('b',f.report('b',100,{x:345})).accepted,true);
  assert.equal(f.sim.actor('b').x,345);assert.equal(f.driver.snapshot().pvp.phase,'fight');
  assert.equal(f.results.length,0,'one retired slot does not terminate the still populated two teams');
});
test('owner input envelope rejects unknown fields, oversized data, forged epochs and mismatched frame ownership',t=>{
  const f=fixture(t);f.start();const owner=f.report('a',8),body={matchId:'owner-fixture',sequence:0,frames:[{held:[],frameSeq:8}],owner};
  assert.equal(validateInputBatch(body).owner.frameSeq,8);
  for(const bad of [{...body,hp:0},{...body,owner:{...owner,epoch:-1}},{...body,owner:{...owner,frameSeq:9}}])assert.throws(()=>validateInputBatch(bad));
  const nested=structuredClone(owner);nested.actor.core.pollution={['__proto__']:{hp:1}};assert.throws(()=>validateInputBatch({...body,owner:nested}));
});
test('production service uses authenticated username rather than accepting an owner actor identity',async t=>{
  const f=fixture(t);let stamp=0;const factory=()=>f.driver;factory.ownership='local-owner-v1';
  const online=createOnlineService({driverFactory:factory,versions:{reference:'fixture',preset:'fixture',program:'fixture'},now:()=>stamp,random:()=>.5,
    accountStore:{recordMatch:async(match,result)=>({recorded:true,result:{...result,finishedAt:stamp}})}});t.after(()=>online.close());
  for(const player of players)await online.join(player.id,'gm',{loadout:Array(8).fill(null)});stamp=11000;await online.tick();
  const match=online.status('a').match;assert.equal(match.ownership,'local-owner-v1');f.start();
  const owner=f.report('a',1,{x:42});online.submitInput('a',{matchId:match.id,sequence:0,frames:[{held:[],frameSeq:1}],owner});
  assert.equal(f.sim.actor('a').x,42);assert.notEqual(f.sim.actor('b').x,42);
  assert.throws(()=>online.submitInput('stranger',{matchId:match.id,sequence:0,frames:[{held:[],frameSeq:1}],owner}),/match-not-active/);
});
test('service consumes one fresh owner copy and revalidates mutated previously validated batches',async t=>{
  const f=fixture(t);let stamp=0;const factory=()=>f.driver;factory.ownership='local-owner-v1';
  const online=createOnlineService({driverFactory:factory,accountStore:{},versions:{reference:'fixture',preset:'fixture',program:'fixture'},now:()=>stamp,random:()=>.5});t.after(()=>online.close());
  for(const player of players)await online.join(player.id,'gm',{loadout:Array(8).fill(null)});stamp=11000;await online.tick();
  const match=online.status('a').match;f.start();
  const owner=f.report('a',1,{x:42});owner.actions=Array.from({length:16},(_,index)=>encodeCriticalAction(owner,{id:index+1,frameSeq:1}));
  const body={matchId:match.id,sequence:0,frames:[{held:[],frameSeq:1}],owner};
  const originalClone=globalThis.structuredClone;let wholeOwnerCopies=0;
  globalThis.structuredClone=(value,...args)=>{if(value?.protocol==='local-owner-v1'&&value.actor&&value.effects&&value.hits)wholeOwnerCopies++;return originalClone(value,...args);};
  try{assert.equal(online.submitInput('a',body).accepted,true);}finally{globalThis.structuredClone=originalClone;}
  assert.equal(wholeOwnerCopies,1,'the authenticated service must not revalidate or reclone the complete action history in the driver');
  assert.equal(f.events.findLast(event=>event.type==='input').data.actions.length,16,'all reliable action samples survive the single-copy chain');
  assert.equal(f.sim.actor('a').x,42);assert.equal(owner.actor.x,42);
  owner.actor.x=900;assert.equal(f.sim.actor('a').x,42,'caller-owned input stays isolated');
  const next=f.report('a',2,{x:51}),validated=validateInputBatch({...body,sequence:1,frames:[{held:[],frameSeq:2}],owner:next});
  validated.owner.actor.stats={forged:true};
  assert.throws(()=>online.submitInput('a',validated),/invalid-owner-state/);
  assert.throws(()=>f.driver.submitInput('a',validated),/invalid-owner-state/);
  assert.equal(f.sim.actor('a').x,42);
  assert.throws(()=>registerLocalOwnerInputConsumer(f.driver,()=>({accepted:true})),/already-registered/,'a public registration call cannot replace the private consumer');
  const valid=validateInputBatch({...body,sequence:1,frames:[{held:[],frameSeq:2}],owner:next});
  valid.owner.actor.core.pollution={['__proto__']:{hp:1}};
  assert.throws(()=>online.submitInput('a',valid),/invalid-owner-state/);
  assert.equal(online.submitInput('a',{...body,sequence:1,frames:[{held:[],frameSeq:2}],owner:next}).accepted,true);
  assert.equal(f.sim.actor('a').x,51,'rejected tampering does not consume the legitimate sequence');
});
test('public owner submissions and emitted states/actions retain mutable-consumer isolation',t=>{
  const f=fixture(t);f.start();const owner=f.report('a',1,{x:42});
  owner.effects=[{id:1,name:Object.keys(profile.damageEffects)[0],x:11,y:0,z:0,active:true}];
  owner.actions=[encodeCriticalAction(owner,{id:1,frameSeq:1,effectIds:new Set([1])})];
  assert.equal(f.submit('a',owner).accepted,true);
  const relayed=f.events.findLast(event=>event.type==='owned-state').data.report;
  const input=f.events.findLast(event=>event.type==='input').data;
  relayed.actor.x=800;relayed.effects[0].x=800;input.actions[0].actor.x=700;input.actions[0].effects[0].x=700;
  owner.actor.x=900;owner.effects[0].x=900;owner.actions[0].actor.x=900;
  const seed=f.driver.snapshot();assert.equal(seed.snapshot.actors.find(actor=>actor.id==='a').x,42);
  assert.equal(seed.owners.a.effects[0].x,11);assert.equal(seed.recentActions.a.actions[0].actor.x,42);assert.equal(seed.recentActions.a.actions[0].effects[0].x,11);
  seed.owners.a.effects[0].x=600;seed.recentActions.a.actions[0].actor.x=600;
  const next=f.driver.snapshot();assert.equal(next.owners.a.effects[0].x,11);assert.equal(next.recentActions.a.actions[0].actor.x,42);
});

test('server fallback publishes canonical actions before the first and subsequent owner poses',t=>{
  const f=fixture(t);f.start();f.events.length=0;
  for(const frame of [3,6]){
    const owner=f.report('a',frame);
    owner.actions=[encodeCriticalAction(owner,{id:frame,frameSeq:frame})];
    const before=f.events.length;assert.equal(f.submit('a',owner).accepted,true);
    const emitted=f.events.slice(before);
    assert.deepEqual(emitted.map(event=>event.type),['input','owned-state']);
    assert.equal(emitted[0].data.actions[0].id,frame);
    assert.equal(emitted[1].data.report.frameSeq,frame);
    assert.equal(f.driver.snapshot().recentActions.a.actions.at(-1).id,frame);
  }
  const repeated=f.report('a',9);repeated.actions=[encodeCriticalAction(repeated,{id:6,frameSeq:6})];
  const before=f.events.length;f.submit('a',repeated);
  assert.deepEqual(f.events.slice(before).map(event=>event.type),['owned-state'],'an already consumed action is not emitted again');
});

test('critical action relay is identity-bound, bounded, idempotent, seeded on reconnect and cleared at respawn',t=>{
  const f=fixture(t);f.start();const owner=f.report('a',100);
  owner.actions=[encodeCriticalAction(owner,{id:90,frameSeq:90})];f.submit('a',owner);
  let relays=f.events.filter(event=>event.type==='input');assert.equal(relays.length,1);assert.equal(relays[0].data.playerId,'a');
  assert.equal(relays[0].data.epoch,1);assert.equal(relays[0].data.frameSeq,100);
  assert.equal(f.driver.snapshot().recentActions.a.actions.length,1,'reconnect receives unconsumed critical source history');
  f.submit('a',{...owner,frameSeq:101});assert.equal(f.events.filter(event=>event.type==='input').length,1,'HTTP retry does not publish a second critical receipt');
  const forged=structuredClone(owner);forged.frameSeq=102;forged.actions[0].actor.id='b';const before=f.sim.snapshot();
  assert.throws(()=>f.submit('a',forged),/invalid-owner-actions/);assert.deepEqual(f.sim.snapshot(),before,'rejected nested identity has no mutable combat side effects');
  const expired=f.report('a',200);expired.actions=[encodeCriticalAction(expired,{id:91,frameSeq:139})];f.submit('a',expired);
  assert.equal(f.events.filter(event=>event.type==='input').length,2,'transport retains a newly consumed identity beyond sixty source steps; combat expiry remains receiver-owned');
  assert.equal(f.driver.snapshot().recentActions.a.actions.at(-1).id,91,'a just received transport identity remains available for reconnect');
  f.driver.tick(.1);assert.equal(f.events.filter(event=>event.type==='state').at(-1).data.recentActions,undefined,'ordinary state broadcasts do not repeat critical histories');
  f.submit('a',f.report('a',201,{hp:0,deathComplete:true}));f.driver.tick(.1);f.driver.tick(12);
  assert.equal(f.driver.snapshot().recentActions.a,undefined);f.driver.tick(6);
  const next=f.report('a',202);next.actions=[encodeCriticalAction(next,{id:1,frameSeq:202})];f.submit('a',next);
  relays=f.events.filter(event=>event.type==='input');assert.equal(relays.length,3);assert.equal(relays[2].data.epoch,2,'new life restarts source action IDs safely');
});

test('canonical receipts acknowledge late sparse action IDs independently of pose freshness without rewinding the actor',t=>{
  const f=fixture(t);f.start();
  const latest=f.report('a',240,{x:145});latest.actions=[encodeCriticalAction(latest,{id:101,frameSeq:240})];
  assert.deepEqual(f.submit('a',latest).consumedActionIds,[101]);
  const old=f.report('a',180,{x:900});old.actions=[encodeCriticalAction(old,{id:17,frameSeq:3})];
  const result=f.submit('a',old);assert.equal(result.ignored,'old-state');assert.deepEqual(result.consumedActionIds,[17]);
  assert.equal(f.sim.actor('a').x,145);assert.equal(f.driver.snapshot().ownership.actors.a.frameSeq,240);
  assert.deepEqual(f.events.filter(row=>row.type==='input').map(row=>row.data.actions[0].id),[101,17]);
  assert.deepEqual(f.submit('a',old).consumedActionIds,[17]);
  assert.equal(f.events.filter(row=>row.type==='input').length,2,'an exact consumed ID is idempotent even when lower than the high-water ID');
  const wrongLife={...old,epoch:0};assert.deepEqual(f.submit('a',wrongLife).consumedActionIds,[]);
});

test('authenticated service exposes only the driver-consumed canonical IDs in this input batch',async t=>{
  const f=fixture(t);let stamp=0;const factory=()=>f.driver;factory.ownership='local-owner-v1';
  const online=createOnlineService({driverFactory:factory,accountStore:{},versions:{reference:'fixture',preset:'fixture',program:'fixture'},now:()=>stamp,random:()=>.5});t.after(()=>online.close());
  for(const player of players)await online.join(player.id,'gm',{loadout:Array(8).fill(null)});stamp=11000;await online.tick();
  const match=online.status('a').match;f.start();const owner=f.report('a',180);
  owner.actions=[encodeCriticalAction(owner,{id:7,frameSeq:3}),encodeCriticalAction(owner,{id:91,frameSeq:6})];
  const result=online.submitInput('a',{matchId:match.id,sequence:0,frames:[{held:[],frameSeq:180}],owner});
  assert.deepEqual(result.consumedActionIds,[7,91]);
  const prior={...owner,epoch:0,frameSeq:183};
  const ignored=online.submitInput('a',{matchId:match.id,sequence:1,frames:[{held:[],frameSeq:183}],owner:prior});
  assert.equal(ignored.ignored,'old-life');assert.deepEqual(ignored.consumedActionIds,[]);
});

test('server fallback holds the source pose and room baseline until every bounded canonical prefix is consumed',t=>{
  const f=fixture(t);f.start();f.submit('a',f.report('a',3,{x:42}));f.events.length=0;
  const latest=f.report('a',240,{x:900}),actions=Array.from({length:40},(_,index)=>encodeCriticalAction(latest,{id:index+1,frameSeq:6+index*3}));
  for(const start of [0,16,32]){
    const complete=start===32,owner={...latest,actions:actions.slice(start,start+16),...(!complete?{actionFrontierComplete:false}:{})};
    const before=f.events.length,result=f.submit('a',owner);
    assert.deepEqual(result.consumedActionIds,owner.actions.map(action=>action.id));
    const emitted=f.events.slice(before);
    assert.deepEqual(emitted.map(event=>event.type),complete?['input','owned-state']:['input']);
    const state=f.driver.snapshot();assert.equal(state.snapshot.actors.find(actor=>actor.id==='a').x,complete?900:42);
    assert.equal(state.ownership.actors.a.frameSeq,complete?240:3);
    if(!complete){f.driver.tick(.1);assert.equal(f.events.at(-1).data.snapshot.actors.find(actor=>actor.id==='a').x,42);}
  }
  const events=f.events.filter(event=>event.type!=='state');
  assert.deepEqual(events.slice(0,3).flatMap(event=>event.data.actions.map(action=>action.id)),actions.map(action=>action.id));
  assert.equal(events.at(-1).data.report.frameSeq,240);
  const invalid={...latest,actionFrontierComplete:'false'};assert.throws(()=>f.submit('a',invalid),/invalid-owner-state/);
});

test('late sparse hit receipts settle exactly once independently of the replaceable pose and survive old-life rejection',t=>{
  const f=fixture(t);f.start();
  const latest=f.report('a',240,{x:145},[{id:101,attackerId:'c',damage:20}]);
  assert.deepEqual(f.submit('a',latest).consumedHitIds,[101]);
  const old=f.report('a',180,{x:900},[{id:17,attackerId:'d',damage:10}]);
  const result=f.submit('a',old);assert.equal(result.ignored,'old-state');assert.deepEqual(result.consumedHitIds,[17]);
  const player=()=>f.pvp.snapshot().players.find(player=>player.id==='a');
  assert.equal(player().damageBy.c,20);assert.equal(player().damageBy.d,10);assert.equal(f.sim.actor('a').x,145);
  assert.deepEqual(f.submit('a',old).consumedHitIds,[17]);assert.equal(player().damageBy.d,10);
  assert.deepEqual(f.submit('a',{...old,epoch:0}).consumedHitIds,[]);assert.equal(player().damageBy.d,10);
});

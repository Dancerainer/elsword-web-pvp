/** Web canonical admission and room lifecycle contracts; not native goldens. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {createRoomWorkerFactory} from '../../apps/server/room-worker-factory.mjs';
import {createOnlineService} from '../../packages/online/service.mjs';
import {OWNERSHIP_PROTOCOL,encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const players=['a','b','c','d'].map((id,index)=>({id,username:id,team:index<2?0:1,loadout:Array(8).fill(null)}));
const map={sceneId:'canonical-receipts-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
  starts:players.map((player,index)=>({index,kind:'SetTeamStartPos',teamFlag:player.team===0,position:[index*1000,0,0],lineId:0,facingRight:true}))};
const versions={referenceVersion:'fixture',presetVersion:'fixture',programVersion:'fixture'};
const config={loadout:Array(8).fill(null)};
function simulation(){return createSimulation({profile,map,actors:players.map((player,index)=>({...player,position:[index*1000,0,0]})),seed:16,versions});}
function report(frameSeq=240){return encodeOwnedState(simulation(),'a',{epoch:1,frameSeq});}
function body(matchId,sequence,owner){return {matchId,sequence,frames:[{held:[],frameSeq:owner.frameSeq}],owner};}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
async function service(t,{remote=false,submitInput}={}){
  let stamp=0;const requests=[];
  const factory=()=>({ownership:OWNERSHIP_PROTOCOL,...(remote?{inputValidation:'room-worker-v1'}:{}),
    submitInput(id,batch){requests.push({id,batch});return submitInput(id,batch);},stop(){}});
  factory.ownership=OWNERSHIP_PROTOCOL;
  const online=createOnlineService({driverFactory:factory,accountStore:{},versions:{fixture:true},now:()=>stamp,random:()=>.5});
  t.after(()=>online.close());for(const player of players)await online.join(player.id,'gm',config,'2v2');
  stamp=11000;await online.tick();return {online,requests,matchId:online.status('a').match.id};
}
function driver(t){
  const sim=simulation(),templates=structuredClone(sim.state.actors),events=[];
  const pvp=new PvpMatch({players,map,seed:16,versions,onRespawn(id){const index=sim.state.actors.findIndex(actor=>actor.id===id);
    sim.state.actors[index]=structuredClone(templates[index]);return sim.state.actors[index];}});
  const battle=createLocalOwnerBattleDriver({match:{id:'canonical-room',players},simulation:sim,pvp,manual:true,clock:()=>0,
    emit:(type,data)=>events.push({type,data}),finish(){}});
  t.after(()=>battle.stop());for(const player of players)battle.ready(player.id);battle.tick(10);
  const owned=(frameSeq,patch={},hits=[])=>{const value=encodeOwnedState(sim,'a',{epoch:battle.snapshot().ownership.actors.a.epoch,frameSeq});
    Object.assign(value.actor,patch);value.hits=hits;return value;};
  return {sim,pvp,battle,events,owned,submit:value=>battle.submitInput('a',{frames:[{held:[],frameSeq:value.frameSeq}],owner:value})};
}

test('service rejects malformed and foreign canonical receipts without consuming the legitimate request sequence',async t=>{
  let acknowledgement;const f=await service(t,{submitInput:()=>acknowledgement});
  const owner=report();owner.actions=[encodeCriticalAction(owner,{id:7,frameSeq:3}),encodeCriticalAction(owner,{id:91,frameSeq:6})];
  owner.hits=[{id:5,attackerId:'c',damage:20},{id:60,attackerId:'d',damage:10}];
  const invalid=[
    {consumedActionIds:[92]},{consumedActionIds:[7,7]},{consumedActionIds:'7'},
    {consumedActionIds:[-1]},{consumedActionIds:[7.5]},{consumedActionIds:Array(17).fill(7)},
    {consumedHitIds:[61]},{consumedHitIds:[5,5]},{consumedHitIds:'5'},
    {consumedHitIds:[-1]},{consumedHitIds:[5.5]},{consumedHitIds:Array(129).fill(5)},
  ];
  for(const value of invalid){acknowledgement={accepted:true,...value};assert.throws(()=>f.online.submitInput('a',body(f.matchId,0,owner)),/input-rejected/);}
  acknowledgement={accepted:true,consumedActionIds:[91],consumedHitIds:[5]};
  assert.deepEqual(f.online.submitInput('a',body(f.matchId,0,owner)),{accepted:true,sequence:0,consumedActionIds:[91],consumedHitIds:[5]});
  acknowledgement.consumedActionIds.push(7);acknowledgement.consumedHitIds.push(60);
  assert.throws(()=>f.online.submitInput('a',body(f.matchId,0,owner)),/input-sequence-rejected/);
});

test('an async worker receipt cannot borrow canonical IDs from another in-flight batch',async t=>{
  const pending=[];const f=await service(t,{remote:true,submitInput:()=>{const row=deferred();pending.push(row);return row.promise;}});
  const first=report(240),second=report(240);
  first.actions=[encodeCriticalAction(first,{id:7,frameSeq:3})];first.hits=[{id:5,attackerId:'c',damage:20}];
  second.actions=[encodeCriticalAction(second,{id:91,frameSeq:6})];second.hits=[{id:60,attackerId:'d',damage:10}];
  const a=f.online.submitInput('a',body(f.matchId,0,first)),b=f.online.submitInput('a',body(f.matchId,1,second));
  pending[0].resolve({accepted:true,consumedActionIds:[91],consumedHitIds:[60]});await assert.rejects(a,/input-rejected/);
  pending[1].resolve({accepted:true,consumedActionIds:[91],consumedHitIds:[60]});
  assert.deepEqual(await b,{accepted:true,sequence:1,consumedActionIds:[91],consumedHitIds:[60]});
});

test('async canonical confirmation uses the submitted batch snapshot despite later caller mutation',async t=>{
  const pending=deferred();let count=0;const f=await service(t,{remote:true,submitInput:()=>count++===0?pending.promise:Promise.resolve({accepted:true,consumedActionIds:[],consumedHitIds:[]})});
  const owner=report();owner.actions=[encodeCriticalAction(owner,{id:7,frameSeq:3})];owner.hits=[{id:5,attackerId:'c',damage:20}];
  const request=body(f.matchId,0,owner),result=f.online.submitInput('a',request);
  request.sequence=100;request.frames[0].frameSeq=900;owner.actions[0].id=91;owner.hits[0].id=60;
  pending.resolve({accepted:true,consumedActionIds:[7],consumedHitIds:[5]});
  assert.deepEqual(await result,{accepted:true,sequence:0,consumedActionIds:[7],consumedHitIds:[5]});
  const next=report(243);assert.deepEqual(await f.online.submitInput('a',body(f.matchId,1,next)),
    {accepted:true,sequence:1,consumedActionIds:[],consumedHitIds:[]},'mutated sequence cannot retire a later valid request');
});

test('async foreign receipts cannot be laundered by changing pending owner IDs',async t=>{
  const pending=deferred();const f=await service(t,{remote:true,submitInput:()=>pending.promise});
  const owner=report();owner.actions=[encodeCriticalAction(owner,{id:7,frameSeq:3})];owner.hits=[{id:5,attackerId:'c',damage:20}];
  const result=f.online.submitInput('a',body(f.matchId,0,owner));owner.actions[0].id=91;owner.hits[0].id=60;
  pending.resolve({accepted:true,consumedActionIds:[91],consumedHitIds:[60]});await assert.rejects(result,/input-rejected/);
});

test('late sparse damage preserves the newest final attacker and resulting kill credit',t=>{
  const f=driver(t),latest=f.owned(240,{x:145},[{id:101,attackerId:'c',damage:20}]);f.submit(latest);
  const older=f.owned(180,{x:900},[{id:17,attackerId:'d',damage:10}]);
  assert.deepEqual(f.submit(older).consumedHitIds,[17]);
  const victim=()=>f.pvp.snapshot().players.find(player=>player.id==='a');
  assert.deepEqual(victim().damageBy,{c:20,d:10});assert.equal(victim().lastAttackerId,'c');
  assert.equal(f.sim.actor('a').x,145);assert.equal(f.battle.snapshot().ownership.actors.a.frameSeq,240);
  f.submit(f.owned(243,{hp:0,deathComplete:true}));f.battle.tick(.1);
  assert.equal(f.pvp.snapshot().players.find(player=>player.id==='c').kills,1);
  assert.equal(f.pvp.snapshot().players.find(player=>player.id==='d').kills,0);
  assert.deepEqual(f.submit(older).consumedHitIds,[17],'a repeated consumed receipt remains acknowledged while its corpse is fading');
});

test('source hit ordering ignores rejected high IDs and resets its frontier at a new server-issued life',t=>{
  const f=driver(t);
  const owner=f.owned(240,{},[{id:101,attackerId:'c',damage:20},{id:17,attackerId:'d',damage:10},{id:999,attackerId:'b',damage:1}]);
  assert.deepEqual(f.submit(owner).consumedHitIds,[101,17,999]);
  assert.equal(f.pvp.snapshot().players.find(player=>player.id==='a').lastAttackerId,'c','wire array order and a friendly forged high ID cannot select the final attacker');
  f.submit(f.owned(243,{},[{id:102,attackerId:'d',damage:10}]));
  assert.equal(f.pvp.snapshot().players.find(player=>player.id==='a').lastAttackerId,'d','a rejected high ID cannot suppress a later valid final attacker');
  f.submit(f.owned(246,{hp:0,deathComplete:true}));f.battle.tick(.1);f.battle.tick(12);f.battle.tick(6);
  assert.equal(f.battle.snapshot().ownership.actors.a.epoch,2);
  const next=f.owned(249,{},[{id:1,attackerId:'c',damage:20}]);assert.deepEqual(f.submit(next).consumedHitIds,[1]);
  assert.equal(f.pvp.snapshot().players.find(player=>player.id==='a').lastAttackerId,'c');
  assert.deepEqual(f.submit({...owner,frameSeq:252}).consumedHitIds,[],'old-life canonical IDs cannot enter the new frontier');
});

test('slow-phase trade receipts remain consumable while new attack actions and corpse resurrection remain locked',t=>{
  const f=driver(t);f.pvp.state.score=[3,3];
  const c=encodeOwnedState(f.sim,'c',{epoch:1,frameSeq:3});c.actor.hp=0;c.actor.deathComplete=false;
  f.battle.submitInput('c',{frames:[{held:[],frameSeq:3}],owner:c});f.battle.tick(.1);assert.equal(f.pvp.snapshot().phase,'slow');
  const owner=f.owned(6,{hp:0,deathComplete:false},[{id:1,attackerId:'c',damage:20}]);owner.actions=[encodeCriticalAction(owner,{id:7,frameSeq:6})];
  const result=f.submit(owner);assert.deepEqual(result.consumedHitIds,[1]);assert.deepEqual(result.consumedActionIds,[7]);
  assert.equal(f.events.some(event=>event.type==='input'&&event.data.actions.some(action=>action.id===7)),false,'a retired slow-phase action is acknowledged without executing or relaying it');
  f.battle.tick(.1);assert.deepEqual(f.pvp.snapshot().score,[4,4]);
  const corpse=f.owned(9,{hp:100,hidden:true,deathComplete:true},[{id:2,attackerId:'d',damage:10}]);
  assert.deepEqual(f.submit(corpse).consumedHitIds,[2]);assert.equal(f.sim.actor('a').hp,0);
});

test('previously unseen same-life corpse hits are retired idempotently without damage or credit and cannot enter the next life',t=>{
  const f=driver(t);f.submit(f.owned(3,{hp:0,deathComplete:false},[{id:101,attackerId:'c',damage:20}]));f.battle.tick(.1);
  const victim=()=>f.pvp.snapshot().players.find(player=>player.id==='a');assert.equal(victim().alive,false);
  const before=structuredClone(victim());let calls=0;const recordHit=f.pvp.recordHit;
  f.pvp.recordHit=function(value){calls++;return recordHit.call(this,value);};
  const late=f.owned(6,{hp:100,hidden:true,deathComplete:true},[{id:17,attackerId:'d',damage:10},{id:999,attackerId:'c',damage:100}]);
  assert.deepEqual(f.submit(late).consumedHitIds,[17,999]);assert.deepEqual(f.submit(late).consumedHitIds,[17,999]);
  assert.equal(calls,0,'dead-owner retirement must never call the contribution/final-attacker consumer');
  assert.deepEqual(victim().damageBy,before.damageBy);assert.equal(victim().lastAttackerId,before.lastAttackerId);
  assert.equal(victim().lastHitSequence,before.lastHitSequence);assert.equal(f.sim.actor('a').hp,0);
  assert.equal(f.sim.actor('a').hidden,true);assert.equal(f.sim.actor('a').deathComplete,true);
  f.battle.tick(12);f.battle.tick(6);assert.equal(f.battle.snapshot().ownership.actors.a.epoch,2);
  assert.deepEqual(f.submit({...late,frameSeq:240}).consumedHitIds,[]);assert.equal(calls,0,'old-life retirement cannot record damage after respawn');
  const next=f.owned(243,{},[{id:17,attackerId:'c',damage:30}]);
  assert.deepEqual(f.submit(next).consumedHitIds,[17]);assert.equal(calls,1,'a reused ID in the new server-issued life remains independently consumable');
  assert.deepEqual(victim().damageBy,{c:30});assert.equal(victim().lastAttackerId,'c');
});

test('an incomplete action frontier cannot indefinitely prevent a dead owner finishing its corpse fade in slow phase',t=>{
  const f=driver(t);f.pvp.state.score=[3,3];
  f.submit(f.owned(3,{x:145,hp:0,deathComplete:false}));f.battle.tick(.1);
  assert.equal(f.pvp.snapshot().phase,'slow');
  const latest=f.owned(240,{x:900,hp:0,hidden:true,deathComplete:true});
  let pending=Array.from({length:40},(_,index)=>encodeCriticalAction(latest,{id:index+1,frameSeq:6+index*3}));
  const before=f.events.length;
  for(let attempt=0;attempt<3&&pending.length;attempt++){
    const incomplete=pending.length>16,owner={...latest,actions:pending.slice(0,16),...(incomplete?{actionFrontierComplete:false}:{})};
    const ack=f.submit(owner),consumed=new Set(ack.consumedActionIds);pending=pending.filter(action=>!consumed.has(action.id));
    if(incomplete)assert.equal(f.sim.actor('a').x,145,'an incomplete critical prefix must not publish its newer geometry');
    if(f.sim.actor('a').hidden&&f.sim.actor('a').deathComplete)break;
  }
  assert.equal(f.sim.actor('a').hp,0);
  assert.equal(f.sim.actor('a').hidden,true,'locked combat admission must either retire its obsolete prefix or admit the authoritative corpse lifecycle');
  assert.equal(f.sim.actor('a').deathComplete,true);
  assert.equal(f.events.slice(before).filter(event=>event.type==='input').length,0,'discarded dead-owner combat cannot be relayed as a new attack');
  f.battle.tick(2);assert.equal(f.pvp.snapshot().phase,'result','the pending end can finish after its corpse fades');
});

test('temporary respawn lock retains pending actions and its incomplete pose without weakening new-life invulnerability',t=>{
  const f=driver(t);f.submit(f.owned(3,{hp:0,deathComplete:true}));f.battle.tick(.1);f.battle.tick(12);
  const before={x:f.sim.actor('a').x,hp:f.sim.actor('a').hp};assert.equal(f.battle.snapshot().ownership.actors.a.epoch,2);
  const owner=f.owned(240,{x:900,hp:0});owner.actions=[encodeCriticalAction(owner,{id:7,frameSeq:240})];owner.actionFrontierComplete=false;
  assert.deepEqual(f.submit(owner).consumedActionIds,[],'a living temporary input lock cannot permanently retire pending combat');
  assert.deepEqual({x:f.sim.actor('a').x,hp:f.sim.actor('a').hp},before);
  f.battle.tick(2);assert.deepEqual(f.submit(owner).consumedActionIds,[7]);
  assert.deepEqual({x:f.sim.actor('a').x,hp:f.sim.actor('a').hp},before,'consuming an incomplete prefix still holds its latest pose');
  assert.deepEqual(f.submit({...owner,actionFrontierComplete:true}).consumedActionIds,[7]);
  assert.equal(f.sim.actor('a').hp,before.hp,'closing its source frontier cannot forge a death during respawn invulnerability');
  assert.equal(f.pvp.snapshot().players.find(player=>player.id==='a').alive,true);
  assert.equal(f.events.filter(event=>event.type==='input'&&event.data.actions.some(action=>action.id===7)).length,1);
});

test('real worker IPC retains bounded 16+16+8 canonical receipts at one source frame before publishing its complete pose',async t=>{
  // Replace only the factory's asset-loading boundary; run production worker
  // IPC, service admission, pure combat state and local-owner driver together.
  const directory=await mkdtemp(path.join(tmpdir(),'canonical-receipts-v6-'));
  assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const fixture=path.join(directory,'driver.mjs'),entry=path.join(directory,'entry.mjs');
  const url=relative=>new URL(relative,new URL('../../',import.meta.url)).href;
  await writeFile(fixture,`
import {readFileSync} from 'node:fs';
import {createSimulation} from ${JSON.stringify(url('packages/combat-core/index.mjs'))};
import {PvpMatch} from ${JSON.stringify(url('packages/pvp/index.mjs'))};
import {createLocalOwnerBattleDriver} from ${JSON.stringify(url('apps/server/local-owner-driver.mjs'))};
const profile=JSON.parse(readFileSync(new URL(${JSON.stringify(url('packages/combat-core/rf-profile.json'))})));
const map=${JSON.stringify(map)},versions=${JSON.stringify(versions)};
export async function createBattleDriverFactory(){return args=>{
  const players=args.match.players,sim=createSimulation({profile,map,actors:players.map((p,i)=>({...p,position:[i*1000,0,0]})),seed:16,versions});
  const pvp=new PvpMatch({players,map,seed:16,versions});
  const driver=createLocalOwnerBattleDriver({...args,simulation:sim,pvp,manual:true});
  for(const p of players)driver.ready(p.id);driver.tick(10);return driver;
};}
`);
  const productionEntry=url('apps/server/room-worker-entry.mjs');
  await writeFile(entry,`
import {registerHooks} from 'node:module';
const entry=${JSON.stringify(productionEntry)};
registerHooks({resolve(specifier,context,nextResolve){
  if(context.parentURL===entry&&specifier==='./battle-driver.mjs')return {url:${JSON.stringify(pathToFileURL(fixture).href)},shortCircuit:true};
  return nextResolve(specifier,context);
}});
await import(entry);
`);
  const metadataFactory=Object.assign(()=>{}, {ownership:OWNERSHIP_PROTOCOL,professions:{RF:true},versions:{fixture:true}});
  const factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry:entry});
  let stamp=0;const events=[];
  const online=createOnlineService({driverFactory:factory,accountStore:{},versions:{fixture:true},now:()=>stamp,random:()=>.5,
    emit:(id,type,data)=>events.push({id,type,data})});t.after(()=>online.close());
  for(const player of players)await online.join(player.id,'gm',config,'2v2');stamp=11000;await online.tick();
  const matchId=online.status('a').match.id,baseline=report(3);baseline.actor.x=42;
  assert.deepEqual(await online.submitInput('a',body(matchId,0,baseline)),{accepted:true,sequence:0,consumedActionIds:[],consumedHitIds:[]});
  const latest=report(240);latest.actor.x=900;
  const actions=Array.from({length:40},(_,index)=>encodeCriticalAction(latest,{id:index+1,frameSeq:6+index*3}));
  const acknowledgements=[];
  for(const [index,start]of [0,16,32].entries()){
    const owner={...latest,actions:actions.slice(start,start+16),...(start<32?{actionFrontierComplete:false}:{})};
    const ack=await online.submitInput('a',body(matchId,index+1,owner));acknowledgements.push(...ack.consumedActionIds);
    assert.deepEqual(ack.consumedActionIds,owner.actions.map(action=>action.id));
    const poses=events.filter(event=>event.type==='owned-state'&&event.data.playerId==='a');
    assert.equal(poses.filter(event=>event.data.report.frameSeq===240).length,start===32?3:0,'the completed owner pose is broadcast only after the final prefix to the three other players');
    if(start<32)assert.equal(ack.ignored,'actions-pending');
  }
  assert.deepEqual(acknowledgements,Array.from({length:40},(_,index)=>index+1));
  const delivered=events.filter(event=>event.id==='b'&&event.type==='input').flatMap(event=>event.data.actions.map(action=>action.id));
  assert.deepEqual(delivered,acknowledgements);
  const ordered=events.filter(event=>event.id==='b'&&['input','owned-state'].includes(event.type));
  assert.deepEqual(ordered.map(event=>event.type),['owned-state','input','input','input','owned-state']);
});

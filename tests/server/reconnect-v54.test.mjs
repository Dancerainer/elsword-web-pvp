/** User-requested Web reconnect lifecycle; no native-client golden claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PvpMatch,RECONNECT_GRACE_SECONDS} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createOnlineService} from '../../packages/online/service.mjs';
import {encodeOwnedState,OWNERSHIP_PROTOCOL} from '../../packages/online/owned-state.mjs';
import {npcHitTargets,applyAddSummonDamage} from '../../packages/combat-core/add-summons.mjs';
import {prismHitTargets,applyAddPrismEndpointDamage,tickAddPrismEndpoints} from '../../packages/combat-core/add-prism-endpoints-2016.mjs';
import {tickAddCountdownShake} from '../../packages/combat-core/add-countdown-shake-2016.mjs';
import {createBuffFromFactor,consumeBuffHit,tickBuffs} from '../../packages/combat-core/buffs.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
function room(t,mode='1v1',capabilities={},advanceIntro=true){
 const count=mode==='1v1'?2:4,players=Array.from({length:count},(_,i)=>({id:String.fromCharCode(97+i),username:String.fromCharCode(97+i),team:i<count/2?0:1,loadout:Array(8).fill(null)}));
 const map={sceneId:'reconnect-v54',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
  starts:players.map((p,i)=>({index:i,kind:'SetTeamStartPos',teamFlag:p.team===0,position:[i*1000,0,0],lineId:0,facingRight:true}))};
 const create=()=>createSimulation({profile,map,actors:players.map((p,i)=>({...p,position:[i*1000,0,0]})),seed:54,
  versions:{referenceVersion:'fixture',presetVersion:'fixture',programVersion:'v54-test'}});
 const simulation=create(),templates=structuredClone(simulation.state.actors),events=[],results=[];
 const pvp=new PvpMatch({players,map,mode,seed:54,versions:simulation.versions,onRespawn(id){const i=simulation.state.actors.findIndex(a=>a.id===id);return simulation.state.actors[i]=structuredClone(templates[i]);}});
 const driver=createLocalOwnerBattleDriver({match:{id:'reconnect-v54',players,...capabilities},simulation,pvp,manual:true,clock:()=>0,
  emit:(type,data)=>events.push({type,data}),finish:value=>results.push(value)});
 t.after(()=>driver.stop());for(const p of players)driver.ready(p.id);if(advanceIntro)driver.tick(10);
 return {driver,simulation,pvp,events,results,players,create};
}
test('confirmed 1v1 absence removes targeting immediately, preserves snapshot, and reenters a new protected life',t=>{
 const f=room(t),a=f.simulation.actor('a');a.x=345;a.hp=12345;a.mp=71;a.cooldowns.fixture=8;a.awakening.orbs=2;
 a.awakening.remaining=10;Object.assign(a.core,{phase:'prepare',targetId:'b',gauge:90,level:3});
 a.sourceStopQueues={hit:[{remaining:9,sourceId:'b'}],world:[{remaining:10,sourceId:'b'}]};
 const before=f.driver.snapshot(),old=encodeOwnedState(f.simulation,'a',{epoch:before.ownership.actors.a.epoch,frameSeq:20});
 f.simulation.state.effects.push({id:1,ownerId:'a',active:true,name:'fixture'});
 f.driver.disconnect('a',{recoverable:true});
 assert.equal(f.pvp.state.phase,'fight');assert.equal(f.simulation.actor('a').hidden,true);assert.equal(f.simulation.actor('a').pvpDisconnected,true);
 assert.equal(f.simulation.state.effects.length,0);assert.equal(f.pvp.recordHit({attackerId:'b',targetId:'a',damage:10}),false);
 assert.deepEqual(f.pvp.state.score,[0,0]);assert.equal(f.pvp.player('a').deaths,0);
 assert.equal(f.driver.submitInput('a',{frames:[{held:['X'],frameSeq:20}],owner:old}).accepted,false);
 f.driver.tick(6);assert.equal(f.driver.reconnect('a').resumed,true);
 const restored=f.simulation.actor('a'),after=f.driver.snapshot();
 assert.equal(restored.x,345);assert.equal(restored.hp,12345);assert.equal(restored.mp,71);assert.equal(restored.cooldowns.fixture,8);
 assert.equal(restored.awakening.orbs,2);assert.equal(restored.hidden,false);assert.equal(restored.pvpDisconnected,false);
 assert.equal(restored.core.phase,'idle');assert.equal(restored.core.targetId,null);assert.equal(restored.core.gauge,90);
 assert.equal(restored.sourceStopQueues,undefined,'old V53 STOP requests cannot resume after the new life starts');
 assert.equal(restored.forceInvincible,5);assert.ok(Math.abs(restored.inputLock-f.pvp.rules.respawnLock)<1e-12);
 assert.equal(after.ownership.actors.a.epoch,before.ownership.actors.a.epoch+1);assert.equal(after.ownership.actors.a.frameSeq,0);
 assert.equal(f.driver.submitInput('a',{frames:[{held:['X'],frameSeq:20}],owner:old}).ignored,'old-life');
 f.driver.tick(5.01);assert.equal(f.pvp.player('a').invincibleUntil,null);assert.equal(f.simulation.actor('a').forceInvincible,0);
});
test('intro absence preserves its seat and opening sequence; protection starts at actual restore and grace includes intro elapsed',t=>{
 const f=room(t,'1v1',{},false),original=f.driver.snapshot();assert.equal(f.pvp.state.phase,'intro');
 f.driver.disconnect('a',{recoverable:true});assert.equal(f.pvp.state.phase,'intro');assert.equal(f.simulation.actor('a').hidden,true);
 assert.equal(f.driver.reconnect('a').resumed,true);assert.equal(f.simulation.actor('a').pvpPresentation.state,f.pvp.player('a').pose.state);
 assert.equal(f.simulation.actor('a').forceInvincible,5);const duration=f.pvp.introDuration;
 f.driver.tick(duration);assert.equal(f.pvp.state.phase,'fight');
 assert.ok(Math.abs(f.simulation.actor('a').forceInvincible-Math.max(0,5-duration))<1e-12);
 assert.equal(f.driver.snapshot().ownership.actors.a.epoch,original.ownership.actors.a.epoch+1);
 assert.equal(f.events.flatMap(row=>row.data.events??[]).filter(row=>row.type==='fight-start').length,1);
 const g=room(t,'1v1',{},false),before=g.simulation.actor('a');before.x=321;before.mp=67;
 g.driver.disconnect('a',{recoverable:true});g.driver.tick(g.pvp.introDuration);g.driver.tick(6);
 assert.equal(g.pvp.state.phase,'fight');assert.equal(g.simulation.actor('a').hidden,true);assert.deepEqual(g.pvp.state.score,[0,0]);
 assert.equal(g.driver.reconnect('a').resumed,true);const restored=g.simulation.actor('a');
 assert.equal(restored.x,321);assert.equal(restored.mp,67);assert.equal(restored.forceInvincible,5);
 const h=room(t,'1v1',{},false);h.driver.disconnect('a',{recoverable:true});h.driver.tick(h.pvp.introDuration);
 h.driver.tick(RECONNECT_GRACE_SECONDS-h.pvp.introDuration);assert.equal(h.pvp.state.phase,'slow');
 assert.equal(h.driver.reconnect('a').resumed,false);
});
test('client disconnect tombstone only clears for a newer connected room life; delayed old room state cannot remove restored actor',t=>{
 const f=room(t),peer=f.create(),sync=createLocalOwnershipSync(),before=f.driver.snapshot();sync.reconcile(peer,before,'b');
 f.driver.disconnect('a',{recoverable:true});const missing=f.driver.snapshot();sync.reconcile(peer,missing,'b');
 sync.reconcile(peer,before,'b');assert.equal(peer.actor('a').pvpDisconnected,true);
 f.driver.reconnect('a');sync.reconcile(peer,f.driver.snapshot(),'b');assert.equal(peer.actor('a').pvpDisconnected,false);assert.equal(peer.actor('a').hp>0,true);
 sync.reconcile(peer,missing,'b');assert.equal(peer.actor('a').pvpDisconnected,false);
});
test('disconnect received before first room seed records its epoch and cannot be undone by that same life',t=>{
 const f=room(t),peer=f.create(),sync=createLocalOwnershipSync(),before=f.driver.snapshot();
 sync.disconnect(peer,'a',before.ownership.actors.a.epoch);sync.reconcile(peer,before,'b');assert.equal(peer.actor('a').pvpDisconnected,true);
 f.driver.disconnect('a',{recoverable:true});f.driver.reconnect('a');sync.reconcile(peer,f.driver.snapshot(),'b');
 assert.equal(peer.actor('a').pvpDisconnected,false);sync.disconnect(peer,'a',before.ownership.actors.a.epoch);
 assert.equal(peer.actor('a').pvpDisconnected,false);
});
test('reconnect grace expires into normal result, and independent timeout wins over saved snapshot',t=>{
 const f=room(t);f.driver.disconnect('a',{recoverable:true});f.driver.tick(RECONNECT_GRACE_SECONDS);
 assert.equal(f.pvp.state.phase,'slow');assert.equal(f.driver.reconnect('a').resumed,false);
 f.driver.tick(2);assert.equal(f.results.length,1);assert.equal(f.results[0].winnerTeam,1);
 const g=room(t);g.driver.disconnect('a',{recoverable:true});g.pvp.state.remaining=.01;g.pvp.state.fightTime=g.pvp.rules.duration-.01;
 g.driver.tick(.02);assert.equal(g.pvp.state.phase,'slow');assert.equal(g.driver.reconnect('a').resumed,false);
});
test('dead 2v2 reconnect keeps death and respawn deadline, never grants a free living body',t=>{
 const f=room(t,'2v2');f.simulation.actor('a').hp=0;f.simulation.actor('a').mp=73;f.simulation.actor('a').deathComplete=true;f.driver.tick(.1);
 const deadline=f.pvp.player('a').respawnAt;assert.equal(f.pvp.player('a').alive,false);
 f.driver.disconnect('a',{recoverable:true});f.driver.tick(1);assert.equal(f.driver.reconnect('a').resumed,true);
 assert.equal(f.simulation.actor('a').hp,0);assert.equal(f.pvp.player('a').alive,false);assert.equal(f.pvp.player('a').respawnAt,deadline);
 assert.equal(f.simulation.actor('a').mp,73,'dead rejoin must not reset stored MP to a clean template value');
 assert.equal(f.pvp.player('a').invincibleUntil,null);
});
test('disconnected identity cannot run actor callbacks, Buff clocks or core helpers in positive combat steps',t=>{
 const f=room(t),a=f.simulation.actor('a');a.cooldowns.fixture=7;f.driver.disconnect('a',{recoverable:true});
 let actorTicks=0,coreTicks=0;const tick=f.simulation.tickActor.bind(f.simulation),core=f.simulation.tickCore.bind(f.simulation);
 f.simulation.tickActor=(actor,...args)=>{if(actor.id==='a')actorTicks++;return tick(actor,...args);};
 f.simulation.tickCore=(actor,...args)=>{if(actor.id==='a')coreTicks++;return core(actor,...args);};
 f.simulation.step(1/60,{});assert.equal(actorTicks,0);assert.equal(coreTicks,0);assert.equal(a.cooldowns.fixture,7);
 a.sourceAddSummon={hp:100,serial:4,state:'APOCALYPSE_WAIT'};
 assert.deepEqual(npcHitTargets(f.simulation),[],'a disconnected owner NPC cannot be a resource-farming target');
 assert.equal(applyAddSummonDamage(f.simulation,{sourceSummonOwnerId:'a',sourceSummonSerial:4},10),false);
});
test('V53 Prism and Countdown helpers cannot target, tick or carry effects through confirmed absence',t=>{
 const f=room(t),a=f.simulation.actor('a');f.driver.disconnect('a',{recoverable:true});
 const npc={id:1,npcId:1576,hp:100,state:'WAIT',animationTime:0,elapsed:0};a.sourceAddPrismEndpoints=[npc];
 assert.deepEqual(prismHitTargets(f.simulation),[]);assert.equal(applyAddPrismEndpointDamage(f.simulation,a,1,10),false);
 tickAddPrismEndpoints(f.simulation,a,1/60);assert.equal(npc.hp,100);assert.equal(npc.animationTime,0);
 const rows=[{ownerId:'a',sourceAddCountdownShake:{group:1,count:0,targetId:'b'}},
  {ownerId:'b',sourceAddCountdownShake:{group:2,count:0,targetId:'a'}}];
 f.simulation.state.effects=rows;tickAddCountdownShake(f.simulation);
 for(const e of rows){assert.equal(e.dead,true);assert.equal(e.suppressSecondaryDamage,true);assert.equal(e.endReason,'network-disconnected');}
});
test('reconnect preserves independently accepted Buff counters while holding its uncommitted position and vitals',t=>{
 // Authored RF 437/408 plus a lightweight numeric bridge; this verifies Web
 // lifecycle integration, not a native-client behavioral golden or WAN result.
 const f=room(t,'1v1',{ownerStatusVersion:1}),a=f.simulation.actor('a'),float=Math.fround;
 const nativeValues={buffFixed:(value,resistance)=>float(float(value)*float(1-resistance)),
  buffRelation:(attack,multiplier,resistance)=>float(float(float(attack)*float(multiplier))*float(1-resistance)),
  buffPercent:(value,resistance)=>float(float(value)*float(1-resistance)),
  buffInterval:(sum,interval,elapsed)=>({sum:float(sum+elapsed),triggered:false})};
 const owner={...structuredClone(a),sourceHitCountByte:70,buffResistances:{0:0,1:0},debuffDurationMultiplier:1};
 const made=createBuffFromFactor(profile,{factor:437,sourceActor:owner,targetActor:owner,roll:0,nativeValues});
 assert.equal(made.supported,true,JSON.stringify(made.unsupported));owner.sourceHitCountByte=71;
 const buffs=consumeBuffHit(profile,[made.buff],{targetActor:owner}).buffs;
 const report=encodeOwnedState(f.simulation,'a',{epoch:f.driver.snapshot().ownership.actors.a.epoch,frameSeq:9});
 Object.assign(report.actor,{buffs,sourceHitCountByte:71,x:a.x+999,hp:a.hp-100,mp:a.mp+20,sourceStatusClock:{version:1,revision:1,frameSeq:9}});
 report.actionFrontierComplete=false;const before={x:a.x,hp:a.hp,mp:a.mp};
 assert.equal(f.driver.submitInput('a',{frames:[{held:[],frameSeq:9}],owner:report}).ignored,'actions-pending');
 assert.deepEqual(a.buffs,[]);assert.equal(a.sourceHitCountByte,0);
 f.driver.disconnect('a',{recoverable:true});f.driver.tick(6);assert.equal(f.driver.reconnect('a').resumed,true);
 const restored=f.simulation.actor('a');assert.deepEqual({x:restored.x,hp:restored.hp,mp:restored.mp},before);
 assert.deepEqual(restored.buffs,buffs);assert.equal(restored.sourceHitCountByte,71);
 assert.equal(restored.stats.criticalRate,100);
 const next=tickBuffs(profile,restored.buffs,1/60,{targetActor:restored,nativeValues});
 assert.equal(next.buffs[0].finalizers.find(row=>row.kind==='hit').remaining,2,'the byte baseline must not gain 71 extra hits on rejoin');
});
function service(t){
 let clock=0;const events=[],drivers=[];
 const factory=Object.assign(args=>{const driver={...args,ownership:OWNERSHIP_PROTOCOL,inputs:[],
  submitInput(id,value){this.inputs.push(value);return {accepted:true};},disconnect(){},reconnect(){return {resumed:true,epoch:2};},stop(){},snapshot(){return {pvp:{phase:'fight'}};}};
  drivers.push(driver);return driver;},{ownership:OWNERSHIP_PROTOCOL});
 const online=createOnlineService({driverFactory:factory,now:()=>clock,random:()=>.5,versions:{fixture:'v54'},
  emit:(username,type,data)=>events.push({username,type,data}),accountStore:{recordMatch:async(match,result)=>({recorded:true,result:{...result,finishedAt:clock}})}});
 t.after(()=>online.close());return {online,drivers,events,async start(){for(const id of ['a','b','c','d'])await online.join(id,'gm',{loadout:Array(8).fill(null),branchChoices:{},keyBindings:{schemaVersion:1,bindings:{up:'ArrowUp'}}});
  clock=11000;await online.tick();drivers[0].emit('state',{pvp:{phase:'fight'}});return drivers[0];}};
}
test('service reserves disconnected seat and blocks uploads until the worker restores it; terminal recovery routes lobby',async t=>{
 const f=service(t),driver=await f.start(),matchId=driver.match.id;
 assert.equal(f.online.disconnect('a','network',{recoverable:true}).recoverable,true);
 assert.equal(f.online.status('a').match.id,matchId);
 assert.throws(()=>f.online.submitInput('a',{matchId,sequence:1,frames:[{held:[]}]}),/match-not-active/);
 assert.equal((await f.online.reconnect('a')).resumed,true);assert.equal(f.online.status('a').match.players.find(p=>p.id==='a').connected,true);
 f.online.disconnect('a','network',{recoverable:true});await driver.finish({winnerTeam:1,players:[]});
 assert.equal((await f.online.reconnect('a')).ended,true);assert.equal(f.online.status('a').match,null);
 assert.equal(f.events.filter(e=>e.username==='a'&&e.type==='reconnect-ended').length,1);
});
test('settlement racing asynchronous reconnect takes precedence over worker success',async t=>{
 const f=service(t),driver=await f.start();let release,started;
 const inFlight=new Promise(resolve=>started=resolve);driver.reconnect=()=>{started();return new Promise(resolve=>release=resolve);};
 f.online.disconnect('a','network',{recoverable:true});const reconnect=f.online.reconnect('a');await inFlight;
 await driver.finish({winnerTeam:1,players:[]});release({resumed:true,epoch:2});
 assert.equal((await reconnect).ended,true);assert.equal(f.online.status('a').match,null);
});
test('a new page remains absent until ready and match finishing during preparation returns ended without restoration',async t=>{
 const f=service(t),driver=await f.start(),matchId=driver.match.id;let restores=0;driver.reconnect=()=>{restores++;return {resumed:true,epoch:2};};
 f.online.disconnect('a','network',{recoverable:true});
 assert.equal((await f.online.reconnect('a',{deferUntilReady:true})).pending,true);
 assert.equal((await f.online.reconnect('a',{deferUntilReady:true})).pending,true);assert.equal(restores,0);
 assert.equal(f.online.status('a').match.players.find(p=>p.id==='a').connected,false);
 assert.equal(f.online.loadingProgress('a',{matchId,percent:80}).ok,true);
 await driver.finish({winnerTeam:1,players:[]});assert.equal(f.online.status('a').lastResult,null);
 assert.deepEqual(await f.online.ready('a',matchId),{ok:false,ended:true,matchId});assert.equal(restores,0);
});

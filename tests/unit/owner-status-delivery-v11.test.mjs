/** Actual owner sync / online transport with controlled delivery order.
 * Numeric Buff construction is the same explicit bridge as the clock tests;
 * these are Web regressions, not Native/WAN latency measurements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createBuffFromFactor} from '../../packages/combat-core/buffs.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {encodeOwnedState,encodeOwnedStatusSource,encodeCriticalAction,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {createOwnerStatusClock,decodeOwnerStatusClock} from '../../packages/online/owner-status-clock.mjs';
import {encodeOwnedStatus} from '../../packages/online/owned-status.mjs';
import {createOwnerBuffSender,decodeOwnerBuffProtection} from '../../packages/online/owner-buff-sync.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const crossProfiles={RF:profile,...Object.fromEntries(['LK','GM'].map(id=>[id,JSON.parse(readFileSync(
  new URL(`../../packages/combat-core/${id.toLowerCase()}-profile.json`,import.meta.url)))]))};
const map={sceneId:'owner-status-delivery-v11',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const ids=['a','b','c','d'];
const input={held:[],pressed:[],released:[]},f=Math.fround;
const nativeValues={buffFixed:(value,resistance)=>f(f(value)*f(1-resistance)),
  buffRelation:(attack,multiplier,resistance)=>f(f(f(attack)*f(multiplier))*f(1-resistance)),
  buffPercent:(value,resistance)=>f(f(value)*f(1-resistance)),
  buffInterval(sum,interval,elapsed){const next=f(f(sum)+f(elapsed));return next>=f(interval)?{sum:0,triggered:true}:{sum:next,triggered:false};}};
const make=owner=>createSimulation({profile,map,networkOwnerId:owner,seed:2016,
  preset:{buffResistances:{0:0,1:0,2:0,3:0,4:0,5:0,6:0},debuffDurationMultiplier:1},actors:ids.map((id,index)=>({
  id,professionId:'RF',team:index%2,position:[index*2000,0,0],lineId:0,loadout:Array(8).fill(null)}))});
const room=(sim,version=1,epoch=3)=>({snapshot:sim.snapshot(),ownership:{mode:'local-owner-v1',ownerStatusVersion:version,
  actors:Object.fromEntries(ids.map(id=>[id,{epoch,frameSeq:0}]))},owners:{}});
function makeBuff(sim,id){
  const actor=sim.actor(id),result=createBuffFromFactor(profile,{factor:42,sourceActor:actor,targetActor:actor,roll:0,nativeValues});
  assert.equal(result.supported,true,JSON.stringify(result.unsupported));assert.equal(result.accepted,true);return result.buff;
}
function sender(id='b',version=1){
  const sim=make(id),sync=createLocalOwnershipSync({ownerStatusVersion:version,clock:()=>0});sync.reconcile(sim,room(sim,version),id);
  return {sim,sync,step(events=[]){return sync.afterStep(sim,id,events);}};
}
function recipient(version=1){
  const sim=make('a'),sync=createLocalOwnershipSync({ownerStatusVersion:version,clock:()=>0});sync.reconcile(sim,room(sim,version),'a');return {sim,sync};
}
const status=report=>encodeOwnedStatus({...report,actions:[]});
const coreFields=actor=>Object.fromEntries(['x','y','z','vx','vy','vz','hp','mp','state','stateSerial','animationName','animationTime',
  'awakening','core','cooldowns','knockdown','skillId','skillContext','fired'].filter(key=>Object.hasOwn(actor,key)).map(key=>[key,structuredClone(actor[key])]));

test('independent protection and reliable Buff end survive cross-channel reordering without changing owner resources',()=>{
  const sim=make('a'),sync=createLocalOwnershipSync({ownerStatusVersion:1,combatPlaybackVersion:1,clock:()=>0});sync.reconcile(sim,room(sim),'a');
  const remote=sim.actor('b'),from=make('b'),clock=createOwnerStatusClock(),buffSender=createOwnerBuffSender();
  const sample=(frame)=>{const report=encodeOwnedState(from,'b',{epoch:3,frameSeq:frame});
    Object.assign(report.actor,clock.encode(report.actor,3,frame).actor);const value=status(report);buffSender.capture(value);return value;};
  from.actor('b').buffs=[makeBuff(from,'b')];const active=sample(90);
  assert.equal(sync.receiveStatus(sim,'b',active,'a'),true);const before=coreFields(remote);
  from.actor('b').superArmor=true;sample(100);
  assert.equal(sync.receiveProtection(sim,'b',decodeOwnerBuffProtection(buffSender.compact()),'a'),true);
  assert.equal(remote.superArmor,true);assert.equal(remote.buffs.length,1);assert.deepEqual(coreFields(remote),before);
  assert.equal(sync.receiveStatus(sim,'b',active,'a'),false);assert.equal(remote.superArmor,true);
  const stillActive=sample(105);from.actor('b').buffs=[];sample(110);
  assert.equal(sync.receiveBuffs(sim,'b',buffSender.snapshot(),'a'),true);
  assert.equal(sync.receiveBuffs(sim,'b',buffSender.snapshot(),'a'),false,'ACK retry is idempotent at the actor');
  assert.deepEqual(remote.buffs,[]);assert.equal(remote.superArmor,true);assert.deepEqual(coreFields(remote),before);
  assert.equal(sync.receiveStatus(sim,'b',stillActive,'a'),true);assert.deepEqual(remote.buffs,[]);
  assert.equal(sync.receiveBuffs(sim,'b',{...buffSender.snapshot(),epoch:2},'a'),false);
  from.actor('b').superArmor=false;const latest=sample(120);assert.equal(sync.receiveStatus(sim,'b',latest,'a'),true);
  assert.equal(remote.superArmor,false);assert.deepEqual(remote.buffs,[]);
  assert.equal(sync.receiveBuffs(sim,'b',buffSender.snapshot(),'a'),false,'older reliable anchor cannot rewind a newer full status');
  assert.equal(sync.receiveProtection(sim,'b',decodeOwnerBuffProtection({...buffSender.compact(),epoch:2}),'a'),false);
  assert.deepEqual(coreFields(remote),before);sync.clear();
});

test('same-frame full, protection and repair deliveries cannot reset elapsed domain timers',()=>{
  const sim=make('a'),sync=createLocalOwnershipSync({ownerStatusVersion:1,combatPlaybackVersion:1,clock:()=>0});sync.reconcile(sim,room(sim),'a');
  const from=make('b'),actor=sim.actor('b');from.actor('b').buffs=[makeBuff(from,'b')];from.actor('b').forceInvincible=1;
  const report=encodeOwnedState(from,'b',{epoch:3,frameSeq:100});Object.assign(report.actor,createOwnerStatusClock().encode(report.actor,3,100).actor);
  const full=status(report),sender=createOwnerBuffSender();sender.capture(full);const snapshot=sender.snapshot(),guard=decodeOwnerBuffProtection(sender.compact());
  assert.equal(sync.receiveBuffs(sim,'b',snapshot,'a'),true);assert.equal(sync.receiveProtection(sim,'b',guard,'a'),true);
  actor.forceInvincible=.75;const timer=actor.buffs[0].finalizers.find(row=>row.kind==='time');assert.ok(timer);timer.remaining=f(timer.remaining-.25);
  const aged=structuredClone(actor.buffs);assert.equal(sync.receiveBuffs(sim,'b',snapshot,'a'),false);
  assert.equal(sync.receiveProtection(sim,'b',guard,'a'),false);assert.equal(sync.receiveStatus(sim,'b',full,'a'),true);
  assert.equal(actor.forceInvincible,.75);assert.deepEqual(actor.buffs,aged);
  assert.equal(sync.receiveBuffs(sim,'b',snapshot,'a'),false);assert.equal(sync.receiveProtection(sim,'b',guard,'a'),false);
  assert.equal(actor.forceInvincible,.75);assert.deepEqual(actor.buffs,aged);sync.clear();
});

test('delayed Buff repair materializes at the already observed source protection frame',()=>{
  const sim=make('a'),sync=createLocalOwnershipSync({ownerStatusVersion:1,combatPlaybackVersion:1,clock:()=>0});sync.reconcile(sim,room(sim),'a');
  const from=make('b');from.actor('b').buffs=[makeBuff(from,'b')];const report=encodeOwnedState(from,'b',{epoch:3,frameSeq:100});
  Object.assign(report.actor,createOwnerStatusClock().encode(report.actor,3,100).actor);
  const sender=createOwnerBuffSender();sender.capture(status(report));const snapshot=sender.snapshot();
  const compact=sender.compact();compact.frameSeq=200;compact.actor.sourceStatusClock.frameSeq=200;
  assert.equal(sync.receiveProtection(sim,'b',decodeOwnerBuffProtection(compact),'a'),true);
  const expected=decodeOwnerStatusClock({...report.actor,buffs:snapshot.buffs},200).buffs;
  assert.equal(sync.receiveBuffs(sim,'b',snapshot,'a'),true);assert.deepEqual(sim.actor('b').buffs,expected);
  const refreshBuffs=decodeOwnerStatusClock({...report.actor,buffs:snapshot.buffs},180).buffs;
  const remaining=sim.actor('b').buffs[0].finalizers.find(row=>row.kind==='time');remaining.remaining=f(remaining.remaining-.25);
  const aged=structuredClone(sim.actor('b').buffs);
  assert.equal(sync.receiveBuffs(sim,'b',{...snapshot,frameSeq:180,buffs:refreshBuffs},'a'),false);
  assert.deepEqual(sim.actor('b').buffs,aged,'same source frontier from a newer anchor must not restart the timer');
  assert.equal(sync.receiveStatus(sim,'b',{...status(report),frameSeq:150},'a'),true);
  assert.deepEqual(sim.actor('b').buffs,aged);sync.clear();
});

test('newer Buff end is accepted after an older anchor was materialized at a later protection frame',()=>{
  for(const knownRevision of [undefined,2]){
    const sim=make('a'),sync=createLocalOwnershipSync({ownerStatusVersion:1,combatPlaybackVersion:1,clock:()=>0});sync.reconcile(sim,room(sim),'a');
    const from=make('b');from.actor('b').buffs=[makeBuff(from,'b')];const report=encodeOwnedState(from,'b',{epoch:3,frameSeq:100});
    Object.assign(report.actor,createOwnerStatusClock().encode(report.actor,3,100).actor);
    const sender=createOwnerBuffSender();sender.capture(status(report));const old=sender.snapshot(),compact=sender.compact();
    compact.frameSeq=200;compact.actor.sourceStatusClock.frameSeq=200;
    assert.equal(sync.receiveProtection(sim,'b',decodeOwnerBuffProtection(compact),'a',knownRevision),true);
    assert.equal(sync.receiveBuffs(sim,'b',old,'a'),knownRevision===undefined);
    assert.equal(sync.receiveBuffs(sim,'b',{...old,revision:2,frameSeq:180,buffs:[]},'a'),true);
    assert.deepEqual(sim.actor('b').buffs,[]);sync.clear();
  }
});

test('a known newer Buff revision prevents an older full pose from reviving an expired Buff before repair',()=>{
  const sim=make('a'),sync=createLocalOwnershipSync({ownerStatusVersion:1,combatPlaybackVersion:1,clock:()=>0});sync.reconcile(sim,room(sim),'a');
  const from=make('b');from.actor('b').buffs=[makeBuff(from,'b')];const report=encodeOwnedState(from,'b',{epoch:3,frameSeq:150});
  Object.assign(report.actor,createOwnerStatusClock().encode(report.actor,3,150).actor);
  const sender=createOwnerBuffSender();sender.capture(status(report));const compact=sender.compact();
  compact.frameSeq=200;compact.buffRevision=2;compact.actor.sourceStatusClock.frameSeq=200;
  assert.equal(sync.receiveProtection(sim,'b',decodeOwnerBuffProtection(compact),'a',2),true);
  assert.deepEqual(sim.actor('b').buffs,[]);assert.equal(sync.receiveStatus(sim,'b',status(report),'a'),true);
  assert.deepEqual(sim.actor('b').buffs,[],'known newer revision invalidates the old full-status Buff domain');
  assert.equal(sync.receiveBuffs(sim,'b',{...sender.snapshot(),revision:2,frameSeq:100},'a'),true,
    'a skipped full Buff domain cannot fence an independently valid repair anchor');
  assert.equal(sim.actor('b').buffs.length,1);sync.clear();
});

test('current owner rejects both fresh and delayed status before it can change any local combat result',()=>{
  const from=sender('a'),to=recipient();Object.assign(to.sim.actor('a'),{hp:654321,mp:123,invincible:true,forceInvincible:.4,
    superArmor:true,stateSerial:900,x:1357});to.sim.actor('a').buffs=[makeBuff(to.sim,'a')];
  const report=from.step(),before=structuredClone(to.sim.actor('a'));
  assert.equal(to.sync.receiveStatus(to.sim,'a',status(report),'a'),false);
  assert.equal(to.sync.receivePeer(to.sim,'a',report,'a'),false);
  const malformed={...status(report),actor:{...status(report).actor,hp:1,x:-999}};
  assert.equal(to.sync.receiveStatus(to.sim,'a',malformed,'a'),false,'owner rejection happens even before an invalid self payload is decoded');
  assert.deepEqual(to.sim.actor('a'),before);assert.equal(to.sync.statusDiagnostics.accepted,0);
  from.sync.clear();to.sync.clear();
});

test('fresh remote armor/Buff status overtakes an older empty pose without advancing resources, pose or action',()=>{
  const from=sender(),to=recipient(),oldBody=encodeOwnedState(from.sim,'b',{epoch:3,frameSeq:0});
  const remote=to.sim.actor('b');Object.assign(remote,{x:777,y:50,hp:remote.hpMax+100,mp:450,stateSerial:400});
  const before=coreFields(remote);from.sim.actor('b').buffs=[makeBuff(from.sim,'b')];from.sim.actor('b').superArmor=true;
  const newest=from.step();assert.equal(to.sync.receiveStatus(to.sim,'b',status(newest),'a'),true);
  assert.deepEqual(coreFields(remote),before,'status has no resource, movement or action authority even when stat projection would clamp resources');
  assert.equal(remote.superArmor,true);assert.equal(remote.buffs.length,1);
  assert.equal(to.sync.receivePeer(to.sim,'b',oldBody,'a'),true,'the independently valid older body may still be observed');
  assert.equal(remote.superArmor,true);assert.equal(remote.buffs.length,1,'an older empty body cannot erase the already accepted new Buff');
  assert.equal(to.sync.statusDiagnostics.restoredAfterBody,1);from.sync.clear();to.sync.clear();
});

test('a new remote Buff/armor end cannot be revived by a delayed earlier active pose or status',()=>{
  const from=sender(),to=recipient();from.sim.actor('b').buffs=[makeBuff(from.sim,'b')];from.sim.actor('b').superArmor=true;
  const active=from.step();assert.equal(to.sync.receiveStatus(to.sim,'b',status(active),'a'),true);
  from.sim.actor('b').buffs=[];from.sim.actor('b').superArmor=false;const ended=from.step();
  assert.ok(ended.actor.sourceStatusClock.revision>active.actor.sourceStatusClock.revision);
  assert.equal(to.sync.receiveStatus(to.sim,'b',status(ended),'a'),true);
  assert.equal(to.sync.receivePeer(to.sim,'b',active,'a'),true);
  assert.equal(to.sim.actor('b').superArmor,false);assert.deepEqual(to.sim.actor('b').buffs,[]);
  assert.equal(to.sync.receiveStatus(to.sim,'b',status(active),'a'),false);assert.equal(to.sync.statusDiagnostics.stale,1);
  assert.equal(to.sync.receiveStatus(to.sim,'b',status(ended),'a'),false);assert.equal(to.sync.statusDiagnostics.duplicates,1);
  assert.equal(to.sim.actor('b').superArmor,false);assert.deepEqual(to.sim.actor('b').buffs,[]);from.sync.clear();to.sync.clear();
});

test('status delivery rejects old life, retired owner, unknown actor and legacy room capability',()=>{
  const from=sender(),packet=status(from.step()),to=recipient();
  assert.equal(to.sync.receiveStatus(to.sim,'b',{...packet,epoch:2},'a'),false);
  assert.equal(to.sync.receiveStatus(to.sim,'missing',packet,'a'),false);
  to.sync.disconnect(to.sim,'b');const retired=structuredClone(to.sim.actor('b'));
  assert.equal(to.sync.receiveStatus(to.sim,'b',packet,'a'),false);assert.deepEqual(to.sim.actor('b'),retired);
  const legacy=recipient(0),before=structuredClone(legacy.sim.actor('b'));
  assert.equal(legacy.sync.receiveStatus(legacy.sim,'b',packet,'a'),false);assert.deepEqual(legacy.sim.actor('b'),before);
  from.sync.clear();to.sync.clear();legacy.sync.clear();
});

test('status source changes report immediately and calibrates at 30 frames without requiring an attack sample',()=>{
  const from=sender();const initial=from.step();assert.equal(initial.frameSeq,1);assert.equal(initial.actions.length,0);
  from.sim.actor('b').superArmor=true;const armor=from.step();assert.ok(armor);assert.equal(armor.frameSeq,2);assert.equal(armor.actions.length,0);
  assert.ok(armor.actor.sourceStatusClock.revision>initial.actor.sourceStatusClock.revision);
  let calibrated;for(let frame=3;frame<=32;frame++){const report=from.step();if(report?.actor.sourceStatusClock.revision>armor.actor.sourceStatusClock.revision)calibrated=report;}
  assert.ok(calibrated);assert.equal(calibrated.frameSeq,32);assert.equal(calibrated.actor.sourceStatusClock.frameSeq,32);
  assert.equal(calibrated.actions.length,0);from.sync.clear();
});

test('legacy producer excludes negotiated status keys while preserving current local protection and Buff state',()=>{
  const from=sender('b',0),actor=from.sim.actor('b');actor.forceInvincible=.7;actor.buffs=[makeBuff(from.sim,'b')];actor.superArmor=true;
  const before=structuredClone(actor),report=from.step([{actorId:'b',type:'attackWindow'}]);
  assert.equal(Object.hasOwn(report.actor,'sourceStatusClock'),false);assert.equal(Object.hasOwn(report.actor,'forceInvincible'),false);
  assert.equal(report.actor.superArmor,true);assert.equal(report.actor.buffs.length,1);
  assert.ok(report.actions.length>0);for(const action of report.actions){assert.equal(Object.hasOwn(action.actor,'sourceStatusClock'),false);assert.equal(Object.hasOwn(action.actor,'forceInvincible'),false);}
  assert.deepEqual(actor,before);from.sync.clear();
});

for(const [sourceId,sourceProfession,factor,label]of [['c','LK',321,'ally-authored Buff'],['d','GM',231,'enemy-authored defence debuff']])
test(`RF receives and ends a ${label} using its source profession's frozen roster declarations`,()=>{
  const makeMixed=owner=>createSimulation({profile,profiles:crossProfiles,map,networkOwnerId:owner,
    preset:{buffResistances:{0:0,1:0,2:0,3:0,4:0,5:0,6:0},debuffDurationMultiplier:1},
    actors:ids.map((id,index)=>({id,professionId:id==='c'?'LK':id==='d'?'GM':'RF',
      team:id==='c'?1:id==='d'?0:index%2,position:[index*2000,0,0],lineId:0,loadout:Array(8).fill(null)}))});
  const from=makeMixed('b'),to=makeMixed('a');
  const outgoing=createLocalOwnershipSync({ownerStatusVersion:1,clock:()=>0}),incoming=createLocalOwnershipSync({ownerStatusVersion:1,clock:()=>0});
  outgoing.reconcile(from,room(from),'b');incoming.reconcile(to,room(to),'a');
  const source=from.actor(sourceId),target=from.actor('b');
  assert.equal(source.professionId,sourceProfession);assert.equal(source.team===target.team,sourceProfession==='LK');
  assert.equal(Object.hasOwn(profile.buffFactors,factor),false,'the recipient profile alone cannot validate this factor');
  const created=createBuffFromFactor(from.profileFor(source),{factor,sourceActor:source,targetActor:target,roll:0,nativeValues});
  assert.equal(created.supported,true,JSON.stringify(created.unsupported));assert.equal(created.accepted,true);
  target.buffs=[created.buff];const active=outgoing.afterStep(from,'b',[]),localBefore=structuredClone(to.actor('a'));
  assert.equal(active.actor.buffs[0].sourceActorId,sourceId);assert.equal(active.actor.buffs[0].targetActorId,'b');
  assert.equal(incoming.receiveStatus(to,'b',status(active),'a'),true);
  assert.equal(to.actor('b').buffs[0].factorId,factor);assert.equal(to.actor('b').buffs[0].sourceActorId,sourceId);
  target.buffs=[];const ended=outgoing.afterStep(from,'b',[]);assert.equal(incoming.receiveStatus(to,'b',status(ended),'a'),true);
  assert.deepEqual(to.actor('b').buffs,[]);assert.equal(incoming.receivePeer(to,'b',active,'a'),true);
  assert.deepEqual(to.actor('b').buffs,[],'an older active cross-profession body cannot undo the source end');
  assert.deepEqual(to.actor('a'),localBefore);outgoing.clear();incoming.clear();
});

const response=value=>({ok:true,status:200,json:async()=>value});
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const parse=value=>JSON.parse(typeof value==='string'?value:new TextDecoder().decode(value));
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
async function transport(t,{version=1,peer=true,base=0,holdUploads=false}={}){
  const peers=[],sources=[],events=[],errors=[],uploads=[],intervals=[],timeouts=new Map();let now=0,timerId=0;
  t.mock.method(globalThis,'setInterval',fn=>{intervals.push(fn);return intervals.length;});t.mock.method(globalThis,'clearInterval',()=>{});
  class Channel{constructor(label){this.label=label;this.readyState='open';this.bufferedAmount=0;this.sent=[];}
    send(value){this.sent.push(value);}receive(value){this.onmessage?.({data:typeof value==='string'?value:JSON.stringify(value)});}}
  class Peer{constructor(){this.connectionState='connected';this.sctp={maxMessageSize:64*1024};this.channels=new Map();peers.push(this);}
    createDataChannel(label){const channel=new Channel(label);this.channels.set(label,channel);return channel;}
    async createOffer(){return {type:'offer',sdp:'controlled-v11'};}async setLocalDescription(value){this.localDescription={toJSON:()=>value};}
    close(){this.connectionState='closed';}}
  class Source{constructor(){this.listeners=new Map();sources.push(this);}addEventListener(type,fn){this.listeners.set(type,fn);}close(){}
    emit(type,value){this.listeners.get(type)?.({data:JSON.stringify(value)});}}
  const sim=make('a'),match={id:'status-delivery-v11',ownership:'local-owner-v1',ownerStatusVersion:version,
    players:ids.slice(0,2).map(id=>({id,...(id==='a'?{lastFrameSeq:base}:{})}))};
  const client=createOnlineClient({EventSource:Source,WebSocket:null,RTCPeerConnection:peer?Peer:null,clock:()=>now,
    rtcOptions:{enabled:false},timers:{setTimeout(fn,ms){const id=++timerId;timeouts.set(id,{fn,at:now+ms});return id;},clearTimeout(id){timeouts.delete(id);}},
    fetch:async(url,options)=>{if(url!=='/api/online/input')return response({accepted:true});
      const gate=deferred(),row={body:JSON.parse(options.body),...gate};uploads.push(row);return holdUploads?gate.promise:response({accepted:true});},
    onError:error=>errors.push(error),onEvent(type,value){events.push({type,value});
      if(type==='owner-actions')return true;
      if(type==='peer-owned-state')return {validated:true,applied:true,playerId:value.playerId,epoch:value.report.epoch,frameSeq:value.report.frameSeq};}});
  t.after(async()=>{client.close();for(const upload of uploads)upload.resolve(response({accepted:true}));await settle();});
  await client.open();await client.setMatch(match,'a');await settle();
  sources[0].emit('state',{matchId:match.id,snapshot:{actors:sim.state.actors.filter(actor=>['a','b'].includes(actor.id))},
    ownership:{mode:'local-owner-v1',ownerStatusVersion:version,actors:{a:{epoch:3},b:{epoch:3}}}});await settle();
  return {client,sim,peers,sources,events,errors,uploads,match,
    handshake(){peers[0].channels.get('control').receive({v:1,matchId:match.id,type:'hello-ack',gzip:false});},
    async advance(ms){now+=ms;void intervals[0]();await settle();}};
}
function wireReport(sim,id,frameSeq,{baseFrame=frameSeq,revision=1,attackId}={}){
  const projection=createOwnerStatusClock().encode(encodeOwnedStatusSource(sim.actor(id)),3,baseFrame);
  projection.actor.sourceStatusClock.revision=revision;
  const report=encodeOwnedState(sim,id,{epoch:3,frameSeq});Object.assign(report.actor,projection.actor);report.actions=[];
  if(attackId!==undefined)report.actions=[{...encodeCriticalAction(report,{id:attackId}),ageFrames:0}];return report;
}

test('transport maps status baseline and captured attack frame into the same reconnect source-clock domain',async t=>{
  const f=await transport(t,{peer:false,base:600,holdUploads:true}),report=wireReport(f.sim,'a',9,{baseFrame:1});
  const earlier={...report,frameSeq:3};report.actions=[{...encodeCriticalAction(earlier,{id:99}),ageFrames:6}];report.hits=[{id:7,attackerId:'b',damage:10}];
  const before=structuredClone(report);assert.equal(f.client.send(input,report),609);await settle();assert.equal(f.uploads.length,1);
  const uploaded=f.uploads[0].body.owner;assert.equal(uploaded.frameSeq,609);assert.equal(uploaded.actor.sourceStatusClock.frameSeq,601);
  assert.equal(uploaded.actions[0].id,99);assert.equal(uploaded.actions[0].frameSeq,603);assert.equal(uploaded.actions[0].actor.sourceStatusClock.frameSeq,601);
  assert.equal(Object.hasOwn(uploaded.actions[0],'ageFrames'),false);assert.deepEqual(uploaded.hits,report.hits);
  assert.deepEqual(report,before,'transport mapping cannot modify the source report');assert.doesNotThrow(()=>validateOwnedState(uploaded));
  f.uploads[0].resolve(response({accepted:true,consumedActionIds:[99],consumedHitIds:[7]}));await settle();
  assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().pendingHits,0);assert.deepEqual(f.errors,[]);
});

test('fresh RTC status arrives before the collision control fence while the newer pose still waits for its action',async t=>{
  const f=await transport(t),report=wireReport(f.sim,'b',2,{baseFrame:1});report.actor.superArmor=true;f.handshake();
  const inputChannel=f.peers[0].channels.get('input'),control=f.peers[0].channels.get('control');
  inputChannel.receive({matchId:f.match.id,sequence:2,packet:input,owner:report,status:encodeOwnedStatus(report),controlSequence:1});await settle();
  assert.ok(f.events.some(event=>event.type==='owner-status'&&event.value.status.actor.superArmor===true));
  assert.equal(f.events.filter(event=>event.type==='peer-owned-state').length,0);
  assert.equal(f.client.performance().peerControls.b.pendingPoses,1);assert.deepEqual(f.client.performance().peerReceipts,[]);
  const action=encodeCriticalAction(report,{id:44}),carrier={...report,effects:[],hits:[],actions:[action]};
  control.receive({v:1,matchId:f.match.id,type:'actions',sequence:1,report:carrier});await settle();
  assert.equal(f.events.filter(event=>event.type==='owner-actions').length,1);
  assert.equal(f.events.filter(event=>event.type==='peer-owned-state').length,1);assert.equal(f.client.performance().peerControls.b.pendingPoses,0);
  assert.ok(control.sent.map(parse).some(row=>row.type==='ack'&&row.sequence===1));assert.deepEqual(f.errors,[]);
});

test('RTC status-only delivery neither acknowledges pending combat records nor changes remote input',async t=>{
  const f=await transport(t,{holdUploads:true}),local=wireReport(f.sim,'a',1,{attackId:55});local.hits=[{id:8,attackerId:'b',damage:12}];
  f.client.send(input,local);await settle();assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().pendingHits,1);
  const incoming=wireReport(f.sim,'b',8,{baseFrame:1});incoming.actor.superArmor=true;
  f.peers[0].channels.get('input').receive({matchId:f.match.id,sequence:8,statusOnly:true,status:encodeOwnedStatus(incoming)});await settle();
  assert.equal(f.events.filter(event=>event.type==='owner-status').length,1);assert.equal(f.events.filter(event=>event.type==='peer-owned-state').length,0);
  assert.equal(f.events.filter(event=>event.type==='peer-input').length,0);assert.deepEqual(f.client.remoteInput('b').held,[]);
  assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().pendingHits,1);assert.deepEqual(f.client.performance().peerReceipts,[]);
  f.uploads[0].resolve(response({accepted:true,consumedActionIds:[55],consumedHitIds:[8]}));await settle();
  assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().pendingHits,0);assert.deepEqual(f.errors,[]);
});

test('outbound current protection checkpoint bypasses an unnegotiated action channel without claiming combat delivery',async t=>{
  const f=await transport(t,{holdUploads:true}),report=wireReport(f.sim,'a',1,{attackId:66});report.actor.superArmor=true;
  f.client.send(input,report);await settle();const sent=f.peers[0].channels.get('input').sent.map(parse).filter(row=>row.statusOnly);
  assert.equal(sent.length,1);assert.equal(sent[0].statusOnly,true);assert.equal(sent[0].status.actor.superArmor,true);
  assert.equal(sent[0].owner,undefined);assert.equal(sent[0].packet,undefined);assert.equal(sent[0].controlSequence,undefined);
  assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().ownerStatus.sent,1);assert.deepEqual(f.client.performance().peerReceipts,[]);
});

test('unchanged current protection is retried at the 30-source-frame checkpoint rather than on every ordinary sample',async t=>{
  const f=await transport(t,{holdUploads:true}),first=wireReport(f.sim,'a',1,{baseFrame:1});first.actor.superArmor=true;
  f.client.send(input,first);await settle();assert.equal(f.peers[0].channels.get('input').sent.map(parse).filter(row=>row.statusOnly).length,1);
  const earlier=wireReport(f.sim,'a',30,{baseFrame:1});earlier.actor.superArmor=true;
  f.client.send(input,earlier);await settle();assert.equal(f.peers[0].channels.get('input').sent.map(parse).filter(row=>row.statusOnly).length,1,'29 elapsed frames do not resend an unchanged revision');
  const checkpoint=wireReport(f.sim,'a',31,{baseFrame:1});checkpoint.actor.superArmor=true;
  f.client.send(input,checkpoint);await settle();const sent=f.peers[0].channels.get('input').sent.map(parse).filter(row=>row.statusOnly);
  assert.equal(sent.length,2);assert.ok(sent.every(packet=>packet.statusOnly===true));
  assert.deepEqual(sent.map(packet=>packet.sequence),[1,31]);assert.ok(sent.every(packet=>packet.status.actor.superArmor===true));
  assert.equal(sent[1].status.actor.sourceStatusClock.revision,sent[0].status.actor.sourceStatusClock.revision);
  assert.equal(f.client.performance().ownerStatus.sent,2);assert.deepEqual(f.client.performance().peerReceipts,[]);
});

test('legacy room strips all negotiated status keys at the outbound transport boundary without altering the source',async t=>{
  const f=await transport(t,{version:0,peer:false,holdUploads:true}),report=wireReport(f.sim,'a',3,{baseFrame:1,attackId:77});
  report.actor.forceInvincible=.5;report.actions[0].actor.forceInvincible=.5;const before=structuredClone(report);
  f.client.send(input,report);await settle();const uploaded=f.uploads[0].body.owner;
  for(const actor of [uploaded.actor,...uploaded.actions.map(action=>action.actor)]){
    assert.equal(Object.hasOwn(actor,'sourceStatusClock'),false);assert.equal(Object.hasOwn(actor,'forceInvincible'),false);
  }
  assert.deepEqual(report,before);assert.equal(f.client.performance().ownerStatus.sent,0);
  assert.equal(f.client.performance().pendingActions,1);assert.equal(uploaded.actions[0].id,77);
});

test('legacy coordinator ignores both dedicated RTC and SSE status messages',async t=>{
  const f=await transport(t,{version:0}),report=wireReport(f.sim,'b',1);
  f.peers[0].channels.get('input').receive({matchId:f.match.id,sequence:1,statusOnly:true,status:encodeOwnedStatus(report)});
  f.sources[0].emit('owner-status',{matchId:f.match.id,playerId:'b',status:encodeOwnedStatus(report)});await settle();
  assert.equal(f.events.filter(event=>event.type==='owner-status').length,0);assert.equal(f.events.filter(event=>event.type==='peer-owned-state').length,0);
  assert.deepEqual(f.client.performance().peerReceipts,[]);assert.equal(f.client.performance().ownerStatus.received,0);assert.deepEqual(f.errors,[]);
});

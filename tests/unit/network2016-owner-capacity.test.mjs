/** Captured current-Web source state, not an original-client golden. These
 * tests validate transport/driver admission without running Native or a GPU. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
import {createOwnerUploadDelta} from '../../packages/online/owner-upload-delta.mjs';
import {buildOwnerUploadPrefix,MAXIMUM_OWNER_UPLOAD_BYTES} from '../../packages/online/owner-upload-prefix.mjs';
import {captureProfileDependencies,capacityPresetBehaviorHash} from '../../tools/network2016-capacity-dependencies.mjs';

const read=name=>JSON.parse(readFileSync(new URL(name,import.meta.url)));
const fixture=read('../fixtures/network2016-mm-capacity.json'),original=fixture.report;
const dependencyLock=read('../../contracts/network2016-mm-capacity-dependencies-v37.json');
const profile=read('../../packages/combat-core/mm-profile.json'),preset=read('../../config/mm-preset.json');
const bytes=value=>Buffer.byteLength(JSON.stringify(value)),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const input={held:[],pressed:[],released:[]};
const map={sceneId:'capacity-admission',lines:[{lineId:2,start:[-10000,3080,0],end:[10000,3080,0],type:'LINE_TYPE.LT_NORMAL'}],
  starts:[0,1].map(index=>({index,kind:'SetTeamStartPos',teamFlag:index===0,position:[index*250,3080,0],lineId:2,facingRight:index===0}))};
function simulation(){return createSimulation({profile,preset,profiles:{MM:profile},presets:{MM:preset},map,seed:2016,networkOwnerId:'target',
  actors:[{id:'source',professionId:'MM',team:0,position:[0,3080,0],lineId:2,facing:1,loadout:[{skillId:29604,branchId:'none'},...Array(7).fill(null)]},
    {id:'target',professionId:'MM',team:1,position:[250,3080,0],lineId:2,facing:-1,passives:[],guildPassives:[],loadout:Array(8).fill(null)}]});}
const checked=value=>validateOwnedState(value);
function references(value,sim){return validateOwnedReferences(checked(value),sim.actor('source'),profile,map,{profiles:sim.profiles,actors:sim.state.actors});}

test('real MM frame 5 fits in two unchanged-budget uploads and retains every canonical dependency',()=>{
  // Preserve the historical fixture/full-profile identity. Its independent
  // dependency lock was extracted from that verified Git profile, not this
  // version's newly expanded static analysis/asset closure or a regenerated simulation.
  assert.equal(dependencyLock.source.profileSha256,fixture.source.profileSha256);
  assert.equal(createHash('sha256').update(readFileSync(new URL('../fixtures/network2016-mm-capacity.json',import.meta.url))).digest('hex'),
    dependencyLock.capture.fixtureFileSha256);
  assert.equal(hash(original),dependencyLock.capture.reportSha256);
  assert.equal(hash(dependencyLock.dependencies),dependencyLock.dependenciesSha256);
  assert.deepEqual(Object.keys(dependencyLock.dependencies.states),['ANSI_HA_AMM_APOCALYPSE']);
  assert.deepEqual(Object.keys(dependencyLock.dependencies.skills),['29604']);
  assert.deepEqual(captureProfileDependencies(profile,fixture),dependencyLock.dependencies,
    'all captured state/skill/effect source declarations must still match the original capture dependencies');
  // V45 explicitly changes the Web mana-break policy and version label.
  // Retain the historical source fixture/hash and compare gameplay fields.
  const {manaBreakImmediateDown,...historicalPreset}=preset;
  assert.equal(manaBreakImmediateDown,true);
  historicalPreset.presetVersion=historicalPreset.presetVersion.replace(/-feedback-v45$/,'');
  assert.equal(dependencyLock.source.presetSha256,fixture.source.presetSha256);
  assert.equal(capacityPresetBehaviorHash(historicalPreset),dependencyLock.source.presetBehaviorFieldsSha256);
  assert.equal(bytes(original),112576);assert.equal(original.effects.length,44);assert.equal(original.actions.length,1);
  assert.equal(dependencyLock.capture.reportBytes,112576);assert.equal(dependencyLock.capture.effectCount,44);
  assert.deepEqual(dependencyLock.capture.actionEffectCounts,[44]);
  const before=JSON.stringify(original),prefix=buildOwnerUploadPrefix(original),sim=simulation();
  assert.ok(bytes(prefix)<=MAXIMUM_OWNER_UPLOAD_BYTES);assert.equal(prefix.actionFrontierComplete,false);
  assert.deepEqual(prefix.effects,[]);assert.deepEqual(prefix.actor,original.actor);
  assert.deepEqual(prefix.hits,original.hits);assert.deepEqual(prefix.actions,original.actions);
  references(prefix,sim);
  const complete=buildOwnerUploadPrefix(original,{actions:[],hits:[]});
  assert.ok(bytes(complete)<=MAXIMUM_OWNER_UPLOAD_BYTES);assert.equal(complete.actionFrontierComplete,undefined);
  assert.deepEqual(complete.effects,original.effects);references(complete,sim);
  assert.equal(JSON.stringify(original),before,'assembly cannot mutate the retained source snapshot');
});

test('partial prefix validates MM summon references, admits actions/hits/status and leaves actor and effect pose untouched',t=>{
  const sim=simulation(),players=sim.state.actors.map(actor=>({id:actor.id,username:actor.id,professionId:actor.professionId,team:actor.team,loadout:actor.loadout}));
  const room=new PvpMatch({mode:'1v1',players,map,seed:2016,
    versions:{referenceVersion:'capacity-fixture',presetVersion:'capacity-fixture',programVersion:'capacity-fixture'},rules:{scoreLimit:100}}),events=[];
  const driver=createLocalOwnerBattleDriver({match:{id:'capacity-driver',players,ownerStatusVersion:1,continuousAuraVersion:2,combatPlaybackVersion:1},
    simulation:sim,pvp:room,manual:true,clock:()=>0,emit:(type,data)=>events.push({type,data}),finish:()=>assert.fail('room cannot finish')});
  t.after(()=>driver.stop());for(const player of players)driver.ready(player.id);driver.tick(10);
  assert.equal(driver.snapshot().pvp.phase,'fight');
  // Install an older, complete effect pose. The empty partial pose must not
  // publish effect disappearance or replace the room's accepted frame.
  const old={...structuredClone(original),frameSeq:4,actions:[]};old.actor.x-=50;old.actor.sourceStatusClock.frameSeq=4;
  old.actor.sourceStatusClock.revision--;
  driver.submitInput('source',{frames:[{...input,frameSeq:4}],owner:old});
  const before=driver.snapshot(),prefix=buildOwnerUploadPrefix({...original,hits:[{id:19,attackerId:'target',damage:3}]});
  const eventAt=events.length,receipt=driver.submitInput('source',{frames:[{...input,frameSeq:5}],owner:prefix});
  assert.equal(receipt.ignored,'actions-pending');assert.deepEqual(receipt.consumedActionIds,[5]);assert.deepEqual(receipt.consumedHitIds,[19]);
  assert.equal(driver.snapshot().ownership.actors.source.frameSeq,4);assert.equal(sim.actor('source').x,old.actor.x);
  assert.deepEqual(driver.snapshot().owners.source.effects,before.owners.source.effects);
  assert.equal(events.slice(eventAt).filter(event=>event.type==='owned-state').length,0);
  assert.equal(events.slice(eventAt).filter(event=>event.type==='owner-status').length,1,'protection revision crosses the held pose frontier');
  assert.deepEqual(events.slice(eventAt).filter(event=>event.type==='input').flatMap(event=>event.data.actions),original.actions);
  const complete=buildOwnerUploadPrefix(original,{actions:[],hits:[]}),done=driver.submitInput('source',{frames:[{...input,frameSeq:5}],owner:complete});
  assert.equal(done.frameSeq,5);assert.equal(done.ignored,undefined);assert.equal(sim.actor('source').x,original.actor.x);
  assert.deepEqual(driver.snapshot().owners.source.effects,original.effects);
});

const response=value=>({ok:true,status:200,json:async()=>value});
const settle=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
async function clientFixture(t,{socket=true}={}){
  const uploads=[],sockets=[],errors=[],tasks=new Map(),ticks=[];let serial=0,now=0;
  t.mock.method(globalThis,'setInterval',fn=>ticks.push(fn));t.mock.method(globalThis,'clearInterval',()=>{});
  class Source{addEventListener(type,callback){if(type==='open')queueMicrotask(()=>callback({type:'open'}));}close(){}}
  class Socket{
    constructor(){this.bufferedAmount=0;this.sent=[];sockets.push(this);queueMicrotask(()=>this.receive({type:'transport',data:{connected:true,ownerUploadDelta:1}}));}
    receive(value){this.onmessage?.({data:JSON.stringify(value)});}
    send(value){this.sent.push(JSON.parse(new TextDecoder().decode(value)));}close(){}
  }
  const match={id:'capacity-client',ownership:'local-owner-v1',ownerStatusVersion:1,continuousAuraVersion:2,combatPlaybackVersion:1,players:[{id:'source'},{id:'target'}]};
  const client=createOnlineClient({EventSource:Source,WebSocket:socket?Socket:null,RTCPeerConnection:null,maximumOwnerCredits:1,clock:()=>now,
    timers:{setTimeout(fn){const id=++serial;tasks.set(id,fn);return id;},clearTimeout(id){tasks.delete(id);}},
    socketOptions:{compress:async text=>new TextEncoder().encode(text)},onError:error=>errors.push(error),
    fetch:async(url,options)=>{if(url!=='/api/online/input')return response({accepted:true});
      return new Promise(resolve=>uploads.push({body:JSON.parse(options.body),resolve}));}});
  t.after(async()=>{client.close();for(const row of uploads)row.resolve(response({accepted:false}));await settle();});
  await client.open();await client.setMatch(match,'source');await settle();
  const server=createOwnerUploadDelta();
  const f={client,match,errors,uploads,sockets,
    advance(ms){now+=ms;},async flush(){void ticks[0]();await settle();},
    batches:()=>socket?sockets[0].sent:uploads.map(row=>row.body),
    ack(batch,extra={}){const data={accepted:true,matchId:match.id,sequence:batch.sequence,...extra};
      if(socket)sockets[0].receive({type:'ack',data});else uploads.find(row=>row.body.sequence===batch.sequence).resolve(response(data));},
    decode(batch){return batch.owner??server.decode(batch.ownerUpload).report;}};
  return f;
}

for(const socket of [true,false])test(`${socket?'WS delta':'HTTP'} ACK of final capacity prefix resumes complete same-frame pose without new input`,async t=>{
  const f=await clientFixture(t,{socket});f.client.send(input,original);await settle();
  assert.equal(f.batches().length,1);const first=f.batches()[0];
  assert.ok(first.owner,'partial owner never enters pose baseline cache');assert.equal(first.ownerUpload,undefined);
  assert.equal(first.owner.actionFrontierComplete,false);assert.deepEqual(first.owner.effects,[]);
  assert.deepEqual(first.owner.actions,original.actions);assert.equal(f.client.performance().pendingActions,1);
  f.ack(first,{consumedActionIds:[5],consumedHitIds:[]});await settle();
  assert.equal(f.batches().length,2);const last=f.batches()[1],complete=f.decode(last);
  if(socket)assert.ok(last.ownerUpload,'normal compact upload resumes after the partial frontier');
  assert.equal(complete.frameSeq,first.owner.frameSeq);assert.equal(complete.actionFrontierComplete,undefined);
  assert.deepEqual(complete.effects,original.effects);assert.deepEqual(complete.actions,[]);
  assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().ownerFatal,null);
  f.ack(last,{consumedActionIds:[],consumedHitIds:[],ownerReceipt:{epoch:complete.epoch,frameSeq:complete.frameSeq}});await settle();
  assert.equal(f.batches().length,2);assert.deepEqual(f.errors,[]);
});

test('idle complete pose retries after its HTTP failure even though the final action was already acknowledged',async t=>{
  const f=await clientFixture(t,{socket:false});f.client.send(input,original);await settle();
  f.ack(f.batches()[0],{consumedActionIds:[5],consumedHitIds:[]});await settle();
  assert.equal(f.client.performance().pendingActions,0);assert.equal(f.batches().length,2);
  f.ack(f.batches()[1],{accepted:false});await settle();
  assert.equal(f.client.performance().pendingFrames,1);await f.flush();assert.equal(f.batches().length,2,'existing retry pacing remains');
  f.advance(50);await f.flush();assert.equal(f.batches().length,3);
  assert.deepEqual(f.batches()[2].owner,f.batches()[1].owner);
  f.ack(f.batches()[2],{consumedActionIds:[],consumedHitIds:[]});await settle();
  assert.equal(f.client.performance().pendingFrames,0);assert.equal(f.client.performance().ownerFatal,null);
  assert.equal(f.errors.length,1);assert.match(f.errors[0].message,/owner-input-not-accepted/);
});

test('newest pose replaces the withheld one, while stale room/life ACKs cannot schedule a completion',async t=>{
  const f=await clientFixture(t);f.client.send(input,original);await settle();const first=f.batches()[0];
  const newer={...structuredClone(original),frameSeq:8,actions:[]};newer.actor.x+=3;
  f.client.send(input,newer);await settle();f.ack(first,{consumedActionIds:[5],consumedHitIds:[]});await settle();
  assert.equal(f.decode(f.batches()[1]).frameSeq,8);assert.equal(f.decode(f.batches()[1]).actor.x,newer.actor.x);
  await f.client.setMatch({...f.match,id:'capacity-new-room'},'source');
  f.ack(first,{consumedActionIds:[5]});await settle();assert.equal(f.batches().length,2);
});

test('oversize canonical event remains pending and faults once; neither emptying pose nor ACK loses it',async t=>{
  const f=await clientFixture(t),oversized=structuredClone(original);
  oversized.actions[0].actor.payload='\uad0d'.repeat(34000);
  assert.throws(()=>buildOwnerUploadPrefix(oversized),/owner-action-message-too-large/);
  f.client.send(input,oversized);await settle();
  assert.equal(f.batches().length,0);assert.equal(f.client.performance().pendingActions,1);
  assert.equal(f.client.performance().ownerFatal,'owner-action-message-too-large');
  assert.equal(f.errors.filter(error=>error.fatal).length,1);
});

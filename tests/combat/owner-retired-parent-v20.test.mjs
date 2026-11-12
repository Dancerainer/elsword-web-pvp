/** Web ownership regressions using actual VC models, native map/geometry and
 * declarations. These identity checks are not original-client trajectories. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture} from '../helpers/vc-fixture.mjs';
import {fixture as runeFixture} from '../helpers/rs-fixture.mjs';
import {applyOwnedState,encodeOwnedState,encodeCriticalAction,validateOwnedState,MAX_OWNER_EFFECTS,OWNER_ACTION_HISTORY_FRAMES,MAX_RECENT_OWNER_EFFECT_LINKS,ownedEffectLinkDiagnostics} from '../../packages/online/owned-state.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
const dt=1/60,ground='DAMAGE_EFFECT_IGNITION_CROW_GROUND';
function fixture(){
  const source=vcFixture({skillId:24022,gap:160,passives:[]}),victim=vcFixture({skillId:24022,gap:160,passives:[]});
  source.sim.networkOwnerId='vc';victim.sim.networkOwnerId='target';
  for(const f of [source,victim]){for(const a of f.sim.state.actors){a.inputLock=0;f.sim.enter(a,'RSI_WAIT','retired-parent-fixture');a.presentationTransition=null;}f.sim.drainEvents();}
  return {source,victim};
}
function groundBeforeOwnerReport(){
  const f=fixture(),{source,victim}=f;
  // The actual authored falling-fire main mesh crashes at its native land
  // plane and emits the ground damage child. Its parent has ended when the
  // ordinary owner report first contains that child.
  const parent=source.sim.createEffect(source.a,{NAME:'DAMAGE_EFFECT_IGNITION_CROW_DROPFIRE'},
    {birthAnchor:{position:[160,3090,0],facing:1,rotation:[0,0,0]}});
  parent.skillId=24022;source.sim.tickEffects(dt);source.sim.drainEvents();
  victim.sim.state.nextEffectId=1000;
  applyOwnedState(victim.sim,'vc',encodeOwnedState(source.sim,'vc',{epoch:1,frameSeq:1}));victim.sim.drainEvents();
  const remoteParent=victim.sim.state.effects.find(e=>e.networkId===parent.id);assert.ok(remoteParent);
  let child;
  for(let frame=2;frame<20;frame++){
    source.sim.tickEffects(dt);source.sim.drainEvents();victim.sim.tickEffects(dt);victim.sim.drainEvents();
    child=victim.sim.state.effects.find(e=>e.name===ground);
    if(child?.active&&Object.hasOwn(child.hits,'target'))break;
  }
  assert.ok(child?.active);assert.ok(Object.hasOwn(child.hits,'target'),'predicted native ground fire actually accepted a collision');
  assert.equal(victim.sim.state.effects.includes(remoteParent),false,'native falling parent has retired');
  assert.equal(source.sim.state.effects.some(e=>e.id===parent.id),false);
  const report=encodeOwnedState(source.sim,'vc',{epoch:1,frameSeq:20});
  const wire=report.effects.find(e=>e.name===ground);assert.ok(wire);assert.equal(wire.parentEffectId,parent.id);
  assert.equal(report.effects.some(e=>e.id===parent.id),false,'the owner report legitimately omits the retired parent');
  return {...f,child,report,wire,remoteParent};
}
test('an owner child report claims its already-hit native prediction after the parent retires',()=>{
  const {victim,child,report,wire,remoteParent}=groundBeforeOwnerReport(),hits=child.hits;
  applyOwnedState(victim.sim,'vc',report);
  const remote=victim.sim.state.effects.find(e=>e.networkId===wire.id);
  assert.equal(remote,child,'same source child retains one receiver-local damage and visual identity');
  assert.equal(remote.parentEffectId,remoteParent.id,'retired source parent still resolves to its scoped receiver ID');
  assert.equal(remote.hits,hits);assert.ok(Object.hasOwn(hits,'target'));
  assert.equal(victim.sim.drainEvents().filter(e=>e.type==='effectStarted'&&e.name===ground).length,0,'network arrival cannot birth the same fire twice');
  victim.sim.tickEffects(dt);
  assert.equal(victim.sim.drainEvents().filter(e=>e.type==='hit'&&e.targetId==='target').length,0,'the accepted hit survives the ownership handoff');
});
test('a temporary historical restoration cannot overwrite the live retired-parent link',()=>{
  const {victim,child,report,wire,remoteParent}=groundBeforeOwnerReport(),consumer=createRemoteActionConsumer({clock:()=>0});
  consumer.receive('vc',[encodeCriticalAction(report,{id:20})],1,20);consumer.consume(victim.sim,'target',()=>1);
  assert.ok(victim.sim.state.effects.includes(child),'history restores the actual live prediction');victim.sim.drainEvents();
  applyOwnedState(victim.sim,'vc',report);
  const remote=victim.sim.state.effects.find(e=>e.networkId===wire.id);
  assert.equal(remote,child);assert.equal(remote.parentEffectId,remoteParent.id);
  assert.equal(victim.sim.drainEvents().filter(e=>e.type==='effectStarted'&&e.name===ground).length,0);consumer.clear();
});
for(const json of [false,true])test(`an in-flight ${json?'JSON ':''}snapshot retains retired-parent identity and accepted native damage`,()=>{
  const {victim,child,report,wire,remoteParent}=groundBeforeOwnerReport();
  const snapshot=victim.sim.snapshot();victim.sim.restore(json?JSON.parse(JSON.stringify(snapshot)):snapshot);
  const restored=victim.sim.state.effects.find(effect=>effect.id===child.id),hits=restored.hits;
  applyOwnedState(victim.sim,'vc',report);
  const remote=victim.sim.state.effects.find(effect=>effect.networkId===wire.id);
  assert.equal(remote,restored);assert.equal(remote.parentEffectId,remoteParent.id);assert.equal(remote.hits,hits);
  assert.ok(Object.hasOwn(remote.hits,'target'));
  assert.equal(victim.sim.drainEvents().filter(e=>e.type==='effectStarted'&&e.name===ground).length,0);
  victim.sim.tickEffects(dt);assert.equal(victim.sim.drainEvents().filter(e=>e.type==='hit'&&e.targetId==='target').length,0);
  const outgoing=encodeOwnedState(victim.sim,'vc',{epoch:1,frameSeq:21});
  assert.equal(Object.hasOwn(outgoing,'localOwnerEffectLinks'),false);
  assert.equal(Object.hasOwn(outgoing.actor,'networkFrameSeq'),false);assert.equal(Object.hasOwn(outgoing.actor,'networkFrameEpoch'),false);
  assert.ok(outgoing.effects.every(effect=>!Object.hasOwn(effect,'networkFrameSeq')));
});
test('retired parent links never claim a predicted child from a previous owner life',()=>{
  const {victim,child,report,wire}=groundBeforeOwnerReport();report.epoch=2;
  applyOwnedState(victim.sim,'vc',report);
  const remote=victim.sim.state.effects.find(e=>e.networkId===wire.id);
  assert.notEqual(remote,child,'a new life may reuse a source ID without inheriting old ownership');
  assert.deepEqual(remote.hits,{});assert.equal(remote.parentEffectId,null);
});
for(const delay of [0,6])test(`actual Crow cast has one receiver birth per authored child at ${delay*1000/60} ms owner delay`,()=>{
  const {source,victim}=fixture(),tx=createLocalOwnershipSync(),rx=createLocalOwnershipSync();
  const initial={snapshot:source.sim.snapshot(),ownership:{mode:'local-owner-v1',actors:{vc:{epoch:1},target:{epoch:1}}}};
  tx.reconcile(source.sim,initial,'vc');rx.reconcile(victim.sim,initial,'target');
  const queue=[],births={source:[],victim:[]};
  for(let frame=1;frame<=180;frame++){
    tx.beforeStep(source.sim,'vc');source.sim.step(dt,{vc:frame===1?{pressed:['A'],held:['A']}:{}} ,{snapshot:false});
    const events=source.sim.drainEvents();births.source.push(...events.filter(e=>e.type==='effectStarted'&&e.name.includes('CROW')));
    const report=tx.afterStep(source.sim,'vc',events);
    if(report){report.actions=report.actions.map(({ageFrames,...a})=>a);queue.push({at:frame+delay,report});}
    while(queue[0]?.at<=frame)rx.receivePeer(victim.sim,'vc',queue.shift().report,'target');
    rx.beforeStep(victim.sim,'target');victim.sim.step(dt,{}, {snapshot:false});
    births.victim.push(...victim.sim.drainEvents().filter(e=>e.type==='effectStarted'&&e.actorId==='vc'&&e.name.includes('CROW')));
  }
  assert.equal(births.source.filter(e=>e.name===ground).length,11,'the actual Crow emits all 11 authored drop-fire children');
  const counts=rows=>Object.fromEntries([...new Set(rows.map(e=>e.name))].sort().map(name=>[name,rows.filter(e=>e.name===name).length]));
  assert.deepEqual(counts(births.victim),counts(births.source),'source histories and ordinary live reports cannot duplicate child visuals');
  assert.equal(new Set(births.victim.map(e=>e.effectId)).size,births.victim.length);
  tx.clear();rx.clear();
});
for(const route of ['peer','server'])test(`native Storm Blade cannot replay when ${route} resumes with delayed active reports after its mesh ended`,()=>{
  const source=runeFixture({skillId:21014,networkOwnerId:'rs'}),victim=runeFixture({skillId:21014,networkOwnerId:'target'});
  const tx=createLocalOwnershipSync(),rx=createLocalOwnershipSync(),epochs={rs:{epoch:1},target:{epoch:1}};
  for(const f of [source,victim]){for(const a of f.sim.state.actors){a.inputLock=0;f.sim.enter(a,'RSI_WAIT','storm-stall-fixture');a.presentationTransition=null;}f.sim.drainEvents();}
  const initial={snapshot:source.sim.snapshot(),ownership:{mode:'local-owner-v1',actors:epochs}};
  tx.reconcile(source.sim,initial,'rs');rx.reconcile(victim.sim,initial,'target');
  const queue=[],births=[],ends=[];let firstActive;
  const deliver=report=>{
    if(route==='peer')return rx.receivePeer(victim.sim,'rs',report,'target');
    const snapshot=victim.sim.snapshot();Object.assign(snapshot.actors.find(a=>a.id==='rs'),report.actor);
    rx.reconcile(victim.sim,{snapshot,ownership:{mode:'local-owner-v1',actors:epochs},owners:{rs:report},
      recentActions:{rs:{actions:report.actions,epoch:1,frameSeq:report.frameSeq}}},'target');
  };
  for(let frame=1;frame<=360;frame++){
    tx.beforeStep(source.sim,'rs');source.sim.step(dt,{rs:frame===1?{pressed:['A'],held:['A']}:{}} ,{snapshot:false});
    const report=tx.afterStep(source.sim,'rs',source.sim.drainEvents());
    if(report){report.actions=report.actions.map(({ageFrames,...a})=>a);queue.push(report);if(report.effects.some(e=>e.active)&&!firstActive)firstActive=structuredClone(report);}
    // Preserve every real source report, then deliver it in order after a
    // 1.1 second downlink gap. The local native main handle ends in the gap;
    // the backlog still contains the source's earlier active pose.
    if(frame<175||frame>240)while(queue.length)deliver(queue.shift());
    rx.beforeStep(victim.sim,'target');victim.sim.step(dt,{}, {snapshot:false});
    const events=victim.sim.drainEvents();births.push(...events.filter(e=>e.type==='effectStarted'&&e.actorId==='rs'));
    ends.push(...events.filter(e=>e.type==='effectEnded'&&e.actorId==='rs'));
  }
  assert.equal(births.length,2,'the original center and blade each birth once through live and history paths');
  assert.equal(new Set(births.map(e=>e.effectId)).size,2);
  assert.equal(ends.filter(e=>e.reason==='original-mesh-play-end').length,2,'both original native handles actually ended before resume');
  assert.equal(victim.sim.state.effects.filter(e=>e.ownerId==='rs').length,0,'latest ended state leaves no combat mesh after resume');
  victim.sim.drainEvents();firstActive.epoch=2;
  applyOwnedState(victim.sim,'rs',firstActive);
  assert.equal(victim.sim.drainEvents().filter(e=>e.type==='effectStarted').length,2,'a genuinely new owner life may reuse the same source IDs');
  tx.clear();rx.clear();
});
function packetWithEffects(report,frameSeq,ids){
  // Synthetic source IDs/counts exercise the public wire upper limit with
  // the actual frozen ground-fire declaration; they are not original casts.
  const wire={name:ground,setName:null,ownerStateSerial:report.actor.stateSerial,clock:'custom',start:0,
    elapsed:.1,animationTime:.1,active:true,dead:false,hitCount:0,childCounts:{},soundFired:[],deleteConditions:[],
    birthAnchor:{position:[160,3080,0],rotation:[0,0,0],facing:1},currentAnchor:{position:[160,3080,0],rotation:[0,0,0],facing:1}};
  return validateOwnedState({...report,frameSeq,effects:ids.map(id=>({...wire,id})),hits:[]});
}
test('more than256 recent effect IDs cannot erase a retired parent link or replay a started child',()=>{
  const {victim,child,report,wire}=groundBeforeOwnerReport();
  for(let frame=21;frame<=30;frame++)applyOwnedState(victim.sim,'vc',packetWithEffects(report,frame,
    Array.from({length:MAX_OWNER_EFFECTS},(_,i)=>10000+frame*MAX_OWNER_EFFECTS+i)));
  // Restore the actual prediction that was replaced by the narrow owner body
  // while newer short effects were delivered. The parent identity still falls
  // inside the admitted60-source-frame historical compensation window.
  victim.sim.state.effects.push(child);victim.sim.drainEvents();
  applyOwnedState(victim.sim,'vc',{...report,frameSeq:31});
  assert.equal(victim.sim.state.effects.find(e=>e.networkId===wire.id),child);
  assert.equal(victim.sim.drainEvents().filter(e=>e.type==='effectStarted'&&e.name===ground).length,0);
  assert.ok(ownedEffectLinkDiagnostics(victim.sim).identities>256,'the valid short source burst actually exceeds the old fixed cache');
});
test('live source identities survive sustained schema-limit churn; ended receipts leave after the supported window',()=>{
  const {source,victim}=fixture(),report=encodeOwnedState(source.sim,'vc',{epoch:1,frameSeq:1});
  let first;
  for(let frame=1;frame<=OWNER_ACTION_HISTORY_FRAMES*3;frame++){
    applyOwnedState(victim.sim,'vc',packetWithEffects(report,frame,[1,...Array.from({length:MAX_OWNER_EFFECTS-1},(_,i)=>10000+frame*MAX_OWNER_EFFECTS+i)]));
    const live=victim.sim.state.effects.find(e=>e.networkId===1);if(!first)first=live.id;
    assert.equal(live.id,first,'long-lived source member cannot be evicted by short-lived effects');
    assert.ok(ownedEffectLinkDiagnostics(victim.sim).maxOwnerIdentities<=MAX_RECENT_OWNER_EFFECT_LINKS);
    const births=victim.sim.drainEvents().filter(e=>e.type==='effectStarted'&&e.effectId===first);
    assert.equal(births.length,frame===1?1:0);
  }
  applyOwnedState(victim.sim,'vc',{...report,frameSeq:OWNER_ACTION_HISTORY_FRAMES*4+1,effects:[]});
  assert.equal(ownedEffectLinkDiagnostics(victim.sim).identities,0,'no ended-life meshes or indefinitely growing seen IDs remain');
});
test('restoring a clean simulation snapshot resets receiver-only links while temporary array swaps retain them',()=>{
  const {source,victim}=fixture(),clean=victim.sim.snapshot(),report=encodeOwnedState(source.sim,'vc',{epoch:1,frameSeq:1});
  const packet=packetWithEffects(report,1,[1]);applyOwnedState(victim.sim,'vc',packet);victim.sim.drainEvents();
  assert.equal(ownedEffectLinkDiagnostics(victim.sim).identities,1);
  victim.sim.restore(clean);assert.equal(ownedEffectLinkDiagnostics(victim.sim).identities,0);
  applyOwnedState(victim.sim,'vc',packet);
  assert.equal(victim.sim.drainEvents().filter(e=>e.type==='effectStarted').length,1,'a clean display/simulation reset may birth its initial source identity again');
});

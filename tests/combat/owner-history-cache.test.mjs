/** Receiver cache scope with a genuine native single-Z sample. Synthetic
 * network IDs/order isolate adapter identity; these are not target traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const assets=await loadServerCombatAssets({root,assetRoot:path.join(root,'artifacts')});
async function make(owner,skillId=null){const {native,samplers}=await assets.createRuntime();
  const preset={...assets.preset,onlineMatch:true,...(skillId==null?{}:{loadout:[{skillId},null,null,null,null,null,null,null]})};
  const sim=createSimulation({profile:assets.profile,map:assets.map,preset,seed:2016,networkOwnerId:owner,
    actors:[{id:'sender',team:0,position:[2022.98,2840,0],lineId:6,facing:-1},{id:'receiver',team:1,position:[1920,2840,0],lineId:6,facing:1}],...samplers,
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:assets.versions});
  for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','cache-scope-fixture');}sim.drainEvents();return sim;}
async function fixture(){const source=await make('sender'),receiver=await make('receiver');
  for(let frame=1;frame<=6;frame++){source.step(1/60,{sender:{pressed:frame===1?['Z']:[],held:frame===1?['Z']:[]}},{snapshot:false});source.drainEvents();}
  const report=encodeOwnedState(source,'sender',{epoch:1,frameSeq:6});
  const sample=encodeCriticalAction(report,{id:6,effectIds:new Set(report.effects.map(effect=>effect.id))});
  assert.equal(sample.effects.length,1);assert.equal(sample.effects[0].name,'DamageEffect_RF_COMBO_Z');
  const consumer=createRemoteActionConsumer({clock:()=>0}),nativeTick=receiver.tickEffects.bind(receiver);let mesh,events=[];
  receiver.tickEffects=dt=>{mesh=receiver.state.effects.find(effect=>effect.ownerId==='sender');return nativeTick(dt);};
  const receive=(id,effectId=sample.effects[0].id,effects=true)=>{
    const action={...structuredClone(sample),id,frameSeq:id,effects:effects?sample.effects.map(effect=>({...structuredClone(effect),id:effectId})):[]};
    consumer.receive('sender',[action],1,id);assert.equal(consumer.consume(receiver,'receiver',()=>1),1);
    events=receiver.drainEvents();return events.filter(event=>event.type==='hit'&&event.targetId==='receiver');
  };
  return {receiver,consumer,receive,get mesh(){return mesh;},get events(){return events;}};
}

test('a native history sample clones only its named retired mesh and preserves accepted hit receipts',async t=>{
  const f=await fixture();t.after(()=>f.consumer.clear());const hp=f.receiver.actor('receiver').hp;
  const first=f.receive(6);assert.equal(first.length,1,'authored native Z helpers hit the receiver');
  let reads=0;Object.defineProperty(f.mesh,'cacheCopySentinel',{enumerable:true,get(){reads++;return true;}});
  const next=f.receive(12,101);assert.equal(next.length,1,'a distinct source network ID remains a legal attack');
  assert.equal(reads,0,'unrelated retired meshes cannot be deep-copied into a new action');
  const repeat=f.receive(18);assert.equal(reads,1,'the named retired mesh is still restored');
  assert.equal(repeat.length,0,'its player/life/ID/stage hit receipt survives cache scoping');
  assert.equal(f.receiver.actor('receiver').hp,hp-first[0].amount-next[0].amount);
  assert.equal(f.receiver.state.effects.length,0,'temporary histories do not replace current presentation');
  assert.equal(f.consumer.diagnostics.effectReceipts,2);assert.equal(f.consumer.diagnostics.lastRestoredMeshes,1);
});

test('an actor-only history performs no retired effect copy after repeated native effect identities',async t=>{
  const f=await fixture();t.after(()=>f.consumer.clear());f.receiver.actor('receiver').invincible=true;let reads=0;
  for(let id=1;id<=32;id++){
    f.receive(id*60,id);Object.defineProperty(f.mesh,'cacheCopySentinel',{enumerable:true,get(){reads++;return true;}});
  }
  assert.equal(reads,0,'warming separate source IDs must not copy previous retired mesh objects');
  assert.deepEqual(f.receive(2000,0,false),[]);assert.equal(reads,0,'no effect named in this action means no retired effect restored');
  assert.equal(f.receiver.state.effects.length,0);
  assert.equal(f.consumer.diagnostics.effectReceipts,0,'the actor-only frame is beyond every retired effect\'s supported60-frame window');assert.equal(f.consumer.diagnostics.lastRestoredMeshes,0);
});

test('temporary native ArcEnemy history emits no orphan remote visual births but preserves live event prefix',async t=>{
  const source=await make('sender',24008),receiver=await make('receiver',24008),consumer=createRemoteActionConsumer({clock:()=>0});
  t.after(()=>consumer.clear());source.actor('sender').mp=300;let sample;
  for(let frame=1;frame<=180;frame++){
    source.step(1/60,frame===1?{sender:{pressed:['A'],held:['A']}}:{},{snapshot:false});source.drainEvents();
    const report=encodeOwnedState(source,'sender',{epoch:1,frameSeq:frame});
    if(report.effects.some(effect=>effect.active&&/ARC_ENEMY/.test(effect.name))){sample=encodeCriticalAction(report,{id:frame,effectIds:new Set(report.effects.map(effect=>effect.id))});break;}
  }
  assert.ok(sample,'actual native skill input produced active ArcEnemy meshes');
  const prefix=receiver.emit('effectStarted','sender',{effectId:7000,name:'existing-live-prefix'});
  consumer.receive('sender',[sample],1,sample.frameSeq);assert.equal(consumer.consume(receiver,'receiver',()=>1),1);
  const events=receiver.drainEvents();assert.equal(events[0],prefix,'events enqueued before this history retain their exact object/order');
  assert.equal(events.filter(event=>event.actorId==='sender'&&['effectStarted','effectStartParticles','effectTimedParticles','effectEnded'].includes(event.type)).length,1,'only the pre-existing live event remains');
  assert.ok(consumer.diagnostics.lastFilteredMeshEvents>0,'temporary native mesh events actually traversed the isolated tail');
  assert.equal(receiver.state.effects.filter(effect=>effect.ownerId==='sender').length,0);
  consumer.clear();assert.equal(consumer.diagnostics.totalFilteredMeshEvents,0);assert.equal(consumer.diagnostics.effectReceipts,0);
});

test('history keeps native hit feedback and a victim-owned Nasod guard reaction while discarding the attacker mesh events',async t=>{
  const f=await fixture();t.after(()=>f.consumer.clear());const target=f.receiver.actor('receiver');
  // This authored Z effect anchor lies to the receiver's left. Face that
  // actual attack origin so the native front-contact guard gate is eligible.
  target.facing=-1;
  target.awakening.remaining=20;target.core.level=2;target.core.gauge=40;target.core.phase='idle';target.core.helperLive=true;
  const eventsBefore=f.receiver.emit('effectStarted','sender',{effectId:7000,name:'existing-live-prefix'});
  const hits=f.receive(6);assert.equal(hits.length,1);assert.equal(hits[0].guarded,true);assert.ok(hits[0].damageNumber);
  const local=f.receiver.state.effects.filter(effect=>effect.ownerId==='receiver');
  assert.ok(local.length>0,'actual native guard retains its victim-owned effect after history restoration');
  assert.equal(f.events[0],eventsBefore);
  const previousTick=f.receiver.tickEffects.bind(f.receiver);
  // Activate the existing local guard FX and a new guard's FX with two zero-dt
  // passes inside the next history. This isolates event scoping, without
  // claiming this controlled ordering is the original client's frame order.
  f.receiver.tickEffects=dt=>{previousTick(dt);previousTick(0);};
  const nextPrefix=f.receiver.emit('effectStarted','sender',{effectId:7000,name:'existing-live-prefix'});
  assert.equal(f.receive(12,101).length,1);
  const events=f.events;assert.equal(events[0],nextPrefix);
  assert.ok(events.some(event=>event.type==='effectStarted'&&event.actorId==='receiver'),'victim-owned visual birth in this history tail is preserved');
  assert.ok(events.some(event=>event.type==='effectStarted'&&event.actorId==='sender'&&event.effectId===7000),'earlier live prefix remains');
  assert.ok(events.some(event=>event.type==='hit'&&event.damageNumber),'canonical hit feedback remains');
  assert.ok(events.some(event=>event.type==='sound'&&event.actorId==='receiver'),'canonical received-hit/guard sound remains');
  assert.equal(events.filter(event=>event.actorId==='sender'&&['effectStarted','effectStartParticles','effectTimedParticles','effectEnded'].includes(event.type)&&event.effectId!==7000).length,0);
});

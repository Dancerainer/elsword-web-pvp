/** Production receiver/simulation with frozen RF damage and explicit timing /
 * sphere fixtures; the Arc row test additionally uses compiled Native input.
 * None of these are WAN or original-client measurements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction,encodeEffectState} from '../../packages/online/owned-state.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {arcNativeInput} from '../../packages/combat-core/skill-candidates.mjs';
import {arcLineBasis} from '../../packages/combat-core/archenemy-mesh.mjs';

const base=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const dt=1/60,map={sceneId:'playback-v12-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture({finite=false,maxQueued=96,maxQueueMs=1000,maxTombstones=1024}={}){
  const profile=structuredClone(base);
  // A disclosed timed controller isolates replay phase without guessing an
  // original command's pose/velocity. Damage is the frozen source ball table.
  profile.states.PLAYBACK_TEST_Z={animationName:'Wait',raw:{ANIM_NAME:'Wait',ANIM_SPEED:1,PLAY_TYPE:2,APPLY_ANIM_MOVE:0,
    ATTACK_TIME0:{1:.12,2:.22},DAMAGE_DATA:structuredClone(base.damageEffects.RAVEN_NASOD_BALL.raw.DAMAGE_DATA)}};
  if(finite){profile.damageEffects.RAVEN_HYPER_AURA.raw.DAMAGE_TIME=.08;profile.effectTemplates.Raven_Aura.fields.LifeTime=.08;}
  const sim=createSimulation({profile,map,networkOwnerId:'owner',seed:2016,preset:{passives:[],guildPassives:[]},
    collisionSampler:()=>[{kind:'sphere',center:[30,50,0],radius:30}],
    defenderSampler:actor=>[{kind:'sphere',center:[actor.x,actor.y+50,actor.z],radius:20}],
    effectSampler:effect=>[{kind:'sphere',center:[effect.x+30,effect.y+50,effect.z],radius:30}],
    actors:[{id:'source',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
      {id:'owner',team:1,position:[30,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  const source=sim.actor('source'),owner=sim.actor('owner');
  source.inputLock=owner.inputLock=0;sim.enter(source,'RSI_WAIT','fixture');sim.enter(owner,'RSI_WAIT','fixture');sim.drainEvents();
  let now=0,epoch=1;const playback=createRemoteCombatPlayback({clock:()=>now,maxQueued,maxQueueMs,maxTombstones});
  playback.bind(sim,'owner',()=>epoch);
  function action(id,frame=id,{start=true,state='PLAYBACK_TEST_Z',effects=[],held=[]}={}){
    const packet=encodeOwnedState(sim,'source',{epoch,frameSeq:frame}),value=encodeCriticalAction(packet,{id,frameSeq:frame});
    // This synthetic timed controller explicitly runs at unit speed. Its
    // header must not accidentally inherit the fixture's just-entered WAIT
    // speed ramp now that reliable actions preserve reaction transition intent.
    Object.assign(value.actor,{state,stateSerial:10+id,animationName:'Wait',animationTime:.19,stateTime:.19,
      animationPlaybackSpeed:1,animationSpeedRamp:null,
      fired:['STOP_OTHER_UNIT0'],x:-900,y:300,z:0});
    value.effects=effects;value.playback={version:1,start,held};return value;
  }
  function step(count=1){for(let i=0;i<count;i++){
    playback.beforeStep(sim,'owner',()=>epoch);sim.step(dt,playback.remoteInputs(sim,'owner'),{snapshot:false});
    playback.afterStep(sim);now+=1000/60;
  }}
  function nativeEffect(){return sim.createEffect(source,structuredClone(profile.effectSets.EffectSet_RAVEN_HYPER_AURA.raw.EFFECT0),
    {setName:'EffectSet_RAVEN_HYPER_AURA',clock:'custom',start:0});}
  return {sim,profile,source,owner,playback,action,step,nativeEffect,setNow(value){now=value;},setEpoch(value){epoch=value;}};
}

test('late controller admission does no historical collision, old phase/position/STOP are not installed, normal visible phase hits later',()=>{
  const f=fixture(),hp=f.owner.hp,action=f.action(1,40);
  assert.equal(f.playback.receiveActions('source',[action],1,40),true);
  assert.equal(f.playback.beforeStep(f.sim,'owner',()=>1),1);
  assert.equal(f.owner.hp,hp);assert.equal(f.owner.worldStop,0);assert.equal(f.source.animationTime,0);assert.equal(f.source.x,0);
  assert.ok(!f.source.fired.includes('STOP_OTHER_UNIT0'));
  f.step(6);assert.equal(f.owner.hp,hp,'the new local animation has not entered its attack window');
  f.step(3);assert.ok(f.owner.hp<hp);assert.ok(f.source.animationTime>.12&&f.source.animationTime<.22);
  const once=f.owner.hp;f.playback.receiveActions('source',[action],1,40);f.step();assert.equal(f.owner.hp,once);
});

test('moving out before a delayed action plays produces no damage and no old victim geometry exists',()=>{
  const f=fixture();f.owner.x=500;const before=structuredClone(f.owner);
  f.playback.receiveActions('source',[f.action(1,10)],1,10);f.step(15);
  assert.equal(f.owner.hp,before.hp);assert.equal(f.owner.x,500);assert.equal(f.sim.receiverContactGeometry,undefined);
  assert.equal(f.sim.state.events.filter(event=>event.type==='hit'&&event.targetId==='owner').length,0);
});

test('a current owner guard rejects the naturally played contact without being replaced by sender fields',()=>{
  const f=fixture();f.owner.invincible=true;f.owner.forceInvincible=2;const hp=f.owner.hp;
  const action=f.action(1,20);action.actor.invincible=false;action.actor.forceInvincible=0;
  f.playback.receiveActions('source',[action],1,20);f.step(15);
  assert.equal(f.owner.hp,hp);assert.ok(f.owner.forceInvincible>1);assert.equal(f.owner.x,30);
});

test('reversed arrivals play source ordered controllers at their relative frame spacing instead of a one-step combo burst',()=>{
  const f=fixture(),first=f.action(1,10),second=f.action(2,16,{state:'RSI_WAIT'});
  f.playback.receiveActions('source',[second],1,16);f.playback.receiveActions('source',[first],1,16);
  f.playback.beforeStep(f.sim,'owner',()=>1);assert.equal(f.source.state,'PLAYBACK_TEST_Z');
  for(let i=0;i<5;i++)f.playback.beforeStep(f.sim,'owner',()=>1);
  assert.equal(f.source.state,'PLAYBACK_TEST_Z');assert.equal(f.playback.diagnostics.pending,1);
  f.playback.beforeStep(f.sim,'owner',()=>1);assert.equal(f.source.state,'RSI_WAIT');assert.equal(f.playback.diagnostics.pending,0);
});

test('a late unseen next controller starts at phase zero and rebases subsequent events rather than fast-forwarding',()=>{
  const f=fixture();f.playback.receiveActions('source',[f.action(1,1)],1,1);f.step(12);
  const late=f.action(2,5),following=f.action(3,11,{state:'RSI_WAIT'});
  f.playback.receiveActions('source',[late,following],1,11);f.playback.beforeStep(f.sim,'owner',()=>1);
  assert.equal(f.source.stateSerial,late.actor.stateSerial);assert.equal(f.source.animationTime,0);
  assert.equal(f.playback.diagnostics.pending,1);assert.ok(f.playback.diagnostics.rebasedStarts>0);
});

test('held levels preserve remote charge data without synthesizing pressed/released or device double taps',()=>{
  const f=fixture();f.playback.receiveActions('source',[f.action(1,1,{held:['Z','RIGHT']})],1,1);
  f.playback.beforeStep(f.sim,'owner',()=>1);
  assert.deepEqual(f.playback.remoteInputs(f.sim,'owner'),{source:{held:['Z','RIGHT'],pressed:[],released:[],sampledDevice:true}});
});

test('wire body calibration supplies a motion target while preserving live controller and animation clocks',()=>{
  const f=fixture();f.owner.x=500;f.owner.landPosition=[500,0,0];f.playback.receiveActions('source',[f.action(1,1)],1,1);f.step(3);
  const packet=encodeOwnedState(f.sim,'source',{epoch:1,frameSeq:7});
  packet.actor.x=100;packet.actor.animationTime=100;packet.actor.stateTime=7*dt;packet.actor.stateSerial=f.source.stateSerial;
  packet.actor.hp-=5;packet.actor.mp-=3;const localVitals=[f.owner.hp,f.owner.mp];
  assert.equal(f.playback.observeState(f.sim,'source',packet,'owner'),true);
  assert.equal(f.source.hp,packet.actor.hp);assert.equal(f.source.mp,packet.actor.mp);assert.deepEqual([f.owner.hp,f.owner.mp],localVitals);
  const stale=structuredClone(packet);stale.actor.hp-=20;stale.actor.mp-=20;
  f.playback.observeState(f.sim,'source',stale,'owner');assert.equal(f.source.hp,packet.actor.hp);assert.equal(f.source.mp,packet.actor.mp);
  // A source pose ahead of this playback clock cannot pull the controller
  // into the future. First execute its corresponding positive local frames.
  f.step(4);const before=f.source.animationTime;
  f.playback.beforeStep(f.sim,'owner',()=>1);assert.equal(f.source.animationTime,before);assert.ok(f.source.x>0&&f.source.x<100);
  assert.equal(f.owner.x,500);
});

test('late canonical birth claims the running Native object without changing its local clock or accepted receipt',()=>{
  const f=fixture(),effect=f.nativeEffect();effect.active=true;effect.elapsed=.4;effect.animationTime=.4;
  effect.hits.owner=.25;effect.hitGaps={owner:2.5};
  const state=encodeEffectState(effect,f.profile);state.id=400;state.elapsed=99;state.animationTime=99;
  f.playback.receiveActions('source',[f.action(1,1,{start:false,effects:[state]})],1,1);f.playback.beforeStep(f.sim,'owner',()=>1);
  assert.equal(f.sim.state.effects.filter(value=>value.name===effect.name).length,1);assert.equal(effect.networkId,400);
  assert.equal(effect.elapsed,.4);assert.equal(effect.animationTime,.4);assert.equal(effect.hits.owner,.25);assert.equal(effect.hitGaps.owner,2.5);
});

test('unknown first birth uses current source position and new timers, does not erase another live object or perform immediate damage',()=>{
  const f=fixture();f.owner.x=500;const other=f.nativeEffect(),state=encodeEffectState(other,f.profile);
  state.id=400;state.name='RAVEN_NASOD_BALL';delete state.setName;delete state.definitionMember;
  state.x=-900;state.y=300;state.elapsed=99;state.animationTime=99;state.stage=1;
  state.sourceMeshGlobalTime=99;state.sourceSinglePlayMeshEndPending=true;state.sourceXCrashMeshEndPending=true;
  const hp=f.owner.hp;f.playback.receiveActions('source',[f.action(1,1,{start:false,effects:[state]})],1,1);
  f.playback.beforeStep(f.sim,'owner',()=>1);const installed=f.sim.state.effects.find(effect=>effect.networkId===400);
  assert.ok(installed);assert.ok(f.sim.state.effects.includes(other));assert.equal(installed.elapsed,0);assert.equal(installed.animationTime,0);
  assert.equal(installed.stage,0);assert.equal(installed.x,f.source.x);assert.equal(f.owner.hp,hp);
  assert.deepEqual(installed.birthAnchor.position,[f.source.x,f.source.y,f.source.z]);
  assert.equal(installed.sourceMeshGlobalTime,undefined);assert.equal(installed.sourceSinglePlayMeshEndPending,undefined);
  assert.equal(installed.sourceXCrashMeshEndPending,undefined);f.step();
  assert.ok(f.sim.state.effects.includes(installed),'a copied past mesh-end pulse cannot retire a fresh locally playing birth');
});

test('natural finite retirement leaves a canonical tombstone and delayed birth cannot recreate the projectile',()=>{
  const f=fixture({finite:true});f.owner.x=500;const effect=f.nativeEffect(),state=encodeEffectState(effect,f.profile);state.id=400;
  f.step(9);assert.ok(!f.sim.state.effects.includes(effect));
  f.playback.receiveActions('source',[f.action(1,10,{start:false,effects:[state]})],1,10);f.playback.beforeStep(f.sim,'owner',()=>1);
  assert.equal(f.sim.state.effects.filter(value=>value.networkId===400).length,0);
  assert.ok(f.playback.diagnostics.lateBirthsRejected>0);assert.equal(f.playback.diagnostics.owners.source.tombstones,1);
});

test('unknown terminal, duplicate end, and a later active packet cannot revive the closed identity',()=>{
  const f=fixture(),state=encodeEffectState(f.nativeEffect(),f.profile);state.id=400;
  const terminal={...state,dead:true,endEmitted:true,active:false};
  f.playback.receiveActions('source',[f.action(1,1,{start:false,effects:[terminal]})],1,1);f.playback.beforeStep(f.sim,'owner',()=>1);
  f.playback.receiveActions('source',[f.action(2,2,{start:false,effects:[state]}),f.action(3,3,{start:false,effects:[terminal]})],1,3);
  f.playback.beforeStep(f.sim,'owner',()=>1);f.playback.beforeStep(f.sim,'owner',()=>1);
  assert.equal(f.sim.state.effects.filter(value=>value.networkId===400&&!value.dead).length,0);
});

test('an expired non-start projectile birth cannot return as a fresh damaging object through a later live snapshot',()=>{
  const producer=fixture(),f=fixture();
  const source=producer.nativeEffect();
  const state=encodeEffectState(source,producer.profile);state.id=400;
  const hp=f.owner.hp;
  f.playback.observeSource('source',1,31);
  f.playback.receiveActions('source',[f.action(1,1,{start:false,effects:[state]})],1,31);f.step();
  assert.equal(f.playback.diagnostics.expired,1);assert.equal(f.sim.state.effects.length,0);
  f.playback.receiveActions('source',[f.action(2,31,{start:false,effects:[{...state,elapsed:.5,animationTime:.5}]})],1,31);
  f.step(20);
  assert.equal(f.owner.hp,hp,`late active metadata cannot create a second opportunity to damage the owner; births=${f.playback.diagnostics.births}`);
  assert.equal(f.playback.diagnostics.births,0,'expired birth identity cannot restart at local time zero');
  assert.equal(f.sim.state.events.filter(e=>e.type==='hit'&&e.targetId==='owner').length,0);
});

test('expired metadata binds an already locally running birth without resetting its clock or real accepted hit receipt',()=>{
  const f=fixture(),effect=f.nativeEffect();f.step();
  const state=encodeEffectState(effect,f.profile);state.id=400;
  const hp=f.owner.hp,hits=structuredClone(effect.hits),gaps=structuredClone(effect.hitGaps),elapsed=effect.elapsed;
  assert.ok(hp<50000,'production collision already accepted a local hit');
  f.playback.observeSource('source',1,31);
  f.playback.receiveActions('source',[f.action(1,1,{start:false,effects:[state]})],1,31);f.playback.beforeStep(f.sim,'owner',()=>1);
  assert.equal(effect.networkId,400);assert.notEqual(effect.dead,true);assert.equal(effect.elapsed,elapsed);
  assert.deepEqual(effect.hits,hits);assert.deepEqual(effect.hitGaps,gaps);assert.equal(f.owner.hp,hp);
  assert.equal(f.playback.diagnostics.births,0);assert.equal(f.playback.diagnostics.expiredBirthsRetired,0);
  f.playback.receiveActions('source',[f.action(2,31,{start:false,effects:[state]})],1,31);f.step(10);
  assert.equal(f.owner.hp,hp,'canonical continuation keeps the live object hit gap');
  assert.equal(f.sim.state.effects.filter(e=>e.networkId===400).length,1);
});

for(const expired of [false,true])test(`terminal retires an unclaimed Native prediction and keeps its accepted receipt, expired=${expired}`,()=>{
  const f=fixture(),effect=f.nativeEffect();f.step();
  const state=encodeEffectState(effect,f.profile);state.id=400;
  const hp=f.owner.hp,hits=structuredClone(effect.hits),gaps=structuredClone(effect.hitGaps);
  const frame=expired?31:1;f.playback.observeSource('source',1,frame);
  f.playback.receiveActions('source',[f.action(1,1,{start:false,effects:[{...state,dead:true,endEmitted:true}]})],1,frame);
  f.playback.beforeStep(f.sim,'owner',()=>1);
  assert.equal(effect.dead,true);assert.equal(effect.networkId,400);
  assert.deepEqual(effect.hits,hits);assert.deepEqual(effect.hitGaps,gaps);assert.equal(f.owner.hp,hp);
  f.playback.receiveActions('source',[f.action(2,frame,{start:false,effects:[state]})],1,frame);f.step(8);
  assert.equal(f.sim.state.effects.some(e=>e.networkId===400),false);assert.equal(f.owner.hp,hp);
});

test('a rejected old birth cannot block a different fresh instance or the same numeric ID in a new life',()=>{
  const producer=fixture(),f=fixture(),state=encodeEffectState(producer.nativeEffect(),producer.profile);state.id=400;
  f.playback.observeSource('source',1,31);f.playback.receiveActions('source',[f.action(1,1,{start:false,effects:[state]})],1,31);f.step();
  f.playback.receiveActions('source',[f.action(2,31,{start:false,effects:[{...state,id:401}]})],1,31);f.step(10);
  assert.ok(f.sim.state.effects.some(e=>e.networkId===401));assert.equal(f.sim.state.effects.some(e=>e.networkId===400),false);
  f.playback.reset('source',2);f.setEpoch(2);
  f.playback.receiveActions('source',[f.action(3,1,{start:false,effects:[state]})],2,1);f.step();
  assert.ok(f.sim.state.effects.some(e=>e.networkId===400&&e.networkEpoch===2));
});

test('duplicate terminal cannot claim and kill a newer same-name prediction from the same controller',()=>{
  const f=fixture(),first=f.nativeEffect(),state=encodeEffectState(first,f.profile);state.id=400;
  const terminal={...state,dead:true,endEmitted:true};
  f.playback.receiveActions('source',[f.action(1,1,{start:false,effects:[terminal]})],1,1);f.step();
  const next=f.nativeEffect();
  f.playback.receiveActions('source',[f.action(2,2,{start:false,effects:[terminal]})],1,2);f.playback.beforeStep(f.sim,'owner',()=>1);
  assert.notEqual(next.dead,true);assert.equal(next.networkId,undefined);
  f.playback.receiveActions('source',[f.action(3,3,{start:false,effects:[{...encodeEffectState(next,f.profile),id:401}]})],1,3);
  f.playback.beforeStep(f.sim,'owner',()=>1);assert.equal(next.networkId,401);assert.notEqual(next.dead,true);
});

test('an expired terminal cannot create a fresh DIE_DAMAGE_EFFECT explosion from a locally predicted projectile',()=>{
  const f=fixture(),effect=f.sim.createEffect(f.source,structuredClone(f.profile.effectSets.EffectSet_SA_Raven_SevenBurst.raw.EFFECT2),
    {setName:'EffectSet_SA_Raven_SevenBurst',clock:'custom',start:0,birthAnchor:{position:[0,0,0],rotation:[0,0,0],facing:1}});
  const state=encodeEffectState(effect,f.profile);state.id=400;const hp=f.owner.hp;
  f.playback.observeSource('source',1,31);
  f.playback.receiveActions('source',[f.action(1,1,{start:false,effects:[{...state,dead:true,endEmitted:true}]})],1,31);
  f.step(20);
  assert.equal(f.owner.hp,hp,'a network terminal cannot execute the old projectile death attack');
  assert.equal(f.sim.state.events.some(e=>e.type==='damageSecondaryCreated'&&e.parentEffectId===effect.id),false);
  assert.equal(f.sim.state.effects.some(e=>e.parentEffectId===effect.id),false);
});

test('a real locally reached projectile death still creates its original DIE_DAMAGE_EFFECT child',()=>{
  const f=fixture(),effect=f.sim.createEffect(f.source,structuredClone(f.profile.effectSets.EffectSet_SA_Raven_SevenBurst.raw.EFFECT2),
    {setName:'EffectSet_SA_Raven_SevenBurst',clock:'custom',start:0,birthAnchor:{position:[0,0,0],rotation:[0,0,0],facing:1}});
  f.step(20);
  assert.ok(f.sim.state.events.some(e=>e.type==='damageSecondaryCreated'&&e.parentEffectId===effect.id
    &&e.name==='DamageEffect_SA_Raven_SevenBurst_Projectile_Explosion'));
});

test('bounded tombstone eviction cannot resurrect old IDs or retire an unrelated already live instance',()=>{
  const producer=fixture(),f=fixture({maxTombstones:2}),state=encodeEffectState(producer.nativeEffect(),producer.profile);
  f.playback.receiveActions('source',[f.action(1,1,{start:false,effects:[{...state,id:300}]})],1,1);f.step();
  const live=f.sim.state.effects.find(e=>e.networkId===300);assert.ok(live);
  for(let i=0;i<3;i++){
    f.playback.receiveActions('source',[f.action(2+i,2+i,{start:false,effects:[{...state,id:400+i,dead:true,endEmitted:true}]})],1,2+i);f.step();
  }
  assert.equal(f.playback.diagnostics.owners.source.tombstones,2);assert.equal(f.playback.diagnostics.owners.source.retiredThrough,400);
  f.playback.receiveActions('source',[f.action(5,5,{start:false,effects:[{...state,id:400},{...state,id:300}]})],1,5);f.step();
  assert.equal(f.sim.state.effects.some(e=>e.networkId===400),false);assert.equal(live.dead,false);
  assert.equal(f.sim.state.effects.find(e=>e.networkId===300),live);assert.equal(f.playback.diagnostics.births,1);
});

test('a retired parent keeps a bounded numeric link so a late canonical child claims its actual local birth once',()=>{
  const f=fixture(),parent=f.nativeEffect(),parentState=encodeEffectState(parent,f.profile);parentState.id=400;
  f.playback.receiveActions('source',[f.action(1,1,{start:false,effects:[parentState]})],1,1);f.playback.beforeStep(f.sim,'owner',()=>1);
  assert.equal(parent.networkId,400);parent.dead=true;f.step();
  assert.equal(f.playback.diagnostics.owners.source.effects,0);assert.equal(f.playback.diagnostics.owners.source.parentLinks,1);
  const child=f.sim.createEffect(f.source,{NAME:'RAVEN_NASOD_BALL'},{parentEffectId:parent.id}),childState=encodeEffectState(child,f.profile);
  childState.id=401;childState.parentEffectId=400;
  f.playback.receiveActions('source',[f.action(2,3,{start:false,effects:[childState]})],1,3);f.playback.beforeStep(f.sim,'owner',()=>1);
  assert.equal(child.networkId,401);assert.equal(child.parentEffectId,parent.id);
  assert.equal(f.sim.state.effects.filter(effect=>effect.name==='RAVEN_NASOD_BALL').length,1);
  assert.equal(f.sim.state.effects.some(effect=>effect.networkId===400),false,'the parent link is not a resurrected actor/effect');
});

test('queue overflow refuses admission without evicting admitted events; consumed capacity can be retried',()=>{
  const f=fixture({maxQueued:2});const actions=[f.action(1,1),f.action(2,2),f.action(3,3)];
  assert.equal(f.playback.receiveActions('source',actions,1,3),false);assert.equal(f.playback.diagnostics.pending,2);
  f.playback.beforeStep(f.sim,'owner',()=>1);assert.equal(f.playback.receiveActions('source',[actions[2]],1,3),true);
});

test('expired unplayed actions never settle their old windows, and their terminal still closes an identity',()=>{
  const f=fixture({maxQueueMs:100});const hp=f.owner.hp;
  f.playback.receiveActions('source',[f.action(1,1)],1,1);f.setNow(101);f.playback.beforeStep(f.sim,'owner',()=>1);
  assert.equal(f.source.state,'RSI_WAIT');assert.equal(f.owner.hp,hp);assert.equal(f.playback.diagnostics.expired,1);
});

test('life reset retires old objects and prevents an old queue or old birth from entering a fresh life',()=>{
  const f=fixture();f.playback.receiveActions('source',[f.action(1,1)],1,1);
  f.playback.reset('source',2);f.setEpoch(2);
  assert.equal(f.playback.receiveActions('source',[f.action(2,2)],1,2),true);
  f.playback.beforeStep(f.sim,'owner',()=>2);assert.equal(f.source.state,'RSI_WAIT');assert.equal(f.playback.diagnostics.pending,0);
  assert.ok(f.playback.diagnostics.staleLife>0);
});

test('local-owner input is rejected even if it arrived before bind; clear removes only this receiver hook',()=>{
  const f=fixture(),prior=f.sim.createEffect;f.playback.clear();
  const unbound=createRemoteCombatPlayback({clock:()=>0});unbound.receiveActions('owner',[f.action(1,1)],1,1);
  const before=structuredClone(f.owner);unbound.beforeStep(f.sim,'owner',()=>1);assert.deepEqual(f.owner,before);
  const wrapper=f.sim.createEffect;assert.notEqual(wrapper,prior);unbound.clear();assert.notEqual(f.sim.createEffect,wrapper);
});

test('consumer cap strictly separates legacy histories from playback and does not call zero-dt attack/effect/core compensation',()=>{
  const f=fixture(),action=f.action(1,1),legacy=createRemoteActionConsumer({clock:()=>0}),consumer=createRemoteActionConsumer({clock:()=>0,combatPlaybackVersion:1});
  assert.equal(legacy.receive('source',[action],1,1),false);
  const old=structuredClone(action);delete old.playback;assert.equal(consumer.receive('source',[old],1,1),false);
  f.sim.checkCharacterAttack=()=>{throw Error('historical character collision');};f.sim.tickEffects=()=>{throw Error('historical effect collision');};
  f.sim.tickCore=()=>{throw Error('historical core collision');};
  assert.equal(consumer.receive('source',[action],1,1),true);assert.equal(consumer.consume(f.sim,'owner',()=>1),1);
  assert.equal(consumer.playbackDiagnostics.starts,1);assert.equal(consumer.diagnostics.totalConsumed,0);consumer.clear();legacy.clear();
});

test('controller logical changes preserve locally built Phantom attack windows, charge/expiry clocks and cooldowns',()=>{
  const f=fixture();
  // Disclosed controller records isolate the production merge contract. The
  // actual Phantom queue is built by state-enter callbacks, not this test.
  const attack={state:'PLAYBACK_TEST_Z',serial:20,facing:1,speed:1,start:.72,end:.9};
  f.source.sourceInfinitySword={comboLoops:1,cruelHits:0,cruelCooldown:.7,suddenCooldown:0,brutalCooldown:0,lightningTime:.4,phantomSword:{effectId:10,centerId:11,time:.6,
    matrixQueue:[{time:.6,anchor:{position:[1,2,3],rotation:[0,0,0],facing:1,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}}],attacks:[attack],
    currentAttack:structuredClone(attack)}};
  f.source.sourceElesisSkills={loopTime:.3,chivalryTime:.5,stigmaCooldown:.2,charge:.4,loops:1,hit:false,dodges:0,rushes:0,mpPaid:0};
  f.source.sourceAddCombat={pulseCount:0,pulseOrder:[],phase:{position:[0,0,0],remaining:.6,group:0,skillId:29201},commandChargeTime:.4,stormSize:1,stormDuration:.8};
  const current=structuredClone(f.source),action=f.action(1,1,{start:false});
  Object.assign(action.actor.sourceInfinitySword,{comboLoops:2,cruelCooldown:99,lightningTime:99});
  Object.assign(action.actor.sourceInfinitySword.phantomSword,{time:99,attacks:[{...attack,serial:30,start:99,end:100}],currentAttack:{...attack,serial:30,start:99,end:100}});
  Object.assign(action.actor.sourceElesisSkills,{loopTime:99,chivalryTime:99,stigmaCooldown:99,charge:99,loops:2});
  Object.assign(action.actor.sourceAddCombat,{phase:{...action.actor.sourceAddCombat.phase,remaining:8},commandChargeTime:2.9,stormSize:1.9});
  f.playback.receiveActions('source',[action],1,1);f.playback.beforeStep(f.sim,'owner',()=>1);
  assert.deepEqual(f.source.sourceInfinitySword.phantomSword,current.sourceInfinitySword.phantomSword);
  assert.equal(f.source.sourceInfinitySword.cruelCooldown,.7);assert.equal(f.source.sourceInfinitySword.lightningTime,.4);
  assert.equal(f.source.sourceInfinitySword.comboLoops,2);
  assert.deepEqual(f.source.sourceElesisSkills,{...current.sourceElesisSkills,loops:2});
  assert.deepEqual(f.source.sourceAddCombat,{...current.sourceAddCombat,stormSize:1.9});
});

test('actual Arc rows retain complete local runtime by stable handle and remain usable by compiled Native follow after a wire control',async()=>{
  const {make}=await import('../helpers/rf-passive-fixture-v12.mjs');
  const sim=await make({skillId:24008,passives:[]});sim.networkOwnerId='rf';
  const actor=sim.actor('rf');actor.inputLock=0;sim.enter(actor,'RSI_WAIT','playback-arc-row-fixture');
  for(let frame=1;frame<=100;frame++)sim.step(dt,frame===1?{rf:{pressed:['A'],held:['A']}}:{},{snapshot:false});
  sim.drainEvents();assert.equal(actor.sourceArcEnemy.data.length,4,'actual Native cast creates four stored spear handles');
  const current=structuredClone(actor.sourceArcEnemy),packet=encodeOwnedState(sim,'rf',{epoch:1,frameSeq:101});
  const action=encodeCriticalAction(packet,{id:101,frameSeq:101});action.playback={version:1,start:false,held:[]};action.effects=[];
  // Deliberately reverse serialized rows: index-based restoration corrupts
  // a handle's motion. Old source positions/clocks are never current intent.
  action.actor.sourceArcEnemy.effects.reverse();
  for(const row of action.actor.sourceArcEnemy.effects){row.position=[-900,300,0];row.rotation=[1,2,3];row.nowLifeTime=99;
    row.animationResetTime=99;row.lockOnUnitUID=2;}
  action.actor.sourceArcEnemy.cooldown=99;
  const playback=createRemoteCombatPlayback({clock:()=>0});playback.bind(sim,'target',()=>1);
  assert.equal(playback.receiveActions('rf',[action],1,101),true);assert.equal(playback.beforeStep(sim,'target',()=>1),1);
  for(const row of actor.sourceArcEnemy.effects){const prior=current.effects.find(value=>value.handle===row.handle);
    assert.ok(prior);assert.deepEqual(row.position,prior.position);assert.deepEqual(row.rotation,prior.rotation);
    assert.equal(row.nowLifeTime,prior.nowLifeTime);assert.equal(row.animationResetTime,prior.animationResetTime);
    assert.equal(row.lockOnUnitUID,2,'target UID is not an owned effect identity');}
  assert.equal(actor.sourceArcEnemy.cooldown,current.cooldown);
  assert.deepEqual(actor.sourceArcEnemy.data.map(row=>row.handle),current.data.map(row=>row.handle));
  assert.deepEqual(actor.sourceArcEnemy.effectIds,current.effectIds,'unresolved canonical references preserve the actual local handles');
  const result=sim.skillsFor(actor).evaluate(arcNativeInput(actor,sim.state.effects,{kind:26,dt,basis:arcLineBasis(actor,sim.map.lines)}));
  assert.equal(result.arcEnemy.effects.length,4);sim.executeArcCommands(actor,result);
  assert.equal(actor.sourceArcEnemy.data.length,4);assert.ok(actor.sourceArcEnemy.effects.every(row=>row.position.every(Number.isFinite)));
  playback.afterStep(sim);playback.clear();
});

for(const change of [action=>action.playback.version=2,action=>action.playback.unknown=true,
  action=>action.playback.held=['DASH'],action=>action.playback.held=['Z','Z'],action=>action.targetViews=[]])
test('strict playback marker refuses unknown versions/keys/levels and old target geometry',()=>{
  const f=fixture(),action=f.action(1,1);change(action);
  assert.equal(f.playback.receiveActions('source',[action],1,1),false);assert.equal(f.playback.diagnostics.pending,0);
});

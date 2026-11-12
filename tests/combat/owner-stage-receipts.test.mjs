/** Native pose/collision receivers plus controlled packet ordering. These are
 * Web ownership regressions, not a measured 2016 client expectation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {prepareNasodAttack,launchNasodAttack} from '../../packages/combat-core/nasod-attack.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const assets=await loadServerCombatAssets({root,assetRoot:path.join(root,'artifacts')});
async function make(owner){
  const {native,samplers}=await assets.createRuntime();
  const sim=createSimulation({profile:assets.profile,map:assets.map,preset:{...assets.preset,onlineMatch:true},seed:2016,networkOwnerId:owner,
    actors:[{id:'sender',team:0,position:[2022.98,2840,0],lineId:6,facing:-1},{id:'receiver',team:1,position:[1872.98,2840,0],lineId:6,facing:1}],...samplers,
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:assets.versions});
  for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','stage-receipt-fixture');actor.presentationTransition=null;}
  sim.drainEvents();return sim;
}
async function fixture(){
  const source=await make('sender'),victim=await make('receiver'),sync=createLocalOwnershipSync();
  sync.reconcile(victim,{snapshot:source.snapshot(),ownership:{mode:'local-owner-v1',actors:{sender:{epoch:1},receiver:{epoch:1}}}},'receiver');
  const actor=source.actor('sender');source.enter(actor,'RSI_DASH_COMBO_X','stage-receipt-fixture');
  // These regressions isolate already selected source attack poses. They do
  // not use an inherited WAIT transition as the historical attack's pose.
  actor.presentationTransition=null;
  return {source,victim,sync,actor};
}
function sample(source,clock,frameSeq,before=clock){
  const actor=source.actor('sender');actor.animationTime=clock;source.checkCharacterAttack(actor,before,clock);
  const report=encodeOwnedState(source,'sender',{epoch:1,frameSeq});
  return {report,action:encodeCriticalAction(report,{id:frameSeq})};
}
const hitEvents=simulation=>simulation.drainEvents().filter(event=>event.type==='hit'&&event.targetId==='receiver');

test('66X second-stage history and a delayed live first stage share the same accepted native collision',async()=>{
  const {source,victim,sync}=await fixture();
  const early=sample(source,.62,36),late=sample(source,.7,42,.62),hp=victim.actor('receiver').hp;
  sync.receiveActions('sender',[late.action],1,42);sync.beforeStep(victim,'receiver');
  const first=hitEvents(victim);assert.equal(first.length,1,'native second-stage helpers must actually hit');
  assert.equal(sync.receivePeer(victim,'sender',early.report,'receiver'),true);
  sync.beforeStep(victim,'receiver');const remote=victim.actor('sender');remote.animationTime=.7;
  victim.checkCharacterAttack(remote,.62,.7);
  assert.equal(hitEvents(victim).length,0,'crossing the native stage reset cannot re-charge an accepted second-stage hit');
  assert.equal(victim.actor('receiver').hp,hp-first[0].amount);
});

test('66X legitimately hits once in each separate source damage stage',async()=>{
  const {source,victim,sync}=await fixture(),firstStage=sample(source,.3,18),secondStage=sample(source,.7,42,.62);
  sync.receiveActions('sender',[firstStage.action],1,18);sync.beforeStep(victim,'receiver');
  const first=hitEvents(victim);assert.equal(first.length,1,'actual first-stage helpers must hit');
  sync.receiveActions('sender',[secondStage.action],1,42);sync.beforeStep(victim,'receiver');
  const second=hitEvents(victim);assert.equal(second.length,1,'a separate source stage remains eligible');
  assert.notEqual(first[0].data.DAMAGE.PHYSIC,second[0].data.DAMAGE.PHYSIC);
});

test('receiver ledger leaves the local source trajectory and offline defaults unchanged',async()=>{
  const plain=await make('sender'),bound=await make('sender'),consumer=createRemoteActionConsumer({clock:()=>0});
  assert.equal(plain.receiverHitMemory,null);consumer.remember(bound,'sender',()=>1);
  for(let frame=1;frame<=90;frame++){
    const input=frame===1?{sender:{pressed:['Z'],held:['Z']}}:{};
    plain.step(1/60,input,{snapshot:false});bound.step(1/60,input,{snapshot:false});
    assert.deepEqual(bound.drainEvents(),plain.drainEvents(),'local source events are identical');
    assert.deepEqual(bound.snapshot(),plain.snapshot(),'local source state/random flow is identical');
    consumer.remember(bound,'sender',()=>1);
  }
  consumer.clear();assert.equal(bound.receiverHitMemory,null,'retired ownership consumer removes its hook');
  const offline=await make(null);assert.equal(offline.receiverHitMemory,null,'standalone combat needs no network callback');
});

test('separate Nasod core launches remain eligible while the actor state identity is unchanged',async()=>{
  const sim=await make('receiver'),consumer=createRemoteActionConsumer({clock:()=>0}),actor=sim.actor('sender'),target=sim.actor('receiver');
  consumer.remember(sim,'receiver',()=>1);actor.awakening.remaining=20;actor.core.level=2;
  const serial=actor.stateSerial,data={...sim.profile.damageEffects.RAVEN_NASOD_BALL.raw.DAMAGE_DATA,DAMAGE:{PHYSIC:1,MAGIC:1}};
  // Explicit collision shapes isolate lifecycle receipt routing. Production
  // AttackN mesh helpers have their independent native-source regression.
  const shapes=[{kind:'sphere',center:[target.x,target.y+75,target.z],radius:200}];
  for(let cycle=0;cycle<2;cycle++){
    actor.core.phase='idle';assert.equal(prepareNasodAttack(actor.core,'receiver',[0,180,0]),true);
    launchNasodAttack(actor.core,{direction:[1,0,0],facing:-1});
    assert.equal(sim.checkHits(actor,shapes,data,actor.core.hits,{kind:'core',powerMultiplier:1}),1);
    assert.equal(sim.checkHits(actor,shapes,data,actor.core.hits,{kind:'core',powerMultiplier:1}),0,'same core launch cannot hit again');
    consumer.remember(sim,'receiver',()=>1);
  }
  assert.equal(actor.stateSerial,serial,'core launches do not need a new character state key');
  assert.equal(hitEvents(sim).length,2,'a later legitimate core launch remains a distinct hit');
});

test('a first live character receipt retains an already accepted core hit for following history',async()=>{
  const sim=await make('receiver'),consumer=createRemoteActionConsumer({clock:()=>0}),actor=sim.actor('sender'),target=sim.actor('receiver');
  consumer.remember(sim,'receiver',()=>1);
  sim.enter(actor,'RSI_DASH_COMBO_X','core-receipt-fixture');actor.animationTime=.7;actor.presentationTransition=null;
  actor.awakening.remaining=20;actor.core.level=2;actor.core.phase='idle';
  assert.equal(prepareNasodAttack(actor.core,'receiver',[0,0,0]),true);
  launchNasodAttack(actor.core,{direction:[1,0,0],facing:-1});
  Object.assign(actor.core,{attackElapsed:.4,animationTime:.4,hits:{receiver:0},hitGaps:{receiver:0},hit:true});
  // Explicit core collision input makes loss of its prior receipt observable;
  // this fixture does not stand in for original AttackN geometry or timing.
  sim.nasodAttackSampler=()=>[{kind:'sphere',center:[target.x,target.y+75,target.z],radius:200}];
  sim.checkCharacterAttack(actor,.7,.7);assert.equal(hitEvents(sim).length,1,'native character window creates its first receipt');
  const report=encodeOwnedState(sim,'sender',{epoch:1,frameSeq:42}),action=encodeCriticalAction(report,{id:42});
  consumer.receive('sender',[action],1,42);consumer.consume(sim,'receiver',()=>1);
  assert.equal(hitEvents(sim).length,0,'the same live/history core launch cannot lose its already accepted receipt');
});

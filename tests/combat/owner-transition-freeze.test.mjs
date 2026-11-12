/** Current native simulation/network regression, not a target2016 golden.
 * A walk begins in the same packet that the remote Z hits its owner. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const assets=await loadServerCombatAssets({root,assetRoot:path.join(root,'artifacts')});
async function fixture(owner){
  const {native,samplers}=await assets.createRuntime();
  return createSimulation({profile:assets.profile,map:assets.map,preset:assets.preset,
    actors:[{id:'a',team:0,position:[1920,2840,0],lineId:6,facing:1},
      {id:'b',team:1,position:[2022.98,2840,0],lineId:6,facing:-1}],networkOwnerId:owner,...samplers,
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,
    nativeSkillValues:native.skillValues,nativeNasod:native.nasod,nativeCritical:native.critical,
    nativeManaBreak:native.manaBreak,versions:assets.versions});
}
test('native same-packet walk then received Z preserves the retained pose through owner encoding and JSON reception',async()=>{
  const simulation=await fixture('a'),receiver=await fixture('b'),sync=createLocalOwnershipSync();
  sync.reconcile(simulation,{snapshot:simulation.snapshot(),pvp:{phase:'fight',fightTime:0,
    players:['a','b'].map(id=>({id,alive:true,connected:true}))},ownership:{mode:'local-owner-v1',
    actors:{a:{epoch:1},b:{epoch:1}}},owners:{}},'a');
  simulation.drainEvents();let collided=false;
  for(let frame=1;frame<=30;frame++){
    sync.beforeStep(simulation,'a');
    simulation.step(1/60,{
      a:{held:frame>=6?['RIGHT']:[],pressed:frame===6?['RIGHT']:[],released:[]},
      b:{held:frame===1?['Z']:[],pressed:frame===1?['Z']:[],released:[]},
    },{snapshot:false});
    const events=simulation.drainEvents(),report=sync.afterStep(simulation,'a',events);
    if(frame===6){
      assert.deepEqual(events.filter(event=>event.type==='stateChanged'&&event.actorId==='a')
        .map(event=>[event.state,event.reason]),[['RSI_WALK','source-held-direction'],['RSI_DAMAGE_SMALL_BACK','hit-reaction']]);
      assert.ok(events.some(event=>event.type==='hit'&&event.actorId==='b'&&event.targetId==='a'));
      const pose=simulation.actor('a').presentationTransition.retainedPose;
      assert.equal(pose.animationName,'Walk');assert.equal(pose.animationTime,0);
      assert.equal(pose.presentationTransition.fromName,'Wait');
      assert.ok(report,'the actual reportEvery=3 owner upload runs on this packet');
      // Evidence text stays with the local source object; every controller
      // input must still survive the network projection unchanged.
      const {evidence,...controllerTransition}=pose.presentationTransition;
      assert.equal(typeof evidence,'string');
      assert.deepEqual(report.actor.presentationTransition.retainedPose,{...pose,presentationTransition:controllerTransition});
      assert.equal(Object.hasOwn(report.actor.presentationTransition.retainedPose.presentationTransition,'evidence'),false);
      collided=true;
    }
    if(report){
      const wire=JSON.parse(JSON.stringify(report));validateOwnedState(wire);
      validateOwnedReferences(wire,receiver.actor('a'),receiver.profile,receiver.map);
      const receivingOwner=structuredClone(receiver.actor('b'));
      applyOwnedState(receiver,'a',wire);
      assert.deepEqual(receiver.actor('a').presentationTransition,report.actor.presentationTransition);
      const originalHelpers=simulation.defenderSampler(simulation.actor('a'));
      assert.ok(originalHelpers.length,'sample actual original character helpers, including the interrupted retained pose');
      assert.deepEqual(receiver.defenderSampler(receiver.actor('a')),originalHelpers);
      assert.deepEqual(receiver.actor('b'),receivingOwner,'remote merge preserves the receiving owner');
    }
  }
  assert.equal(collided,true);assert.equal(simulation.state.step,30);
});
test('repeated native XCrash casts retain sampling throttles only for current live meshes',async()=>{
  const simulation=await fixture('a'),sync=createLocalOwnershipSync();
  simulation.configureLoadout([{skillId:24010},null,null,null,null,null,null,null],'a');
  simulation.drainEvents();let observedSample=false;
  for(let frame=1;frame<=3*420;frame++){
    const cast=(frame-1)%420===0;
    // Preparation only: repeat the real effect lifecycle without waiting for
    // recovery/CD. This is a memory regression, not a resource-consumption test.
    if(cast){simulation.actor('a').mp=300;simulation.actor('a').cooldowns={};}
    sync.beforeStep(simulation,'a');
    simulation.step(1/60,{a:{held:cast?['A']:[],pressed:cast?['A']:[],released:[]}},{snapshot:false});
    sync.afterStep(simulation,'a',simulation.drainEvents());
    const live=simulation.state.effects.filter(effect=>effect.ownerId==='a'&&effect.active&&!effect.dead).length;
    assert.ok(sync.sampledEffectCount<=live,`packet ${frame} must not retain retired sampling IDs`);
    if(sync.sampledEffectCount>0)observedSample=true;
  }
  assert.equal(observedSample,true);assert.equal(sync.sampledEffectCount,0);
});

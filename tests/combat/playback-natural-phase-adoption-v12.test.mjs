/** Actual Native Pulse Cannon READY -> LOOP. The second canonical start is
 * held while this recipient's Native event machine enters and plays LOOP.
 * This is a lifecycle regression, not a client2016 or WAN timing claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPlaybackNativeAssets,playbackNativeOwner} from '../../tools/validation/measure-combat-playback-v12.mjs';
const assets=await loadPlaybackNativeAssets(),empty={held:[],pressed:[],released:[],sampledDevice:true};
test('a canonical start arriving after the same Native LOOP already played adopts its phase and cannot restart fired events or local receipts',t=>{
  let now=0;const opts={sourceProfession:'LP',sourceSkill:29006,clock:()=>now},source=playbackNativeOwner(assets,'source',opts),receiver=playbackNativeOwner(assets,'target',opts);
  t.after(()=>{source.clear();receiver.clear();});
  for(const ctx of [source,receiver])for(const actor of ctx.sim.state.actors){actor.inputLock=0;actor.forceInvincible=0;actor.pvpPresentation=null;}
  source.sim.actor('source').mp=source.sim.actor('source').mpMax;
  let held=null,matchingPlayed=null,normalLoopEntry=false,networkEntries=0;
  const original=receiver.sim.enter;receiver.sim.enter=function(actor,state,reason){
    if(actor.id==='source'&&state==='ANSI_SA_APT_PULSE_CANNON_LOOP'){
      if(reason==='network-current-playback')networkEntries++;else normalLoopEntry=true;
    }return original.apply(this,arguments);
  };
  for(let frame=1;frame<=240;frame++){
    now+=1000/60;const input=frame===1?{...empty,held:['A'],pressed:['A']}:{...empty,held:['A']};
    const result=source.step(input);
    if(result.report){
      const packet=structuredClone(result.report),loop=packet.actions.find(action=>action.playback.start&&action.actor.state==='ANSI_SA_APT_PULSE_CANNON_LOOP');
      if(loop&&!held)held={action:structuredClone(loop),epoch:packet.epoch};
      // Later source bodies remain legitimate resource/motion observations,
      // but no later action advances the receipt frontier past the held start.
      const admitted=held?packet.actions.filter(action=>action.frameSeq<held.action.frameSeq):packet.actions;
      if(admitted.length)assert.equal(receiver.sync.receiveActions('source',admitted,packet.epoch,packet.frameSeq),true);
      packet.actions=[];assert.equal(receiver.sync.receivePeerResult(receiver.sim,'source',packet,'target').validated,true);
    }
    const played=receiver.step(empty),remote=receiver.sim.actor('source');
    if(held&&normalLoopEntry&&remote.state===held.action.actor.state&&remote.stateSerial===held.action.actor.stateSerial&&remote.animationTime>0&&remote.fired.length){
      const actualBirth=played.events.find(event=>event.actorId==='source'&&event.type==='effectStarted'&&event.ownerStateSerial===remote.stateSerial)
        ??receiver.sim.state.effects.find(effect=>effect.ownerId==='source'&&effect.ownerStateSerial===remote.stateSerial&&effect.active);
      if(actualBirth){matchingPlayed={frame,clock:remote.animationTime,fired:structuredClone(remote.fired),hits:structuredClone(remote.hits),entries:networkEntries};break;}
    }
  }
  assert.ok(held,'the real producer emitted a Native LOOP controller start');
  assert.ok(matchingPlayed,'the real receiver event path entered this same LOOP serial and started its original effect before canonical admission');
  const remote=receiver.sim.actor('source'),frontier=source.sync.combatPlaybackDiagnostics.producer;
  assert.ok(frontier.actions>1);
  assert.equal(receiver.sync.receiveActions('source',[held.action],held.epoch,Math.max(held.action.frameSeq,matchingPlayed.frame)),true);
  receiver.sync.beforeStep(receiver.sim,'target');
  assert.equal(networkEntries,matchingPlayed.entries,'a proved same Native phase must not run StateStart twice');
  assert.equal(remote.animationTime,matchingPlayed.clock,'adoption does not replace the running clock with phase zero');
  assert.deepEqual(remote.fired,matchingPlayed.fired,'already played authored events remain spent');
  assert.deepEqual(remote.hits,matchingPlayed.hits,'local Native receipts remain local and cannot be cleared by the late start');
});

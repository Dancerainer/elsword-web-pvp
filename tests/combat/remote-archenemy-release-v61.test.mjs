/** Web remote lifecycle regression. Source contact and Native release are real;
 * these assertions are the requested remaining-spears policy, not client capture. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeArc} from '../helpers/archenemy-v17-fixture.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';
import {encodeNetworkBinary,decodeNetworkBinary} from '../../packages/online/network-binary.mjs';
import {createCombatPlaybackProducer} from '../../packages/online/combat-playback.mjs';

for(const delivery of ['complete-controls','production-deltas','disjoint-receiver-ids'])for(const facing of [-1,1])test(`remote Dark Ark retains three waiting spears after the first real melee release (${facing}/${delivery})`,async()=>{
  const source=await makeArc(facing),receiver=await makeArc(facing);
  // Independent worlds need not have created the same number of earlier
  // effects. This fixture only separates their allocator identities.
  if(delivery==='disjoint-receiver-ids')receiver.state.nextEffectId=1000;
  source.networkOwnerId='rf';receiver.networkOwnerId='target';
  source.networkCombatPlaybackVersion=1;receiver.networkCombatPlaybackVersion=1;
  const playback=createRemoteCombatPlayback({clock:()=>source.state.time*1000});playback.bind(receiver,'target',()=>1);
  const producer=createCombatPlaybackProducer({version:1});
  let previousSerial=-1,released=false,checked=0,previousShape='',releaseSounds=0,arcHits=0;const samples=[];
  for(let frame=1;frame<=480;frame++){
    const input=frame===1?{held:['A'],pressed:['A']}:frame===260?{held:['Z'],pressed:['Z']}:{held:[]};
    producer.beforeStep(source,'rf');source.step(1/60,{rf:input},{snapshot:false});const events=source.drainEvents();
    const packet=encodeOwnedState(source,'rf',{epoch:1,frameSeq:frame});
    const action=delivery!=='complete-controls'?producer.capture(source,'rf',{epoch:1,frameSeq:frame,events,held:input.held}):encodeCriticalAction(packet,{id:frame,effectIds:new Set(packet.effects.map(e=>e.id))});
    if(action){if(delivery==='complete-controls')action.playback={version:1,start:source.actor('rf').stateSerial!==previousSerial,held:input.held};
      playback.receiveActions('rf',[decodeNetworkBinary(encodeNetworkBinary(action))],1,frame);}
    previousSerial=source.actor('rf').stateSerial;
    playback.beforeStep(receiver,'target',()=>1);
    receiver.step(1/60,playback.remoteInputs(receiver,'target'),{snapshot:false});playback.afterStep(receiver);
    validateOwnedState(encodeOwnedState(receiver,'rf',{epoch:1,frameSeq:frame}));
    if(process.env.RF_ARC_TRACE){const a=receiver.actor('rf'),shape=JSON.stringify([a.sourceArcEnemy?.data.map(e=>e.handle),a.sourceArcEnemy?.effectIds,
      receiver.state.effects.filter(e=>e.sourceArcHandle).map(e=>[e.id,e.networkId,e.sourceArcHandle,e.dead,e.endReason])]);
      if(shape!==previousShape){console.log(JSON.stringify({frame,action:action?.effects.map(e=>[e.id,e.sourceArcHandle,e.dead,e.lifeTimeSeconds]),receiver:JSON.parse(shape),rows:a.sourceArcEnemy?.effects,sourceRows:source.actor('rf').sourceArcEnemy?.effects}));previousShape=shape;}}
    if(events.some(e=>e.type==='sound'&&e.field==='original-arc-release'))released=true;
    const received=receiver.drainEvents();releaseSounds+=received.filter(e=>e.type==='sound'&&e.field==='original-arc-release').length;
    arcHits+=received.filter(e=>e.type==='hit'&&e.origin?.kind==='effect'&&e.origin.skillId===24008).length;
    if(released){
      const expected=source.actor('rf').sourceArcEnemy.data.map(row=>row.handle);
      const current=receiver.actor('rf').sourceArcEnemy;
      const present=receiver.state.effects.filter(e=>!e.dead&&expected.includes(e.sourceArcHandle));
      samples.push({frame,expected,rows:current.data.map(row=>row.handle),present:present.map(e=>e.sourceArcHandle)});
      // Allow the receiver's ordinary jitter buffer to reach the release.
      if(frame>=300){assert.equal(expected.length,3,'single accepted attack leaves three source spears');
        assert.equal(present.length,3,JSON.stringify(samples.slice(-4)));checked++;}
    }
  }
  assert.ok(released,'real command contact must execute Native release');assert.ok(checked>120);
  assert.equal(releaseSounds,1,'one accepted release transition plays its original sound once');
  assert.ok(arcHits>=1,'the newly released spear reaches a real local victim contact before its .35s lifetime expires');
  if(delivery==='production-deltas'&&facing===1){
    // Silence after release must retain the waiting clocks, then naturally
    // retire the three remaining spears without another owner snapshot.
    for(let frame=481;frame<=2050;frame++){
      playback.beforeStep(receiver,'target',()=>1);receiver.step(1/60,playback.remoteInputs(receiver,'target'),{snapshot:false});
      playback.afterStep(receiver);receiver.drainEvents();
    }
    assert.equal(receiver.actor('rf').sourceArcEnemy.data.length,0);
    assert.equal(receiver.state.effects.filter(e=>!e.dead&&e.sourceArcHandle).length,0);
  }
  playback.clear();
});

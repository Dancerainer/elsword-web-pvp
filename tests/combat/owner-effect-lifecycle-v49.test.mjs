/** Web owner lifecycle regression, not a measured original-client trajectory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {makeArc} from '../helpers/archenemy-v17-fixture.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';
import {encodeNetworkBinary,decodeNetworkBinary} from '../../packages/online/network-binary.mjs';
import {createOwnerPoseDelta} from '../../packages/online/owner-pose-delta.mjs';

test('CA Dread Weapon reaches all four declared damage tables through binary/mask owner packets',()=>{
  const source=elesisFixture('CA',{skillId:28025,gap:1500}),target=elesisFixture('CA',{skillId:28025,gap:1500});
  const send=createOwnerPoseDelta(),receive=createOwnerPoseDelta(),seen=new Set();let ack=-1;
  for(let frame=1;frame<=300;frame++){
    source.sim.step(1/60,{elesis:frame<180?{held:['A'],pressed:frame===1?['A']:[]}:{}},{snapshot:false});
    const packet=encodeOwnedState(source.sim,'elesis',{epoch:1,frameSeq:frame});
    for(const effect of packet.effects)if(effect.name==='DamageEffect_SI_SA_SCA_DREAD_WEAPON_Loop')seen.add(effect.stage);
    const envelope=decodeNetworkBinary(encodeNetworkBinary(send.encode(packet,{acknowledgedEpoch:1,acknowledgedFrameSeq:ack,version:2})));
    const decoded=receive.decode(envelope);decoded.commit();ack=frame;
    validateOwnedReferences(decoded.report,target.a,target.profile,target.map,{profiles:target.sim.profiles,actors:target.sim.state.actors});
    applyOwnedState(target.sim,'elesis',decoded.report);
    source.sim.drainEvents();target.sim.drainEvents();
  }
  assert.deepEqual([...seen].sort(),[0,1,2,3]);
  const packet=encodeOwnedState(source.sim,'elesis',{epoch:1,frameSeq:301});
  source.sim.createEffect(source.a,{NAME:'DamageEffect_SI_SA_SCA_DREAD_WEAPON_Loop'});
  const corrupted=encodeOwnedState(source.sim,'elesis',{epoch:1,frameSeq:302});
  const effect=corrupted.effects.find(e=>e.name==='DamageEffect_SI_SA_SCA_DREAD_WEAPON_Loop');
  for(const stage of [-1,.5,4,Infinity]){effect.stage=stage;assert.throws(()=>validateOwnedState(corrupted),/invalid-owner-effect/);}
  assert.doesNotThrow(()=>validateOwnedState(packet));
});

for(const facing of [-1,1])test(`RF native Arc receiving playback never creates a partial ABI row, facing ${facing}`,async()=>{
  const source=await makeArc(facing),target=await makeArc(facing);
  source.networkOwnerId='rf';target.networkOwnerId='target';
  const playback=createRemoteCombatPlayback({clock:()=>source.state.time*1000});playback.bind(target,'target',()=>1);
  let previousSerial=-1,heldCount=0,maximumSpears=0;
  let waitingPacket;
  for(let frame=1;frame<=240;frame++){
    // One receiver-local pause puts its native birth behind the source's
    // still-valid control frontier, as jittered STOP delivery can do.
    if(frame===35)target.actor('rf').hitStop=.15;
    const input=frame===1?{held:['A'],pressed:['A']}:{held:[]};
    source.step(1/60,{rf:input},{snapshot:false});
    const packet=encodeOwnedState(source,'rf',{epoch:1,frameSeq:frame});
    if(packet.actor.sourceArcEnemy?.data.length===4)waitingPacket=packet;
    const action=encodeCriticalAction(packet,{id:frame,effectIds:new Set(packet.effects.map(e=>e.id))});
    action.playback={version:1,start:source.actor('rf').stateSerial!==previousSerial,held:input.held};previousSerial=source.actor('rf').stateSerial;
    playback.receiveActions('rf',[decodeNetworkBinary(encodeNetworkBinary(action))],1,frame);
    playback.beforeStep(target,'target',()=>1);
    assert.doesNotThrow(()=>target.step(1/60,playback.remoteInputs(target,'target'),{snapshot:false}),`frame ${frame}`);
    playback.afterStep(target);
    assert.doesNotThrow(()=>validateOwnedState(encodeOwnedState(target,'rf',{epoch:1,frameSeq:frame})),`receiver frame ${frame}`);
    heldCount=Math.max(heldCount,target.actor('rf').sourceArcEnemy?.data.length??0);
    maximumSpears=Math.max(maximumSpears,target.state.effects.filter(e=>e.ownerId==='rf'&&e.sourceArcHandle&&!e.dead).length);
    source.drainEvents();target.drainEvents();
  }
  assert.equal(heldCount,4);assert.equal(maximumSpears,4,'source early births and later Native predictions must share the four spear identities');
  for(const mutate of [p=>delete p.actor.sourceArcEnemy.effects[0].animationResetTime,
    p=>p.actor.sourceArcEnemy.effects[0].animationResetTime=1e100,
    p=>p.actor.sourceArcEnemy.effects[0].position[1]=1e100,
    p=>p.actor.sourceArcEnemy.effects[0].handle=0,
    p=>p.actor.sourceArcEnemy.effects[1].handle=p.actor.sourceArcEnemy.effects[0].handle,
    p=>p.actor.sourceArcEnemy.data.push(...p.actor.sourceArcEnemy.data),
    p=>p.actor.sourceArcEnemy.nextHandle=1,
    p=>p.actor.sourceArcEnemy.effects[0].name='unknown-native-effect']){
    const corrupted=structuredClone(waitingPacket);mutate(corrupted);assert.throws(()=>validateOwnedState(corrupted),/invalid-owner/);
  }
  // Stop delivery after the complete birth. The four adopted instances and
  // native owned handles still have to end on their own original 30s clocks.
  for(let frame=241;frame<=2000;frame++){
    playback.beforeStep(target,'target',()=>1);target.step(1/60,playback.remoteInputs(target,'target'),{snapshot:false});playback.afterStep(target);target.drainEvents();
  }
  assert.equal(target.actor('rf').sourceArcEnemy.data.length,0);
  assert.equal(target.state.effects.filter(e=>e.ownerId==='rf'&&e.sourceArcHandle&&!e.dead).length,0);
  playback.clear();
});

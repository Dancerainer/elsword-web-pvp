/** Real pose/attack box/line collision, Web historical packet regression. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {lkCommandFixture} from '../helpers/lk-command-fixture.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
for(const facing of [-1,1])test(`historical LK X uses sword state at attack time, preserves latest presentation ${facing}`,async()=>{
  async function hitAt(historyMode,latestMode){
    const {sim,actor,target}=await lkCommandFixture({facing,gap:85});sim.networkOwnerId='target';
    sim.prepareWayOfSword('lk',historyMode);sim.enter(actor,'RSI_COMBO_X','original-history-fixture');actor.animationTime=.23;
    const sample=encodeOwnedState(sim,'lk',{epoch:1,frameSeq:10}),action=encodeCriticalAction(sample,{id:10});
    assert.equal(action.actor.wayOfSword.state,historyMode);assert.equal(action.actor.destructionRageRemaining,0);
    sim.prepareWayOfSword('lk',latestMode);sim.enter(actor,'RSI_WAIT','latest-presentation');actor.destructionRageRemaining=5;
    const latest=encodeOwnedState(sim,'lk',{epoch:1,frameSeq:20});latest.actions=[action];validateOwnedState(latest);
    const before=target.hp,consumer=createRemoteActionConsumer({clock:()=>0});consumer.receive('lk',[action],1,20);
    assert.equal(consumer.consume(sim,'target',()=>1),1);const amount=before-target.hp;assert.ok(amount>0,'actual native helper must connect');
    assert.equal(sim.actor('lk').wayOfSword.state,latestMode);assert.equal(sim.actor('lk').destructionRageRemaining,5);
    consumer.receive('lk',[action],1,20);assert.equal(consumer.consume(sim,'target',()=>1),0);assert.equal(target.hp,before-amount);return amount;
  }
  const ordinary=await hitAt(0,-2),destruction=await hitAt(-2,0);assert.equal(destruction,ordinary*2);
});

for(const facing of [-1,1])test(`historical Counter preserves captured power/launch and sword state across later owner data ${facing}`,async()=>{
  async function hitAt(historyMode,latestMode){
    const {sim,actor,target}=await lkCommandFixture({facing,gap:85});sim.rng=()=>.99;
    sim.configureLoadout([{skillId:21206},...Array(7).fill(null)],'lk');sim.prepareWayOfSword('lk',historyMode);
    sim.step(1/60,{lk:{pressed:['A']}});actor.animationTime=.1;actor.invincible=false;
    const result=sim.injectHit({attackerId:'target',targetId:'lk',damageData:{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:2},REACT_TYPE:1,CAN_REVENGE:1}});
    assert.equal(result.countered,true);assert.equal(actor.sourceLordKnight.revengePower,2);assert.equal(actor.sourceLordKnight.counterLaunch,true);
    actor.animationTime=.27;const sample=encodeOwnedState(sim,'lk',{epoch:1,frameSeq:10}),action=encodeCriticalAction(sample,{id:10});
    assert.equal(action.actor.sourceLordKnight.revengePower,2);assert.equal(action.actor.sourceLordKnight.counterLaunch,true);
    sim.prepareWayOfSword('lk',latestMode);sim.enter(actor,'RSI_WAIT','newest-counter-presentation');
    actor.sourceLordKnight.revengePower=99;actor.sourceLordKnight.counterLaunch=false;
    const latest=encodeOwnedState(sim,'lk',{epoch:1,frameSeq:20});latest.actions=[action];validateOwnedState(latest);
    sim.networkOwnerId='target';sim.drainEvents();const before=target.hp,consumer=createRemoteActionConsumer({clock:()=>0});
    consumer.receive('lk',[action],1,20);assert.equal(consumer.consume(sim,'target',()=>1),1);
    const hit=sim.drainEvents().find(e=>e.type==='hit'&&e.actorId==='lk');assert.ok(hit,'actual original RevengeAttack helpers must connect');
    // Target2016 RevengeAttack base5.25 + captured incoming coefficient2, no newer launch choice.
    assert.equal(hit.data.DAMAGE.PHYSIC,7.25);assert.equal(hit.data.REACT_TYPE,4);assert.ok(before-target.hp>0);
    assert.equal(sim.actor('lk').sourceLordKnight.revengePower,99);assert.equal(sim.actor('lk').sourceLordKnight.counterLaunch,false);
    assert.equal(sim.actor('lk').wayOfSword.state,latestMode);return hit.amount;
  }
  const ordinary=await hitAt(0,-2),destruction=await hitAt(-2,0);assert.ok(Math.abs(destruction-ordinary*1.5)<1e-6);
});

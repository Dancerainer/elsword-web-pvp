import test from 'node:test';
import assert from 'node:assert/strict';
import {addFixture,tick} from '../helpers/add-fixture.mjs';
import {ADD_BARRIER_STATE,addBarrierEligible} from '../../packages/combat-core/add-barrier.mjs';
import {addCommands,addCommandSkillCancelAllowed} from '../../packages/combat-core/add-commands.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

const damage={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},ATTACK_TYPE:0,REACT_TYPE:0,
  BACK_SPEED_X:100,BACK_SPEED_Y:0,STOP_TIME_DEF:.1,FORCE_DOWN:10};
function fixture(id='LP',state='ANSI_COMBO_NASOD_ARMOR_READY'){
  const result=addFixture(id),{sim,a,b}=result;
  sim.enter(b,state,'original-state-fixture');b.sourceAdd.formation=true;b.sourceAdd.dp=2000;b.awakening.remaining=99999;
  // Isolate the source 100-percent base-damage stage. Separate additional
  // attack is covered below and is not assumed cancelled by this stage.
  a.equipmentAttributes.additionalAttackRatio=0;a.stats.additionalAttackPercent=0;
  sim.drainEvents();return result;
}
const keys=({pressed=[],held=[]}={})=>({pressed:new Set(pressed),held:new Set(held),released:new Set(),ordered:[]});

for(const id of ['LP','MM','DE']){
  test(id+' barrier enters its original state, pays option-aware DP once and uses source armor STOP semantics',()=>{
    const {sim,a,b,profile}=fixture(id),hp=b.hp,dp=b.sourceAdd.dp;
    assert.equal(addBarrierEligible(b,profile,damage),true);
    const hit=sim.injectHit({attackerId:a.id,targetId:b.id,damageData:damage});
    assert.equal(hit.accepted,true);assert.equal(hit.amount,0);assert.equal(b.hp,hp);
    assert.equal(b.state,ADD_BARRIER_STATE);assert.equal(b.superArmor,true);
    assert.equal(b.sourceAdd.dp,dp-500);assert.equal(b.hitStop,0);
    assert.equal(sim.drainEvents().filter(e=>e.type==='addBarrierStarted').length,1);
    // The barrier state is not itself marked as another eligible barrier.
    sim.injectHit({attackerId:a.id,targetId:b.id,damageData:damage});
    assert.equal(sim.drainEvents().filter(e=>e.type==='addBarrierStarted').length,0);
  });
  test(id+' dummy contacts and ordinary mode do not create a barrier',()=>{
    const {sim,a,b,profile}=fixture(id);
    assert.equal(addBarrierEligible(b,profile,{...damage,REACT_TYPE:profile.enums.REACT_TYPE.RT_DUMMY_DAMAGE}),false);
    b.sourceAdd.formation=false;assert.equal(addBarrierEligible(b,profile,damage),false);
    sim.injectHit({attackerId:a.id,targetId:b.id,damageData:damage});
    assert.notEqual(b.state,ADD_BARRIER_STATE);assert.ok(b.sourceAdd.dp>=2000);
    assert.equal(sim.drainEvents().filter(e=>e.type==='addBarrierStarted').length,0);
  });
  test(id+' LP-only normal-command barrier declaration retains its original class restriction',()=>{
    const {b,profile}=fixture(id,'RSI_COMBO_ZZZZ');
    assert.equal(addBarrierEligible(b,profile,damage),id==='LP');
    b.sourceAdd.dp=0;assert.equal(addBarrierEligible(b,profile,damage),false);
  });
}

test('defence-bypass retains original reduction semantics while the barrier reaction still executes',()=>{
  for(const field of ['PENETRATE','IGNORE_STATE_DEFENCE']){
    const {sim,a,b}=fixture(),hp=b.hp;
    const result=sim.injectHit({attackerId:a.id,targetId:b.id,damageData:{...damage,[field]:1}});
    assert.ok(result.amount>0);assert.equal(b.hp,hp-result.amount);
    assert.equal(b.state,ADD_BARRIER_STATE);
    assert.equal(sim.drainEvents().find(e=>e.type==='addBarrierStarted').spent,500);
  }
});

test('separate source-equipment additional attack is not silently folded into the base reduction',()=>{
  const {sim,a,b}=fixture();a.equipmentAttributes.additionalAttackRatio=.1;
  const result=sim.injectHit({attackerId:a.id,targetId:b.id,damageData:damage});
  assert.ok(result.amount>0);assert.equal(b.state,ADD_BARRIER_STATE);
});

test('a positive but insufficient DP pool pays to zero rather than requiring the full raw charge',()=>{
  const {sim,a,b}=fixture();b.sourceAdd.dp=1;
  const result=sim.injectHit({attackerId:a.id,targetId:b.id,damageData:damage});
  assert.equal(result.amount,0);assert.equal(b.state,ADD_BARRIER_STATE);
  assert.equal(b.sourceAdd.dp,0);assert.equal(b.sourceAdd.formation,false);
});

test('speculative hit observations never enter a barrier or spend defender DP',()=>{
  const {sim,a,b}=fixture(),before={state:b.state,serial:b.stateSerial,dp:b.sourceAdd.dp,hp:b.hp};
  sim.observationOnly=true;
  const hit=sim.injectHit({attackerId:a.id,targetId:b.id,damageData:damage});
  assert.equal(hit.observationOnly,true);assert.deepEqual({state:b.state,serial:b.stateSerial,dp:b.sourceAdd.dp,hp:b.hp},before);
  assert.equal(sim.drainEvents().filter(e=>e.type==='addBarrierStarted').length,0);
});

test('barrier uses its original strict cancel field and exits on animation end even if airborne',()=>{
  const {sim,a,profile}=addFixture();sim.enter(a,ADD_BARRIER_STATE,'barrier-state-fixture');
  a.animationTime=0;assert.equal(addCommandSkillCancelAllowed(a,profile.states[a.state]),false);
  a.animationTime=.001;assert.equal(addCommandSkillCancelAllowed(a,profile.states[a.state]),true);
  a.animationTime=.566;assert.equal(addCommands.runEvent(a,keys({held:['RIGHT']}),profile).state,null);
  a.animationTime=.567;assert.equal(addCommands.runEvent(a,keys({held:['RIGHT']}),profile).state,'RSI_WAIT');
  a.grounded=false;a.animationTime=.79;
  assert.equal(addCommands.runEvent(a,keys(),profile).state,'RSI_WAIT');
});

test('barrier keeps the original Nasod followup buffer and defender target',()=>{
  const {sim,a,b,profile}=addFixture();a.sourceAdd.formation=true;a.sourceAdd.dp=2000;
  a.sourceAddCombat={nasodTargetId:b.id};sim.enter(a,ADD_BARRIER_STATE,'barrier-state-fixture');
  a.animationTime=.49;assert.equal(addCommands.runEvent(a,keys({pressed:['Z']}),profile).state,null);
  a.animationTime=.5;assert.equal(addCommands.runEvent(a,keys(),profile).state,null);
  a.animationTime=.501;assert.equal(addCommands.runEvent(a,keys(),profile).state,'ANSI_COMBO_NASOD_ARMOR_READY');
});

test('actual idle simulation retires the barrier, and JSON restoration never charges it twice',()=>{
  const one=fixture(),two=fixture();one.sim.injectHit({attackerId:one.a.id,targetId:one.b.id,damageData:damage});
  two.sim.restore(JSON.parse(JSON.stringify(one.sim.snapshot())));const before=two.sim.actor('target').sourceAdd.dp;
  tick(one.sim,.9);tick(two.sim,.9);
  assert.equal(two.sim.actor('target').sourceAdd.dp,before);
  assert.equal(one.b.state,'RSI_WAIT');assert.deepEqual(two.sim.snapshot(),one.sim.snapshot());
});

test('an actual barrier owner packet restores action and DP without re-entering StateStart',()=>{
  const one=fixture(),two=fixture();one.sim.injectHit({attackerId:one.a.id,targetId:one.b.id,damageData:damage});
  const packet=JSON.parse(JSON.stringify(encodeOwnedState(one.sim,one.b.id,{epoch:0,frameSeq:1}))),report=validateOwnedState(packet);
  assert.deepEqual(report,packet,'validation preserves the complete canonical JSON packet');
  validateOwnedReferences(report,two.b,two.profile,two.sim.map,{actors:two.sim.state.actors,profiles:two.sim.profiles});
  // Keep the sent wire separate from the receiver's live core object, which
  // acquires receiver-local hit receipts after restoration.
  two.sim.drainEvents();applyOwnedState(two.sim,two.b.id,report);
  assert.equal(two.b.state,ADD_BARRIER_STATE);assert.equal(two.b.sourceAdd.dp,1500);
  assert.equal(two.sim.drainEvents().filter(e=>e.type==='addBarrierStarted').length,0);
  assert.equal(JSON.stringify(encodeOwnedState(two.sim,two.b.id,{epoch:0,frameSeq:1})),JSON.stringify(packet));
});

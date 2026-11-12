import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {addStasisDamageObserved} from '../../packages/combat-core/add-recasts.mjs';
import {collisionPoint} from '../../packages/combat-core/collision.mjs';
import {SKILL_SLOT_KEYS} from '../../packages/combat-core/skill-availability.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {filterAddVoidAttackInput,hasAddVoidAttackBlock} from '../../packages/combat-core/add-void-binding-v57.mjs';
import {tickAddVoidHold} from '../../packages/combat-core/add-persistent-skills.mjs';
import {encodeNetworkBinary,decodeNetworkBinary} from '../../packages/online/network-binary.mjs';

const step=(sim,seconds,input={})=>{for(let i=0;i<Math.ceil(seconds*60);i++)sim.step(1/60,input);};
for(const skillId of [29006,29034])for(const slot of [0,3,4,7])test(`Pulse ${skillId} ordinary physical slot ${SKILL_SLOT_KEYS[slot]} held input emits eight native projectiles`,()=>{
  const {sim,a,b}=originalAddFixture('LP',{skillId});
  const selected=a.loadout[0];a.loadout=Array(8).fill(null);a.loadout[slot]=selected;
  a.mp=a.mpMax;b.x=2000;const key=SKILL_SLOT_KEYS[slot];
  step(sim,1);sim.drainEvents();sim.step(1/60,{add:{pressed:[key],held:[key]}});
  assert.equal(a.skillContext.key,key);
  const shots=[];for(let i=0;i<300;i++){sim.step(1/60,{add:{held:[key]}});shots.push(...sim.drainEvents().filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_SA_APT_Pulse_Cannon_Projectile'));}
  assert.equal(shots.length,8);assert.equal(a.unsupported.some(row=>row.id==='pulse-maintenance-dp-input'),false);
});
test('Pulse early release keeps the original four mandatory loops and never charges extra maintenance',()=>{
  const {sim,a,b}=originalAddFixture('LP',{skillId:29006});b.x=2000;a.mp=a.mpMax;step(sim,1);sim.drainEvents();
  sim.step(1/60,{add:{pressed:['A'],held:['A']}});const afterCast=a.mp;
  const shots=[];for(let i=0;i<300;i++){sim.step(1/60,{});shots.push(...sim.drainEvents().filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_SA_APT_Pulse_Cannon_Projectile'));}
  assert.equal(shots.length,4);assert.ok(a.mp>=afterCast);
});

for(const facing of [1,-1])test(`Stasis native original helper expands collision exactly 1.5x at the source accumulator cap, facing ${facing}`,()=>{
  const sample=weighted=>{
    const {sim,a,b}=originalAddFixture('LP',{skillId:29007});a.facing=facing;b.x=2000;a.mp=a.mpMax;step(sim,1);
    sim.step(1/60,{add:{pressed:['A'],held:['A']}});
    for(let i=0;i<300&&!sim.skillAvailability(a.id,0).available;i++)sim.step(1/60,{});
    const loop=sim.state.effects.find(e=>e.setName==='EffectSet_SA_APT_STASIS_FIELD_Loop');assert.ok(loop&&!loop.combatRetired,'the original713c group must survive after the cast state ends');
    if(weighted){addStasisDamageObserved(a,a.hpMax*.5);addStasisDamageObserved(a,a.hpMax*.1,{received:true});}
    assert.equal(sim.skillAvailability(a.id,0).available,true);
    sim.step(1/60,{add:{pressed:['A'],held:['A']}});
    for(let i=0;i<90;i++){
      sim.step(1/60,{});const effect=sim.state.effects.find(e=>e.name==='DamageEffect_APT_Stasis_Field_Activate'&&e.active&&!e.dead);
      if(effect){const shapes=sim.effectSampler(effect,a);assert.equal(shapes.length,1);assert.ok(sim.state.events.some(e=>e.type==='effectEnded'&&e.effectId===loop.id),'the original .3 burst cleanup must reach the retained713c display');return {effect,shape:shapes[0],sim,a};}
    }
    assert.fail('real Stasis recast did not create its original burst helper');
  };
  const base=sample(false),grown=sample(true);
  assert.equal(grown.effect.sourceAddStasisSize,1.5);assert.equal(grown.effect.powerMultiplier/base.effect.powerMultiplier,2);
  assert.ok(Math.abs(grown.shape.radius/base.shape.radius-1.5)<1e-6);
  const outsideBase={kind:'sphere',center:[...base.shape.center],radius:1};outsideBase.center[0]+=base.shape.radius*1.25;
  assert.equal(collisionPoint(base.shape,outsideBase),null);assert.ok(collisionPoint(grown.shape,outsideBase));
  const {sim,a}=grown,report=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:2,frameSeq:10})));
  validateOwnedState(report);validateOwnedReferences(report,a,sim.profileFor(a),sim.map,{actors:sim.state.actors,profiles:sim.profiles});
  sim.state.effects=[];applyOwnedState(sim,a.id,report);const restored=sim.state.effects.find(e=>e.networkId===grown.effect.id);
  assert.ok(restored);assert.ok(Math.abs(sim.effectSampler(restored,a)[0].radius-grown.shape.radius)<1e-6,'owner replacement neither loses nor reapplies the1.5 size factor');
});

test('Stasis retains both original display handles until the independent fifteen-second timeout clears them',()=>{
  const {sim,a,b}=originalAddFixture('LP',{skillId:29007});b.x=2000;a.mp=a.mpMax;step(sim,1);sim.drainEvents();
  sim.step(1/60,{add:{pressed:['A'],held:['A']}});let loop,countdown;const ended=new Set();
  for(let i=0;i<1100&&a.sourceAddCombat?.stasis;i++){
    sim.step(1/60,{});
    loop??=sim.state.effects.find(e=>e.setName==='EffectSet_SA_APT_STASIS_FIELD_Loop');
    countdown??=sim.state.effects.find(e=>e.setName==='EffectSet_SA_APT_STASIS_FIELD_Count_Down');
    for(const e of sim.drainEvents())if(e.type==='effectEnded')ended.add(e.effectId);
    if(countdown&&!countdown.dead)assert.equal(countdown.combatRetired,false,'7140 remains owned until original storage cleanup');
  }
  assert.equal(a.sourceAddCombat.stasis,null);assert.ok(loop);assert.ok(countdown);
  assert.equal(ended.has(loop.id),true);assert.equal(ended.has(countdown.id),true);
  assert.equal(loop.dead,true);assert.equal(countdown.dead,true);
});

test('Void BF475 creates binding, keeps the first recipient position on reapply and clears with its own one-second finalizer',()=>{
  const {sim,a,b}=originalAddFixture('DE',{skillId:29023,targetProfession:'LK'});b.loadout[0]={skillId:21217,branchId:'none'};
  const anchor=[b.x,b.y,b.z],first=sim.grantBuff(a,b,475);assert.ok(first);
  assert.deepEqual(first.behaviors.map(row=>row.kind),['attackBlock','stat','stat','neverMove']);
  assert.equal(b.stats.moveSpeedMultiplier,0);assert.equal(b.stats.jumpSpeedMultiplier,0);assert.equal(hasAddVoidAttackBlock(b),true);
  const input={held:new Set(['RIGHT','AWAKEN','X','A']),pressed:new Set(['X','A']),released:new Set(),edges:[]};
  filterAddVoidAttackInput(b,input);assert.deepEqual([...input.held],['RIGHT','AWAKEN']);assert.equal(input.pressed.size,0);
  b.x+=5;sim.grantBuff(a,b,475);assert.deepEqual(b.buffs.find(q=>q.templateId===437).behaviors.find(q=>q.kind==='neverMove').position,anchor);
  for(let i=0;i<30;i++)sim.step(1/60,{target:{held:['RIGHT','X','A'],pressed:i===0?['X','A']:[]}});
  assert.deepEqual([b.x,b.y,b.z],anchor);assert.equal(b.skillId,null);assert.notEqual(b.state,'RSI_DAMAGE_GROGGY');
  step(sim,1);assert.equal(hasAddVoidAttackBlock(b),false);assert.ok(b.stats.moveSpeedMultiplier>0);assert.ok(b.stats.jumpSpeedMultiplier>0);
});
test('Void binding holds an airborne body without creating a substitute stun or zeroing the ongoing velocity',()=>{
  const {sim,a,b}=originalAddFixture('DE',{skillId:29023,targetProfession:'LK'});b.y+=300;b.grounded=false;b.lineId=null;b.vy=-500;
  sim.enter(b,'RSI_JUMP_DOWN','airborne-fixture');const pos=[b.x,b.y,b.z];assert.ok(sim.grantBuff(a,b,475));
  step(sim,.5,{target:{held:['RIGHT']}});assert.deepEqual([b.x,b.y,b.z],pos);assert.equal(b.grounded,false);assert.ok(b.vy< -500);
  step(sim,.6);assert.ok(b.y<pos[1]);
});
test('Void preserves source post-physics JumpReady line-radius offset and restores it at the next original physics phase',()=>{
  const {sim,a,b}=originalAddFixture('DE',{skillId:29023,targetProfession:'LK'});const height=b.y;
  assert.ok(sim.grantBuff(a,b,475));
  for(let i=0;i<45&&b.y===height;i++)sim.step(1/60,{target:{pressed:i===0?['UP']:[],held:['UP']}});
  assert.equal(b.y,height+30,'fixedV5 SwordMan5856..5885 adds LINE_RADIUS after StateChange even with JumpSpeed0');
  sim.step(1/60,{});assert.equal(b.y,height);assert.equal(hasAddVoidAttackBlock(b),true);
});
test('the actual support reset clears the saved-position registration while preserving attack block and remaining Buff time',()=>{
  const {sim,a,b}=originalAddFixture('DE',{skillId:29023,targetProfession:'LK'});assert.ok(sim.grantBuff(a,b,475));
  const buff=b.buffs.find(row=>row.templateId===437),remaining=buff.finalizers[0].remaining;
  sim.dePhysicalObjects.resetSupport(b);assert.equal(buff.behaviors.find(row=>row.kind==='neverMove').identityCleared,true);
  assert.equal(buff.finalizers[0].remaining,remaining);assert.equal(hasAddVoidAttackBlock(b),true);
  const report=JSON.parse(JSON.stringify(encodeOwnedState(sim,b.id,{epoch:1,frameSeq:1})));
  validateOwnedReferences(validateOwnedState(report),b,sim.profileFor(b),sim.map,{actors:sim.state.actors,profiles:sim.profiles});applyOwnedState(sim,b.id,report);
  b.x+=8;step(sim,.2);assert.equal(b.x,258);sim.grantBuff(a,b,475);
  assert.equal(b.buffs.find(row=>row.templateId===437).behaviors.find(row=>row.kind==='neverMove').identityCleared,true,'refresh does not recreate the original registered behavior');
});
test('Void binding owner replacement preserves the actual recipient anchor, rejects foreign identities and retires on an empty list',()=>{
  const {sim,a,b,profile}=originalAddFixture('DE',{skillId:29023,targetProfession:'LK'});assert.ok(sim.grantBuff(a,b,475));
  const report=JSON.parse(JSON.stringify(encodeOwnedState(sim,b.id,{epoch:1,frameSeq:1}))),targetProfile=sim.profileFor(b);
  assert.deepEqual(decodeNetworkBinary(encodeNetworkBinary(report)),report,'new behavior names/position fields use the existing lossless binary extensions');
  const validate=r=>{validateOwnedState(r);return validateOwnedReferences(r,b,targetProfile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});};
  validate(report);const frozen=structuredClone(report);applyOwnedState(sim,b.id,report);assert.deepEqual(report,frozen);
  const bad=structuredClone(report);bad.actor.buffs[0].factorId=437;assert.throws(()=>validate(bad),/buff-factor-template|void-binding/);
  const wrong=structuredClone(report);wrong.actor.buffs[0].behaviors.find(q=>q.kind==='neverMove').gravity=true;assert.throws(()=>validate(wrong));
  const empty=structuredClone(report);empty.actor.buffs=[];validate(empty);applyOwnedState(sim,b.id,empty);assert.equal(hasAddVoidAttackBlock(b),false);
});
test('Void actual release starts source collapse and deletes the attack group without another explosion or a fresh binding timer',()=>{
  const {sim,a,b}=originalAddFixture('DE',{skillId:29023});b.x=2000;a.mp=a.mpMax;step(sim,1);sim.drainEvents();
  sim.step(1/60,{add:{pressed:['A'],held:['A']}});for(let i=0;i<180&&!a.state.endsWith('_LOOP');i++)sim.step(1/60,{add:{held:['A']}});
  assert.ok(a.state.endsWith('_LOOP'));const field=sim.state.effects.find(e=>e.name==='DamageEffect_ATT_Void_Field');assert.ok(field);
  for(let i=0;i<100&&!field.sourceAddVoidCollapse;i++)sim.step(1/60,{});
  assert.ok(field.sourceAddVoidCollapse);assert.equal(sim.state.effects.some(e=>e.name==='DamageEffect_ATT_Void_Field_Attack'&&!e.dead),false);
  const alpha=field.sourceAddVoidCollapse.alpha;step(sim,.2);assert.ok(field.sourceAddVoidCollapse.alpha<alpha);assert.ok(field.sourceAddVoidCollapse.scale<1);
  assert.equal(sim.state.events.filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_ATT_Void_Field_Explosion').length,1);
});
test('Void actual original attack helper applies BF475 and holds a real opponent until the last independent timer expires',()=>{
  const {sim,a,b}=originalAddFixture('DE',{skillId:29023});a.mp=a.mpMax;step(sim,1);
  sim.step(1/60,{add:{pressed:['A'],held:['A']}});
  for(let i=0;i<300&&!hasAddVoidAttackBlock(b);i++)sim.step(1/60,{add:{held:['A']}});
  assert.equal(hasAddVoidAttackBlock(b),true,'the native attack helper must reach the actual hit/Buff pipeline');
  const anchor=b.buffs.find(q=>q.templateId===437).behaviors.find(q=>q.kind==='neverMove').position;
  step(sim,.2,{add:{held:['A']},target:{held:['RIGHT','X'],pressed:['X']}});
  assert.deepEqual([b.x,b.y,b.z],anchor);assert.ok(sim.state.events.some(e=>e.type==='buffApplied'&&e.targetId===b.id&&e.templateId===437));
  for(let i=0;i<120&&!a.state.endsWith('_END');i++)sim.step(1/60,{});
  assert.ok(a.state.endsWith('_END'));step(sim,1.1);assert.equal(hasAddVoidAttackBlock(b),false);
});
test('Void failed ordinary maintenance retains insufficient MP, while exact equality pays before release',()=>{
  const {sim,a,b}=originalAddFixture('DE',{skillId:29023});b.x=2000;
  sim.enter(a,'ANSI_SA_ATT_VOID_FIELD_LOOP','source-loop-maintenance-boundary');a.stateTime=1;a.mp=.4;
  tickAddVoidHold(sim,a,.02);assert.equal(a.mp,.4);assert.equal(a.sourceAddCombat.voidMaintenanceFailed,true);
  a.mp=.5;tickAddVoidHold(sim,a,.02);assert.equal(a.mp,0);assert.equal(a.sourceAddCombat.voidMaintenanceFailed,false);
});

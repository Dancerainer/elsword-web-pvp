/** Current-owner armor across real Buff mutations and historical contacts.
 * The sphere inputs below are declared fixtures, not native geometry or WAN
 * measurements. Buff 18 and its arithmetic use the frozen LK source/WASM. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const nativeSkillValues=await instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values.wasm',import.meta.url)));
const map={sceneId:'owned-protection-v11',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const damage=profile.states.RSI_COMBO_Z.raw.DAMAGE_DATA;
const shape={kind:'sphere',center:[30,50,0],radius:30};
const origin={kind:'character',state:'RSI_COMBO_Z',powerMultiplier:1};
function fixture(){
  const sim=createSimulation({profile,map,nativeSkillValues,networkOwnerId:'owner',seed:2016,
    preset:{buffResistances:{0:0,1:0,2:0,3:0,4:0,5:0,6:0},debuffDurationMultiplier:1},
    collisionSampler:()=>[structuredClone(shape)],
    defenderSampler:actor=>[{kind:'sphere',center:[actor.x,actor.y+50,actor.z],radius:20}],
    actors:[{id:'source',team:0,position:[-300,0,0],lineId:0,loadout:Array(8).fill(null)},
      {id:'owner',team:1,position:[30,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  const a=sim.actor('source'),b=sim.actor('owner');
  a.inputLock=b.inputLock=0;sim.enter(a,'RSI_WAIT','fixture');sim.enter(b,'RSI_WAIT','fixture');sim.drainEvents();
  const grant=()=>{const buff=sim.grantBuff(b,b,18,1,null);assert.ok(buff?.behaviors.some(row=>row.kind==='superArmor'));return buff;};
  const hit=()=>sim.applyHit(a,b,structuredClone(damage),origin);
  return {sim,a,b,grant,hit};
}

test('a freshly granted current-owner armor Buff governs historical beforeStep contact without an ActorTick',()=>{
  const {sim,a,b,grant}=fixture(),consumer=createRemoteActionConsumer({clock:()=>0});
  sim.enter(a,'RSI_COMBO_Z','captured-attack');a.animationTime=.15;a.stateTime=.15;
  consumer.rememberVictim(sim,'owner',1,6);b.x=500;
  const report=encodeOwnedState(sim,'source',{epoch:1,frameSeq:9});
  const action=encodeCriticalAction(report,{id:9,targetViews:[{playerId:'owner',epoch:1,frameSeq:6,position:[30,0,0]}]});
  assert.equal(b.superArmor,false);grant();assert.equal(b.superArmor,true,'the local Buff mutation resolves armor immediately');
  const state=b.state,serial=b.stateSerial,hp=b.hp,animation=b.animationTime;
  assert.equal(consumer.receive('source',[action],1,9),true);assert.equal(consumer.consume(sim,'owner',()=>1),1);
  assert.ok(b.hp<hp,'armor permits damage');assert.equal(b.state,state,'armor rejects hit reaction');assert.equal(b.stateSerial,serial);
  assert.equal(b.animationTime,animation);assert.equal(b.x,500);assert.equal(sim.actor('owner'),b);
  assert.equal(sim.state.events.filter(event=>event.type==='hit'&&event.targetId==='owner').length,1);consumer.clear();
});

test('armor expiration is effective before the next local reaction, without advancing animation or input',()=>{
  const f=fixture();f.grant();const state=f.b.state,serial=f.b.stateSerial,animation=f.b.animationTime;
  f.sim.advanceActorBuffs(f.b,5.01);assert.equal(f.b.buffs.length,0);assert.equal(f.b.superArmor,false);
  assert.equal(f.b.state,state);assert.equal(f.b.stateSerial,serial);assert.equal(f.b.animationTime,animation);
  assert.equal(f.hit().accepted,true);assert.notEqual(f.b.stateSerial,serial);
});

test('removing the current armor identity is reflected at hit entry rather than preserving a stale derived cache',()=>{
  const f=fixture();f.grant();const serial=f.b.stateSerial;f.b.buffs=[];
  assert.equal(f.hit().accepted,true);assert.equal(f.b.superArmor,false);assert.notEqual(f.b.stateSerial,serial);
});

test('another retained Buff does not hide the removal of an earlier armor identity from the cache',()=>{
  const f=fixture();f.grant();assert.ok(f.sim.grantBuff(f.b,f.b,70,1,null));
  // Keep the frozen Armor Break Buff after removing Endurance, as a local
  // cure/replacement could do. The following manager tick must clear armor.
  f.b.buffs=f.b.buffs.filter(buff=>buff.templateId!==18);
  f.sim.advanceActorBuffs(f.b,.01);assert.ok(f.b.buffs.some(buff=>buff.templateId===78));
  assert.ok(!f.b.buffs.some(buff=>buff.behaviors.some(row=>row.kind==='superArmor')));assert.equal(f.b.superArmor,false);
  const serial=f.b.stateSerial;assert.equal(f.hit().accepted,true);assert.notEqual(f.b.stateSerial,serial);
});

test('armor ends during a world stop even though the animation Future returns early',()=>{
  const f=fixture();f.grant();f.sim.advanceActorBuffs(f.b,4.98);f.b.worldStop=1;
  const state=f.b.state,serial=f.b.stateSerial,animation=f.b.animationTime;
  f.sim.step(.1,{}, {snapshot:false});
  assert.equal(f.b.buffs.length,0);assert.equal(f.b.superArmor,false);assert.equal(f.b.state,state);
  assert.equal(f.b.stateSerial,serial);assert.equal(f.b.animationTime,animation);assert.ok(f.b.worldStop>0);
});

test('native state armor survives removal of an additional armor Buff',()=>{
  const f=fixture();f.sim.enter(f.b,'ESSI_ELK_DASH_COMBO_XChargeX','native-state-armor');f.grant();
  const state=f.b.state,serial=f.b.stateSerial;f.sim.advanceActorBuffs(f.b,5.01);
  assert.equal(f.b.buffs.length,0);assert.equal(f.b.superArmor,true);assert.equal(f.hit().accepted,true);
  assert.equal(f.b.state,state);assert.equal(f.b.stateSerial,serial);
});

test('refreshing a Buff cannot prematurely execute a native time-armor window at state entry',()=>{
  const f=fixture();f.sim.enter(f.b,'ESSI_ELK_XXX','native-time-armor-entry');
  assert.equal(f.b.animationTime,0);assert.equal(f.b.superArmor,false,'state entry does not execute CommonFrameMove time ranges');
  f.grant();assert.equal(f.b.superArmor,true);f.sim.advanceActorBuffs(f.b,5.01);
  assert.equal(f.b.superArmor,false);assert.equal(f.b.animationTime,0);
});

test('a current Tough trait and its explicit skill color flag survive Buff expiration',()=>{
  const f=fixture();f.b.skillContext={traitPolicy:{superArmor:true}};f.b.skillSuperArmorNotRed=true;f.grant();
  const context=f.b.skillContext,serial=f.b.stateSerial;f.sim.advanceActorBuffs(f.b,5.01);
  assert.equal(f.b.superArmor,true);assert.equal(f.b.superArmorNotRed,true);assert.equal(f.hit().accepted,true);
  assert.equal(f.b.stateSerial,serial);assert.equal(f.b.skillContext,context);
});

test('the current destruction-rage variant keeps its independent armor and clock',()=>{
  const f=fixture();f.b.wayOfSword.state=-2;f.b.wayOfSword.point=profile.referenceSemantics.wayOfSword.targetFields.Const_DestStateThreshold;
  f.b.destructionRageRemaining=.5;f.grant();f.sim.advanceActorBuffs(f.b,5.01);
  assert.equal(f.b.superArmor,true);assert.equal(f.b.superArmorNotRed,false);assert.equal(f.b.destructionRageRemaining,.5);
  const serial=f.b.stateSerial;assert.equal(f.hit().accepted,true);assert.equal(f.b.stateSerial,serial);
});

test('Buff armor mutation never clears a current local native invincibility window',()=>{
  const f=fixture();f.sim.enter(f.b,'ESSI_DAMAGE_DOWN_FRONT','current-down');assert.equal(f.b.invincible,true);
  f.grant();f.sim.advanceActorBuffs(f.b,5.01);const before=structuredClone(f.b);
  assert.equal(f.b.invincible,true);assert.equal(f.hit().accepted,false);assert.deepEqual(f.b,before);
});

test('current forced invincibility stays final through Buff grant, removal and normal recovery',()=>{
  const f=fixture();f.b.forceInvincible=.5;f.b.invincible=true;f.grant();f.b.buffs=[];const hp=f.b.hp;
  assert.equal(f.hit().accepted,false);assert.equal(f.b.hp,hp);assert.equal(f.b.forceInvincible,.5);assert.equal(f.b.invincible,true);
  f.b.forceInvincible=0;f.b.invincible=false;assert.equal(f.hit().accepted,true);assert.ok(f.b.hp<hp);
});

test('the refresh cannot replace current locally computed armor when no Buff armor has existed',()=>{
  const f=fixture();f.b.superArmor=true;f.b.superArmorNotRed=false;const serial=f.b.stateSerial;
  assert.equal(f.hit().accepted,true);assert.equal(f.b.superArmor,true);assert.equal(f.b.superArmorNotRed,false);assert.equal(f.b.stateSerial,serial);
});

test('an observer-only Buff grant does not recompute the remote owners protection flags',()=>{
  const f=fixture();assert.equal(f.a.superArmor,false);assert.ok(f.sim.grantBuff(f.a,f.a,18,1,null));assert.equal(f.a.superArmor,false);
  f.sim.advanceActorBuffs(f.a,5.01);assert.equal(f.a.superArmor,false);
});

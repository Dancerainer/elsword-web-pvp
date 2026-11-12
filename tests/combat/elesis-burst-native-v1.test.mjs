import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
const incoming={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:1,ATTACK_TYPE:2,HIT_ADD_MP:8,STOP_TIME_DEF:0,STOP_TIME_ATT:0,WAY_OF_SWORD_TYPE:1};
// Only the external triggering attack is injected. Outgoing shock contacts
// below must pass original MonsterAngryWind_AttackBox and body-sphere geometry.
for(const id of ['GM','BH','CA']){
 for(const facing of [-1,1])test(`${id} ${facing}: sourced bubble hits once without HP damage through native mesh geometry`,()=>{
  const {sim,a,b}=elesisFixture(id,{skillId:28218,gap:120,facing});
  assert.equal(sim.defenderSampler(b).length,3);
  sim.prepareWayOfSword(a.id,-2);a.sourceElesisBreakCharge=2000;a.mp=0;
  const hp=a.hp,targetHp=b.hp,hit=sim.injectHit({attackerId:b.id,targetId:a.id,damageData:incoming});
  assert.equal(hit.amount,0);assert.equal(a.hp,hp);assert.equal(a.mp,0);
  assert.deepEqual(a.wayOfSword,{point:-2550,state:-2});
  assert.ok(sim.state.effects.some(e=>e.effectName==='ELESIS_ENDURANCE_ANGRY_WIND'));
  for(let i=0;i<90;i++)sim.step(1/60,{});
  const outgoing=sim.state.events.filter(e=>e.type==='hit'&&e.actorId===a.id&&e.targetId===b.id);
  assert.equal(outgoing.length,1);assert.equal(outgoing[0].origin.kind,'effect');
  assert.equal(outgoing[0].origin.skillId,null);assert.equal(outgoing[0].amount,0);assert.equal(b.hp,targetHp);
  assert.equal(outgoing[0].data.NO_DAMAGE,1);assert.equal(outgoing[0].data.FORCE_FLY,1);
  assert.equal(outgoing[0].data.BACK_SPEED_X,1000);assert.equal(outgoing[0].data.BACK_SPEED_Y,700);
  assert.equal(outgoing[0].data.REACT_TYPE,5);assert.match(b.state,/DAMAGE_/);
 });
 test(`${id}: distant target is not hit by burst presentation`,()=>{
  const {sim,a,b}=elesisFixture(id,{skillId:28218,gap:1400});
  sim.prepareWayOfSword(a.id,-2);a.sourceElesisBreakCharge=2000;
  sim.injectHit({attackerId:b.id,targetId:a.id,damageData:incoming});
  for(let i=0;i<90;i++)sim.step(1/60,{});
  assert.equal(sim.state.events.filter(e=>e.type==='hit'&&e.actorId===a.id).length,0);
  assert.equal(b.state,'RSI_WAIT');
 });
 test(`${id}: airborne burst uses target fall/landing states and returns to WAIT`,()=>{
  const {sim,a,b,profile}=elesisFixture(id,{skillId:28218,gap:1400});
  sim.prepareWayOfSword(a.id,-2);a.sourceElesisBreakCharge=2000;a.y+=250;a.grounded=false;a.lineId=null;
  sim.injectHit({attackerId:b.id,targetId:a.id,damageData:incoming});
  sim.step(1/60,{});assert.equal(a.state,'ESI_CAN_NOT_ATTACK_JUMP_DOWN');
  for(let i=0;i<180;i++)sim.step(1/60,{});
  assert.equal(a.grounded,true);assert.equal(profile.states[a.state].sourceState,'ESI_SWORD_WAIT');
  assert.ok(sim.state.events.some(e=>e.type==='stateChanged'&&e.state==='RSI_JUMP_LANDING'));
 });
}

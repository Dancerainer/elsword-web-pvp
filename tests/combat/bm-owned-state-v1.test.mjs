/** Web ownership/restore regressions, not original-client answer traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bmFixture,bmProfile} from '../helpers/bm-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

const skills=bmProfile.skillCatalog.filter(skill=>skill.topTier&&!skill.passive&&skill.supported&&skill.skillId!==900);
for(const skill of skills)for(const awake of [false,true])test(`BM owned ${skill.skillId}${awake?' awake':''} survives real skill effects, buffs and JSON restore`,()=>{
  const source=bmFixture({skillId:skill.skillId}),receiver=bmFixture({skillId:skill.skillId});
  if(awake)source.a.awakening.remaining=60;
  let began=false;
  for(let frame=0;frame<240;frame++){
    source.sim.step(1/60,{bm:frame===0?{pressed:['A'],held:['A']}:{held:[]}}, {snapshot:false});
    began||=source.sim.drainEvents().some(event=>event.type==='skillStarted'&&event.actorId==='bm');
    if(![15,60,150,239].includes(frame))continue;
    const packet=JSON.parse(JSON.stringify(encodeOwnedState(source.sim,'bm',{epoch:1,frameSeq:frame+1})));
    assert.doesNotThrow(()=>validateOwnedState(packet));
    assert.doesNotThrow(()=>validateOwnedReferences(packet,receiver.a,receiver.sim.profileFor(receiver.a),receiver.map,{profiles:receiver.sim.profiles,actors:receiver.sim.state.actors}));
    applyOwnedState(receiver.sim,'bm',packet);
    assert.deepEqual(receiver.a.sourceBladeMaster,source.a.sourceBladeMaster);
    receiver.sim.step(1/60,{bm:{held:[]}},{snapshot:false});
    for(const actor of receiver.sim.state.actors)assert.ok([actor.x,actor.y,actor.hp,actor.mp].every(Number.isFinite));
  }
  assert.equal(began,true,'test must enter the skill through its actual slot');
});

test('BM passive Emergency Escape restores without an equipped Shadow Step and rejects forged passive eligibility',()=>{
  const source=bmFixture({skillId:24033,passives:[24410]}),receiver=bmFixture({skillId:24033,passives:[24410]});
  source.b.x=source.a.x-100;source.sim.rng=()=>0;
  source.sim.applyHit(source.b,source.a,{DAMAGE:{PHYSIC:.1},DAMAGE_TYPE:0,REACT_TYPE:1,BACK_SPEED_X:0,BACK_SPEED_Y:0,STOP_TIME_ATT:0,STOP_TIME_DEF:0,FORCE_DOWN:0},{kind:'character',powerMultiplier:1});
  assert.equal(source.a.skillId,24217);assert.ok(source.a.sourceBladeMaster.escapeCooldown>0);
  const packet=encodeOwnedState(source.sim,'bm',{epoch:1,frameSeq:1}),check=()=>validateOwnedReferences(packet,receiver.a,receiver.sim.profileFor(receiver.a),receiver.map);
  assert.doesNotThrow(check);applyOwnedState(receiver.sim,'bm',packet);
  receiver.a.passivePolicy.bladeMaster.escapeChance=0;assert.throws(check,/unconfigured-owner-skill/);
  const malformed=structuredClone(packet);malformed.actor.sourceBladeMaster.loops=-1;assert.throws(()=>validateOwnedState(malformed),/actor-shape/);
});

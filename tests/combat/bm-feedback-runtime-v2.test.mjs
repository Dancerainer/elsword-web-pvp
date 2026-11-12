import test from 'node:test';
import assert from 'node:assert/strict';
import {bmSampledFixture} from '../helpers/bm-sampled-commands-v2.mjs';
import {bmFixture,bmProfile} from '../helpers/bm-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

for(const facing of [1,-1])test(`BM physical 668X hits an airborne target with big stagger rather than knockdown, facing ${facing}`,()=>{
  const f=bmSampledFixture({gap:400,facing,passives:[]}),{sim,a,b}=f;
  sim.rng=()=>.99;
  const accepted=[],apply=sim.applyParticipantHit;
  sim.applyParticipantHit=function(attacker,target,data,origin){
    const name=this.state.effects.find(e=>e.id===origin?.id)?.name;
    const result=apply.call(this,attacker,target,data,origin);
    if(result.accepted&&name==='DamageEffect_RBM_DashJump_X')accepted.push({reaction:data.REACT_TYPE,state:target.state});
    return result;
  };
  const key=facing===1?'RIGHT':'LEFT';f.press(key);f.down(key);f.step();
  assert.equal(a.state,'RSI_DASH');f.down('UP');
  // The target2016 BM first X is a short hand burst, not the old traveling
  // fireball. Both players jump normally to put a real body in its air range.
  sim.step(1/60,{bm:f.input.consume(sim.state.time+1/60,1/60),target:{pressed:['UP']}});
  f.up('UP');f.step();f.up(key);f.step(5);f.press('X');
  assert.equal(a.state,'RSI_DASH_JUMP_COMBO_X');
  f.step(180);
  assert.equal(accepted.length,1);
  assert.equal(accepted[0].reaction,2);
  assert.equal(accepted[0].state,'RSI_DAMAGE_AIR_SMALL');
  assert.equal(b.state,'RSI_WAIT');
  assert.equal(bmProfile.damageEffects.RAVEN_DASH_JUMP_X.raw.DAMAGE_DATA.REACT_TYPE,3,'shared source declarations stay intact');
});

test('Shockwave third damage stage restores across an owned packet and rejects undeclared stages',()=>{
  const source=bmFixture({skillId:24030,passives:[],gap:450}),receiver=bmFixture({skillId:24030,passives:[],gap:450});
  source.sim.rng=()=>.99;source.sim.step(1/60,{bm:{pressed:['A']}});
  for(let i=0;i<60&&!source.sim.state.effects.some(e=>e.stage===2);i++)source.sim.step(1/60,{});
  const packet=encodeOwnedState(source.sim,'bm',{epoch:1,frameSeq:60});
  const third=packet.effects.find(e=>e.stage===2);assert.ok(third);
  const refs=p=>validateOwnedReferences(p,receiver.a,receiver.sim.profileFor(receiver.a),receiver.map,{profiles:receiver.sim.profiles,actors:receiver.sim.state.actors});
  assert.doesNotThrow(()=>refs(packet));
  applyOwnedState(receiver.sim,'bm',packet);
  const restored=receiver.sim.state.effects.find(e=>e.networkId===third.id);
  assert.equal(restored.stage,2);
  assert.ok(restored.damage.DAMAGE_DATA_NEXT2.DAMAGE.PHYSIC>0);
  const overflow=structuredClone(packet);overflow.effects.find(e=>e.id===third.id).stage=4;
  assert.throws(()=>validateOwnedState(overflow),/invalid-owner-effect-stage/);
  const undeclaredThirdNext=structuredClone(packet);undeclaredThirdNext.effects.find(e=>e.id===third.id).stage=3;
  assert.throws(()=>refs(undeclaredThirdNext),/invalid-owner-effect-stage/);
  source.sim.createEffect(source.a,{NAME:'RBM_BLACKHOLE_EXPLOSION'});
  const undeclared=encodeOwnedState(source.sim,'bm',{epoch:1,frameSeq:61});
  const single=undeclared.effects.find(e=>e.name==='RBM_BLACKHOLE_EXPLOSION');assert.ok(single);single.stage=2;
  assert.throws(()=>refs(undeclared),/invalid-owner-effect-stage/);
});

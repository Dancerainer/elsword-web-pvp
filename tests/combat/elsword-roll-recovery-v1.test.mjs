import test from 'node:test';
import assert from 'node:assert/strict';
import {rollFixture,castRoll,until} from '../helpers/elsword-roll-fixture.mjs';
import {lordKnightSkillEvent} from '../../packages/combat-core/lk-skills.mjs';
import {encodeOwnedState,validateOwnedState,applyOwnedState} from '../../packages/online/owned-state.mjs';
const landing='ESSI_SI_A_ES_ROLLING_END';
const keys=(...held)=>({held:new Set(held),pressed:new Set()});
for(const profession of ['LK','IS','RS']){
  test(`${profession} Roll recovery uses target .266 strict horizontal gate and preserves animation-end priority`,()=>{
    const f=rollFixture(profession);castRoll(f);until(f,()=>f.a.state===landing);
    assert.equal(f.profile.states[landing].raw.WALK_CANCEL_AFTER,.266);
    for(const time of [.25,.266]){f.a.animationTime=time;lordKnightSkillEvent(f.sim,f.a,keys('RIGHT'));assert.equal(f.a.state,landing);}
    f.a.animationTime=.267;
    for(const key of ['Z','X','A','UP','DOWN','AWAKEN']){lordKnightSkillEvent(f.sim,f.a,keys(key));assert.equal(f.a.state,landing);}
    lordKnightSkillEvent(f.sim,f.a,keys('LEFT'));assert.equal(f.a.state,'RSI_WAIT');assert.equal(f.a.skillId,null);
    const ended=rollFixture(profession);castRoll(ended);until(ended,()=>ended.a.state===landing);
    ended.a.animationTime=.61;ended.a.grounded=false;lordKnightSkillEvent(ended.sim,ended.a,keys('RIGHT'));
    assert.equal(ended.a.state,'RSI_JUMP_DOWN');
  });
  for(const facing of [-1,1])for(const speed of [1,1.8])for(const direction of ['LEFT','RIGHT'])
    test(`${profession} Roll ${facing}/${speed}/${direction}: real cast, original helpers, cancel, then move and cast next skill`,()=>{
      const f=rollFixture(profession,{facing,speed});castRoll(f);until(f,()=>f.a.state===landing);
      const start=f.sim.state.time;
      for(let i=0;i<40&&f.a.state===landing;i++)f.step({held:[direction]});
      assert.equal(f.a.state,'RSI_WAIT');assert.equal(f.a.skillId,null);
      assert.ok(Math.abs(f.sim.state.time-start-16/60)<1e-8,'item speed is disabled by both original Roll state rows');
      const event=f.sim.state.events.find(e=>e.reason==='elsword-roll-source-walk-cancel');assert.ok(event);
      f.step({held:[direction]});assert.equal(f.a.state,'RSI_WALK');assert.equal(f.a.facing,direction==='RIGHT'?1:-1);
      f.step({pressed:['S'],held:['S']});assert.equal(f.a.skillId,21026);
    });
  test(`${profession} Roll without horizontal input retains original natural landing end`,()=>{
    const f=rollFixture(profession);castRoll(f);until(f,()=>f.a.state===landing);const start=f.sim.state.time;
    until(f,()=>f.a.skillId===null);assert.equal(f.a.state,'RSI_WAIT');
    assert.ok(Math.abs(f.sim.state.time-start-.6)<1e-8);
    assert.equal(f.sim.state.events.some(e=>e.reason==='elsword-roll-source-walk-cancel'),false);
  });
  test(`${profession} Roll landing cancel survives owned-state transfer and real hitstop defers its clock`,()=>{
    const f=rollFixture(profession);castRoll(f);until(f,()=>f.a.state===landing);f.a.animationTime=.25;
    const receiver=rollFixture(profession);const owned=encodeOwnedState(f.sim,'actor');validateOwnedState(owned);applyOwnedState(receiver.sim,'actor',owned);
    receiver.a.hitStop=.1;for(let i=0;i<5;i++)receiver.step({held:['RIGHT']});assert.equal(receiver.a.state,landing);
    for(let i=0;i<5&&receiver.a.state===landing;i++)receiver.step({held:['RIGHT']});assert.equal(receiver.a.state,'RSI_WAIT');
  });
}

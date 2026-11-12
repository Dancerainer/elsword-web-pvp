/** Target declarations and the pinned callback establish the expected end
 * condition. These are current-simulation regressions, not client captures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {make,profile,read} from '../fixtures/is-native-simulation.mjs';
import {infinitySwordCommands} from '../../packages/combat-core/is-commands.mjs';
import {IS_COMMAND_CANCEL} from '../../packages/combat-core/is-feedback.mjs';
const state='ESSI_ETK_COMBO_XXXZ',dt=1/120;
const keys=(pressed=[],held=[])=>({pressed:new Set(pressed),held:new Set(held)});
for(const facing of [-1,1])for(const target of [false,true]){
  test(`IS final Z ${facing}, ${target?'hit':'miss'}: sword and pose survive .4 until the original animation ends`,()=>{
    const sim=make({facing,target}),a=sim.actor('is');sim.enter(a,state,'source-final-Z');sim.drainEvents();
    let crossed=false,lastAnimationTime=0,finished=false;
    for(let frame=0;frame<240&&!finished;frame++){
      const before=a.animationTime;sim.step(dt,{},{snapshot:false});
      if(a.state===state){
        lastAnimationTime=a.animationTime;
        if(a.animationTime>.4){crossed=true;assert.ok(sim.state.effects.some(e=>e.name==='SecondBlade'&&e.ownerStateSerial===a.stateSerial));}
      }else{
        assert.equal(a.state,'RSI_WAIT');assert.ok(before>=1.08&&before<1.10,'SkinAnim uses the source period minus its default .12 transition');
        assert.ok(!sim.state.effects.some(e=>e.name==='SecondBlade'));finished=true;
      }
      sim.drainEvents();
    }
    assert.ok(crossed&&finished);assert.ok(lastAnimationTime>=1.08);
  });
}
test('IS final Z has no idle .4 exit, while explicit user cancellation windows remain usable',()=>{
  const sim=make({target:false}),a=sim.actor('is');sim.enter(a,state,'source-final-Z-boundaries');
  a.animationTime=.40001;assert.equal(infinitySwordCommands.runEvent(a,keys(),profile).state,null);
  a.animationTime=1.2;assert.equal(infinitySwordCommands.runEvent(a,keys(),profile).state,null);
  a.animationTime=1.20001;assert.equal(infinitySwordCommands.runEvent(a,keys(),profile).state,'RSI_WAIT');
  a.animationTime=.37;assert.equal(infinitySwordCommands.runEvent(a,keys(['DASH']),profile).state,null);
  a.animationTime=.37001;assert.equal(infinitySwordCommands.runEvent(a,keys(['DASH']),profile).state,'DASH_REQUEST');
  assert.equal(Object.hasOwn(IS_COMMAND_CANCEL[state],'recover'),false);
});
test('the independently re-parsed 2016 declaration stays identical to the frozen production raw state',()=>{
  const contract=read('contracts/is-final-z-source-review.json');
  assert.deepEqual(profile.states[state].raw,contract.target.raw);
  assert.equal(profile.states[state].clip.durationSeconds,1.2);
  assert.equal(profile.states[state].clip.decodedKeysSha256,'940a793443055d3bd69461c7b942a8f2a76974ea44247b6bd8ef8b43b82afc83');
  assert.equal(contract.clientMeasured,false);
});

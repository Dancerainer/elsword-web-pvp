import test from 'node:test';
import assert from 'node:assert/strict';
import {bmSampledFixture} from '../helpers/bm-sampled-commands-v2.mjs';
import {bmProfile,bmFixture} from '../helpers/bm-fixture.mjs';
import {createBladeMasterCommands,bmCommandSkillCancelAllowed} from '../../packages/combat-core/bm-commands.mjs';
const noKeys=()=>({pressed:new Set(),held:new Set()});

for(const facing of [-1,1]){
  test(`BM feedback ${facing}: physical ZZXX follows shared Raven chain, also with forward held`,()=>{
    for(const forward of [false,true]){
      const f=bmSampledFixture({facing});f.press('Z');f.press('Z');f.wait('RSI_COMBO_ZZ');f.press('X');f.wait('RSI_COMBO_ZZX');
      if(forward)f.down(facing>0?'RIGHT':'LEFT');f.press('X');f.wait('RSI_COMBO_ZZXX');
      assert.ok(!f.frames.some(r=>r.state.startsWith('RRF_')));f.input.releaseAll(f.sim.state.time+.001);f.wait('RSI_WAIT');
    }
  });
  test(`BM feedback ${facing}: physical ZZXX still finishes through real contact and hit-stop`,()=>{
    const f=bmSampledFixture({facing,gap:150});f.press('Z');f.press('Z');f.wait('RSI_COMBO_ZZ');f.press('X');f.wait('RSI_COMBO_ZZX');f.press('X');f.wait('RSI_COMBO_ZZXX');f.wait('RSI_WAIT');
    assert.ok(f.sim.state.events.some(e=>e.type==='hit'&&e.actorId==='bm'&&e.origin.state==='RSI_COMBO_ZZXX'&&e.amount>0));
  });
  test(`BM feedback ${facing}: physical ZZZ up Z really launches and cannot leak velocity into XZZZ`,()=>{
    const f=bmSampledFixture({facing});f.upFinisher();f.wait('RSI_WAIT');
    const first=f.frames.filter(r=>r.state==='RSI_RBM_COMBO_ZZZupZ');
    assert.ok(first.some(r=>!r.grounded&&r.y>3080));
    assert.ok(Math.max(...first.map(r=>r.y))<3380);
    assert.equal(f.a.vy,0);assert.equal(f.a.grounded,true);
    const start=f.frames.length,groundY=f.a.y;f.xzzz();f.wait('RSI_WAIT');
    const second=f.frames.slice(start),launches=f.sim.state.events.filter(e=>e.type==='velocityEvent'&&e.actorId==='bm'&&e.field==='SPEED_TIME0'&&e.values['2']===1500);
    assert.equal(launches.length,1);assert.ok(second.some(r=>!r.grounded));
    // Independent Euler bound: a single1500 launch under source4000 gravity
    // rises <1500^2/(2*4000), with no stale extra1500 from the earlier combo.
    assert.ok(Math.max(...second.map(r=>r.y))-groundY<=281.25);
    assert.ok(Math.max(...second.map(r=>r.vy))<=1500);
  });
  test(`BM feedback ${facing}: ZZZ up Z accepts a fresh airborne X after its target hit window`,()=>{
    const f=bmSampledFixture({facing});f.upFinisher();f.at(.71);const y=f.a.y;f.press('X');
    assert.equal(f.a.state,'RSI_JUMP_COMBO_X');assert.equal(f.a.grounded,false);assert.ok(f.a.y>=y);
  });
  test(`BM feedback ${facing}: contact ZZZ up Z also releases the floor and leaves no extra XZZZ lift`,()=>{
    const f=bmSampledFixture({facing,gap:150});f.upFinisher();f.wait('RSI_WAIT');
    assert.ok(f.sim.state.events.some(e=>e.type==='hit'&&e.actorId==='bm'&&e.origin.state==='RSI_RBM_COMBO_ZZZupZ'));
    assert.equal(f.a.vy,0);const start=f.frames.length,groundY=f.a.y;f.xzzz();f.wait('RSI_WAIT');
    assert.ok(Math.max(...f.frames.slice(start).map(r=>r.y))-groundY<=281.25);
  });
  test(`BM feedback ${facing}: ZZZ up Z can resume sampled air66 or an air-legal skill without gaining height again`,()=>{
    for(const cancel of ['dash','skill']){
      const f=bmSampledFixture({facing,skillId:24030});f.upFinisher();f.at(.71);const vy=f.a.vy;
      if(cancel==='skill'){
        assert.equal(f.sim.skillAvailability('bm',0).available,true);f.press('A');
        assert.equal(f.a.skillId,24030);assert.ok(f.sim.state.events.some(e=>e.type==='skillStarted'&&e.skillId===24030));
      }else{
        const key=facing>0?'RIGHT':'LEFT';f.press(key);f.down(key);f.step();
        assert.equal(f.a.state,'RSI_DASH_JUMP');assert.equal(f.a.grounded,false);assert.ok(f.a.vy<=vy);
      }
    }
  });
  test(`BM feedback ${facing}: black-hole slash accepts a late sampled Z before automatic explosion`,()=>{
    const f=bmSampledFixture({facing});f.blackHole();f.at(.72);const serial=f.a.stateSerial;
    f.press('Z');assert.equal(f.a.state,'RBM_COMBO_ZZZXZ');assert.ok(f.a.stateSerial>serial);
    assert.equal(f.a.sourceBladeMaster.blackHoleCount,3);
  });
  test(`BM feedback ${facing}: all four black-hole slashes reach damage before bounded explosion`,()=>{
    const f=bmSampledFixture({facing});f.blackHole();
    for(let count=2;count<=5;count++){
      assert.equal(f.a.sourceBladeMaster.blackHoleCount,count);
      f.at(.4);assert.equal(f.a.state,'RBM_COMBO_ZZZXZ');
      if(count<5){const serial=f.a.stateSerial;f.press('Z');f.until(()=>f.a.stateSerial>serial);}
    }
    f.wait('RBM_COMBO_ZZZX_EXPLOSION');f.wait('RSI_WAIT');
    const serials=new Set(f.frames.filter(r=>r.state==='RBM_COMBO_ZZZXZ').map(r=>r.serial));assert.equal(serials.size,4);
    for(const serial of serials)assert.ok(f.frames.some(r=>r.serial===serial&&r.animationTime>=.39));
  });
  test(`BM feedback ${facing}: physical 668ZZZ landing can walk or jump without waiting for full end`,()=>{
    for(const cancel of ['walk','jump']){
      const f=bmSampledFixture({facing});f.dashJumpThird();f.wait('RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ_Landing');f.at(.21);
      f.down(cancel==='walk'?(facing>0?'LEFT':'RIGHT'):'UP');f.step();
      assert.equal(f.a.state,'RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ_Landing');
      assert.equal(f.a.sourcePendingState?.state,cancel==='walk'?'RSI_WAIT':'RSI_JUMP_READY');
      f.step();
      if(cancel==='walk'){
        assert.equal(f.a.state,'RSI_WAIT');assert.equal(f.a.sourcePendingState?.state,'RSI_WALK');f.step();
      }
      assert.ok(cancel==='walk'?f.a.state==='RSI_WALK':['RSI_JUMP_READY','RSI_JUMP_UP'].includes(f.a.state),f.a.state);
    }
  });
  test(`BM feedback ${facing}: physical 668ZZZZ fourth Z accepts reverse movement and fresh X`,()=>{
    for(const cancel of ['walk','attack']){
      const f=bmSampledFixture({facing});f.dashJumpThird();f.wait('RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ_Landing');f.press('Z');f.wait('RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZZ');f.at(.51);
      if(cancel==='walk'){
        f.down(facing>0?'LEFT':'RIGHT');f.step();
        assert.equal(f.a.state,'RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZZ');assert.equal(f.a.sourcePendingState?.state,'RSI_WAIT');
        f.step();assert.equal(f.a.state,'RSI_WAIT');assert.equal(f.a.sourcePendingState?.state,'RSI_WALK');
        f.step();assert.equal(f.a.state,'RSI_WALK');
      }
      else{f.press('X');assert.equal(f.a.state,'RSI_COMBO_X');}
    }
  });
  test(`BM feedback ${facing}: third and fourth 668Z recovery keeps original skill windows available`,()=>{
    for(const stage of [3,4]){
      const f=bmSampledFixture({facing,skillId:24033});f.dashJumpThird();f.wait('RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ_Landing');
      if(stage===4){f.press('Z');f.wait('RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZZ');}
      const raw=bmProfile.states[f.a.state].raw.SKILL_CANCEL_AFTER;
      assert.equal(raw,stage===3?.01:.35,'raw declarations remain independent of original enter normalization');
      // Third recovery consumes the original .1 minimum; the user's fourth-Z
      // free recovery remains tied to its independent SPEED_TIME2 .306 gate.
      f.a.animationTime=Math.fround(stage===3?.1:.306);
      assert.equal(f.sim.skillAvailability('bm',0).available,false,'equality stays closed at the consumed source gate');
      f.at(stage===3?.1001:.3061);
      assert.equal(f.sim.skillAvailability('bm',0).available,true);
      f.down('A');f.step();
      assert.equal(f.a.skillId,null,'dispatch retains the old command context until apply');
      assert.equal(f.a.sourcePendingState?.skill.skillId,24033);
      f.up('A');f.step();
      assert.equal(f.a.skillId,24033);assert.ok(f.sim.state.events.some(e=>e.type==='skillStarted'&&e.skillId===24033));
    }
  });
}

test('BM feedback cancel boundaries remain closed before attack/dive and open after, without changing raw declarations',()=>{
  const {sim,a,native}=bmFixture({gap:4000}),commands=createBladeMasterCommands(sim,native.commands);
  for(const [state,at] of [['RSI_RBM_COMBO_ZZZupZ',.7],['RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ',.3]]){
    sim.enter(a,state,'boundary');a.animationTime=at;assert.equal(bmCommandSkillCancelAllowed(a,bmProfile.states[state]),false);
    a.animationTime=at+.0001;assert.equal(bmCommandSkillCancelAllowed(a,bmProfile.states[state]),true);
  }
  sim.enter(a,'RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZZ','ground-finisher');assert.equal(commands.isAirState(a),false);
  sim.enter(a,'RSI_COMBO_ZZX','shared-inclusive-window');a.animationTime=.6;
  const r=commands.runEvent(a,{...noKeys(),pressed:new Set(['X'])},bmProfile);assert.equal(r.flags,1);assert.equal(r.state,null);
  a.sourceCommandFlags=r.flags;a.animationTime=.6001;assert.equal(commands.runEvent(a,noKeys(),bmProfile).state,'RSI_COMBO_ZZXX');
});

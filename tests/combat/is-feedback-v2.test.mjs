/** Actual geometry/input tests of the requested Web corrections. Expectations
 * describe the user request; they are not claimed as original-client traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {make,profile,map,read,effectIndex} from '../fixtures/is-native-simulation.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const dt=1/120;
function tick(sim,frames,input=()=>({})){const events=[];for(let i=0;i<frames;i++){sim.step(dt,{is:input(i)}, {snapshot:false});events.push(...sim.drainEvents());}return events;}
function restore(receiver,report){validateOwnedState(report);validateOwnedReferences(report,receiver.actor('is'),profile,map,{actors:receiver.state.actors,profiles:{IS:profile}});applyOwnedState(receiver,'is',report);}
const hits=events=>events.filter(e=>e.type==='hit'&&e.actorId==='is');
for(const facing of [-1,1]){
  test(`668XXX ${facing}: hop retains roll, both authored hits, big stagger and red armor`,()=>{
    const sim=make({facing}),a=sim.actor('is');sim.enter(a,'ESSI_EIS_DASHJUMP_COMBO_XXX','feedback-roll');
    const events=[];let lifted=false,armoredHit=false;
    for(let i=0;i<180;i++){
      sim.step(dt,{});const row=sim.drainEvents();events.push(...row);
      if(a.y>3081){lifted=true;assert.equal(a.state,'ESSI_EIS_DASHJUMP_COMBO_XXX');}
      if(hits(row).length){assert.equal(a.superArmor,true);assert.equal(a.superArmorNotRed,false);armoredHit=true;}
    }
    assert.ok(lifted&&armoredHit);assert.ok(a.x*facing>200);
    assert.deepEqual(hits(events).map(e=>e.data.REACT_TYPE),[1,2]);
    assert.ok(events.some(e=>e.type==='stateChanged'&&e.actorId==='target'&&e.state==='RSI_DAMAGE_BIG_FRONT'));
    assert.equal(a.state,'RSI_WAIT');assert.ok(!sim.state.effects.some(e=>e.name==='SecondBlade'));
  });
  test(`Z4→Z5 ${facing}: queued last Z catches a genuinely airborne fourth-Z launch`,()=>{
    const sim=make({facing}),a=sim.actor('is'),b=sim.actor('target');sim.enter(a,'ESSI_ETK_COMBO_ZZZZ','feedback-Z-chain');
    let queued=false,launch=false,caught=false;const events=[];
    for(let i=0;i<240;i++){
      const input=!queued&&a.animationTime>.28&&a.state==='ESSI_ETK_COMBO_ZZZZ'?{pressed:['Z']}:{ };
      input.held=[facing===1?'RIGHT':'LEFT'];queued||=!!input.pressed;
      const priorY=b.y,priorGround=b.grounded;sim.step(dt,{is:input});const row=sim.drainEvents();events.push(...row);
      for(const e of hits(row)){
        if(e.origin.state==='ESSI_ETK_COMBO_ZZZZ'&&e.data.REACT_TYPE===4)launch=true;
        if(e.origin.state==='ESSI_ETK_COMBO_ZZZZZ'){assert.ok(launch);if(!caught)assert.ok(priorY>3081&&!priorGround);caught=true;}
      }
    }
    assert.ok(queued&&launch&&caught);assert.equal(hits(events).filter(e=>e.origin.state==='ESSI_ETK_COMBO_ZZZZZ').length,2);
  });
  test(`XXXX~Z ${facing}: real second sword launches and completes its authored animation`,()=>{
    const sim=make({facing}),a=sim.actor('is');sim.enter(a,'ESSI_ETK_COMBO_XXXZ','feedback-XZ');
    const events=tick(sim,240);
    assert.deepEqual(hits(events).map(e=>e.data.REACT_TYPE),[1,4]);
    const ended=events.find(e=>e.type==='stateChanged'&&e.actorId==='is'&&e.state==='RSI_WAIT');
    assert.ok(ended&&ended.time>.9&&ended.time<1.5);assert.ok(events.some(e=>e.actorId==='target'&&e.state==='RSI_DAMAGE_AIR_UP'));
    assert.ok(!sim.state.effects.some(e=>e.name==='SecondBlade'));
  });
  test(`66ZZ ${facing}: broad final slash reaches distant target and pulls toward attacker`,()=>{
    const sim=make({facing,distance:400}),a=sim.actor('is'),b=sim.actor('target');sim.enter(a,'ESSI_ETK_DASH_COMBO_ZZ','feedback-pull');
    let pulled=false;
    for(let i=0;i<220;i++){
      sim.step(dt,{});for(const e of hits(sim.drainEvents()))if(e.data.BACK_SPEED_X===-700){
        assert.equal(e.data.REACT_TYPE,2);assert.equal(b.state,'RSI_DAMAGE_BIG_FRONT');assert.ok(b.vx*facing<0);assert.ok((b.x-a.x)*facing>0);pulled=true;
      }
    }
    assert.ok(pulled,'last-stage collision, not only the first close-range hit');
  });
  test(`66XXX middle X ${facing}: three source swords actually hit and launch`,()=>{
    const sim=make({facing}),a=sim.actor('is');sim.enter(a,'ESSI_EIS_DASH_COMBO_XX','feedback-dash-swords');
    const events=tick(sim,180),swords=events.filter(e=>e.type==='effectStarted'&&/^ELSWORD_C_DASHXX_SWORD/.test(e.name));
    assert.equal(swords.length,3);const ids=new Set(swords.map(e=>e.effectId));
    assert.ok(hits(events).some(e=>ids.has(e.origin.id)&&e.data.REACT_TYPE===4&&e.data.STOP_TIME_DEF===.133));
    assert.ok(events.some(e=>e.actorId==='target'&&e.state==='RSI_DAMAGE_AIR_UP'));
    for(const name of ['elsword_C_DashXX_sword_M01','elsword_C_DashXX_sword_M02','elsword_C_DashXX_sword_M03']){
      assert.equal(effectIndex.templates[name].animationClips[0].ticksPerSecond,4800);assert.ok(effectIndex.templates[name].poseData);
    }
  });
  test(`668ZZZ ${facing}: exactly 10MP, three swords and source big stagger`,()=>{
    const sim=make({facing}),a=sim.actor('is');a.y+=250;a.grounded=false;a.lineId=null;
    const b=sim.actor('target');b.y+=250;b.grounded=false;b.lineId=null;
    sim.enter(a,'ESSI_ETK_DASH_JUMP_ZZZ','feedback-air-swords');const paid=sim.drainEvents();const events=[...paid,...tick(sim,150)];
    assert.deepEqual(events.filter(e=>e.type==='commandMpSpent').map(e=>e.amount),[10]);
    const swords=events.filter(e=>e.type==='effectStarted'&&/^ELSWORD_C_DASH_JUMP_ZZZ_SWORD/.test(e.name));assert.equal(swords.length,3);
    const ids=new Set(swords.map(e=>e.effectId));assert.ok(hits(events).some(e=>ids.has(e.origin.id)&&e.data.REACT_TYPE===2&&e.data.STOP_TIME_DEF===.25));
  });
  test(`Sword Fall ${facing}: original four releases and target2016 damage declarations`,()=>{
    const sim=make({facing,skillId:21019,unenhancedSwordFall:true});sim.step(dt,{is:{pressed:['A']}});const events=tick(sim,480);
    const births=events.filter(e=>e.type==='effectStarted'&&e.actorId==='is');
    const released=births.filter(e=>/^ELSWORD_SWORDFALL_BLADE[1-4]$/.test(e.name));
    assert.deepEqual(released.map(e=>e.name),['ELSWORD_SWORDFALL_BLADE1','ELSWORD_SWORDFALL_BLADE2','ELSWORD_SWORDFALL_BLADE3','ELSWORD_SWORDFALL_BLADE4']);
    assert.equal(new Set(released.map(e=>e.time)).size,4);assert.ok(hits(events).length>0);
    for(const e of hits(events)){assert.equal(e.data.REACT_TYPE,5);assert.equal(e.data.BACK_SPEED_X,850);assert.equal(e.data.BACK_SPEED_Y,550);assert.equal(e.data.STOP_TIME_DEF,0);}
    assert.ok(births.some(e=>e.name==='elsword_A_swordFall_M02'));
    assert.ok(births.some(e=>e.name==='ELSWORD_SWORDFALL_BLADE_FALLEN4'));
  });
}
for(const [state,at] of [['RSI_COMBO_ZZ',.24],['ESSI_ETK_COMBO_ZZZZ',.24],['ESSI_ETK_COMBO_ZZZZZ',.44],
  ['RSI_COMBO_XX',.5],['ESSI_ETK_COMBO_XXX_LOOP',.266],['RSI_COMBO_XXX',.3]]){
  test(`${state}: skill is available in the new middle window and the real key interrupts`,()=>{
    const sim=make({target:false,skillId:21213}),a=sim.actor('is');sim.enter(a,state,'feedback-skill-cancel');
    a.animationTime=at;assert.equal(sim.skillAvailability('is',0).available,false,'strict boundary');
    a.animationTime=at+.00001;assert.equal(sim.skillAvailability('is',0).available,true);
    sim.step(dt,{is:{pressed:['A']}});
    if(state==='RSI_COMBO_ZZ'){
      assert.equal(a.state,state);assert.equal(a.skillId,null,'shared original post retains its current command context');
      assert.equal(a.sourcePendingState?.skill.skillId,21213);sim.step(dt,{});
    }
    assert.equal(a.skillId,21213);
    assert.ok(!sim.state.effects.some(e=>e.name==='SecondBlade'&&e.ownerStateSerial!==a.stateSerial));
  });
}
test('real preset attack speed keeps all three authored X loops before the final X',()=>{
  const sim=make({target:false}),a=sim.actor('is'),queued=new Set();sim.enter(a,'ESSI_ETK_COMBO_XXX_LOOP','source-loop-at-real-preset-speed');
  const states=[];
  for(let i=0;i<360;i++){
    const keys=a.state==='ESSI_ETK_COMBO_XXX_LOOP'&&a.animationTime>.05&&!queued.has(a.stateSerial)?{pressed:['X']}:{};
    if(keys.pressed)queued.add(a.stateSerial);
    sim.step(dt,{is:keys},{snapshot:false});
    states.push(...sim.drainEvents().filter(e=>e.type==='stateChanged').map(e=>e.state));
  }
  assert.equal(a.sourceInfinitySword.comboLoops,3);
  assert.equal(states.filter(n=>n==='ESSI_ETK_COMBO_XXX_LOOP').length,3);
  assert.ok(states.includes('RSI_COMBO_XXX'));assert.equal(a.state,'RSI_WAIT');
});

test('10MP gate rejects third air Z below cost; forced fixture cannot produce unpaid swords',()=>{
  const sim=make({target:false}),a=sim.actor('is');a.mp=9;a.y+=250;a.grounded=false;a.lineId=null;
  sim.enter(a,'ESSI_DASH_JUMP_COMBO_Z2','low-MP');a.sourceCommandFlags=1;a.animationStopped=true;sim.step(dt,{});
  assert.notEqual(a.state,'ESSI_ETK_DASH_JUMP_ZZZ');assert.equal(sim.state.effects.length,0);
  a.mp=9;sim.enter(a,'ESSI_ETK_DASH_JUMP_ZZZ','explicit-unpaid-fixture');assert.ok(!sim.drainEvents().some(e=>e.type==='commandMpSpent'));
  assert.ok(!tick(sim,100).some(e=>e.type==='effectStarted'&&/^ELSWORD_C_DASH_JUMP_ZZZ_SWORD/.test(e.name)));
});
test('SecondBlade exact loop pose and state-end identity survive owner reconstruction and repeated cleanup',()=>{
  const owner=make({target:false}),receiver=make({target:false}),a=owner.actor('is');
  for(let i=0;i<10;i++){
    owner.enter(a,'RSI_COMBO_XX','repeated-sword');tick(owner,8);const sword=owner.state.effects.find(e=>e.name==='SecondBlade');assert.ok(sword);
    assert.deepEqual(sword.deleteConditions,[2]);assert.equal(sword.sourceArcPose.animationName,'Elsword_SisKnight_sword_base');
    const report=encodeOwnedState(owner,'is',{epoch:1,frameSeq:i});restore(receiver,report);
    assert.ok(receiver.state.effects.some(e=>e.name==='SecondBlade'&&e.deleteOnStateEnd));
    owner.enter(a,'RSI_WAIT','cleanup');const events=tick(owner,1);assert.ok(events.some(e=>e.type==='effectEnded'&&e.name==='SecondBlade'));
    assert.ok(!owner.state.effects.some(e=>e.name==='SecondBlade'));
    restore(receiver,encodeOwnedState(owner,'is',{epoch:1,frameSeq:100+i}));assert.ok(!receiver.state.effects.some(e=>e.name==='SecondBlade'));
  }
});
test('original projectile damage is rebuilt from trusted target data after the owner recovers',()=>{
  const owner=make({skillId:21033,target:false}),receiver=make({target:false}),a=owner.actor('is');
  owner.step(dt,{is:{pressed:['A']}});while(!owner.state.effects.some(e=>/^ELSWORD_SWORDFALL_BLADE/.test(e.name)))tick(owner,1);
  owner.enter(a,'RSI_WAIT','skill-finished-fixture');const report=encodeOwnedState(owner,'is',{epoch:2,frameSeq:150});restore(receiver,report);
  const swords=receiver.state.effects.filter(e=>/^ELSWORD_SWORDFALL_BLADE[1-4]$/.test(e.name));assert.equal(swords.length,1);
  for(const e of swords)assert.deepEqual(e.damage,profile.damageEffects[e.name].raw);
});
test('original raw tables and source damage stay independent from the Web adjustments',()=>{
  const evidence=read('contracts/is-feedback-source-v2.json');
  for(const [name,raw] of Object.entries(evidence.sources.elsword.states))assert.deepEqual(profile.states[name].raw,raw,name);
  for(const [name,raw] of Object.entries(evidence.sources.effect.sets))assert.deepEqual(profile.effectSets[name].raw,raw,name);
  for(const [name,raw] of Object.entries(evidence.sources.damage.effects))assert.deepEqual(profile.damageEffects[name].raw,raw,name);
  assert.equal(profile.states.ESSI_ETK_COMBO_ZZZZ.raw.SKILL_CANCEL_AFTER,.4);
  assert.equal(profile.damageEffects.ELSWORD_SWORDFALL_BLADE1.raw.DAMAGE_DATA.REACT_TYPE,5);
});

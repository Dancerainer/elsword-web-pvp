import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';

// Original target2016 authored clocks, independently parsed and SHA-checked
// by gm-cancel-audit-v35. This uses original meshes, poses, map and WASM;
// it remains current web/native-adapter evidence, not an original client run.
const authored={xxDownX:{start:.1,inputEnd:.271,dispatch:.271},powerBreak:{skill:.533,walk:.566,attack:.566},finisher:{skill:.766}};
function device(facing=1,skillId=28203){
 const fixture=elesisFixture('GM',{position:[0,3080,0],gap:1200,facing,skillId}),{sim,a,profile}=fixture;
 const keyboard=createInputBuffer({sampledLevels:true}),source=()=>profile.states[a.state].sourceState??a.state;
 let lastPacket;
 const step=()=>{lastPacket=keyboard.consume(sim.state.time+1/60,1/60);return sim.step(1/60,{[a.id]:lastPacket});};
 const down=key=>keyboard.down(key,sim.state.time+.001),up=key=>keyboard.up(key,sim.state.time+.001);
 const tap=key=>{down(key);step();up(key);step();};
 const until=(predicate,message,max=240)=>{for(let i=0;i<max&&!predicate();i++)step();assert.ok(predicate(),message+'; '+source()+' @ '+a.animationTime);};
 const time=at=>{const serial=a.stateSerial;until(()=>a.animationTime>=at||a.stateSerial!==serial,'animation time '+at);assert.equal(a.stateSerial,serial,'action must survive to its declared clock');};
 const noContact=()=>assert.equal(sim.state.events.filter(e=>e.type==='hit'&&e.actorId===a.id).length,0,'distant actor cannot add accidental attacker STOP');
 return {...fixture,keyboard,source,step,down,up,tap,until,time,noContact,packet:()=>lastPacket};
}
function reachXX(d){
 d.tap('X');assert.equal(d.source(),'ESI_COMBO_X');
 d.time(.1);d.tap('X');
 d.until(()=>d.source()==='ESI_COMBO_XX','real sampled X/X reaches XX');
 d.time(authored.xxDownX.start+.03);
 assert.ok(d.a.animationTime<authored.xxDownX.inputEnd);
}
for(const facing of [-1,1]){
 for(const freeze of [false,true])test(`GM Native ${facing}: XX down-X keeps its buffered edge after Down release${freeze?' and HitSTOP':''}`,()=>{
  const d=device(facing);reachXX(d);
  assert.deepEqual(d.profile.states.ESI_COMBO_XX.raw.EVENT_PROCESS_TIME2,{'1':authored.xxDownX.start,'2':authored.xxDownX.inputEnd,'3':authored.xxDownX.dispatch});
  d.down('DOWN');d.down('X');d.step();
  assert.equal(d.source(),'ESI_COMBO_XX');assert.equal(d.a.sourceCommandFlags&(1<<2),1<<2,'actual sampled input latches the original branch');
  const frozenTime=d.a.animationTime;
  if(freeze)d.a.hitStop=.1;
  d.up('DOWN');d.up('X');d.step();
  if(freeze){for(let i=0;i<3;i++)d.step();assert.equal(d.a.animationTime,frozenTime);assert.equal(d.a.sourceCommandFlags&(1<<2),1<<2);assert.equal(d.source(),'ESI_COMBO_XX');}
  d.until(()=>d.source()==='ESI_COMBO_SGM_XX_DOWN_X_START','cached source branch executes after .271 despite released Down');
  assert.equal(d.a.sourceCommandFlags,0,'original branch is consumed exactly once');d.noContact();
 });
 for(const freezeClock of ['hitStop','worldStop'])for(const attack of ['Z','X'])test(`GM Native ${facing}: PowerBreak sampled ${attack} survives ${freezeClock} at its open original attack gate`,()=>{
  const d=device(facing);d.tap('A');assert.equal(d.source(),'ESI_SI_A_SSK_POWER_BREAK');
  assert.equal(d.profile.states[d.a.state].raw.ATTACK_CANCEL_AFTER_EX,authored.powerBreak.attack);
  d.time(authored.powerBreak.attack+.001);
  const before=d.a.animationTime,serial=d.a.stateSerial;d.a[freezeClock]=.1;
  d.down(attack);d.step();d.up(attack);d.step();
  assert.equal(d.a.animationTime,before);assert.equal(d.a.stateSerial,serial);
  assert.ok(d.a.pendingPressed.includes(attack),'released fresh attack is preserved through the stop');
  for(let i=0;i<2;i++)d.step();assert.equal(d.a.animationTime,before);assert.equal(d.a.stateSerial,serial);
  d.until(()=>d.source()==='ESI_COMBO_'+attack,'open EX gate dispatches the preserved fresh attack after unfreezing',30);
  assert.ok(!d.a.pendingPressed.includes(attack),'stop edge is not replayed twice');d.noContact();
 });
 test(`GM Native ${facing}: PowerBreak WALK precedes a simultaneous fresh attack and retains pose facing`,()=>{
  const d=device(facing);d.tap('A');d.time(authored.powerBreak.walk+.001);
  const back=facing===1?'LEFT':'RIGHT';d.down(back);d.down('Z');d.step();
  assert.equal(d.source(),'ESI_WAIT','fixed SKILL -> WALK -> BWALK -> DASH -> ZX macro order');assert.equal(d.a.facing,facing);
  d.up('Z');d.step();assert.equal(d.source(),'ESI_WALK');assert.equal(d.a.facing,-facing,'next free packet turns and walks');d.noContact();
 });
 test(`GM Native ${facing}: sampled direction-double cannot preempt PowerBreak WALK after both gates open`,()=>{
  const d=device(facing),forward=facing===1?'RIGHT':'LEFT';d.tap('A');d.time(.35);d.tap(forward);
  assert.equal(d.source(),'ESI_SI_A_SSK_POWER_BREAK','the first direction precedes its .566 walk gate');
  d.time(.6);d.down(forward);d.step();
  assert.ok(d.packet().pureDouble.includes(forward),'the real sampled device produced the double direction');
  assert.equal(d.source(),'ESI_WAIT','original WALK-before-DASH order wins after both original windows open');assert.equal(d.a.facing,facing);d.noContact();
 });
 test(`GM Native ${facing}: off-support 668XXX can use the original air-legal skill at .766`,()=>{
  const d=device(facing,28033);d.sim.enter(d.a,'ESI_DASH_JUMP_COMBO_SSK_XXX','native-original-finisher-seed');
  d.a.y=6000;d.a.grounded=false;d.a.lineId=null;d.a.vy=0;
  assert.equal(d.profile.states[d.a.state].raw.SKILL_CANCEL_AFTER,authored.finisher.skill);
  assert.equal(d.profile.skillCatalog.find(s=>s.skillId===28033).useCondition,2);
  d.time(authored.finisher.skill+.001);assert.equal(d.a.grounded,false,'actual map physics still has no support before the finisher end');
  assert.equal(d.sim.skillAvailability(d.a.id,0).available,true,'declared air-legal skill remains available in retained off-support callback');
  d.down('A');d.step();assert.equal(d.source(),'ESI_SI_SA_SSK_EXTINCTION_START');
  assert.ok(d.sim.state.events.some(e=>e.type==='skillStarted'&&e.actorId===d.a.id&&e.skillId===28033));
 });
}

for(const facing of [-1,1])for(const state of ['ESI_DASH_JUMP_COMBO_SSK_XXX','ESI_DASH_COMBO_SSK_ZZX','ESI_COMBO_SGM_XX_DOWN_X_END','ESI_DASH_JUMP_COMBO_SGM_XZ_DOWN']){
 test(`GM Native ${facing}: ${state} survives actual unsupported-foot integration until its own end`,()=>{
  const d=device(facing);d.sim.enter(d.a,state,'native-off-support-source-callback-seed');
  // Start over the original map, above its highest 3800 line. No substitute
  // training line or constant grounded flag masks the real geometry query.
  d.a.y=6000;d.a.grounded=false;d.a.lineId=null;d.a.vy=0;
  const serial=d.a.stateSerial;
  for(let i=0;i<6;i++){d.step();assert.equal(d.a.grounded,false);assert.equal(d.a.stateSerial,serial);assert.equal(d.source(),state);}
  d.until(()=>d.a.stateSerial!==serial,'own animation end dispatch',180);
  // The transition is observed immediately, before WAIT's free-foot query
  // starts the next state on the following packet.
  assert.equal(d.source(),state==='ESI_DASH_JUMP_COMBO_SSK_XXX'?'ESI_JUMP_DOWN':'ESI_WAIT');
  d.noContact();
 });
}

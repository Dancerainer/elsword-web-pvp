/** Independent declaration/source expectations and current real-pose input.
 * These are Web adapter regressions, not captured original-client traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {lkCommandFixture} from '../helpers/lk-command-fixture.mjs';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url))),source=read('contracts/lk-ca-feedback-v57.json'),dt=1/60;
function device(sim,a){
 const buffer=createInputBuffer({sampledLevels:true}),step=()=>sim.step(dt,{[a.id]:buffer.consume(sim.state.time+dt)},{snapshot:false});
 const edge=(key,on)=>{buffer[on?'down':'up'](key,sim.state.time+.001);step();};
 const tap=key=>{edge(key,true);edge(key,false);};
 const until=(predicate,label,max=240)=>{for(let i=0;i<max&&!predicate();i++)step();assert.ok(predicate(),`${label}; ${a.state}@${a.animationTime}`);};
 const sourceState=()=>sim.profileFor(a).states[a.state].sourceState??a.state;
 const state=name=>until(()=>sourceState()===name,name);
 const time=value=>{const serial=a.stateSerial;until(()=>a.animationTime>=value||a.stateSerial!==serial,'clock '+value);assert.equal(a.stateSerial,serial);};
 const dashJump=()=>{step();const forward=a.facing>0?'RIGHT':'LEFT';tap(forward);edge(forward,true);tap('UP');for(let i=0;i<4;i++)step();};
 return {step,edge,tap,until,state,time,dashJump,sourceState};
}
test('independent source capsule distinguishes numeric144 from class-specific Lua table and preserves every raw DD',()=>{
 assert.equal(source.lk.numeric143Successor,144);assert.equal(source.lk.registeredClass,100);
 const [base,knight,last,jump]=source.lk.declarations;
 assert.equal(base.raw.DAMAGE_DATA.REACT_TYPE,3);assert.equal(base.raw.DAMAGE_DATA.DAMAGE.PHYSIC,4.08);
 assert.equal(knight.raw.DAMAGE_DATA.REACT_TYPE,2);assert.equal(knight.raw.DAMAGE_DATA.DAMAGE.PHYSIC,3.35);
 assert.equal(last.raw.DAMAGE_DATA.REACT_TYPE,4);assert.equal(last.raw.DAMAGE_DATA.BACK_SPEED_Y,2100);
 assert.equal(jump.raw.ATTACK_TIME0['1'],.1);assert.equal(jump.raw.ATTACK_TIME0['2'],.2666);
 for(const [profession,rows]of [['lk',source.lk.declarations],['ca',source.ca.declarations]]){
  const profile=read(`packages/combat-core/${profession}-profile.json`);
  for(const row of rows){assert.deepEqual(profile.states[row.name].raw,row.raw);assert.equal(createHash('sha256').update(JSON.stringify(row.raw)).digest('hex'),row.rawSha256);}
 }
});
for(const facing of [-1,1]){
 test(`LK ${facing}: actual Knight second-stage posed helpers apply its own BIG DD without the base knockdown`,async()=>{
  const {sim,actor:a,target:b}=await lkCommandFixture({gap:85,facing,preset:{passives:[]}}),i=device(sim,a);i.step();
  sim.enter(a,'ESSI_KNIGHT_DASH_JUMP_COMBO_X2','v57-original-class144-hit');
  a.grounded=false;a.lineId=null;a.y+=60;
  const contacts=[],apply=sim.applyHit.bind(sim);
  sim.applyHit=(attacker,victim,data,origin)=>{const result=apply(attacker,victim,data,origin);
   if(result.accepted&&attacker===a&&victim===b&&origin.kind==='character'&&origin.state==='ESSI_KNIGHT_DASH_JUMP_COMBO_X2')
    contacts.push({react:data.REACT_TYPE,power:data.DAMAGE.PHYSIC,targetState:b.state,origin});return result;};
  for(let n=0;n<90;n++)i.step();
  assert.equal(contacts.length,1);assert.equal(contacts[0].react,2);assert.equal(contacts[0].power,3.35);
  assert.ok(!/DAMAGE_(?:AIR_)?DOWN/.test(contacts[0].targetState),contacts[0].targetState);
  assert.equal(contacts[0].origin.state,'ESSI_KNIGHT_DASH_JUMP_COMBO_X2');
 });
 test(`LK ${facing}: sampled668XXX selects class144, accepts the thirdX and reaches its ground finisher`,async()=>{
  const {sim,actor:a}=await lkCommandFixture({gap:5000,facing}),i=device(sim,a);
  i.dashJump();i.tap('X');i.tap('X');i.state('ESSI_KNIGHT_DASH_JUMP_COMBO_X2');i.tap('X');i.state('ESSI_KNIGHT_DASH_JUMP_COMBO_X3');
  assert.equal(a.grounded,true);
  const states=sim.state.events.filter(e=>e.type==='stateChanged'&&e.actorId===a.id).map(e=>e.state);
  assert.equal(states.filter(n=>n==='RSI_DASH_JUMP_COMBO_X').length,1);assert.equal(states.filter(n=>n==='ESSI_KNIGHT_DASH_JUMP_COMBO_X2').length,1);
  assert.equal(states.includes('ESSI_DASH_JUMP_COMBO_X2'),false,'base DD would prematurely knock down the target');
  assert.equal(states.filter(n=>n==='ESSI_KNIGHT_DASH_JUMP_COMBO_X3').length,1);
 });
 for(const followup of ['Z',null])test(`LK ${facing}: class144 landing ${followup??'without fresh input'} retains its independent successor`,async()=>{
  const {sim,actor:a}=await lkCommandFixture({gap:5000,facing}),i=device(sim,a);i.dashJump();i.tap('X');i.tap('X');i.state('ESSI_KNIGHT_DASH_JUMP_COMBO_X2');
  if(followup)i.tap(followup);i.state(followup?'ESSI_COMBO_Z1':'ESSI_DASH_JUMP_COMBO_X2_LANDING');
  assert.equal(sim.state.events.some(e=>e.type==='stateChanged'&&e.actorId===a.id&&e.state==='ESSI_KNIGHT_DASH_JUMP_COMBO_X3'),false);
 });
 for(const delay of [0,4,12,20])test(`LK ${facing}: one physical8X at +${delay} packets enters one attack and never repeats its accepted contact`,async()=>{
  const {sim,actor:a}=await lkCommandFixture({gap:85,facing}),i=device(sim,a);i.step();i.tap('UP');for(let n=0;n<delay;n++)i.step();i.tap('X');for(let n=0;n<180;n++)i.step();
  const states=sim.state.events.filter(e=>e.type==='stateChanged'&&e.actorId===a.id),attacks=states.filter(e=>e.state==='RSI_JUMP_COMBO_X');
  assert.equal(attacks.length,1);assert.equal(states.some(e=>e.state==='RSI_COMBO_X'),false,'landing must not reuse a consumed freshX');
  const hits=sim.state.events.filter(e=>e.type==='hit'&&e.actorId===a.id&&e.origin.kind==='character'&&e.origin.state==='RSI_JUMP_COMBO_X');
  assert.ok(hits.length<=1);assert.equal(new Set(hits.map(e=>e.origin.id)).size,hits.length);
 });
 test(`LK ${facing}: airborne8X XAP_WAIT freezes before original D3DX LOOP can wrap and keeps accepting landing`,async()=>{
  const {sim,actor:a,profile}=await lkCommandFixture({gap:5000,facing,position:[0,6000,0],lineId:null}),i=device(sim,a);
  // An actual free-air sampled X selects the same original common JumpAttackX.
  a.grounded=false;a.lineId=null;sim.enter(a,'RSI_JUMP_DOWN','v57-high-air-start');i.tap('X');
  const period=profile.states.RSI_JUMP_COMBO_X.clip.durationSeconds,end=period-Math.max(period/10,.03);
  i.until(()=>a.animationStopped,'original XAP_WAIT end');const stopped=a.animationTime;
  assert.ok(stopped>end&&stopped<period,'the first packet after transition end must precede the native LOOP period');
  for(let n=0;n<30;n++){i.step();assert.equal(a.animationTime,stopped);assert.equal(a.state,'RSI_JUMP_COMBO_X');}
  i.until(()=>a.grounded,'actual Garpai landing');i.until(()=>a.state!=='RSI_JUMP_COMBO_X','jump attack landing successor');
  assert.equal(sim.state.events.filter(e=>e.type==='stateChanged'&&e.actorId===a.id&&e.state==='RSI_JUMP_COMBO_X').length,1);
 });
 test(`CA ${facing}: sampled668XX emits no projectile, third freshX releases exactly one existing wave`,()=>{
  const {sim,a}=elesisFixture('CA',{gap:5000,facing}),i=device(sim,a);i.dashJump();i.tap('X');i.tap('X');i.state('ESI_DASH_JUMP_COMBO_SDK_XX');
  const waves=()=>sim.state.events.filter(e=>e.type==='effectStarted'&&e.actorId===a.id&&e.name==='DamageEffect_SCA_Combo_ZZZ_Projectile01_Uppercut');
  assert.equal(waves().length,0);i.time(.1);assert.equal(waves().length,0);i.tap('X');i.state('ESI_DASH_JUMP_COMBO_SDK_XXX');
  i.until(()=>waves().length>0,'thirdX original wave');for(let n=0;n<90;n++)i.step();assert.equal(waves().length,1);
 });
 test(`CA ${facing}: original66Z renewal retains declared melee and projectile DD instead of deleting melee from a feedback guess`,()=>{
  const {sim,a,profile}=elesisFixture('CA',{gap:5000,facing}),i=device(sim,a);i.step();sim.enter(a,'ESI_DASH_COMBO_SCA_ZZZ_START','source-row-fixture');
  for(let n=1;n<=180&&a.state!=='ESI_DASH_COMBO_SCA_ZZZ_END';n++)sim.step(dt,{[a.id]:{pressed:n%6===1?['Z']:[],held:['Z']}},{snapshot:false});
  assert.equal(a.state,'ESI_DASH_COMBO_SCA_ZZZ_END');assert.equal(a.sourceElesisCommand.loops,4);
  const waves=sim.state.events.filter(e=>e.type==='effectStarted'&&e.actorId===a.id&&/^DamageEffect_SCA_Combo_ZZZ_Projectile01(?:_Uppercut)?$/.test(e.name));
  // V58 closes the independently sealed original Frame callbacks in addition
  // to these five original raw queue entries. The historical five-only Web
  // observation was not an original-client golden count.
  assert.equal(waves.length,14,'five raw queue waves plus nine original START/LOOP frame producers before END .37');
  for(const n of ['ESI_DASH_COMBO_SCA_ZZZ_START','ESI_DASH_COMBO_SCA_ZZZ_LOOP_1','ESI_DASH_COMBO_SCA_ZZZ_LOOP_2'])assert.ok(profile.states[n].raw.DAMAGE_DATA.DAMAGE.PHYSIC>0);
  assert.deepEqual(source.ca.projectiles.map(e=>[e.raw.DAMAGE_DATA.REACT_TYPE,e.raw.DAMAGE_DATA.BACK_SPEED_X]),[[2,500],[2,500]]);
  assert.equal(profile.states.ESI_DASH_COMBO_SCA_ZZZ_END.raw.DAMAGE_DATA.REACT_TYPE,5);
  assert.deepEqual(profile.states.ESI_DASH_COMBO_SCA_ZZZ_END.raw.EFFECT_SET_LIST_EX,{});
 });
}

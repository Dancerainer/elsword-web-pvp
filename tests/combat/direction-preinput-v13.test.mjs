import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {dashZxFixture,dashZxFrame as step} from '../../tools/combat/rf_dash_zx_audit.mjs';
const tap=(f,key)=>{const b=createInputBuffer();b.tap(key,f.s.state.time);step(f,b.consume());};
function until(f,state){for(let i=0;i<180&&f.a.state!==state;i++)step(f);assert.equal(f.a.state,state);}
async function prefix(){const f=await dashZxFixture({gap:1500});tap(f,'Z');tap(f,'Z');until(f,'RSI_COMBO_ZZ');tap(f,'X');until(f,'RSI_COMBO_ZZX');tap(f,'X');return f;}
for(const where of ['RSI_COMBO_ZZX','RSI_COMBO_ZZXX'])test(`released 82X during ${where} survives to target .6 cancel, without waiting for full X`,async()=>{
  const f=await prefix();if(where==='RSI_COMBO_ZZXX')until(f,where);
  tap(f,'UP');tap(f,'DOWN');tap(f,'X');
  assert.deepEqual(f.a.cancelInput.commands,['UP','DOWN','X']);
  until(f,'RSI_JUMP_UP');const takeoff=f.a.y;
  const events=f.s.state.events,from=events.findLast(e=>e.type==='stateChanged'&&e.state==='RSI_COMBO_ZZXX');
  const launch=events.findLast(e=>e.type==='stateChanged'&&e.state==='RSI_JUMP_UP');
  assert.ok(launch.time-from.time<.6,'cancel is before the full source clip, a behavioral requirement, not generated frame-position gold');
  assert.equal(f.a.cancelInput.commands[0],'DOWN');
  step(f);assert.equal(f.a.cancelInput.commands[0],'X');assert.ok(f.a.y>takeoff);
  step(f);assert.equal(f.a.state,'RSI_JUMP_COMBO_X');assert.equal(f.a.cancelInput,null);
});
test('82 preserves browser edge order when both taps arrive in one packet',async()=>{
  const f=await prefix();until(f,'RSI_COMBO_ZZXX');const b=createInputBuffer();b.tap('UP',1);b.tap('DOWN',1.001);b.tap('X',1.002);
  step(f,b.consume());assert.deepEqual(f.a.cancelInput.commands,['UP','DOWN','X']);until(f,'RSI_JUMP_UP');step(f);step(f);assert.equal(f.a.state,'RSI_JUMP_COMBO_X');
});
test('buffer cannot survive a received hit, unrelated skill or jump lock',async()=>{
  for(const next of ['RSI_DAMAGE_SMALL_FRONT','RSI_SA_MEGA_DRILL']){
    const f=await prefix();tap(f,'UP');f.s.enter(f.a,next);assert.equal(f.a.cancelInput,null);
  }
  const f=await prefix();f.a.canNotJumpTime=1;tap(f,'UP');assert.equal(f.a.cancelInput??null,null);
});
test('ordered directional preinput survives stop and full JSON restore for 120 steps',async()=>{
  const f=await prefix();f.a.hitStop=.1;tap(f,'UP');tap(f,'DOWN');tap(f,'X');
  const g=await dashZxFixture({gap:1500});f.s.drainEvents();g.s.restore(JSON.parse(JSON.stringify(f.s.snapshot())));
  for(let i=0;i<120;i++){step(f);step(g);assert.deepEqual(f.s.snapshot(),g.s.snapshot());assert.deepEqual(f.s.drainEvents(),g.s.drainEvents());}
});
test('newly registered original HA stun clears preinput on the first control-update frame',async()=>{
  const f=await prefix();until(f,'RSI_COMBO_ZZXX');tap(f,'UP');f.a.animationTime=.59;
  const factor=f.s.profile.damageEffects.DAMAGE_EFFECT_RRF_Infernal_Arms_Effect_Stun.raw.DAMAGE_DATA.BUFF_FACTOR;
  f.s.grantBuff(f.b,f.a,factor);step(f);
  assert.equal(f.a.buffControls.inputBlock,true);assert.equal(f.a.cancelInput,null);
  assert.notEqual(f.a.state,'RSI_JUMP_UP');assert.equal(f.a.grounded,true);
});
test('queued air attack cannot bypass the original attack lock on its delivery frame',async()=>{
  const f=await prefix();until(f,'RSI_COMBO_ZZXX');tap(f,'UP');tap(f,'DOWN');tap(f,'X');until(f,'RSI_JUMP_UP');
  f.a.canNotAttackTime=1;step(f);step(f);
  assert.notEqual(f.a.state,'RSI_JUMP_COMBO_X');assert.equal(f.a.cancelInput,null);
});

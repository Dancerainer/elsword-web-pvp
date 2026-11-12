import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {FINAL_OPTION_SPEED_SEMANTICS,resolveSpeedAttributes,sourceScaledSpeed} from '../../packages/combat-core/speed-attributes.mjs';
const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url)));
const profile=read('packages/combat-core/rf-profile.json'),preset=authoredEquipmentPreset(read('config/rf-preset.json'));
const map={sceneId:'source-jump-v9',lines:[
  {lineId:0,start:[-5000,0,0],end:[5000,0,0],type:'LT_NORMAL',nativeFields:{CAN_DOWN:false}},
  {lineId:1,start:[-1000,300,0],end:[1000,300,0],type:'LT_NORMAL'}]};
// Guild speed modifiers are a separate composition test; this checks equipment final options.
const make=(suppliedPreset=preset)=>createSimulation({profile,preset:{...suppliedPreset,guildPassives:[]},map,actors:[{id:'rf',team:0,x:-300,y:0,facing:1}]});
const attributes=bonus=>({animationSpeedMultiplier:1.3,moveSpeedMultiplier:1+bonus,jumpSpeedMultiplier:1+bonus});
// Literal float outputs are independently evaluated by the unchanged original
// UpdateResultValueWithOptionData body (tools/native/check_movement_stat_source.py).
// They are reference-source checks, not recorded target-2016 client trajectories.
test('final option percentages use original half-rate float operations for movement/jump',()=>{
  for(const [bonus,multiplier] of [[0,1],[.2,1.100000023841858],[.21,1.1050000190734863],[.3,1.149999976158142]]){
    const result=resolveSpeedAttributes(attributes(bonus),FINAL_OPTION_SPEED_SEMANTICS);
    assert.equal(result.stats.moveSpeedMultiplier,multiplier);assert.equal(result.stats.jumpSpeedMultiplier,multiplier);
    assert.equal(result.stats.animationSpeedMultiplier,1.3);assert.deepEqual(result.options,attributes(bonus));
  }
});
test('a fixture without declared option semantics retains explicit actual multipliers',()=>{
  const result=resolveSpeedAttributes(attributes(.3));assert.equal(result.options,null);
  assert.deepEqual(result.stats,attributes(.3));
  const s=make({attributes:attributes(.3)});assert.equal(s.actor('rf').stats.jumpSpeedMultiplier,1.3);
});
test('unconfirmed option semantics and negative/debuff inputs fail closed',()=>{
  assert.throws(()=>resolveSpeedAttributes(attributes(.3),'guessed'),/Unsupported/);
  for(const value of [NaN,Infinity,.9,'1.21'])assert.throws(()=>resolveSpeedAttributes({...attributes(.3),jumpSpeedMultiplier:value},FINAL_OPTION_SPEED_SEMANTICS),/finite, nonnegative/);
});
test('v20 equipment jump23% yields source normal1672.5 and dash2453, with only normal radius offset',()=>{
  const s=make(),a=s.actor('rf');assert.equal(a.stats.moveSpeedMultiplier,Math.fround(1.115));
  assert.equal(a.stats.jumpSpeedMultiplier,Math.fround(1.115));
  assert.equal(a.speedAttributeOptions.jumpSpeedMultiplier,1.23);
  s.jump(a,false);assert.equal(a.vy,1672.5);assert.equal(a.y,30);
  const t=make(),b=t.actor('rf');t.jump(b,true);assert.equal(b.vy,2453);assert.equal(b.y,0);
  assert.equal(sourceScaledSpeed(1500,Math.fround(1.115)),1672.5);
});
test('v20 equipment movement23% applies source GetWalkSpeed557.5 and GetDashSpeed808.375, including DashEnd entry',()=>{
  const s=make(),a=s.actor('rf');
  assert.equal(sourceScaledSpeed(500,a.stats.moveSpeedMultiplier),557.5);
  assert.equal(sourceScaledSpeed(725,a.stats.moveSpeedMultiplier),808.375);
  s.enter(a,'RSI_DASH_END','independent-source-fixture');assert.equal(a.vx,808.375);
});
test('air dash turn clamps against GetJumpSpeed with the final attribute, rather than bare1500',()=>{
  const s=make(),a=s.actor('rf');a.grounded=false;a.lineId=null;a.y=500;a.vy=2453;
  s.enter(a,'RSI_DASH_JUMP','independent-source-fixture');
  s.processInput(a,{held:new Set(['LEFT']),pressed:new Set()});
  assert.equal(a.state,'RSI_JUMP_UP');assert.equal(a.facing,1);assert.equal(a.vy,1672.5);
  // DashJump Event requests the state without assigning Future facing;
  // original JumpFrameMoveFuture applies the turn on the following packet.
  s.step(.01,{held:['LEFT']},{snapshot:false});assert.equal(a.facing,-1);
});
test('ordinary jump Down accelerates descent instead of assigning dash forced-terminal velocity',()=>{
  for(const [held,expected] of [[['DOWN'],-80],[['UP','DOWN'],-40],[[],-40]]){
    const s=make(),a=s.actor('rf');s.enter(a,'RSI_JUMP_UP','independent-source-fixture');
    a.grounded=false;a.lineId=null;a.y=600;a.vy=0;
    s.step(.01,{held},{snapshot:false});assert.equal(a.vy,expected);
  }
});
test('source CanDown path lowers1.5radius without an upward impulse and rejects bottom line',()=>{
  const s=make(),a=s.actor('rf');a.y=300;a.lineId=1;a.lastTouchLineId=1;
  assert.equal(s.dropPlatform(a),true);assert.equal(a.y,255);assert.equal(a.vy,0);assert.equal(a.grounded,false);
  const t=make(),b=t.actor('rf');assert.equal(t.dropPlatform(b),false);assert.equal(b.y,0);assert.equal(b.grounded,true);
});
test('mapped speed options roundtrip snapshots without applying the half-rate a second time',()=>{
  const s=make(),a=s.actor('rf');s.jump(a,false);for(let i=0;i<8;i++)s.step(.01,{}, {snapshot:false});
  const state=JSON.parse(JSON.stringify(s.snapshot())),t=make();t.restore(state);
  for(let i=0;i<18;i++){s.step(.01,{}, {snapshot:false});t.step(.01,{}, {snapshot:false});}
  assert.deepEqual(t.snapshot(),JSON.parse(JSON.stringify(s.snapshot())));
});
test('SetInputData rejects this packet Up before CommonFuture expires the jump lock',()=>{
  // Unconditional V5 SetInputData:28896-28901 precedes the timer decrement at
  // 14961-14966. This expectation is source-derived, not a target-client trace.
  for(const held of [[],['UP']]){
    const s=make(),a=s.actor('rf');a.canNotJumpTime=.005;
    s.step(.01,{pressed:['UP'],held},{snapshot:false});
    assert.equal(a.canNotJumpTime,0);assert.equal(a.state,'RSI_WAIT');assert.equal(a.grounded,true);
    s.step(.01,{}, {snapshot:false});assert.equal(a.state,'RSI_WAIT','rejected tap is not saved until lock expires');
    s.step(.01,{pressed:['UP'],held:['UP']},{snapshot:false});assert.equal(a.state,'RSI_JUMP_UP');
  }
});
test('received Up and X during their source locks do not enter the hit-stop edge adapter',()=>{
  const s=make(),a=s.actor('rf');a.canNotJumpTime=.005;a.canNotAttackTime=.005;a.hitStop=.03;
  s.step(.01,{pressed:['UP','X'],held:['UP','X']},{snapshot:false});
  assert.deepEqual(a.pendingPressed,[]);assert.equal(a.canNotJumpTime,.005);
  for(let i=0;i<5;i++)s.step(.01,{}, {snapshot:false});
  assert.equal(a.canNotJumpTime,0);assert.equal(a.canNotAttackTime,0);assert.equal(a.state,'RSI_WAIT');
});

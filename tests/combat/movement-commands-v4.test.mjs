import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
// These literal source-equation fixtures use neutral 1x speeds. The product
// preset's 30% modifiers are covered by separate configured-preset observations.
preset.attributes={...preset.attributes,animationSpeedMultiplier:1,moveSpeedMultiplier:1,jumpSpeedMultiplier:1};
const map={sceneId:'source-movement-v4',lines:[
  {lineId:0,start:[-5000,0,0],end:[5000,0,0],type:'LINE_TYPE.LT_NORMAL',nativeFields:{CAN_DOWN:false}},
  {lineId:1,start:[-1000,250,0],end:[1000,250,0],type:'LINE_TYPE.LT_NORMAL',nativeFields:{}},
]};
const make=(extra={})=>createSimulation({profile,preset,map,actors:[{id:'rf',team:0,x:-300,y:0,facing:1},{id:'target',team:1,x:3500,y:0,facing:-1}],...extra});
const step=(s,input={},dt=1/60)=>s.step(dt,input,{snapshot:false});
const advance=(s,n,input={})=>{for(let i=0;i<n;i++)step(s,input);};
// Independent source expectations: these fixtures exercise the port, not native
// client measurements. Literal windows/velocities below come from the source
// functions cited in reports/rf-movement-commands-v4.md.
test('omitted CAN_DOWN uses confirmed native true default, only with a lower authored line',()=>{
  const s=make(),a=s.actor('rf');a.y=250;a.lineId=1;a.grounded=true;
  step(s,{pressed:['DOWN']});assert.equal(a.grounded,false);assert.equal(a.y,205);
  const m=structuredClone(map);delete m.lines[0].nativeFields.CAN_DOWN;
  const t=make({map:m});step(t,{pressed:['DOWN']});assert.equal(t.actor('rf').y,0);
  assert.ok(t.drainEvents().some(e=>e.reason==='no-source-line-below'));
});
test('actual 2016 Garpai ordinary platform is traversable downward; spring CAN_DOWN false is retained',()=>{
  const actual=read('artifacts/scene/sander-garpai-rock-pvp/collision.json');
  const top=actual.lines.find(l=>l.lineId===6),x=(top.start[0]+top.end[0])/2;
  const s=make({map:actual,actors:[{id:'rf',team:0,position:[x,top.start[1],0],lineId:6}]});
  step(s,{pressed:['DOWN']});assert.equal(s.actor('rf').grounded,false);
  assert.equal(s.actor('rf').y,top.start[1]-45);
  const jumpLine=actual.lines.find(l=>l.lineId===8);
  assert.equal(jumpLine.nativeFields.CAN_DOWN.symbol,'FALSE');
});
test('WAIT holds Up to start direct normal jump; dash end still uses JumpReady',()=>{
  const s=make(),a=s.actor('rf');step(s,{held:['UP']});
  assert.equal(a.state,'RSI_JUMP_UP');assert.equal(a.y,30);
  const t=make(),b=t.actor('rf');t.enter(b,'RSI_DASH_END','source-fixture');step(t,{pressed:['UP']});
  assert.equal(b.state,'RSI_JUMP_READY');
});
test('forced dash jump landing halves inertia and keeps source stiffness before one-sixth period',()=>{
  const s=make(),a=s.actor('rf');a.vx=1200;s.enter(a,'RSI_DASH_JUMP_POWER_LANDING','source-fixture');
  assert.equal(a.vx,600);step(s,{pressed:['Z']});assert.equal(a.state,'RSI_DASH_JUMP_POWER_LANDING');
  a.animationTime=1.3666666666666667/6+.001;step(s,{held:['UP']});assert.equal(a.state,'RSI_JUMP_READY');
  const t=make(),b=t.actor('rf');t.enter(b,'RSI_DASH_JUMP_POWER_LANDING','source-fixture');step(t,{pressed:['RIGHT'],held:['RIGHT']});
  assert.equal(b.state,'RSI_WALK','native fresh direction cancels power landing immediately');
});
test('dash jump Down then Up on descent buffers the native immediate bounce, cancelling forced landing',()=>{
  // Native IsOnLine radius30 lands before crossing Y=0. Start sufficiently
  // high that the Up edge is received while still descending above that bound.
  const s=make(),a=s.actor('rf');a.y=200;a.grounded=false;a.lineId=null;s.enter(a,'RSI_DASH_JUMP','source-fixture');
  step(s,{pressed:['DOWN']});assert.equal(a.downForce,true);
  step(s,{pressed:['UP']});assert.equal(a.jumpOnLanding,true);
  advance(s,5);assert.equal(a.state,'RSI_DASH_JUMP');assert.equal(a.downForce,false);
  assert.ok(a.vy>1900);assert.ok(s.drainEvents().some(e=>e.type==='jump'&&e.dash));
});
test('dash end re-press facing direction resumes dash; early released-dash Z remains dash attack',()=>{
  const s=make(),a=s.actor('rf');s.enter(a,'RSI_DASH_END','source-fixture');step(s,{pressed:['RIGHT'],held:['RIGHT']});assert.equal(a.state,'RSI_DASH');
  const t=make(),b=t.actor('rf');t.enter(b,'RSI_DASH_END','source-fixture');step(t,{pressed:['Z']});assert.equal(b.state,'RSI_DASH_COMBO_Z');
});
test('668ZX follows original dash jump Z latch, diagonal callback and its actual landing state',()=>{
  const s=make(),a=s.actor('rf');
  step(s,{pressed:['RIGHT'],held:['RIGHT'],edges:[{key:'RIGHT',down:true,time:1}]});step(s,{released:['RIGHT']});
  step(s,{pressed:['RIGHT'],held:['RIGHT'],edges:[{key:'RIGHT',down:true,time:1.1}]});assert.equal(a.state,'RSI_DASH');
  step(s,{pressed:['UP'],held:['RIGHT','UP']});advance(s,5,{held:['RIGHT']});
  step(s,{pressed:['Z'],held:['RIGHT']});assert.equal(a.state,'RSI_DASH_JUMP_COMBO_Z');
  advance(s,2);step(s,{pressed:['X']});advance(s,10);
  assert.equal(a.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX');
  for(let i=0;i<80&&a.state!=='RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING';i++)step(s);
  assert.equal(a.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING');assert.equal(a.vx,0);assert.equal(a.vy,0);
  assert.ok(s.drainEvents().some(e=>e.field==='nativeZXDiagonal'&&e.values[0]===2200&&e.values[1]===-2640));
});
test('recovered forward XX6XXX route consumes target windows, with reference-source uncertainty attached',()=>{
  const s=make(),a=s.actor('rf');s.enter(a,'RSI_COMBO_XX','source-fixture');a.animationTime=.51;
  // a1bcdab X2GURaven.cpp:8309-8317 routes forward to frontX, down to downX.
  // Names are counterintuitive: target frontX uses OT_ComboX3Down_New.
  step(s,{pressed:['X'],held:['RIGHT']});step(s,{held:['RIGHT']});step(s,{held:['RIGHT']});assert.equal(a.state,'RSI_OVER_TAKER_COMBO_XXfrontX');
  assert.equal(a.animationName,'OT_ComboX3Down_New');
  // Recovered source separates an input latch from its later stateChange.
  // Target EPT0 is {.2,.66,.56} for frontX and {.2,.7,.6} for frontXX.
  for(const [next,fireAt] of [['RSI_OVER_TAKER_COMBO_XXfrontXX',.57],['RSI_OVER_TAKER_COMBO_XXfrontXX2',.61]]){
    const current=a.state;a.animationTime=.25;step(s,{pressed:['X'],held:['RIGHT']});assert.equal(a.state,current);
    a.animationTime=fireAt;step(s,{held:['RIGHT']});assert.equal(a.state,next);
  }
  assert.ok(a.unsupported.some(e=>e.id.startsWith('combo-binding:')));
  assert.equal(profile.states.RSI_OVER_TAKER_COMBO_XXdownX.raw.DAMAGE_DATA,undefined,'no invented startup damage');
});
test('2016 candidate input window rejects too-early presses rather than endlessly queuing X',()=>{
  const s=make(),a=s.actor('rf');s.enter(a,'RSI_OVER_TAKER_COMBO_XXfrontXX','source-fixture');a.animationTime=.1;
  step(s,{pressed:['X']});assert.equal(a.buffered,null);
  a.animationTime=.59;step(s);assert.equal(a.state,'RSI_OVER_TAKER_COMBO_XXfrontXX');
});
test('incoming source track speed ramp shares logical clock and freezes with hitstop',()=>{
  const s=make(),a=s.actor('rf');s.enter(a,'RSI_DASH','source-fixture');
  const d=profile.states.RSI_DASH.clip.durationSeconds/10;
  step(s,{held:['RIGHT']},.01);assert.ok(Math.abs(a.animationTime-.01*.01/(2*d))<1e-10);
  a.hitStop=.1;const time=a.animationTime,blend=a.presentationTransition.elapsedSeconds;
  step(s,{},.02);assert.equal(a.animationTime,time);assert.equal(a.presentationTransition.elapsedSeconds,blend);
});
test('loop resets at native early-end with outgoing pose metadata rather than modulo snap',()=>{
  const s=make(),a=s.actor('rf');s.enter(a,'RSI_DASH','source-fixture');
  a.animationSpeedRamp=null;a.animationPlaybackSpeed=1;
  a.animationTime=.84;const serial=a.animationTransitionSerial;step(s,{held:['RIGHT']},.01);
  // Dash period=.9333333, early end=.84, default transition=.0933333.
  assert.equal(a.animationTime,0);assert.equal(a.animationTransitionSerial,serial+1);
  assert.equal(a.presentationTransition.enabled,true);assert.ok(a.presentationTransition.fromTime>.84);
  assert.equal(a.presentationTransition.fromName,'Dash');
});
test('CAN_PUSH false does not bypass native crossing guard',()=>{
  const p=structuredClone(profile);p.states.RSI_COMBO_Z.raw.CAN_PUSH_UNIT=0;
  const s=make({profile:p,actors:[{id:'rf',team:0,x:-80,y:0},{id:'target',team:1,x:0,y:0}]});
  const a=s.actor('rf');s.enter(a,'RSI_COMBO_Z','source-fixture');a.vx=10000;step(s,{},.1);
  assert.equal(a.x,-80);assert.equal(a.vx,0);
});

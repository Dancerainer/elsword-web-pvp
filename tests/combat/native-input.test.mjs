import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSimulation } from '../../packages/combat-core/index.mjs';
import { collisionPoint } from '../../packages/combat-core/collision.mjs';
import { createInputBuffer } from '../../apps/web/input-buffer.mjs';
const read=f=>JSON.parse(readFileSync(new URL('../../'+f,import.meta.url)));
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
// Source-derived expectations, NOT a target-client recording:
// KTDIDevice.cpp double gap0.4; Raven jump/down callbacks; KTDXCollision.h.
const map={sceneId:'native-input-fixture',lines:[{lineId:0,start:[-2000,0,0],end:[2000,0,0],type:'LINE_TYPE.LT_NORMAL',nativeFields:{CAN_DOWN:false}},{lineId:1,start:[-800,250,0],end:[800,250,0],type:'LINE_TYPE.LT_NORMAL',nativeFields:{CAN_DOWN:true}}]};
const make=(actors)=>createSimulation({profile,preset,map,actors:actors??[{id:'rf',team:0,x:-300,y:0,lineId:0,facing:1},{id:'target',team:1,x:300,y:0,lineId:0,facing:-1}]});
const step=(s,input={},dt=1/60)=>s.step(dt,input,{snapshot:false});
// Start the actual equipped skill: source StartFuture reads its range, and
// target highest Shadow node24217 supplies SA_TELEPORT_RANGE_ABS[1]=6.
// 24204 is Weapon Crash, not Shadow Step; direct enter lacks skill context.
function startShadow(s){
  s.configureLoadout([{skillId:24217,branchId:'none'},null,null,null,null,null,null,null]);
  step(s,{pressed:['A']});
  assert.equal(s.actor('rf').skillId,24217);
  assert.equal(s.actor('rf').state,'RSI_SI_A_RF_SHADOW_STEP');
  assert.equal(s.actor('rf').sourceShadowStep.range,600);
}
test('two rapid press-release cycles survive one browser interval; repeat is suppressed',()=>{
  const b=createInputBuffer();assert.equal(b.down('RIGHT',1),true);assert.equal(b.down('RIGHT',1.01),false);b.up('RIGHT',1.02);b.down('RIGHT',1.2);
  const first=b.consume();assert.deepEqual(first.pressed,['RIGHT']);assert.deepEqual(first.released,['RIGHT']);assert.deepEqual(first.held,[]);
  const second=b.consume();assert.deepEqual(second.pressed,['RIGHT']);assert.deepEqual(second.held,['RIGHT']);assert.equal(second.edges[0].time,1.2);
  const s=make();step(s,first);step(s,second);assert.equal(s.actor('rf').state,'RSI_DASH');
});
test('dash requires release and second press within native 0.4 seconds, not repeats',()=>{
  for(const interval of [.39,.41]){const s=make();step(s,{held:['RIGHT'],pressed:['RIGHT'],edges:[{key:'RIGHT',down:true,time:1}]});step(s,{released:['RIGHT']});step(s,{held:['RIGHT'],pressed:['RIGHT'],edges:[{key:'RIGHT',down:true,time:1+interval}]});assert.equal(s.actor('rf').state,interval<.4?'RSI_DASH':'RSI_WALK');}
  const s=make();step(s,{held:['RIGHT'],pressed:['RIGHT']});step(s,{held:['RIGHT'],pressed:['RIGHT']});assert.equal(s.actor('rf').state,'RSI_WALK');
});
test('normal jump down adds original G acceleration; dash-jump down forces max falling speed',()=>{
  const a=make(),b=make();for(const s of [a,b]){s.actor('rf').y=450;s.actor('rf').grounded=false;s.actor('rf').lineId=null;s.enter(s.actor('rf'),'RSI_JUMP_UP','source-fixture');s.actor('rf').vy=1000;}
  step(a,{});step(b,{held:['DOWN']});assert.ok(Math.abs((a.actor('rf').vy-b.actor('rf').vy)-4000/60)<1e-8);
  const s=make(),actor=s.actor('rf');actor.y=500;actor.grounded=false;actor.lineId=null;s.enter(actor,'RSI_DASH_JUMP','source-fixture');step(s,{pressed:['DOWN'],held:['DOWN']});assert.equal(actor.downForce,true);assert.equal(actor.vy,profile.physics.MAX_G_SPEED);
});
test('down alone drops from CAN_DOWN true platform by native45 units and cannot drop false ground',()=>{
  const s=make(),a=s.actor('rf');a.y=250;a.lineId=1;a.grounded=true;step(s,{pressed:['DOWN']});assert.equal(a.grounded,false);assert.ok(a.y<=205);assert.equal(a.lineId,1);
  const t=make(),b=t.actor('rf');step(t,{pressed:['DOWN']});assert.equal(b.grounded,true);assert.equal(b.y,0);assert.ok(t.drainEvents().some(e=>e.type==='dropRejected'));
});
test('opponents cannot cross even at high velocity; authored pass flag permits a pass',()=>{
  const s=make([{id:'rf',team:0,x:-75,y:0,lineId:0},{id:'target',team:1,x:0,y:0,lineId:0,facing:-1}]),a=s.actor('rf'),b=s.actor('target');a.vx=10000;step(s,{held:['RIGHT']},.1);assert.ok(a.x<=b.x-profile.body.UNIT_WIDTH);
  a.x=-75;startShadow(s);a.vx=10000;step(s,{},.1);assert.ok(a.x>b.x,'source CAN_PASS_UNIT state must not gain a fabricated wall');
});
test('source passive speed resets after physics and is retained for the following frame',()=>{
  const s=make(),a=s.actor('rf');startShadow(s);step(s);assert.equal(a.vx,1000);const x=a.x;step(s);assert.equal(a.vx,1000);assert.ok(a.x>x+15);
});
test('double-tap release/time is retained across a world stop instead of swallowing input',()=>{
  const s=make(),a=s.actor('rf');a.worldStop=.1;
  step(s,{pressed:['RIGHT'],held:['RIGHT'],edges:[{key:'RIGHT',down:true,time:1}]});step(s,{released:['RIGHT'],edges:[{key:'RIGHT',down:false,time:1.02}]});step(s,{pressed:['RIGHT'],held:['RIGHT'],edges:[{key:'RIGHT',down:true,time:1.2}]});
  for(let i=0;i<5;i++)step(s,{held:['RIGHT']});assert.equal(a.state,'RSI_DASH');assert.equal(a.pendingPressed.length,0);
});
test('front/back and elevated received attacks select distinct source reaction clips',()=>{
  const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:1,BACK_SPEED_X:100,BACK_SPEED_Y:300};
  for(const [x,state,sign] of [[0,'RSI_DAMAGE_SMALL_BACK',1],[700,'RSI_DAMAGE_SMALL_FRONT',-1]]){const s=make(),a=s.actor('rf'),b=s.actor('target');a.x=x;b.facing=1;s.injectHit({attackerId:a.id,targetId:b.id,damageData:data});assert.equal(b.state,state);assert.equal(b.animationName,profile.states[state].animationName);assert.equal(Math.sign(b.vx),sign);assert.equal(b.vy,0);}
  const s=make(),a=s.actor('rf'),b=s.actor('target');a.y=b.y=600;b.grounded=false;b.lineId=null;s.injectHit({attackerId:a.id,targetId:b.id,damageData:data});assert.equal(b.state,'RSI_DAMAGE_AIR_SMALL');assert.equal(b.vy,1000,'User25842 AirSmall entry adds700 to backY300');
});
test('XX down-X and ZZX forward-X choose exact RF source mappings; unknown ZZZX is not substituted',()=>{
  // a1bcdab recovered RSI_COMBO_XX_EventProcess explicitly selects downX;
  // target2016 gives that state OT_ComboX3Front_New, not the forward clip.
  const s=make(),a=s.actor('rf');s.enter(a,'RSI_COMBO_XX','source-fixture');a.animationTime=.51;step(s,{pressed:['X'],held:['DOWN']});step(s,{held:['DOWN']});step(s,{held:['DOWN']});assert.equal(a.state,'RSI_OVER_TAKER_COMBO_XXdownX');assert.equal(a.animationName,'OT_ComboX3Front_New');
  s.enter(a,'RSI_COMBO_ZZX','source-fixture');a.animationTime=.55;step(s,{pressed:['X'],held:['RIGHT']});step(s,{held:['RIGHT']});step(s,{held:['RIGHT']});assert.equal(a.state,'RRF_COMBO_ZZXFRONTX');
  s.enter(a,'RSI_COMBO_ZZZ','source-fixture');a.animationTime=.54;step(s,{pressed:['X']});assert.equal(a.state,'RSI_COMBO_ZZZ');assert.ok(s.drainEvents().some(e=>e.type==='unsupported'&&e.id==='combo-branch:RSI_COMBO_ZZZ:X'));
});
test('sphere uses strict distance and midpoint; sword ray uses native forward projection, not AABB',()=>{
  const sphere={kind:'sphere',center:[0,0,0],radius:10};assert.equal(collisionPoint(sphere,{kind:'sphere',center:[20,0,0],radius:10}),null);assert.deepEqual(collisionPoint(sphere,{kind:'sphere',center:[12,0,0],radius:10}),[6,0,0]);
  const sword={kind:'line',start:[0,0,0],end:[100,0,0],radius:5};assert.deepEqual(collisionPoint(sword,{kind:'sphere',center:[50,10,0],radius:10}),[50,0,0]);assert.equal(collisionPoint(sword,{kind:'sphere',center:[-5,0,0],radius:10}),null);
});
test('fast render view avoids snapshots without changing deterministic results or restore',()=>{
  const a=make(),b=make();for(let i=0;i<60;i++){const input=i===0?{pressed:['Z']}:{};a.step(1/60,input);b.step(1/60,input,{snapshot:false});}assert.deepEqual(a.snapshot(),b.snapshot());assert.equal(b.view().actors[0],b.actor('rf'));
  const saved=b.snapshot(),c=make();c.restore(JSON.parse(JSON.stringify(saved)));step(b,{pressed:['X']});step(c,{pressed:['X']});assert.deepEqual(b.snapshot(),c.snapshot());
});

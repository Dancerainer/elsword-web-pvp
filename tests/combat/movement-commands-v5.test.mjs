import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const profile=read('packages/combat-core/rf-profile.json'),preset=authoredEquipmentPreset(read('config/rf-preset.json'));
// Freeze neutral speeds for the independently sourced velocity/height and input
// window equations; do not let a product preset redefine this test's baseline.
preset.guildPassives=[];
preset.attributes={...preset.attributes,animationSpeedMultiplier:1,moveSpeedMultiplier:1,jumpSpeedMultiplier:1,damageReduction:0,awakeningChargeBonus:0};
const map={sceneId:'source-movement-v5',lines:[
  {lineId:0,start:[-5000,0,0],end:[5000,0,0],type:'LINE_TYPE.LT_NORMAL',nativeFields:{CAN_DOWN:false}},
  {lineId:1,start:[-1000,250,0],end:[1000,250,0],type:'LINE_TYPE.LT_NORMAL',nativeFields:{}},
]};
const make=(extra={})=>createSimulation({profile,preset,map,actors:[{id:'rf',team:0,x:-300,y:0,facing:1},{id:'target',team:1,x:3500,y:0,facing:-1}],...extra});
const step=(s,input={},dt=.01)=>s.step(dt,input,{snapshot:false});
const advance=(s,n,input={})=>{for(let i=0;i<n;i++)step(s,input);};
const effectAnchorSampler=(e,a)=>({position:[a.x+(e.definition.POSITION_OFFSET_X??0)*a.facing,a.y,a.z],facing:a.facing});
// These are source-derived port checks. No outputs from the implementation are
// relabelled as measured native 2016 answers.
test('662Z uses DASH+oneDown shortcut without upward launch then air dash Z',()=>{
  const s=make(),a=s.actor('rf');a.y=250;a.lineId=1;a.grounded=true;
  step(s,{pressed:['RIGHT'],held:['RIGHT'],edges:[{key:'RIGHT',down:true,time:1}]});
  step(s,{released:['RIGHT']});
  step(s,{pressed:['RIGHT'],held:['RIGHT'],edges:[{key:'RIGHT',down:true,time:1.1}]});
  assert.equal(a.state,'RSI_DASH');
  step(s,{pressed:['DOWN'],held:['RIGHT','DOWN']});
  assert.equal(a.state,'RSI_DASH_JUMP');assert.equal(a.vy,0);assert.equal(a.downForce,false);
  assert.equal(a.y,205,'native radius*1.5 is subtracted on drop');
  step(s,{pressed:['Z'],held:['RIGHT']});assert.equal(a.state,'RSI_DASH_JUMP_COMBO_Z');
  for(let i=0;i<80&&!a.grounded;i++)step(s);
  assert.equal(a.state,'RSI_DASH_JUMP_LANDING');
  assert.equal(a.lineId,1,'native radius support lets SPEED_Y500 return to the original platform');
  step(s,{pressed:['Z']});assert.equal(a.state,'RSI_COMBO_Z','landing can continue Z without a manufactured global input lock');
});
test('ZZXX82XZ candidate uses target .6 field; normal X down applies extraG and Up-only .2 landing lock',()=>{
  const s=make(),a=s.actor('rf');s.enter(a,'RSI_COMBO_ZZXX','source-fixture');
  a.animationTime=.58;step(s,{pressed:['UP']});assert.equal(a.state,'RSI_COMBO_ZZXX');
  step(s,{held:['UP']});assert.equal(a.state,'RSI_JUMP_UP');
  step(s,{pressed:['DOWN'],held:['DOWN']});
  step(s,{pressed:['X'],held:['DOWN']});assert.equal(a.state,'RSI_JUMP_COMBO_X');
  const priorVy=a.vy;step(s,{held:['DOWN']});assert.ok(Math.abs(a.vy-(priorVy-profile.physics.G_ACCEL*.02))<1e-8);
  let maximum=a.y;
  for(let i=0;i<80&&!a.grounded;i++){step(s,{held:['DOWN']});maximum=Math.max(maximum,a.y);}
  assert.equal(a.state,'RSI_JUMP_LANDING');assert.ok(maximum<200,'source extraG controls jump height without invented teleport or multiplier');
  assert.equal(a.canNotJumpTime,.2);step(s,{pressed:['UP'],held:['UP']});assert.equal(a.state,'RSI_JUMP_LANDING');
  step(s,{pressed:['Z'],held:['UP']});assert.equal(a.state,'RSI_COMBO_Z','the native .2 timer filters only Up');
  assert.ok(a.unsupported.some(e=>e.id==='updown-cancel-target-binding'),'target callback uncertainty remains explicit');
});
test('air X holds last pose until ground; opposing direction does not reverse native facing',()=>{
  const s=make(),a=s.actor('rf');a.y=1500;a.grounded=false;a.lineId=null;a.vy=0;
  s.enter(a,'RSI_JUMP_COMBO_X','source-fixture');a.animationTime=profile.states[a.state].clip.durationSeconds;
  step(s,{held:['LEFT','DOWN']});assert.equal(a.state,'RSI_JUMP_COMBO_X');assert.equal(a.facing,1);
  assert.equal(a.animationStopped,true);
  const blend=a.presentationTransition.elapsedSeconds,time=a.animationTime;
  step(s,{held:['DOWN']});assert.equal(a.animationTime,time);assert.equal(a.presentationTransition.elapsedSeconds,blend);
});
test('source X down permits extraG with Up held; source Z down does not',()=>{
  for(const [name,expected] of [['RSI_JUMP_COMBO_X',-80],['RSI_JUMP_COMBO_Z',-40]]){
    const s=make(),a=s.actor('rf');a.y=500;a.grounded=false;a.lineId=null;a.vy=0;s.enter(a,name,'source-fixture');
    step(s,{held:['UP','DOWN']});assert.equal(a.vy,expected);assert.equal(a.jumpAttackDown,name.endsWith('_X'));
  }
});
test('668ZXX reaches its true 2016 ZXX state; missing trigger remains disabled',()=>{
  const s=make(),a=s.actor('rf');s.enter(a,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING','source-fixture');
  a.animationTime=.249;step(s,{pressed:['X']});assert.equal(a.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX');
  assert.equal(a.animationName,'OT_DashJumpComboZ3a');advance(s,35);
  assert.equal(s.view().effects.some(e=>e.setName==='EffectSet_ROT_DASHJUMP_ZXX'),false);
  assert.equal(profile.referenceSemantics.mechanicBindings.RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX.animationTime,null);
});
test('original black spear parent moves at DirSpeed1000 and creates four independent damage children',()=>{
  const template=profile.effectTemplates.Mesh_Raven_OverTaker_XX_Down_X_Dummy;
  assert.equal(template.fields.LifeType,'LT_TIME');assert.equal(template.fields.LifeTime,.5);
  assert.equal(template.events.find(e=>e.property==='DirSpeed').value,1000);
  const s=make({effectAnchorSampler,actors:[{id:'rf',team:0,x:0,y:0,facing:1},{id:'target',team:1,x:3500,y:0,facing:-1}]});
  s.spawnSet(s.actor('rf'),'EffectSet_ROT_DASHJUMP_ZXX',profile.enums.EFFECT_SET_TIMER_TYPE.ESTT_CUSTOM);
  advance(s,40);
  const children=s.drainEvents().filter(e=>e.type==='damageChildCreated');
  assert.deepEqual(children.map(e=>e.eventTime),[.01,.11,.21,.31]);
  for(const e of children){
    const ideal=100+1000*e.eventTime;
    assert.ok(e.position[0]>=ideal-1e-8&&e.position[0]<=ideal+10+1e-8,'source velocity and event time within one fixed-step quantization');
  }
  assert.ok(children.every(e=>e.name==='DamageEffect_RSI_OVER_TAKER_BIG_SPINE'));
  assert.equal(s.view().effects.filter(e=>e.name==='DamageEffect_RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX').length,1,'DAMAGE_TIME0 is not zero-second lifetime');
  // GameMajorXMeshPlayer.txt:75645 sets LT_TIME=.5. Fixed V5
  // KTDGXMeshPlayer.cpp:2132..2146 checks OLD float time before adding dt.
  // Independent binary32 sum of .01f: packet50=.4999997913837433;
  // packet51=.5099998116493225 remains alive; packet52 sees that old time.
  const parent=s.state.effects.find(e=>e.name==='DamageEffect_RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX');
  advance(s,10);assert.equal(parent.meshLifetimeElapsed,0.4999997913837433);
  step(s);assert.equal(parent.meshLifetimeElapsed,0.5099998116493225);
  assert.ok(s.state.effects.includes(parent),'the crossing packet still executes the source interval');
  assert.equal(s.drainEvents().filter(e=>e.type==='effectEnded'&&e.effectId===parent.id).length,0);
  step(s);assert.equal(s.state.effects.includes(parent),false);
  assert.deepEqual(s.drainEvents().filter(e=>e.type==='effectEnded'&&e.effectId===parent.id).map(e=>e.reason),['template-life-time']);
});
test('black spear uses original global .1 attack window and 2.13 magic / MP4 independently of owner animation',()=>{
  const s=make({effectAnchorSampler,actors:[{id:'rf',team:0,x:0,y:0,facing:1,attributes:{magicAttack:1000,animationSpeedMultiplier:3},mp:0},
    {id:'target',team:1,x:410,y:0,facing:-1}],
    defenderSampler:b=>[{kind:'sphere',center:[b.x,50,0],radius:5}],
    effectSampler:e=>e.name==='DamageEffect_RSI_OVER_TAKER_BIG_SPINE'?[{kind:'sphere',center:[e.currentAnchor.position[0],50,0],radius:5}]:[]});
  s.spawnSet(s.actor('rf'),'EffectSet_ROT_DASHJUMP_ZXX',profile.enums.EFFECT_SET_TIMER_TYPE.ESTT_CUSTOM);
  const before=s.actor('target').hp;advance(s,50);
  assert.equal(before-s.actor('target').hp,2130);
  assert.ok(Math.abs(s.actor('rf').mp-(4+50*.01))<1e-6,'one MP4 hit plus 0.5 unfrozen seconds of sourced natural recovery');
  const events=s.drainEvents();assert.equal(events.filter(e=>e.type==='hit'&&e.origin.kind==='effect').length,1);
});
test('DAMAGE_TIME1 ends a persistent damage effect on its first accepted hit, not after one second',()=>{
  const p=structuredClone(profile);p.damageEffects.DamageEffect_RSI_OVER_TAKER_BIG_SPINE.raw.DAMAGE_TIME=1;
  const s=make({profile:p,actors:[{id:'rf',team:0,x:0,y:0,facing:1},{id:'target',team:1,x:10,y:0,facing:-1}],
    effectSampler:e=>e.name==='DamageEffect_RSI_OVER_TAKER_BIG_SPINE'?[{kind:'sphere',center:[10,50,0],radius:10}]:[]});
  s.createEffect(s.actor('rf'),{NAME:'DamageEffect_RSI_OVER_TAKER_BIG_SPINE'},{birthAnchor:{position:[10,0,0],facing:1}});
  step(s);assert.equal(s.view().effects.length,0);assert.ok(s.drainEvents().some(e=>e.type==='effectEnded'&&e.reason==='hit-limit'));
});
test('mixed root cache updates even when physics gate is off and resets on ChangeAnim',()=>{
  const s=make({motionOffsetSampler:()=>({x:10,z:2})}),a=s.actor('rf');a.applyMotionOffset=false;
  const initial=a.x;step(s);assert.equal(a.x,initial);assert.deepEqual(a.motionMoveNow,{x:10,z:2});
  a.applyMotionOffset=true;step(s);assert.equal(a.x,initial,'re-enabling unit gate cannot replay discarded root translation');
  s.enter(a,'RSI_WAIT','source-fixture');assert.deepEqual(a.motionMoveNow,{x:0,z:0});
  step(s);assert.equal(a.x,initial+10);assert.equal(a.z,2);
});
test('nested child timing and motion caches roundtrip snapshots deterministically',()=>{
  const s=make({effectAnchorSampler}),a=s.actor('rf');s.spawnSet(a,'EffectSet_ROT_DASHJUMP_ZXX',profile.enums.EFFECT_SET_TIMER_TYPE.ESTT_CUSTOM);
  advance(s,12);const snapshot=s.snapshot();advance(s,25);const expected=s.snapshot();
  const t=make();t.restore(snapshot);advance(t,25);assert.deepEqual(t.snapshot(),expected);
});
test('three complete 662Z gestures return to authored Garpai platform4 through radius support, while plain Down descends',()=>{
  const actual=read('artifacts/scene/sander-garpai-rock-pvp/collision.json');
  const s=make({map:actual,actors:[{id:'rf',team:0,x:-650,y:3800,z:0,lineId:4,facing:1}]}),a=s.actor('rf');
  for(let attempt=0;attempt<3;attempt++){
    step(s,{pressed:['RIGHT'],held:['RIGHT']});step(s,{released:['RIGHT']});
    step(s,{pressed:['RIGHT'],held:['RIGHT']});assert.equal(a.state,'RSI_DASH');
    step(s,{pressed:['DOWN'],held:['RIGHT','DOWN']});assert.equal(a.state,'RSI_DASH_JUMP');
    step(s,{pressed:['Z'],held:['RIGHT']});assert.equal(a.state,'RSI_DASH_JUMP_COMBO_Z');
    for(let i=0;i<100&&!a.grounded;i++)step(s);
    assert.equal(a.state,'RSI_DASH_JUMP_LANDING');assert.equal(a.lineId,4);assert.equal(a.y,3800);
  }
  const t=make({map:actual,actors:[{id:'rf',team:0,x:-650,y:3800,z:0,lineId:4,facing:1}]});
  step(t,{pressed:['DOWN']});for(let i=0;i<200&&!t.actor('rf').grounded;i++)step(t);
  assert.equal(t.actor('rf').lineId,2,'no Z SPEED_Y impulse means ordinary Down reaches the actual lower platform');
});
test('full ZZXX82XZ input chain runs on authored Garpai support without assigning a combat state',()=>{
  const actual=read('artifacts/scene/sander-garpai-rock-pvp/collision.json');
  const s=make({map:actual,actors:[{id:'rf',team:0,x:-650,y:3800,z:0,lineId:4,facing:1}]}),a=s.actor('rf');
  step(s,{pressed:['Z']});assert.equal(a.state,'RSI_COMBO_Z');
  for(const [sourceTime,key,expected] of [[.28,'Z','RSI_COMBO_ZZ'],[.35,'X','RSI_COMBO_ZZX'],[.56,'X','RSI_COMBO_ZZXX']]){
    for(let i=0;i<100&&a.animationTime<sourceTime;i++)step(s);
    step(s,{pressed:[key]});for(let i=0;i<100&&a.state!==expected;i++)step(s);
    assert.equal(a.state,expected);
  }
  for(let i=0;i<100&&a.animationTime<.6;i++)step(s);
  step(s,{pressed:['UP'],held:['UP']});assert.equal(a.state,'RSI_JUMP_UP');
  step(s,{pressed:['DOWN'],held:['DOWN']});step(s,{pressed:['X'],held:['DOWN']});assert.equal(a.state,'RSI_JUMP_COMBO_X');
  let height=a.y-3800;
  for(let i=0;i<100&&!a.grounded;i++){step(s,{held:['DOWN']});height=Math.max(height,a.y-3800);}
  assert.equal(a.lineId,4);assert.equal(a.y,3800);assert.ok(height<200);
  step(s,{pressed:['Z']});assert.equal(a.state,'RSI_COMBO_Z');
});
test('a rejected native support cannot fall through swept fallback into disabled, wall, monster or remote-depth lines',()=>{
  for(const variant of ['disabled','wall','monster','remote-depth']){
    const m={sceneId:'source-invalid-support-'+variant,lines:[{lineId:0,start:[-500,0,variant==='remote-depth'?500:0],
      end:[500,0,variant==='remote-depth'?500:0],nativeFields:{ENABLE:variant!=='disabled'},
      type:variant==='wall'?'LINE_TYPE.LT_WALL':variant==='monster'?'LINE_TYPE.LT_MONSTER_ROAD':'LINE_TYPE.LT_NORMAL'}]};
    const s=make({map:m,actors:[{id:'rf',team:0,x:0,y:50,z:0}]}),a=s.actor('rf');a.vy=-3500;
    advance(s,4);assert.equal(a.grounded,false,variant);assert.equal(s.drainEvents().some(e=>e.type==='landed'),false,variant);
  }
});

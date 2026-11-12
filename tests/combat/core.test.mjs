import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSimulation } from '../../packages/combat-core/index.mjs';
const profile = JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
// A small, explicit unit-test map. The application uses the original map contract.
const map = { sceneId:'unit-fixture-map', lines:[
  {lineId:0,start:[-1000,0,0],end:[1000,0,0],type:'LINE_TYPE.LT_NORMAL'},
  {lineId:1,start:[2000,200,0],end:[2600,200,0],type:'LINE_TYPE.LT_NORMAL'},
] };
const make = (extra={}) => createSimulation({profile,map,preset:{guildPassives:[]},actors:[
  {id:'rf',team:0,x:0,y:0,awakening:{orbs:3}}, {id:'target',team:1,x:150,y:0,facing:-1},
],...extra});
const advance = (s,n,input={}) => { for (let i=0;i<n;i++) s.step(1/60,input); };
const normalDamage = {DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:0,ATTACK_TYPE:2,HIT_ADD_MP:1};

test('literal target declarations and RF-owned max node, no VC GroundImpact', () => {
  assert.equal(profile.physics.WALK_SPEED,500);
  assert.equal(profile.physics.G_ACCEL,4000);
  assert.equal(profile.states.RSI_COMBO_Z.raw.ANIM_SPEED,1.05);
  assert.equal(profile.damageEffects.DamageEffect_RF_COMBO_Z.raw.ATTACK_TIME_START,.092);
  assert.equal(profile.skillCatalog.find(s=>s.skillId===24027).powerMultiplier,1.2);
  assert.equal(profile.skillCatalog.find(s=>s.skillId===24405).maxLevel,3);
  assert.equal(profile.skillCatalog.some(s=>s.skillId===24216),false);
});
test('eight slots, max Enhanced replacement, duplicate/non RF/unknown trait rejected', () => {
  const s=make(); const load=s.configureLoadout([{skillId:24002},null,null,null,null,null,null,null]);
  assert.equal(load[0].skillId,24027); assert.equal(load[0].level,1);
  assert.throws(()=>s.configureLoadout([{skillId:24216},null,null,null,null,null,null,null]),/not an RF/);
  assert.throws(()=>s.configureLoadout([{skillId:24002},{skillId:24027},null,null,null,null,null,null]),/Duplicate/);
  assert.throws(()=>s.configureLoadout([{skillId:24027,branchId:'heavy'},null,null,null,null,null,null,null]),{name:'RangeError',message:'Unknown trait heavy'});
});
test('banning either base or enhanced ID blocks the whole replacement family',()=>{
  const s=make();s.preset.bannedSkillIds=[24002];
  const slots=id=>[{skillId:id},null,null,null,null,null,null,null];
  assert.throws(()=>s.configureLoadout(slots(24027)),/Banned/);
  assert.throws(()=>s.configureLoadout(slots(24002)),/Banned/);
  s.preset.bannedSkillIds=[24027];
  assert.throws(()=>s.configureLoadout(slots(24002)),/Banned/);
  s.preset.bannedSkillIds=[];assert.equal(s.configureLoadout(slots(24002))[0].skillId,24027);
});
test('awakening defaults off, fixture orbs explicit; .83 animation event and target30s/orb', () => {
  const s=make(); assert.equal(s.actor('rf').awakening.remaining,0);
  s.step(1/60,{pressed:['AWAKEN']}); advance(s,47);
  assert.equal(s.actor('rf').awakening.remaining,0);
  // Native track-speed ramp: BoostPower period 1.3666667 /10, integrated
  // half-ramp delay .0683333. At53/60 wall seconds it is still before .83;
  // at55/60 it crosses .83 (start is an Event decision after physics). These are source equations, not recorded gold.
  advance(s,5); assert.equal(s.actor('rf').awakening.remaining,0);
  advance(s,2); assert.ok(s.actor('rf').awakening.remaining>89);
  assert.equal(s.actor('rf').core.gauge,40); assert.equal(s.actor('rf').core.level,2);
  assert.equal(s.drainEvents().filter(e=>e.type==='awakeningStarted').length,1);
});
test('seeded same inputs and snapshot continuation are byte-for-byte reproducible', () => {
  const a=make({seed:123}),b=make({seed:123});
  for(let i=0;i<36;i++){const keys={held:['RIGHT'],pressed:i===0?['Z']:i===5?['Z']:[]};a.step(1/60,keys);b.step(1/60,keys);}
  assert.deepEqual(a.snapshot(),b.snapshot());
  const snap=a.snapshot(); const c=make({seed:999}); c.restore(snap);
  for(let i=0;i<40;i++){a.step(1/60,{});c.step(1/60,{});}
  assert.deepEqual(a.snapshot(),c.snapshot());
  assert.throws(()=>c.restore({...snap,versions:{baseline:'other'}}),/mismatch/);
});
test('MP/CD checked and skill A starts max PowerAssault once', () => {
  const s=make(); s.step(1/60,{pressed:['A']});
  assert.equal(s.actor('rf').skillId,24027); assert.equal(s.actor('rf').mp,150);
  assert.equal(s.actor('rf').cooldowns[24027],10);
  advance(s,100); s.step(1/60,{pressed:['A']});
  assert.equal(s.drainEvents().filter(e=>e.type==='skillStarted').length,1);
});
test('empty sampler cannot fabricate hits; supplied source sphere enables timed direct attacks', () => {
  const s=make(); s.step(1/60,{pressed:['Z']}); advance(s,20);
  assert.equal(s.actor('target').hp,50000);
  const t=make({collisionSampler:a=>[{kind:'sphere',center:[a.x+150,a.y+75,a.z],radius:50}]});
  t.enter(t.actor('rf'),'RSI_COMBO_ZZ','unit-test'); advance(t,30);
  assert.ok(t.actor('target').hp<50000);
  assert.equal(t.drainEvents().filter(e=>e.type==='hit').length,1);
});
test('no substituted floor in a gap and dash jump uses distinct native speed', () => {
  const s=make(); const a=s.actor('rf');a.x=1050;s.step(1/60,{});
  assert.equal(a.grounded,false); assert.ok(a.y<0);
  a.x=0;a.y=0;a.grounded=true;a.lineId=0;s.enter(a,'RSI_DASH','unit-test');
  s.step(1/60,{held:['RIGHT'],pressed:['UP']});
  assert.equal(a.state,'RSI_DASH_JUMP');assert.ok(a.vy>2000);
  // V5 callback sets725*1.6, then PhysicProcess consumes original reload2000.
  assert.equal(a.vx,725-2000/60);
  s.step(1/60,{held:['RIGHT']});assert.equal(a.vx,725*1.6-2000/60);
});
test('core guards front grounded attacks at25%; rear attack cannot guard', () => {
  const s=make();const a=s.actor('rf'),b=s.actor('target');
  b.awakening.remaining=10;b.core.gauge=40;s.updateCoreLevel(b);b.core.phase='idle';
  const front=s.injectHit({attackerId:'rf',targetId:'target',damageData:normalDamage});
  assert.equal(front.guarded,true);assert.equal(front.amount,250);assert.equal(b.core.gauge,20);
  a.x=300;s.enter(b,'RSI_WAIT','unit-test');
  const rear=s.injectHit({attackerId:'rf',targetId:'target',damageData:normalDamage});
  assert.equal(rear.guarded,false);assert.equal(rear.amount,1000);
});
test('core hit consumes launched levels; invalid target keeps gauge; recall heals existing remainder', () => {
  // Explicit unit collision input; production AttackN poses are independently
  // checked in nasod-passives-production-v13. Missing helpers never imply a hit.
  const s=make({nasodAttackSampler:()=>[{kind:'sphere',center:[150,75,0],radius:50}]});const a=s.actor('rf');a.awakening.remaining=20;a.core.gauge=60;s.updateCoreLevel(a);a.core.phase='idle';
  s.injectHit({attackerId:'rf',targetId:'target',damageData:{...normalDamage,ATTACK_TYPE:1,ATTACK_TRIGGER_TYPE:1}});
  advance(s,73);assert.equal(a.core.gauge,0);assert.equal(a.core.phase,'absent');
  a.core.gauge=40;s.updateCoreLevel(a);a.core.phase='idle';s.actor('target').hp=50000;
  s.injectHit({attackerId:'rf',targetId:'target',damageData:{...normalDamage,ATTACK_TYPE:1,ATTACK_TRIGGER_TYPE:1}});
  s.actor('target').hp=0;advance(s,20);assert.equal(a.core.gauge,40);
  a.hp=10000;a.mp=0;a.awakening.remaining=.001;s.step(1/60,{});
  assert.equal(a.hp,11000);assert.equal(a.mp,40);assert.equal(a.core.level,0);
});

test('source deletion condition2 is not the custom clock enum1', () => {
  const s=make();s.step(1/60,{pressed:['Z']});
  const e=s.state.effects.find(e=>e.name==='DamageEffect_RF_COMBO_Z');
  assert.equal(e.clock,'animation');assert.deepEqual(e.deleteConditions,[2,1]);
  s.enter(s.actor('rf'),'RSI_WAIT','unit-test');s.step(1/60,{});
  assert.equal(s.state.effects.some(e=>e.name==='DamageEffect_RF_COMBO_Z'),false);
});
test('effect USE_GLOBAL_TIME window does not run at the owner doubled animation speed', () => {
  const s=make({preset:{attributes:{animationSpeedMultiplier:2}},
    effectSampler:()=>[{kind:'sphere',center:[150,75,0],radius:2000}]});
  s.step(.02,{pressed:['Z']});for(let i=0;i<3;i++)s.step(.02,{});
  assert.equal(s.actor('target').hp,50000);
  s.step(.02,{});assert.ok(s.actor('target').hp<50000);
});
test('native defender adapter can reject a hit that prototype INIT_BODY would accept', () => {
  const a=make(),b=make({defenderSampler:()=>[{kind:'sphere',center:[10000,10000,0],radius:1}]});
  const shape={kind:'sphere',center:[150,75,0],radius:50};
  assert.equal(a.intersects(shape,a.actor('target')),true);
  assert.equal(b.intersects(shape,b.actor('target')),false);
});
test('PvP stop range: full1300, half2000, beyond2000 none', () => {
  const s=createSimulation({profile,map,actors:[
    {id:'rf',team:0,x:0,y:0,awakening:{orbs:3}},
    {id:'near',team:1,x:1000,y:0},{id:'mid',team:1,x:1600,y:0},{id:'far',team:1,x:2200,y:200},
  ]});
  s.enter(s.actor('rf'),'RSI_HYPER_MODE','unit-test');s.processStateEvents(s.actor('rf'),.02,.04);
  // The original setter appends a request; the next User outer update
  // selects its last remaining duration into the scalar cache.
  assert.equal(s.actor('near').worldStop,0);assert.equal(s.actor('mid').worldStop,0);
  assert.equal(s.actor('near').sourceStopQueues.world.at(-1).remaining,1.5);
  assert.equal(s.actor('mid').sourceStopQueues.world.at(-1).remaining,.75);
  assert.equal(s.actor('far').worldStop,0);assert.equal(s.actor('far').sourceStopQueues?.world?.length??0,0);
});
test('target FALSE-symbol blocks drop and unresolved CAN_DOWN is not silently true',()=>{
  const m=structuredClone(map);m.lines[0].nativeFields={CAN_DOWN:{symbol:'FALSE',resolved:false}};
  const s=make({map:m});s.step(1/60,{held:['DOWN'],pressed:['DOWN']});
  assert.equal(s.actor('rf').grounded,true);assert.equal(s.actor('rf').y,0);
  assert.ok(s.drainEvents().some(e=>e.type==='dropRejected'));
  const unknown=structuredClone(map);unknown.lines[0].nativeFields={CAN_DOWN:{symbol:'UNCONFIRMED',resolved:false}};
  const t=make({map:unknown});t.step(1/60,{held:['DOWN'],pressed:['DOWN']});
  assert.equal(t.actor('rf').grounded,true);assert.ok(t.actor('rf').unsupported.some(u=>u.id==='CAN_DOWN-unknown'));
});
test('closed original line endpoint -2 blocks only that endpoint; open -1 drops',()=>{
  const m=structuredClone(map);m.lines[0].beforeLine=-2;m.lines[0].nextLine=-1;
  const s=make({map:m});const a=s.actor('rf');a.x=-999;s.step(.02,{held:['LEFT']});s.step(.02,{held:['LEFT']});
  assert.equal(a.x,-1000);assert.equal(a.grounded,true);
  a.x=999;s.step(.02,{held:['RIGHT']});assert.equal(a.grounded,false);assert.ok(a.x>1000);
});
test('native inertia decays and dash-jump landing selects separate original clip',()=>{
  const s=make();const a=s.actor('rf');a.grounded=false;a.y=1;a.vy=-100;a.vx=800;
  s.enter(a,'RSI_DASH_JUMP','unit-test');s.step(1/60,{});
  assert.equal(a.state,'RSI_DASH_JUMP_LANDING');assert.equal(a.animationName,'DashJumpLanding');
  const start=a.vx;advance(s,6);assert.ok(a.vx<start);
});
test('effect birth anchor survives a snapshot and owner motion; sound sets have source timestamps',()=>{
  const s=make({effectAnchorSampler:(effect,a)=>({position:[a.x+7,a.y+8,a.z],boneName:effect.definition.BONE_NAME})});
  s.step(1/60,{pressed:['Z']});const e=s.state.effects.find(e=>e.name==='DamageEffect_RF_COMBO_Z');
  assert.ok(e.birthActorPose);assert.ok(e.birthAnchor.position);
  const saved=structuredClone(e.birthAnchor);s.actor('rf').x+=100;s.step(1/60,{});assert.deepEqual(e.birthAnchor,saved);
  const snap=s.snapshot(),t=make();t.restore(snap);assert.deepEqual(t.state.effects[0].birthAnchor,saved);
  const u=make({seed:1});u.step(1/60,{pressed:['S']});advance(u,75);
  const sound=u.drainEvents().filter(e=>e.type==='sound');assert.ok(sound.some(e=>e.name.startsWith('RavenVoice_')));assert.ok(sound.some(e=>e.name==='Raven_Slash1.ogg'));
});
test('original jump-line launch speed survives held movement during the .1 input lock',()=>{
  const m={sceneId:'original-line8-unit-excerpt',lines:[{lineId:8,start:[-1400,2000,0],end:[1400,2000,0],type:'LINE_TYPE.LT_JUMP_UP_REL',
    beforeLine:-1,nextLine:-1,nativeFields:{CAN_DOWN:{symbol:'FALSE'},JUMP_SPEED_X:1500,JUMP_SPEED_Y:3800,JUMP_REL_UP_KEYSTOP_TIME:.1}}]};
  const s=createSimulation({profile,map:m,actors:[{id:'rf',team:0,x:0,y:2001}]});const a=s.actor('rf');
  s.step(1/60,{});assert.equal(a.pendingPlatformJump.lineId,8);
  s.step(1/60,{held:['RIGHT']});
  assert.equal(a.vx,1500-2000/60);assert.equal(a.vy,3800-4000/60);assert.ok(a.y>2000);
  assert.ok(a.inputLock>0);
});

test('ordinary takeoff applies native line radius; jump-ready command enters air attack',()=>{
  const s=make();const a=s.actor('rf');s.jump(a,false);
  assert.equal(a.y,30);assert.equal(a.vy,1500);assert.equal(a.grounded,false);
  const t=make();const b=t.actor('rf');t.step(1/60,{pressed:['UP']});
  assert.equal(b.state,'RSI_JUMP_UP');
  t.step(1/60,{pressed:['Z']});assert.equal(b.state,'RSI_JUMP_COMBO_Z');assert.ok(b.y>30);
  const u=make();const c=u.actor('rf');u.jump(c,true);assert.equal(c.y,0);
});

test('spent Nasod core becomes visible when source command charge reaches level one',()=>{
  const s=make();const a=s.actor('rf');a.awakening.remaining=10;
  a.core.phase='absent';a.core.gauge=16;a.core.level=0;s.drainEvents();
  s.injectHit({attackerId:'rf',targetId:'target',damageData:normalDamage});
  assert.equal(a.core.gauge,20);assert.equal(a.core.level,1);assert.equal(a.core.phase,'idle');
  assert.equal(a.core.animationName,'Wait');
  const events=s.drainEvents();assert.equal(events.filter(e=>e.type==='coreLevelChanged').length,1);
  assert.ok(events.some(e=>e.type==='sound'&&e.name==='Raven_NasodCore_Appear.ogg'));
});

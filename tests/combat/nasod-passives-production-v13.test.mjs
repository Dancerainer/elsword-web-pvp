import test from 'node:test';
import assert from 'node:assert/strict';
import {make,frames,profile} from '../helpers/rf-passive-fixture-v12.mjs';
import {canRepeatHit,rememberHit} from '../../packages/combat-core/hit-gap-memory.mjs';
import {prepareNasodAttack,launchNasodAttack,advanceNasodUnlock,NASOD_ATTACK_SCALE,canTriggerArchenemy,positionNasodIdle} from '../../packages/combat-core/nasod-attack.mjs';
import {awakeningDurationPlan} from '../../packages/combat-core/passives.mjs';
const f=Math.fround,dt=1/60;
// Expectations below are literal consumer operations/target declarations.
// Fixture observations are not treated as original-client expected traces.
function awakened(s){const a=s.actor('rf');a.awakening.remaining=120;a.core.gauge=100;s.updateCoreLevel(a);a.core.phase='idle';s.tickCore(a,0);s.drainEvents();return a;}
function press(s,key){s.step(dt,{pressed:[key],held:[key]},{snapshot:false});}

test('HitUnit birth gap survives DAMAGE_DATA_NEXT in both gap directions',()=>{
  const hits={},gaps={};rememberHit(hits,gaps,'enemy',1,{HIT_GAP:.05});
  assert.equal(canRepeatHit(hits,gaps,'enemy',1.05,{RE_ATTACK:1,HIT_GAP:5}),true);
  rememberHit(hits,gaps,'enemy',1.05,{HIT_GAP:5});
  assert.equal(canRepeatHit(hits,gaps,'enemy',1.1,{RE_ATTACK:1,HIT_GAP:.01}),false);
  assert.equal(canRepeatHit(hits,gaps,'enemy',6.05,{RE_ATTACK:1,HIT_GAP:.01}),true);
  assert.equal(canRepeatHit(hits,gaps,'enemy',100,{RE_ATTACK:0,HIT_GAP:0}),false);
  assert.equal(canRepeatHit({}, {},'enemy',1.1,{RE_ATTACK:0,HIT_GAP:5}),true);
});

test('core selects AttackN at request, retains its clock at launch, native unlock expires after three 60Hz updates',()=>{
  assert.deepEqual(NASOD_ATTACK_SCALE,[0,1,1.6,1.4,1.6,1.5]);
  for(let level=1;level<=5;level++){
    const c={level,phase:'idle',x:200,y:300,z:0};assert.equal(prepareNasodAttack(c,'enemy',[0,180,0]),true);
    assert.equal(c.animationName,`Attack${level}`);assert.equal(c.helper.scale,f(NASOD_ATTACK_SCALE[level]));
    c.animationTime=.3;launchNasodAttack(c,{direction:[1,0,0],facing:-1});
    assert.equal(c.x,350);assert.equal(c.animationTime,.3);assert.equal(c.dirSpeed,3600);
    assert.deepEqual(c.helper.attackTime,[0,9999]);
    assert.deepEqual([1,2,3,4].map(()=>advanceNasodUnlock(c,dt)),[true,true,true,false]);
  }
});

test('idle core source offset uses native per-packet .05 interpolation after birth',()=>{
  const c={},owner={x:1000,y:200,z:0,facing:1},basis={direction:[1,0,0],rotation:[0,0,0]};
  positionNasodIdle(c,owner,basis,true);assert.deepEqual([c.x,c.y,c.z],[838,326,0]);
  owner.x=1100;positionNasodIdle(c,owner,basis);assert.equal(c.x,843);
});

test('actual SteelWall retains the ending RT_FLY and core helper collision without timing/invulnerability shortcuts',async()=>{
  const s=await make({skillId:24032,passives:[24405]}),a=awakened(s);press(s,'A');
  let seenHelper=false,coreTargetState;
  for(let i=0;i<180;i++){
    if(a.core.phase==='attack')seenHelper ||= s.nasodAttackSampler(a.core).some(v=>v.source?.helper?.startsWith('ATTACK_SPHERE'));
    const n=s.state.events.length;s.step(dt,{}, {snapshot:false});
    if(s.state.events.slice(n).some(e=>e.type==='coreAttackHit'))coreTargetState=s.actor('target').state;
  }
  const ordinary=s.state.events.filter(e=>e.type==='hit'&&e.origin.kind==='effect'&&e.origin.skillId===24032);
  // Target DamageEffect_RSI_SI1_Over_Taker_Charged_Bolt: MAX_HIT_COUNT3
  // then retained hit-unit memory permits DAMAGE_DATA_NEXT RT_FLY.
  assert.deepEqual(ordinary.map(e=>e.data.REACT_TYPE),[4,4,4,5]);
  assert.equal(ordinary.at(-1).data.BACK_SPEED_Y,800);
  const prepared=s.state.events.find(e=>e.type==='coreAttackPrepared'),start=s.state.events.find(e=>e.type==='coreAttackStarted');
  assert.ok(start.time-prepared.time>=.3-dt-1e-9&&start.time-prepared.time<=.3+dt);
  assert.equal(s.state.events.filter(e=>e.type==='coreAttackHit').length,1);
  assert.ok(seenHelper);assert.ok(coreTargetState?.includes('DAMAGE'),'core hit must enter actual damage state');
  assert.equal(s.state.events.some(e=>e.type==='unsupported'&&e.code==='core-helper-missing'),false);
});

test('actual Nasod pending attack and hit-gap memory reproduce after JSON restoration',async()=>{
  const left=await make({skillId:24032,passives:[24405]});awakened(left);press(left,'A');
  for(let i=0;i<100&&left.actor('rf').core.phase!=='prepare';i++)frames(left,1);
  assert.equal(left.actor('rf').core.phase,'prepare');
  const right=await make({skillId:24032,passives:[24405]});right.restore(JSON.parse(JSON.stringify(left.snapshot())));
  frames(left,120);frames(right,120);assert.deepEqual(left.snapshot(),right.snapshot());
});

test('24405 initial duration uses explicit -30% description; reawakening is animated, additive and consumes one orb',async()=>{
  const s=await make({passives:[24405]}),a=s.actor('rf');
  assert.equal(awakeningDurationPlan(a.passivePolicy,{orbs:3,baseSeconds:30}).addedSeconds,90*f(.7));
  const off=await make({passives:[]});assert.equal(awakeningDurationPlan(off.actor('rf').passivePolicy,{orbs:3,baseSeconds:30}).addedSeconds,90);
  a.awakening.orbs=3;s.drainEvents();press(s,'Control');frames(s,75);
  const first=s.state.events.find(e=>e.type==='awakeningStarted');assert.ok(first);assert.equal(first.addedSeconds,90*f(.7));
  const auraCount=s.state.events.filter(e=>e.type==='coreAuraStarted').length;assert.equal(auraCount,1);
  a.awakening.orbs=2;a.core.gauge=20;s.updateCoreLevel(a);a.awakening.remaining=30;
  const before=s.state.time;press(s,'Control');assert.equal(a.awakening.orbs,1);assert.equal(a.core.gauge,20);
  assert.ok(a.awakening.remaining>29);assert.equal(s.state.events.some(e=>e.type==='reawakenCoreRefill'),false);
  frames(s,75);const second=s.state.events.find(e=>e.type==='reawakenCoreRefill');assert.ok(second);
  assert.ok(second.time-before>=.83/a.stats.animationSpeedMultiplier-dt);assert.equal(second.addedSeconds,30*f(.7));assert.equal(second.coreGauge,60);
  assert.ok(second.duration>49&&second.duration<52,'remaining duration receives the user-corrected one-bead duration');
  assert.equal(s.state.events.filter(e=>e.type==='coreAuraStarted').length,auraCount);
});

test('ArcEnemy rejects special aura and class-core provenance even if owner currently has an ordinary active skill',async()=>{
  assert.equal(canTriggerArchenemy({ATTACK_TYPE:1},{kind:'effect'}),false);
  assert.equal(canTriggerArchenemy({}, {kind:'core'}),false);
  assert.equal(canTriggerArchenemy({}, {kind:'effect'},{name:'RAVEN_HYPER_AURA'}),false);
  assert.equal(canTriggerArchenemy({ATTACK_TYPE:2},{kind:'character'}),true);
  const s=await make({skillId:24008}),a=s.actor('rf'),b=s.actor('target');press(s,'A');frames(s,100);
  assert.ok(a.sourceArcEnemy.data.length>0);const handles=a.sourceArcEnemy.data.map(d=>d.handle);
  s.drainEvents();s.acceptedSkillHit(a,b,{ATTACK_TYPE:1},{kind:'effect',skillId:24204});
  s.acceptedSkillHit(a,b,{ATTACK_TYPE:2},{kind:'core',skillId:24204});
  assert.deepEqual(a.sourceArcEnemy.data.map(d=>d.handle),handles);assert.equal(s.state.events.some(e=>e.type==='originalSkillEffectRelease'),false);
  s.acceptedSkillHit(a,b,{ATTACK_TYPE:2},{kind:'character',skillId:24204,impactPoint:[b.x,b.y,b.z]});
  assert.equal(a.sourceArcEnemy.data.length,handles.length-1,'eligible ordinary active still releases one stored spear');
});

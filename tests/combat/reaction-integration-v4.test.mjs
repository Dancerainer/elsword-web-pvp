import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'explicit-reaction-fixture',lines:[{lineId:0,start:[-2000,0,0],end:[2000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const make=()=>createSimulation({profile,map,actors:[{id:'attacker',team:0,x:0,y:0},{id:'victim',team:1,x:200,y:0,facing:-1}]});
const hit=(s,extra={})=>s.injectHit({attackerId:'attacker',targetId:'victim',damageData:{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.01},REACT_TYPE:1,FORCE_DOWN:20,BACK_SPEED_X:100,...extra}});
const steps=(s,n,input={})=>{for(let i=0;i<n;i++)s.step(1/60,input);};

test('integrated KD reserves maximum, commits after reactions, and the next hit triggers the prior threshold',()=>{
  const s=make(),a=s.actor('attacker'),b=s.actor('victim');a.knockdown.now=80;b.knockdown.now=80;
  hit(s);hit(s);assert.equal(a.knockdown.now,0);assert.equal(b.knockdown.now,80);
  assert.equal(b.state,'RSI_DAMAGE_SMALL_FRONT');s.step(1/60);assert.equal(b.knockdown.now,100);
  hit(s);assert.equal(b.state,'RSI_DAMAGE_DOWN_FRONT');assert.equal(b.knockdown.now,100);assert.equal(b.knockdown.activated,true);
  s.step(1/60);assert.equal(b.knockdown.now,20);
  assert.equal(s.state.events.filter(e=>e.type==='knockdownTriggered').length,1);
});
test('explicit down reset and superarmor damage preserve sourced gauge behavior without invented hit reactions',()=>{
  const s=make(),b=s.actor('victim');b.knockdown.now=70;hit(s,{REACT_TYPE:3});assert.equal(b.knockdown.now,0);
  s.step(1/60);assert.equal(b.knockdown.now,20);
  s.enter(b,'RSI_WAIT','fixture');b.superArmor=true;const before=b.hp;
  hit(s);assert.ok(b.hp<before);assert.equal(b.state,'RSI_WAIT');s.step(1/60);assert.equal(b.knockdown.now,40);
});
test('native UP/FLY clears floor support before existing full KD selects AirDownInvincible',()=>{
  const s=make(),b=s.actor('victim');b.knockdown.now=100;
  hit(s,{REACT_TYPE:5,BACK_SPEED_Y:1000});
  assert.equal(b.state,'RSI_DAMAGE_AIR_DOWN_INVINCIBLE');assert.equal(b.grounded,false);assert.equal(b.lineId,null);assert.equal(b.vy,0);
});
test('guard reserves KD, dummy and superarmor still flush prior full KD, non-damaging types never reserve',()=>{
  const s=make(),b=s.actor('victim');b.awakening.remaining=10;b.core.gauge=40;s.updateCoreLevel(b);b.core.phase='idle';
  assert.equal(hit(s).guarded,true);s.step(1/60);assert.equal(b.knockdown.now,20);
  for(const react of [0,6,10,11,14,17]){const t=make();hit(t,{REACT_TYPE:react});t.step(1/60);assert.equal(t.actor('victim').knockdown.now,0);}
  for(const armor of [false,true]){const t=make(),v=t.actor('victim');v.knockdown.now=100;v.superArmor=armor;
    hit(t,{REACT_TYPE:armor?1:7});assert.equal(v.state,'RSI_DAMAGE_DOWN_FRONT');}
  const t=make(),v=t.actor('victim'),hp=v.hp;hit(t,{NO_DAMAGE:1});t.step(1/60);assert.equal(v.knockdown.now,0);assert.equal(v.hp,hp);
});
test('first guard reserves before parry entry resets the native pending latch',()=>{
  const s=make(),b=s.actor('victim');b.awakening.remaining=10;b.core.gauge=40;s.updateCoreLevel(b);b.core.phase='idle';
  // Fixed-V5 X2GUUser.cpp:8989 scales existing nowSpeed, independently of
  // the incoming damage's BACK_SPEED_X. Separate both values in the fixture.
  b.vx=100;hit(s,{FORCE_DOWN:20,BACK_SPEED_X:900});assert.equal(b.knockdown.addedThisState,false);assert.equal(b.vx,70,'guard multiplies current velocity100 by.7, not damage back900');
  hit(s,{FORCE_DOWN:10});assert.equal(b.knockdown.pending,10);s.step(1/60);assert.equal(b.knockdown.now,10);
});

test('no-damage hits do not consume the awakened core or enter native parry',()=>{
  const s=make(),b=s.actor('victim');b.awakening.remaining=10;b.core.gauge=40;s.updateCoreLevel(b);b.core.phase='idle';
  const hp=b.hp;assert.equal(hit(s,{NO_DAMAGE:1}).guarded,false);
  assert.equal(b.hp,hp);assert.equal(b.core.gauge,40);assert.equal(b.core.guardRemaining,0);
  assert.notEqual(b.state,'RSI_PARRYING');
  assert.equal(s.canGuard(b,s.actor('attacker'),{REACT_TYPE:1,HP_PERCENT_UP:1}),false);
});
test('effects after unit processing reserve KD until the next victim update',()=>{
  const s=make(),b=s.actor('victim');
  // Isolate the native phase order with an explicit damage-effect fixture.
  let fired=false;s.tickEffects=()=>{if(!fired){hit(s);fired=true;}};
  s.step(1/60);assert.equal(b.knockdown.now,0);assert.equal(b.knockdown.pending,20);
  s.step(1/60);assert.equal(b.knockdown.now,20);assert.equal(b.knockdown.pending,null);
});
test('native pass remains independent from final vertical/depth overlap and rejects diagonal crossing',()=>{
  const s=make(),a=s.actor('attacker'),b=s.actor('victim');b.x=0;b.z=0;
  a.x=100;a.y=0;a.z=100;s.blockUnits(a,-100,0,-100);assert.equal(a.x,-100);assert.equal(a.z,-100);
});
test('fatal launch keeps physics running, lands into original death and never enters ordinary standup',()=>{
  const s=make(),b=s.actor('victim');b.hp=1;hit(s,{DAMAGE:{PHYSIC:1},REACT_TYPE:5,BACK_SPEED_Y:1200});
  assert.equal(b.hp,0);assert.equal(b.state,'RSI_DAMAGE_AIR_FLY_FRONT');assert.equal(b.grounded,false);
  for(let i=0;i<120&&!b.grounded;i++)s.step(1/60,{actorId:'victim',pressed:['UP','A']});
  assert.equal(b.grounded,true);assert.equal(b.state,'RSI_DIE_FRONT');assert.equal(b.animationSpeedOverride,.5);
  assert.equal(b.core.phase,'absent');assert.equal(b.hidden,false);assert.equal(b.deathAlpha,1);
  assert.equal(s.state.events.some(e=>e.type==='stateChanged'&&e.state==='RSI_DAMAGE_STANDUP_FRONT'),false);
  steps(s,400);assert.equal(b.deathComplete,true);assert.equal(b.hidden,true);assert.equal(b.deathAlpha,0);
});
test('death front/back uses half-speed independent of attack-speed items and preserves pre-fade snapshots',()=>{
  for(const facing of [-1,1]){
    const s=make(),b=s.actor('victim');b.facing=facing;b.hp=1;b.stats.animationSpeedMultiplier=2;
    hit(s,{DAMAGE:{PHYSIC:1}});assert.equal(b.state,facing<0?'RSI_DIE_FRONT':'RSI_DIE_BACK');
    assert.equal(b.animationTargetSpeed,.5);assert.equal(b.animationTime,0);
    steps(s,30);assert.ok(b.animationTime<=.25);assert.equal(b.deathAlpha,1);
    const restored=make();restored.restore(JSON.parse(JSON.stringify(s.snapshot())));
    for(let i=0;i<90;i++){s.step(1/60);restored.step(1/60);assert.deepEqual(JSON.parse(JSON.stringify(s.snapshot())),JSON.parse(JSON.stringify(restored.snapshot())));}
  }
});

test('a corpse displaced off a platform keeps its death animation when landing below',()=>{
  const s=createSimulation({profile,map:{sceneId:'death-floor-fixture',lines:[
    {lineId:0,start:[-2000,0,0],end:[2000,0,0],type:'LINE_TYPE.LT_NORMAL'},
    {lineId:1,start:[-20,200,0],end:[20,200,0],type:'LINE_TYPE.LT_NORMAL'}]},
    actors:[{id:'attacker',team:0,x:-200,y:200},{id:'victim',team:1,x:0,y:200,lineId:1,facing:-1}]});
  const b=s.actor('victim');b.hp=1;hit(s,{DAMAGE:{PHYSIC:1},BACK_SPEED_X:1500});
  steps(s,40);assert.equal(b.grounded,true);assert.equal(b.y,0);assert.equal(b.state,'RSI_DIE_FRONT');
  assert.equal(s.state.events.filter(e=>e.type==='stateChanged'&&e.state==='RSI_DIE_FRONT').length,1);
  assert.ok(b.animationTime>.2);
});

test('original death states ignore spring platforms and complete their fade',()=>{
  const s=createSimulation({profile,map:{sceneId:'death-spring-fixture',lines:[
    {lineId:0,start:[-2000,0,0],end:[2000,0,0],type:'LINE_TYPE.LT_JUMP_UP_REL',nativeFields:{JUMP_SPEED_X:100,JUMP_SPEED_Y:1500}}]},
    actors:[{id:'attacker',team:0,x:-200,y:0},{id:'victim',team:1,x:0,y:0,facing:-1}]});
  const b=s.actor('victim');b.hp=1;hit(s,{DAMAGE:{PHYSIC:1}});steps(s,400);
  assert.equal(b.state,'RSI_DIE_FRONT');assert.equal(b.pendingPlatformJump,null);assert.equal(b.deathComplete,true);
  assert.equal(s.state.events.some(e=>e.actorId==='victim'&&e.type==='jumpPlatformLaunched'),false);
});
test('late down Z waits for down end and enters original StandupAttack, ordinary rise grants temporary .3s protection',()=>{
  const s=make(),b=s.actor('victim');s.enter(b,'RSI_DAMAGE_DOWN_BACK','fixture');b.animationTime=.67;
  s.step(1/60,{actorId:'victim',pressed:['Z']});assert.equal(b.state,'RSI_DAMAGE_DOWN_BACK');
  b.animationTime=profile.states[b.state].clip.durationSeconds;s.step(1/60);assert.equal(b.state,'RSI_STANDUP_ATTACK_BACK');
  s.enter(b,'RSI_DAMAGE_STANDUP_BACK','fixture');b.animationTime=profile.states[b.state].clip.durationSeconds;s.step(1/60);
  assert.equal(b.state,'RSI_WAIT');assert.equal(b.forceInvincible,.3);assert.equal(b.invincible,true);
  steps(s,20);assert.equal(b.forceInvincible,0);assert.equal(b.invincible,false);
});
test('UP changes to FALL at the source negative-velocity boundary and lands through AirDownLanding',()=>{
  const s=make(),b=s.actor('victim');hit(s,{REACT_TYPE:4,BACK_SPEED_Y:900});assert.equal(b.state,'RSI_DAMAGE_AIR_UP');
  let seenFall=false,seenLanding=false;
  for(let i=0;i<70;i++){s.step(1/60);seenFall||=b.state==='RSI_DAMAGE_AIR_FALL';seenLanding||=b.state==='RSI_DAMAGE_AIR_DOWN_LANDING';}
  assert.equal(seenFall,true);assert.equal(seenLanding,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeCommands} from '../../packages/native-source/commands.mjs';
import {airSmallStartFuture,groundHitReactionNext} from '../../packages/combat-core/reaction-policy.mjs';
const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url)));
const profile=read('packages/combat-core/rf-profile.json');
const map={sceneId:'independent-source-reaction-v7',lines:[
  {lineId:0,start:[-2000,0,0],end:[2000,0,0],type:'LT_NORMAL'},
  {lineId:1,start:[-2000,590,500],end:[2000,590,500],type:'LT_NORMAL'},
  {lineId:2,start:[-2000,595,0],end:[2000,595,0],type:'LT_WALL'},
  {lineId:3,start:[-2000,598,0],end:[2000,598,0],type:'LT_NORMAL',nativeFields:{ENABLE:false}}]};
const commands=()=>createNativeCommands({bytes:readFileSync(new URL('../../artifacts/native/commands.wasm',import.meta.url))});
const make=async native=>createSimulation({profile,map,nativeCommands:native?await commands():null,
  actors:[{id:'rf',team:0,x:0,y:0,facing:1},{id:'target',team:1,x:300,y:0,facing:-1,
    attributes:{moveSpeedMultiplier:1.3}}]});
const data={DAMAGE:{PHYSIC:.01},REACT_TYPE:1,BACK_SPEED_X:725,BACK_SPEED_Y:200};

test('original AirSmall entry runs independently of DamageReact, using source 700/.33 and saved attacker side',async()=>{
  const c=await commands();
  for(const front of [true,false]){
    const a={state:'RSI_DAMAGE_AIR_SMALL',animationTime:0,vx:100,vy:-500,passiveSpeed:{x:-1,y:-1},
      facing:1,y:600,grounded:false,landPosition:[0,0,0],lastAttackerFront:front,stats:{moveSpeedMultiplier:1.3}};
    const r=c.runStart(a,profile),fallback=airSmallStartFuture({localVx:100,vy:-500,fromFront:front,walkSpeed:650});
    assert.equal(r.handled,true);assert.equal(r.boundaryCalls.start,1);assert.equal(r.boundaryCalls.event,0);
    const decrease=Math.fround(Math.fround(650)*Math.fround(.33));
    assert.equal(r.vy,200);assert.equal(r.vx,Math.fround(100+(front?-1:1)*decrease));assert.equal(r.vx,fallback.localVx);assert.equal(r.vy,fallback.vy);
  }
});
test('source Small/Big leave-support branch is strict >200 and lowers 1.5*LINE_RADIUS',async()=>{
  const c=await commands();
  for(const state of ['RSI_DAMAGE_SMALL_FRONT','RSI_DAMAGE_SMALL_BACK','RSI_DAMAGE_BIG_FRONT','RSI_DAMAGE_BIG_BACK']){
    const a={state,animationTime:.1,vx:0,vy:0,passiveSpeed:{x:-1,y:-1},facing:1,y:500,
      grounded:false,landPosition:[0,300,0],stats:{moveSpeedMultiplier:1}};
    assert.equal(c.runEvent(a,{},profile).state,null);
    const r=c.runEvent({...a,y:501},{},profile);
    assert.equal(r.state,'RSI_DAMAGE_AIR_SMALL');assert.equal(r.y,456);assert.equal(r.boundaryCalls.event,1);
    assert.deepEqual(groundHitReactionNext(state,{heightAboveLand:201,grounded:false}),{state:r.state,offsetY:-45});
    assert.equal(c.runEvent({...a,animationStopped:true},{},profile).state,'RSI_DAMAGE_AIR_SMALL');
    assert.equal(c.runEvent({...a,grounded:true,animationStopped:true},{},profile).state,'RSI_WAIT');
  }
});
test('BigFront original key skip only resolves after .93; elevated leave-support branch retains priority',async()=>{
  const c=await commands(),a={state:'RSI_DAMAGE_BIG_FRONT',animationTime:.93,vx:0,vy:0,passiveSpeed:{x:-1,y:-1},
    facing:1,y:0,grounded:true,landPosition:[0,0,0],stats:{moveSpeedMultiplier:1}};
  assert.equal(c.runEvent(a,{held:['Z']},profile).state,null);
  for(const key of ['Z','RIGHT','DOWN','Q','F'])assert.equal(c.runEvent({...a,animationTime:.931},{held:[key]},profile).state,'RSI_WAIT');
  assert.equal(c.runEvent({...a,y:201},{held:['Z']},profile).state,'RSI_DAMAGE_AIR_SMALL');
});
test('remembered land position, not a remote/disabled/wall line sharing X, chooses the received clip',async()=>{
  for(const native of [false,true]){
    const s=await make(native),b=s.actor('target');b.y=600;b.grounded=false;b.lineId=null;
    assert.deepEqual(b.landPosition,[300,0,0]);
    s.injectHit({attackerId:'rf',targetId:'target',damageData:data});
    assert.equal(b.state,'RSI_DAMAGE_AIR_SMALL');assert.equal(b.vy,900);
    assert.equal(b.vx,939.5,'725 plus 650*.33 after native local-to-world conversion');
  }
});
test('new Small to AirSmall event runs its start once, then one-play pose remains until actual ground',async()=>{
  for(const native of [false,true]){
    const s=await make(native),b=s.actor('target');b.y=500;b.grounded=false;b.lineId=null;b.vy=-100;
    s.enter(b,'RSI_DAMAGE_SMALL_FRONT','independent-source-fixture');
    s.step(.01,{}, {snapshot:false});
    assert.equal(b.state,'RSI_DAMAGE_AIR_SMALL');assert.equal(b.vy,560);
    const before=b.vy;s.step(.01,{}, {snapshot:false});assert.equal(b.vy,before-40);
    assert.equal(s.state.events.filter(e=>e.type==='stateChanged'&&e.actorId==='target'&&e.state==='RSI_DAMAGE_AIR_SMALL').length,1);
    for(let i=0;i<200&&!b.grounded;i++)s.step(.01,{}, {snapshot:false});
    assert.equal(b.y,0);assert.equal(b.state,'RSI_JUMP_LANDING');
  }
});
test('true low-height X and Z pickup uses original reaction types; an airborne X is never forced onto ground',async()=>{
  for(const native of [false,true]){
    const s=await make(native),a=s.actor('rf'),b=s.actor('target');
    s.injectHit({attackerId:'rf',targetId:'target',damageData:profile.states.RSI_JUMP_COMBO_X.raw.DAMAGE_DATA});
    assert.equal(b.state,'RSI_DAMAGE_DOWN_FRONT');
    b.forceInvincible=0;b.invincible=false;b.y=20;b.grounded=false;b.lineId=null;
    s.injectHit({attackerId:'rf',targetId:'target',damageData:profile.states.RSI_JUMP_COMBO_X.raw.DAMAGE_DATA});
    assert.equal(b.state,'RSI_DAMAGE_AIR_DOWN');assert.equal(b.grounded,false);assert.equal(b.vy,0);
    s.injectHit({attackerId:'rf',targetId:'target',damageData:profile.damageEffects.DamageEffect_RF_COMBO_Z.raw.DAMAGE_DATA});
    assert.equal(b.state,'RSI_DAMAGE_SMALL_FRONT');assert.equal(b.grounded,false);assert.equal(b.vy,0);
  }
});
test('native reaction plus land cache survives complete JSON restore and continues identically',async()=>{
  const a=await make(true),b=await make(true),target=a.actor('target');target.y=600;target.grounded=false;target.lineId=null;
  a.injectHit({attackerId:'rf',targetId:'target',damageData:data});a.drainEvents();b.restore(JSON.parse(JSON.stringify(a.snapshot())));
  for(let i=0;i<120;i++){a.step(.01);b.step(.01);a.drainEvents();b.drainEvents();
    assert.deepEqual(JSON.parse(JSON.stringify(a.snapshot())),JSON.parse(JSON.stringify(b.snapshot())));}
});

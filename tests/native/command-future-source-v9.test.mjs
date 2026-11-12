import {historicalRfPreset} from '../helpers/rf-historical-preset-v20.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNativeCommands} from '../../packages/native-source/commands.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const profile=read('packages/combat-core/rf-profile.json'),preset=historicalRfPreset(read('config/rf-preset.json'));
const c=await createNativeCommands({bytes:readFileSync(new URL('../../artifacts/native/commands.wasm',import.meta.url))});
const actor=(state,extra={})=>({state,animationTime:0,animationBeforeTime:0,animationOneshotTimer:0,
  sourceCommandFlags:0,vx:700,vy:-500,passiveSpeed:{x:1250,y:-1},facing:1,grounded:false,y:1000,
  stats:{moveSpeedMultiplier:1},mp:300,...extra});
// Literal branches and equations below are from the independently hash-pinned
// unchanged C++ methods. They are reference-source checks, never 2016 gold.
test('668X executes original .21/.26/.29/.7 Future speed branches',()=>{
  for(const [time,vy] of [[.21,-500],[.22,0],[.26,1200],[.28,1200],[.29,0],[.699,0],[.7,-500]]){
    const result=c.runFuture(actor('RRF_DASH_JUMP_COMBO_X',{animationTime:time}),{},profile,.01);
    assert.equal(result.handled,true);assert.equal(result.vy,vy);assert.equal(result.boundaryCalls.future,1);
  }
});
test('668X original Now .26 one-shot pays exactly10 MP, emits target set, disables camera; MP failure emits no damage',()=>{
  for(const [mp,spawned,nextMp,fail] of [[300,1,290,0],[10,1,0,0],[9,0,9,1]]){
    const result=c.runNow(actor('RRF_DASH_JUMP_COMBO_X',{mp,animationBeforeTime:.25,animationTime:.26}),profile);
    assert.equal(result.effectSetCalls,spawned);assert.equal(result.mp,nextMp);assert.equal(result.magicFailCalls,fail);
    assert.equal(result.disabledCameraCalls,spawned);
    const consumed=c.runNow(actor('RRF_DASH_JUMP_COMBO_X',{mp,animationBeforeTime:.26,animationTime:.27,animationOneshotTimer:.26}),profile);
    assert.equal(consumed.effectSetCalls,0);assert.equal(consumed.mp,mp);
  }
});
test('668X press is latched before .39; XX stops negative vertical speed through .54 then lands',()=>{
  let result=c.runEvent(actor('RRF_DASH_JUMP_COMBO_X',{animationTime:.2}),{pressed:['X']},profile);
  assert.equal(result.flags,1);assert.equal(result.state,null);
  result=c.runEvent(actor('RRF_DASH_JUMP_COMBO_X',{animationTime:.39,sourceCommandFlags:result.flags}),{},profile);
  assert.equal(result.state,'RRF_DASH_JUMP_COMBO_XX');
  for(const [time,vy] of [[.54,0],[.55,-500]])assert.equal(c.runFuture(actor('RRF_DASH_JUMP_COMBO_XX',{animationTime:time}),{},profile,.01).vy,vy);
  assert.equal(c.runEvent(actor('RRF_DASH_JUMP_COMBO_XX',{grounded:true}),{},profile).state,'RRF_DASH_JUMP_COMBO_XX_LANDING');
});
test('ZZ6XX exact velocity gates and End cleanup execute unchanged source',()=>{
  for(const [time,vx,passive] of [[.26,0,1250],[.27,700,1250],[.32,700,1250],[.33,0,0],[.6,0,0]]){
    const result=c.runFuture(actor('RRF_COMBO_ZZXFRONTX',{animationTime:time}),{},profile,.01);
    assert.equal(result.vx,vx);assert.equal(result.passiveSpeed.x,passive);
  }
  const result=c.runEnd(actor('RRF_COMBO_ZZXFRONTX'),profile);assert.equal(result.vx,0);assert.equal(result.passiveSpeed.x,0);
});
const floor={sceneId:'source-phase-fixture',lines:[{lineId:0,start:[-5000,0,0],end:[5000,0,0],type:'LT_NORMAL',nativeFields:{CAN_DOWN:false}}]};
const sim=()=>createSimulation({profile,preset,map:floor,nativeCommands:c,actors:[{id:'rf',team:0,x:0,y:0,lineId:0}]});
const step=(s,input={})=>s.step(.01,input,{snapshot:false});
test('the next successful 668X stops the previous original effect set handle including retired visual children',()=>{
  const s=sim(),a=s.actor('rf');
  function shoot(){a.grounded=false;a.y=1000;s.enter(a,'RRF_DASH_JUMP_COMBO_X','source-fixture');
    a.animationBeforeTime=.25;a.animationTime=.26;a.animationOneshotTimer=0;step(s);}
  shoot();const first=structuredClone(a.sourceDashJumpEffectGroup);assert.equal(first.length,3);assert.equal(a.mp,290);
  shoot();assert.equal(a.mp,280);
  const stopped=s.state.events.filter(e=>e.type==='effectEnded'&&e.reason==='original-stop-effect-set');
  assert.deepEqual(stopped.map(e=>e.effectId),first.map(e=>e.id));
  assert.ok(a.sourceDashJumpEffectGroup.every(e=>!first.some(old=>old.id===e.id)));
});
test('ordinary launch and JumpReady command are post-physics, with a single state transition',()=>{
  const s=sim(),a=s.actor('rf');step(s,{held:['UP']});assert.equal(a.y,30);assert.equal(a.vy,1657.5);
  a.y=0;a.grounded=true;a.lineId=0;s.enter(a,'RSI_JUMP_READY','source-fixture');const serial=a.stateSerial;
  step(s,{pressed:['Z']});assert.equal(a.state,'RSI_JUMP_COMBO_Z');assert.equal(a.stateSerial,serial+1);assert.equal(a.y,30);assert.equal(a.vy,1657.5);
});
test('DashJump Down is an independent post-attack modifier; reverse chooses Up before forced downward speed',()=>{
  for(const input of [{pressed:['Z','DOWN']},{pressed:['DOWN'],held:['LEFT']}]){
    const s=sim(),a=s.actor('rf');a.y=1000;a.grounded=false;a.lineId=null;s.enter(a,'RSI_DASH_JUMP','source-fixture');a.vy=2431;
    step(s,input);assert.equal(a.state,input.pressed.includes('Z')?'RSI_DASH_JUMP_COMBO_Z':'RSI_JUMP_UP');assert.equal(a.vy,-2000);assert.equal(a.downForce,true);
  }
});
test('speed vector consumes current pre-controller time and native Future passive zero remains zero',()=>{
  const s=sim(),a=s.actor('rf');s.enter(a,'RRF_COMBO_ZZXFRONTX','source-fixture');a.animationTime=.34;
  for(let i=0;i<30;i++)step(s);
  assert.equal(a.vx,0);assert.equal(a.passiveSpeed.x,0);
  const z=sim(),b=z.actor('rf');z.enter(b,'RSI_COMBO_ZZ','source-fixture');
  const field=Object.keys(profile.states[b.state].raw).find(k=>k.startsWith('SPEED_TIME'));
  if(field){const at=profile.states[b.state].raw[field]['3'];b.animationTime=at-.001;b.animationSpeedRamp=null;
    step(z);assert.equal(b.fired.includes(field),false);step(z);assert.equal(b.fired.includes(field),true);}
});

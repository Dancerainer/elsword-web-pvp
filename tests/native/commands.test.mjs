import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import {createNativeCommands} from '../../packages/native-source/commands.mjs';
import {createNativeGeometry} from '../../packages/native-source/geometry.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url),'utf8'));
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
// This suite compares native callback equations at neutral 1x speed. Configured
// 30% behavior is a separate fixture and does not change these source inputs.
preset.attributes={...preset.attributes,animationSpeedMultiplier:1,moveSpeedMultiplier:1,jumpSpeedMultiplier:1};
const commandPath=process.env.RF_NATIVE_COMMANDS_WASM??new URL('../../artifacts/native/commands/commands.wasm',import.meta.url);
const geometryPath=process.env.RF_NATIVE_GEOMETRY_WASM??new URL('../../artifacts/native/geometry/geometry.wasm',import.meta.url);
const mapPath=new URL('../../artifacts/scene/sander-garpai-rock-pvp/collision.json',import.meta.url);
const missing=!existsSync(commandPath)||!existsSync(geometryPath);
const nativeTest=(name,fn)=>test(name,{skip:missing?'Build original command and geometry WASM first':false},fn);
const near=(a,b,eps=1e-4)=>assert.ok(Math.abs(a-b)<=eps,`${a} vs ${b}`);
const floor={sceneId:'original-callback-fixture',lines:[{lineId:0,start:[-5000,0,0],end:[5000,0,0],type:'LT_NORMAL',nativeFields:{CAN_DOWN:false}}]};
const commands=()=>createNativeCommands({bytes:readFileSync(commandPath)});
const sourceActor=(state,extra={})=>({state,animationTime:0,animationBeforeTime:0,animationOneshotTimer:0,animationStopped:false,
  sourceCommandFlags:0,vx:700,vy:0,passiveSpeed:{x:-1,y:-1},facing:1,grounded:false,y:800,canNotJumpTime:0,stats:{moveSpeedMultiplier:1},...extra});
const step=(s,input={},dt=.01)=>s.step(dt,input,{snapshot:false});
const advance=(s,n,input={})=>{for(let i=0;i<n;i++)step(s,input);};
const dash=s=>{step(s,{pressed:['RIGHT'],held:['RIGHT']});step(s,{released:['RIGHT']});step(s,{pressed:['RIGHT'],held:['RIGHT']});assert.equal(s.actor('rf').state,'RSI_DASH');};
async function make({map=floor,...extra}={}){
  const c=await commands(),g=await createNativeGeometry({bytes:readFileSync(geometryPath),map}),calls=[];
  const observed={...c};
  for(const method of ['runFuture','runEvent','runStart'])observed[method]=(...args)=>{
    const result=c[method](...args);calls.push({method,state:args[0].state,result});return result;
  };
  return {s:createSimulation({profile,preset,map,nativeCommands:observed,nativeGeometry:g,
    actors:[{id:'rf',team:0,x:-650,y:0,z:0,lineId:0,facing:1}],...extra}),calls,c,g};
}
function garpai(t){
  if(!existsSync(mapPath)){t.skip('Original 2016 converted Garpai map required');return null;}
  const map=JSON.parse(readFileSync(mapPath,'utf8'));
  assert.equal(map.source.sha256,'dc51d7927c168a57e6220796b6c73cc90104abdcb39723c9c4d24b7dd7c57d8a');return map;
}
// These expected branches and constants come from unchanged C++ method bodies;
// they are not recorded native2016 traces and do not prove the host orchestration.
nativeTest('Future callbacks read the preceding interval; .267 is strict before/inclusive now and oneshot',async()=>{
  const c=await commands();
  for(const [before,now,oneshot,fire] of [[.25,.266,0,false],[.266,.267,0,true],[.267,.28,0,false],[.26,.28,.267,false]]){
    const a=sourceActor('RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX',{animationBeforeTime:before,animationTime:now,animationOneshotTimer:oneshot});
    const r=c.runFuture(a,{},profile,.01);assert.equal(r.handled,true);assert.equal(r.boundaryCalls.future,1);
    assert.equal(r.passiveSpeed.x,fire?2200:-1);assert.equal(r.passiveSpeed.y,fire?-2640:-1);
    assert.equal(r.animationBeforeTime,Math.fround(now));assert.equal(r.animationOneshotTimer,Math.fround(Math.max(now,oneshot)));
  }
});
nativeTest('RF dash Z latches separate flags, same-frame Z priority and strict .2 branch',async()=>{
  const c=await commands(),a=sourceActor('RSI_DASH_JUMP_COMBO_Z',{animationTime:.2});
  let r=c.runEvent(a,{pressed:['Z','X']},profile);assert.equal(r.flags,1);assert.equal(r.state,null);
  r=c.runEvent({...a,sourceCommandFlags:r.flags,animationTime:.201},{pressed:['X']},profile);
  assert.equal(r.flags,3);assert.equal(r.state,'RSI_DASH_JUMP_COMBO_ZZ');
  r=c.runEvent({...a,animationTime:.201},{pressed:['X']},profile);assert.equal(r.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX');
  r=c.runEvent({...a,grounded:true,animationTime:.201},{pressed:['X']},profile);assert.equal(r.state,'RSI_DASH_JUMP_LANDING');
});
nativeTest('source JumpX down adds gravity even with Up; JumpZ down requires Up absent',async()=>{
  const c=await commands();
  for(const [state,expectedVy,flag] of [['RSI_JUMP_COMBO_X',-40,1],['RSI_JUMP_COMBO_Z',0,0]]){
    const r=c.runFuture(sourceActor(state),{held:['UP','DOWN','RIGHT']},profile,.01);
    assert.equal(r.vy,expectedVy);assert.equal(r.flags,flag);assert.equal(r.vx,500);
    const landed=c.runEvent(sourceActor(state,{grounded:true,sourceCommandFlags:r.flags}),{},profile);
    assert.equal(landed.state,'RSI_JUMP_LANDING');assert.equal(landed.canNotJumpTime,flag?Math.fround(.2):0);
  }
});
nativeTest('V5 hardcoded landing X probe is retained separately from target2016 candidate window',async()=>{
  const c=await commands();
  for(const [time,next] of [[.1,null],[.101,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX'],[.299,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX'],[.3,null]]){
    const a=sourceActor('RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING',{grounded:true,animationTime:time});
    assert.equal(c.handlesEvent(a),false);assert.equal(c.probeLandingEvent(a,{pressed:['X'],held:['RIGHT']},profile).state,next);
  }
  assert.equal(profile.referenceSemantics.comboBuffers.RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING.after,.25);
  assert.equal(c.probeLandingEvent(sourceActor('RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING',{grounded:true,animationTime:.41}),{held:['RIGHT']},profile).state,'RSI_WALK');
});
nativeTest('original ZXX walk-off requests JumpDown and subtracts45; grounded animation-end requests Wait',async()=>{
  const c=await commands();
  let r=c.runEvent(sourceActor('RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX',{y:250}),{},profile);
  assert.equal(r.state,'RSI_JUMP_DOWN');assert.equal(r.y,205);assert.equal(r.boundaryCalls.event,1);
  r=c.runEvent(sourceActor('RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX',{grounded:true,animationStopped:true}),{},profile);
  assert.equal(r.state,'RSI_WAIT');
});
nativeTest('native Future dive runs one tick after animation crosses .267, and hitstop preserves its clock',async()=>{
  const {s,calls}=await make(),a=s.actor('rf');a.grounded=false;a.lineId=null;a.y=1000;
  s.enter(a,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX','source-fixture');
  for(let i=0;i<80&&a.animationTime<.267;i++)step(s);
  assert.equal(a.passiveSpeed.x,-1,'crossing tick does not execute the next Future callback early');
  const clock={time:a.animationTime,before:a.animationBeforeTime,oneshot:a.animationOneshotTimer};
  a.hitStop=.02;step(s);step(s);
  assert.deepEqual({time:a.animationTime,before:a.animationBeforeTime,oneshot:a.animationOneshotTimer},clock);
  step(s);assert.equal(a.passiveSpeed.x,2200);assert.equal(a.vx,2200);assert.equal(a.vy,-2640);
  assert.ok(calls.some(v=>v.method==='runFuture'&&v.result.boundaryCalls.future===1&&v.result.passiveSpeed.x===2200));
});
nativeTest('three full 662Z inputs still recapture actual Garpai upper platform through both native modules',async t=>{
  const map=garpai(t);if(!map)return;
  const {s,calls}=await make({map,actors:[{id:'rf',team:0,x:-650,y:3800,z:0,lineId:4,facing:1}]}),a=s.actor('rf');
  for(let repeat=0;repeat<3;repeat++){
    dash(s);step(s,{pressed:['DOWN'],held:['DOWN','RIGHT']});assert.equal(a.lastTouchLineId,2);
    step(s,{pressed:['Z'],held:['RIGHT']});assert.equal(a.state,'RSI_DASH_JUMP_COMBO_Z');assert.equal(a.sourceCommandFlags,0,'starting Z is not a second Z');
    for(let i=0;i<150&&!a.grounded;i++)step(s);
    assert.equal(a.state,'RSI_DASH_JUMP_LANDING');assert.equal(a.lineId,4);near(a.y,3800);
    advance(s,60);
  }
  assert.ok(calls.some(v=>v.state==='RSI_DASH_JUMP_COMBO_Z'&&v.result.state==='RSI_DASH_JUMP_LANDING'));
});
nativeTest('full 668ZXX held-forward chain preserves buffered third X through .15 movement cancel',async t=>{
  const map=garpai(t);if(!map)return;
  const {s,calls}=await make({map,actors:[{id:'rf',team:0,x:-650,y:3800,z:0,lineId:4,facing:1}]}),a=s.actor('rf');
  dash(s);step(s,{pressed:['UP'],held:['UP','RIGHT']});advance(s,5,{held:['RIGHT']});
  step(s,{pressed:['Z'],held:['RIGHT']});assert.equal(a.sourceCommandFlags,0);
  step(s,{pressed:['X'],held:['RIGHT']});
  for(let i=0;i<150&&a.state!=='RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING';i++)step(s,{held:['RIGHT']});
  assert.equal(a.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING');
  step(s,{pressed:['X'],held:['RIGHT']});
  for(let i=0;i<80&&a.state==='RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING';i++)step(s,{held:['RIGHT']});
  assert.equal(a.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX');
  assert.ok(calls.some(v=>v.result.state==='RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX'));
  assert.ok(a.unsupported.some(e=>e.id==='combo-binding:RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING'));
  assert.equal(profile.referenceSemantics.mechanicBindings.RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX.supported,false);
});
nativeTest('full ZZXX82XZ chain retains native down-X landing lock, allowing Z immediately',async t=>{
  const map=garpai(t);if(!map)return;
  const {s,calls}=await make({map,actors:[{id:'rf',team:0,x:-650,y:3800,z:0,lineId:4,facing:1}]}),a=s.actor('rf');
  step(s,{pressed:['Z']});step(s,{pressed:['Z']});
  for(let i=0;i<120&&a.state!=='RSI_COMBO_ZZ';i++)step(s);
  assert.equal(a.state,'RSI_COMBO_ZZ');step(s,{pressed:['X']});
  for(let i=0;i<120&&a.state!=='RSI_COMBO_ZZX';i++)step(s);
  assert.equal(a.state,'RSI_COMBO_ZZX');step(s,{pressed:['X']});
  for(let i=0;i<120&&a.state!=='RSI_COMBO_ZZXX';i++)step(s);
  assert.equal(a.state,'RSI_COMBO_ZZXX');
  while(a.animationTime<.6)step(s);
  step(s,{pressed:['UP'],held:['UP']});assert.equal(a.state,'RSI_JUMP_UP');
  step(s,{pressed:['DOWN'],held:['DOWN']});step(s,{pressed:['X'],held:['DOWN']});assert.equal(a.state,'RSI_JUMP_COMBO_X');
  let maximum=a.y;for(let i=0;i<120&&!a.grounded;i++){step(s,{held:['DOWN']});maximum=Math.max(maximum,a.y);}
  assert.equal(a.state,'RSI_JUMP_LANDING');assert.ok(maximum-3800<200);near(a.canNotJumpTime,.2);
  step(s,{pressed:['UP'],held:['UP']});assert.equal(a.state,'RSI_JUMP_LANDING');
  step(s,{pressed:['Z']});assert.equal(a.state,'RSI_COMBO_Z');
  assert.ok(calls.some(v=>v.state==='RSI_JUMP_COMBO_X'&&v.result.boundaryCalls.future===1&&v.result.flags===1));
});
nativeTest('complete JSON restores both native modules independently during buffered dash Z',async()=>{
  const first=await make(),a=first.s.actor('rf');dash(first.s);step(first.s,{pressed:['UP'],held:['UP','RIGHT']});advance(first.s,8);
  step(first.s,{pressed:['Z']});step(first.s,{pressed:['X']});a.hitStop=.017;
  const second=await make();assert.notEqual(first.c,second.c);assert.notEqual(first.g,second.g);
  second.s.restore(JSON.parse(JSON.stringify(first.s.snapshot())));first.s.drainEvents();second.s.drainEvents();
  for(let i=0;i<160;i++){
    const input=i===55?{pressed:['X'],held:['RIGHT']}:{held:['RIGHT']};
    step(first.s,input);step(second.s,input);first.s.drainEvents();second.s.drainEvents();
    assert.deepEqual(JSON.parse(JSON.stringify(first.s.snapshot())),JSON.parse(JSON.stringify(second.s.snapshot())));
  }
});
nativeTest('runtime verifies commands hash before execution and creates isolated command instances',async()=>{
  const manifestPath=new URL('../../artifacts/native/manifest.json',import.meta.url);
  if(!existsSync(manifestPath))return;
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  const options={manifest,map:floor,loadBinary:file=>readFileSync(new URL('../../artifacts/native/'+file,import.meta.url))};
  const first=await createNativeRuntime(options),second=await createNativeRuntime(options);
  assert.notEqual(first.commands,second.commands);assert.equal(first.versions.nativeCommands,manifest.modules.commands.sha256);
  await assert.rejects(createNativeRuntime({...options,loadBinary:file=>{
    const b=Buffer.from(options.loadBinary(file));if(file==='commands.wasm')b[b.length-1]^=1;return b;
  }}),/commands binary hash mismatch/);
  await assert.rejects(createNativeRuntime({...options,manifest:{...manifest,runtimeVersion:'original-source-functions-v1'}}),/Unsupported/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene} from '@babylonjs/core';
import {NativeTrailBuffer,unpackArgb,traceTiming,trailActive,trailTip,RF_TRAIL_REFERENCE,TARGET_TRACE_TYPES} from '../../packages/presentation/weapon-trails.mjs';
import {createRFWeaponTrails} from '../../apps/web/weapon-trails.mjs';
import {createEffectPresentationPolicy,DEFAULT_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {make} from '../helpers/rf-passive-fixture-v12.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const blue=unpackArgb(0xcc5555ff);

test('mixed quality restores an actual combo claw and keeps its original fading tail without sampling medium idle',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);let calls=0;
  const policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY),enabled=a=>policy.actor(a).level==='high'||a.skillId===24010;
  const manager=createRFWeaponTrails({scene,profile,sampleEndpoints(a,names){calls++;return Object.fromEntries(names.map((n,i)=>[n,[a.animationTime*100,i*100,0]]));}});
  const actor={id:'player1',state:'RSI_COMBO_X',animationTime:0,awakening:{remaining:0}};
  for(let i=0;i<8;i++){actor.animationTime=i/60;manager.step({actors:[actor],dt:1/60,clawEnabled:enabled});}
  assert.ok(manager.proof().channels.some(c=>c.key.includes(':claw:')&&c.visible));
  const sampled=calls;actor.state='RSI_WAIT';manager.step({actors:[actor],dt:.05,clawEnabled:enabled});
  assert.equal(calls,sampled);assert.ok(manager.proof().channels.some(c=>c.key.includes(':claw:')&&c.visible),'original strip does not vanish at the quality boundary');
  manager.step({actors:[actor],dt:.6,clawEnabled:enabled});assert.equal(manager.proof().channels.length,0);
  manager.dispose();scene.dispose();engine.dispose();
});

test('normal and awakened original XCrash input reaches its first legal claw window with actual skill identity',async t=>{
  const observations=[];
  for(const awakened of [false,true]){
    const simulation=await make({skillId:24010,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});
    if(awakened){simulation.state.actors[0].awakening.orbs=1;for(let i=0;i<120;i++)simulation.step(1/60,i===0?{pressed:['CTRL'],held:['CTRL']}:{},{snapshot:false});}
    const policy=createEffectPresentationPolicy(simulation.profile,DEFAULT_EFFECT_QUALITY),enabled=a=>policy.actor(a).level==='high'||a.skillId===24010;
    let windows=0,first=null,last=null;
    for(let i=0;i<240;i++){
      simulation.step(1/60,i===0?{pressed:['A'],held:['A']}:{},{snapshot:false});
      const actor=simulation.state.actors[0],timing=traceTiming(simulation.profile.states[actor.state]?.raw,'claw');
      if(trailActive(timing,actor.animationTime)&&timing.type===0){
        assert.equal(actor.skillId,24010);assert.equal(enabled(actor),true);assert.equal(policy.actor(actor).level,'medium','particle skill quality stays medium');
        assert.equal(actor.awakening.remaining>0,awakened);windows++;first??={state:actor.state,time:actor.animationTime,timing};last=actor.animationTime;
      }
    }
    assert.ok(windows>0,'normal input must execute actual source timing, not fabricated actor state');observations.push({awakened,windows,first,last});
  }
  t.diagnostic(JSON.stringify(observations));
});

test('medium keeps the major sword timing and suppresses the high-only claw without sampling or allocating it',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);let calls=0;
  const manager=createRFWeaponTrails({scene,profile,sampleEndpoints(a,names){calls++;return Object.fromEntries(names.map((n,i)=>[n,[a.animationTime*100,i*100,0]]));}});
  const actor={id:'player1',state:'RSI_COMBO_X',animationTime:0,awakening:{remaining:0}};
  manager.step({actors:[actor],dt:1/60,clawEnabled:false});assert.equal(calls,0);assert.equal(scene.meshes.length,0);assert.equal(manager.proof().unsupported.length,0);
  manager.step({actors:[actor],dt:1/60});assert.equal(scene.meshes.length,4);
  manager.step({actors:[actor],dt:1/60,clawEnabled:false});assert.equal(scene.meshes.length,0);
  actor.state='RSI_COMBO_Z';
  for(let n=0;n<8;n++){actor.animationTime=n/60;manager.step({actors:[actor],dt:1/60,clawEnabled:false});}
  assert.equal(scene.meshes.length,4);assert.ok(scene.meshes.some(m=>m.isEnabled()));
  assert.ok(manager.proof().channels.every(c=>c.key.includes(':sword:')));
  manager.dispose();scene.dispose();engine.dispose();
});

test('target RF declarations select weapon Z and unit claw X by animation interval',()=>{
  assert.deepEqual(traceTiming(profile.states.RSI_COMBO_Z.raw,'sword'),{start:0,end:100,type:0});
  assert.equal(traceTiming(profile.states.RSI_COMBO_Z.raw,'claw'),null);
  assert.deepEqual(traceTiming(profile.states.RSI_COMBO_X.raw,'claw'),{start:0,end:100,type:0});
  assert.equal(trailActive(traceTiming(profile.states.RSI_COMBO_X.raw,'claw'),100),false);
  assert.equal(trailActive(traceTiming(profile.states.RSI_A_RF_MEGADRILL_BREAK.raw,'sword'),.099),false);
  assert.equal(trailActive(traceTiming(profile.states.RSI_A_RF_MEGADRILL_BREAK.raw,'sword'),.1),true);
  assert.equal(traceTiming({UNIT_SLASH_TRACE0:{1:0,2:0,3:1,4:0,5:1}},'claw'),null);
  assert.equal(TARGET_TRACE_TYPES.NONE,4);
  assert.equal(traceTiming({UNIT_SLASH_TRACE0:{1:0,2:0,3:1}},'claw').type,4);
});
test('native strip colors and four-unit tip preserve source endpoint width',()=>{
  assert.deepEqual(blue,[85/255,85/255,1,204/255]);
  assert.deepEqual(trailTip([0,0,0],[0,0,100]),[0,0,4]);
  const b=new NativeTrailBuffer({curveType:2});
  b.add([0,0,0],[0,0,100],blue);b.add([10,0,0],[10,0,100],blue);
  const g=b.geometry();assert.deepEqual(g.positions.slice(0,6),[10,0,0,10,0,100]);
  assert.deepEqual(g.indices,[0,1,2,2,1,3]);assert.equal(g.colors[7],.08);
});
test('source alpha decreases by dt/DisableTime, not an arbitrary fade multiplier',()=>{
  const b=new NativeTrailBuffer({curveType:2,disableSeconds:.4});
  b.add([0,0,0],[0,1,0],blue);b.fade(.1);
  assert.ok(Math.abs(b.pairs[0].color[3]-.55)<1e-12);assert.equal(b.pairs[0].downColor[3],0);
  b.fade(.3);assert.equal(b.visible,false);
  const tip=new NativeTrailBuffer({disableSeconds:.5});tip.add([0,0,0],[0,1,0],unpackArgb(0xff5555ff));tip.fade(.4);
  assert.ok(Math.abs(tip.pairs[0].color[3]-.2)<1e-12);tip.fade(.1);assert.equal(tip.visible,false);
});
test('smooth source curve has a one-sample lag and 20-unit Catmull subdivision',()=>{
  const b=new NativeTrailBuffer();
  for(const x of [0,30,60,90])b.add([x,0,0],[x,10,0],blue);
  // Source CatmullRom([0,30,60,90], .5) = 45; t=1 is not emitted.
  assert.deepEqual(b.pairs[0].up,[45,0,0]);assert.deepEqual(b.pairs[1].up,[30,0,0]);
  assert.deepEqual(b.pairs[2].up,[13.125,0,0]);
  assert.ok(b.pairs.every(p=>p.down[1]===10));
});
test('fixed capacity, pause, source visibility gates and clear have real lifecycle effects',()=>{
  const b=new NativeTrailBuffer({vertexCount:4,curveType:2});
  for(let x=0;x<10;x++)b.step({dt:.01,up:[x,0,0],down:[x,10,0],color:blue});
  assert.equal(b.pairs.length,2);assert.deepEqual(b.pairs[0].up,[9,0,0]);
  const before=b.snapshot();b.step({dt:0,up:[999,0,0],down:[999,10,0],color:blue});assert.deepEqual(b.snapshot(),before);
  b.step({dt:1,emit:false,shown:false});assert.deepEqual(b.snapshot(),before);
  b.step({dt:1,emit:false});assert.equal(b.visible,false);
  b.clear();assert.equal(b.pairs.length,0);assert.equal(b.upHistory,null);
  assert.throws(()=>new NativeTrailBuffer({textured:true}),/not implemented/);
});
test('real target helper endpoints are recorded rather than generated from attack radius',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../fixtures/rf-weapon-trails-target.json',import.meta.url)));
  assert.equal(fixture.helpers.TRACE_START0.parent,'rrf');
  assert.equal(fixture.helpers.TRACE_END0.parent,'rrf');
  assert.equal(fixture.helpers.ATTACK_SPHERE1_Lhand1.parent,'Bip01_L_Hand');
  const b=new NativeTrailBuffer({curveType:2});
  b.add(fixture.helpers.TRACE_START0.translation,fixture.helpers.TRACE_END0.translation,blue);
  assert.equal(b.pairs[0].up[2],-89.75216674804688);
  assert.equal(b.pairs[0].down[2],34.95254135131836);
  assert.equal(RF_TRAIL_REFERENCE.claw.down,'Bip01_L_Hand');
});
test('Babylon strips use displayed endpoint callback, bounded meshes, pause and disposal',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);let calls=0;
  const manager=createRFWeaponTrails({scene,profile,sampleEndpoints(a,names){calls++;return Object.fromEntries(names.map((n,i)=>[n,[a.animationTime*100,i*100,0]]));}});
  const actor={id:'player1',state:'RSI_COMBO_X',animationTime:0,awakening:{remaining:0}};
  manager.step({actors:[actor],dt:0});assert.equal(calls,0);assert.equal(scene.meshes.length,0);
  for(let n=0;n<8;n++){actor.animationTime=n/60;manager.step({actors:[actor],dt:1/60});}
  assert.equal(scene.meshes.length,4);assert.ok(scene.meshes.some(m=>m.isEnabled()));
  assert.equal(manager.proof().channels.find(c=>c.key.endsWith(':tip')).drawCount,3);
  const proof=manager.proof();manager.step({actors:[actor],dt:0});assert.deepEqual(manager.proof(),proof);
  actor.hidden=true;manager.step({actors:[actor],dt:1/60});assert.equal(scene.meshes.filter(m=>m.isEnabled()).length,0);
  actor.hidden=false;actor.deathAlpha=0;manager.step({actors:[actor],dt:1/60});assert.equal(scene.meshes.filter(m=>m.isEnabled()).length,0);
  actor.deathAlpha=1;
  actor.state='RSI_WAIT';manager.step({actors:[actor],dt:.6});assert.equal(scene.meshes.filter(m=>m.isEnabled()).length,0);
  manager.clear();assert.equal(scene.meshes.length,0);assert.equal(manager.proof().channels.length,0);
  actor.state='RSI_COMBO_Z';manager.step({actors:[actor],dt:1/60});assert.equal(scene.meshes.length,4);
  manager.step({actors:[],dt:1/60});assert.equal(scene.meshes.length,0);
  manager.dispose();manager.dispose();assert.equal(scene.materials.length,0);
  assert.throws(()=>manager.step({actors:[],dt:0}),/disposed/);scene.dispose();engine.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NullEngine,Scene} from '@babylonjs/core';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';

const index=JSON.parse(readFileSync(new URL('../../contracts/rf-fx-index.json',import.meta.url)));
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const pins={
  'KTDX.h':'0097cffed97c4446e45fd586cc873290e6770a93e03b3bc7873383fb85d297cf',
  'stdafx.h':'faa636cea5336375368ca83be2d1616528e12a0241a24bee4c9e2a04f0aa1685',
  'KTDGParticleSystem.h':'2146e70e9ca5e7a3a2d653923a7e7e6a2e0562fc07fba6ca8309c2c2cfa7ab74',
  'KTDGParticleSystem.cpp':'43b5025740ed9c89a5f6f3617789abd68bcb18aaf8aaddef1b5ca9d3b9334050',
  'KTDGXMeshPlayer.cpp':'0a98af22b4f4b260dc9fe61d7866f8251ebf2c4a94d90032c8462e6b5831417d',
};
function source(name){const bytes=readFileSync(new URL('../../.cache/native-reference/KTDXLIB/'+name,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),pins[name]);return bytes.toString('latin1');}
const velocity=(time,value)=>({property:'Velocity',start:time,end:time,fade:false,value});
function fixture(events,fields={}){const name='literal-native-equation',t={name,kind:'particle',unsupported:[],repeated:{},
  fields:{Emitrate:0,NumParticles:1,Lifetime:10,TriggerCount:1,...fields},events};
  const runtime=createEffectRuntime({index:{templates:{[name]:t}}}),particle=runtime.emitParticle(name);return {runtime,particle};}

test('fixed V5 macro declarations and active accumulator/lifetime consumer bodies are independently pinned',()=>{
  const definitions=source('KTDX.h'),header=source('KTDGParticleSystem.h'),particle=source('KTDGParticleSystem.cpp'),mesh=source('KTDGXMeshPlayer.cpp');
  assert.match(particle,/^#include "StdAfx.h"/);assert.match(source('stdafx.h'),/#include "KTDX.h"/);
  const expected=new Set(['X2OPTIMIZE_PARTICLE_AND_ETC_SIMULATION','X2OPTIMIZE_PARTICLE_AND_ETC_SIMULATION_VELOCITY_ACCUM_BUG_FIX']);
  const branches=[];assert.match(definitions,/^#ifndef _KTDX_H_\r?\n#define _KTDX_H_/);
  for(const line of definitions.split('\n')){
    if(/^\s*#\s*if(?:def|ndef)?\b/.test(line))branches.push(line.trim());
    if(/^\s*#\s*endif\b/.test(line))branches.pop();
    const match=line.match(/^\s*#define\s+(\w+)/);if(match&&expected.has(match[1])){assert.deepEqual(branches,['#ifndef _KTDX_H_'],'only the confirmed header guard encloses selected macros');expected.delete(match[1]);}
  }
  assert.equal(expected.size,0);assert.doesNotMatch(definitions,/^\s*#undef\s+X2OPTIMIZE_PARTICLE_AND_ETC_SIMULATION/m);
  const frame=header.slice(header.indexOf('bool OnFrameMove( double fTime, float fElapsedTime )'),header.indexOf('void ClearTraceSeqList()'));
  assert.ok(frame.indexOf('m_fAge')<frame.indexOf('m_fAge >= m_fLifetime'));
  assert.match(frame,/m_vPos \+= m_vVelocityToAccumPos;\s*ResetVelocityToAccumPos\(\)/);
  assert.match(particle,/pParticle->m_vVelocityToAccumPos \+= \( 0\.5f \* fElapsedTime \* fElapsedTime \) \* vGravity/);
  assert.ok(particle.indexOf('pParticle->m_vVelocity += vGravity * fElapsedTime')<particle.indexOf('RunEvent( *pParticle )'));
  assert.match(particle,/part\.UpdateVelocityAccumPosAndEventTimer\( part\.GetEventTimer\(\) \)/);
  const fade=particle.slice(particle.indexOf('void CKTDGParticleSystem::CParticleEvent_Velocity::OnFrameMove'),particle.indexOf('bool CKTDGParticleSystem::CParticleEvent_Position::ProcessTokenStream'));
  assert.match(fade,/part\.SetVelocity\( part\.GetVelocity\(\) \+ remainVelocity \* \( fRatio \* 0\.5f \), false \)/);
  assert.match(fade,/part\.SetVelocity\( part\.GetVelocity\(\) \+ remainVelocity \* fRatio, false \)/);
  const lifetime=mesh.slice(mesh.indexOf('\t\tcase LT_TIME:'),mesh.indexOf('\t\tcase LT_MANUAL:'));
  assert.ok(lifetime.indexOf('m_NowLifeTime >= m_MaxLifeTime')<lifetime.indexOf('m_NowLifeTime += m_fElapsedTime'));
});

test('real RRF_DASHJUMP_X LT_TIME is alive after packet 42 and ends on old-time check at packet 43',()=>{
  const t=index.templates.RRF_DASHJUMP_X;assert.equal(t.fields.LifeType,'LT_TIME');assert.equal(t.fields.LifeTime,.7);assert.equal(t.fields.DrawCount,0);
  const r=createEffectRuntime({index}),e=r.add(t.name),p=r.particles.get([...e.particles][0]);
  for(let packet=0;packet<42;packet++)r.step(1/60,{});
  assert.equal(r.particles.has(p.id),true);assert.equal(p.age,0.699999988079071);assert.equal(p.nativeLifetime,Math.fround(.7));
  r.step(1/60,{});assert.equal(r.count,0);assert.equal(r.emitters.has(e.id),false);
  const normal=r.emitParticle('Flare_Raven_RFF_DashJumpAttackX1_Burst01');
  for(let packet=0;packet<12;packet++)r.step(1/60,{});
  assert.equal(r.particles.has(normal.id),false,'ordinary particle still increments age before its 0.2-second check');
});

test('production RRF damage parent keeps the same native LT_TIME boundary as its invisible mesh',async()=>{
  const t=index.templates.RRF_DASHJUMP_X,engine=new NullEngine(),scene=new Scene(engine);
  const fixtureProfile={...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
  const view=await createEffectsView({engine,scene,index:{...index,templates:{[t.name]:t}},profile:fixtureProfile,samplers:{}});
  try{const state={actors:[{id:1,hp:800000,facing:1,stateSerial:1,awakening:{remaining:0}}]},entry=profile.effectSets.EffectSet_RRF_DashJumpX.raw.EFFECT0;
    view.event({type:'effectStarted',effectId:99,actorId:1,name:entry.NAME,definition:entry,birthAnchor:{position:[0,0,0],facing:1}},state);
    for(let packet=0;packet<42;packet++)view.step(1/60,state);
    assert.equal(view.count,1);assert.equal(view.proof().activeEffectParents,1);
    view.step(1/60,state);assert.equal(view.count,0);assert.equal(view.proof().activeEffectParents,0);
  }finally{view.clear();scene.dispose();engine.dispose();}
});

test('literal velocity displacement consumes the previous prepared packet, including a delayed event inside a packet',()=>{
  const {runtime:r,particle:p}=fixture([velocity(0,[120,0,0]),velocity(.1875,[240,0,0])]);
  // Native interval areas: first packet empty; then 120*.125; then
  // 120*.0625 + 240*.0625; then 240*.125. Expected values are analytic.
  for(const expected of [0,15,37.5,67.5]){r.step(.125,{});assert.equal(p.position[0],expected);}
});

test('native fade retains both original velocity additions and the prepared midpoint packet',()=>{
  const {runtime:r,particle:p}=fixture([velocity(0,[1000,0,0]),{property:'Velocity',start:.125,end:.375,fade:true,value:[0,0,0]}]);
  // Original midpoint packets: 125; 750*.125=93.75; 125*.125=15.625.
  // Original post-fade velocity is 250 after ratio=.5; source final cap is 0.
  const expected=[[0,1000],[125,250],[218.75,0],[234.375,0]];
  for(const [position,speed] of expected){r.step(.125,{});assert.equal(p.position[0],position);assert.equal(p.velocity[0],speed);}
});

test('gravity prepares half-time-squared plus next velocity after movement; TRACE_MORE adds one independent world displacement',()=>{
  const {runtime:r,particle:p}=fixture([velocity(0,[0,0,0])],{Gravity:[0,64,0],Trace:true});
  const emitter=r.emitters.get(p.emitterId);emitter.options.anchor=s=>[s.x,0,0];emitter.options.traceMore=true;
  // After the empty birth packet, y=.5*g*((packet-1)*dt)^2. World anchor
  // movement is unrelated to that local acceleration and must not be doubled.
  for(const [packet,y] of [0,.5,2,4.5].entries()){r.step(.125,{x:(packet+1)*100});assert.equal(p.position[1],y);assert.equal(p.position[0],(packet+1)*100);}
});

test('real LimitCrusherAP05 initial -3000 velocity waits for its prepared native packet',()=>{
  const t=index.templates.LimitCrusherAP05;assert.deepEqual(t.events.find(e=>e.property==='Velocity').value,[-3000,0,0]);
  const r=createEffectRuntime({index}),p=r.emitParticle(t.name);r.step(.0625,{});assert.equal(p.position[0],0);
  r.step(.0625,{});assert.equal(p.position[0],-187.5);
});

test('velocity random values are sampled at actual activation, including source initial-event replay on the first packet',()=>{
  const calls=[],nativeRandom={randomFloat:(a,b)=>{calls.push([a,b]);return a;}};
  const t={name:'activation-source',kind:'particle',unsupported:[],repeated:{},fields:{Emitrate:0,NumParticles:1,Lifetime:2},
    events:[velocity(0,[{random:[10,20]},0,0]),velocity(.25,[{random:[100,200]},0,0])]};
  const r=createEffectRuntime({index:{templates:{[t.name]:t}},nativeRandom});r.emitParticle(t.name);
  assert.deepEqual(calls,[[10,20]]);r.step(.125,{});assert.deepEqual(calls,[[10,20],[10,20]]);
  r.step(.125,{});assert.deepEqual(calls,[[10,20],[10,20],[100,200]]);r.step(.125,{});assert.equal(calls.length,3);
});

test('malformed velocity vectors/times remain unsupported and do not replace a confirmed velocity with invented values',()=>{
  const {runtime:r,particle:p}=fixture([velocity(0,[100,0,0]),velocity(.125,[200,300]),velocity('unconfirmed',[0,0,0])]);
  r.step(.125,{});r.step(.125,{});assert.equal(p.position[0],12.5);assert.deepEqual(p.velocity,[100,0,0]);
  assert.ok(r.notes.has(p.name+':velocity-event'));assert.ok(r.notes.has(p.name+':velocity-time'));
  assert.ok([...p.position,...p.velocity,...p.velocityAccum].every(Number.isFinite));
});

test('TRACE_MORE translates an expiring particle before its FinalParticleList birth; ordinary Trace waits for successful movement',()=>{
  const child={name:'native-final-birth',kind:'particle',unsupported:[],repeated:{},fields:{Emitrate:0,NumParticles:1,Lifetime:1},events:[]};
  const parent={name:'native-expiry-position',kind:'particle',unsupported:[],repeated:{},
    fields:{Emitrate:0,NumParticles:1,Lifetime:.25,Trace:true,FinalParticleList:child.name},events:[]};
  for(const traceMore of [true,false]){
    const r=createEffectRuntime({index:{templates:{[parent.name]:parent,[child.name]:child}}}),p=r.emitParticle(parent.name,{anchor:s=>[s.x,0,0],traceMore});
    r.step(.125,{x:100});assert.equal(p.position[0],100);r.step(.125,{x:200});assert.equal(r.particles.has(p.id),false);
    const final=[...r.emitters.values()].find(e=>e.name===child.name);assert.ok(final);
    assert.equal(final.position[0],traceMore?200:100,'native direct SetPosition happens before age test; template Trace happens after it');
  }
});

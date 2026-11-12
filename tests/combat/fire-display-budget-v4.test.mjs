import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {DEFAULT_EFFECT_QUALITY,FULL_EFFECT_QUALITY,createEffectPresentationPolicy} from '../../packages/effect-runtime/presentation-quality.mjs';
const read=p=>JSON.parse(readFileSync(process.env.ELSWORD_ASSETS_ROOT&&p.startsWith('artifacts/')?resolve(process.env.ELSWORD_ASSETS_ROOT,p.slice(10)):new URL('../../'+p,import.meta.url)));
const rs=read('packages/combat-core/rs-profile.json'),vc=read('packages/combat-core/vc-profile.json');
const rsIndex=read('artifacts/rs/fx/index.json'),vcIndex=read('artifacts/vc/fx/index.json');
for(const name of ['SwordFire_ReadyP01L','SwordFire_ComboXZZ'])test(`${name}: default web quality bounds trace fans while retaining an early visible packet`,()=>{
  const original=JSON.stringify(rsIndex.templates[name]),births=[];
  const r=createEffectRuntime({index:rsIndex,effectQuality:DEFAULT_EFFECT_QUALITY,onBirth:p=>births.push({name:p.name,frame})});let frame=0;
  const emitter=r.add(name,{position:[0,0,0]});for(;frame<90;frame++)r.step(1/60,{});
  assert.ok(emitter.max<=8);assert.ok(emitter.divisor>1);
  assert.equal(births.find(p=>p.name===name).frame,0,'source70/200 per second first packet fits the first60Hz tick');
  assert.ok(births.some(p=>p.name==='SwordFire_ReadyP01D3'||p.name==='SwordFire_F03'),'authored flame child remains visible');
  assert.equal(JSON.stringify(rsIndex.templates[name]),original,'source definition is immutable');
  r.stop(emitter.id);for(let i=0;i<180;i++)r.step(1/60,{});assert.equal(r.count,0);assert.equal(r.emitters.size,0);
});
test('RS command flames follow selected quality while character blade cues and high display stay intact',()=>{
  const policy=createEffectPresentationPolicy(rs,DEFAULT_EFFECT_QUALITY),e={skillId:null,setName:'EffectSet_EMK_ComboZZZZ'};
  assert.deepEqual(policy.effect(e),{level:'high',particleDivisor:8});assert.equal(policy.actor({skillId:null,state:'RSI_COMBO_ZZZZ'}),FULL_EFFECT_QUALITY);
  assert.equal(createEffectPresentationPolicy(rs,FULL_EFFECT_QUALITY).effect(e),FULL_EFFECT_QUALITY);
  assert.equal(createEffectPresentationPolicy(vc,DEFAULT_EFFECT_QUALITY).effect({skillId:null,setName:'EffectSet_Raven_Dash_Jump_Fire'}),FULL_EFFECT_QUALITY);
});
test('VC travelling flame keeps overlapping packets throughout a moving original effect owner',()=>{
  const r=createEffectRuntime({index:vcIndex,effectQuality:DEFAULT_EFFECT_QUALITY});
  const e=r.add('C_RVC_DashComboZZZZ_P02',{position:[0,0,0],anchor:s=>[s.frame*25,0,0]});
  const counts=[];for(let frame=0;frame<120;frame++){r.step(1/60,{frame});counts.push(r.count);}
  assert.ok(counts.slice(0,2).some(n=>n>0));assert.ok(counts.slice(2).every(n=>n>0));assert.ok(Math.max(...counts)<=24);
  assert.equal(e.divisor,2);r.stop(e.id);for(let i=0;i<120;i++)r.step(1/60,{});assert.equal(r.count,0);
});
for(const name of ['SA_RVC_DeadlyRaid_P01','SA_RVC_DeadlyRaid_P05','RWT_SA_REVOLVER_CANNON_Fire_Spark','RWT_SA_REVOLVER_CANNON_FireSpark'])test(`${name}: a short contact owns a timely burst with a bounded tail`,()=>{
  const r=createEffectRuntime({index:vcIndex,effectQuality:DEFAULT_EFFECT_QUALITY}),e=r.add(name,{position:[0,0,0]});
  r.step(1/60,{});assert.ok(r.count>0,'first source packet must precede the .1-second impact-owner retirement');
  r.stop(e.id);for(let i=0;i<120;i++)r.step(1/60,{});assert.equal(r.count,0);assert.equal(r.emitters.size,0);
});
test('retrigger clears the initial-packet override when the same common-hit sequence changes to high quality',()=>{
  const r=createEffectRuntime({index:vcIndex,effectQuality:DEFAULT_EFFECT_QUALITY}),e=r.add('DamageImpact',{triggerCount:10,triggerWait:true});
  assert.equal(e.firstSourcePacket,true);r.retrigger(e.id,{effectQuality:FULL_EFFECT_QUALITY,triggerCount:10});
  assert.equal(e.firstSourcePacket,false);assert.equal(e.divisor,1);assert.equal(e.firstSourceCarry,0);
});

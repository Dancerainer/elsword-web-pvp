import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createParticleControlEvents,advanceParticleEventClock,runParticleControlEvents,consumeParticleCrash} from '../../packages/effect-runtime/particle-control-events.mjs';
const json=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
const index=json('contracts/lk-fx-index.json');
function source(file){
  const row=json('contracts/rf-native-runtime-sources.json').files.find(r=>r.relativePath==='KTDXLIB/'+file);
  const bytes=readFileSync(new URL('../../.cache/native-source-runtime/KTDXLIB/'+file,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);return bytes.toString('latin1');
}

test('independent pinned native consumers keep particle age, resettable event time and render-only Crash distinct',()=>{
  const header=source('KTDGParticleSystem.h'),cpp=source('KTDGParticleSystem.cpp');
  assert.match(header,/m_fAge\s*\+= fElapsedTime/);assert.match(header,/m_fEventTimerOld\s*= m_fEventTimer/);
  assert.match(header,/m_fResetCrash\s*= 0\.01f/);assert.match(header,/m_fNowResetCrash\s*\+= fElapsedTime/);
  const reset=cpp.slice(cpp.indexOf('void CKTDGParticleSystem::CParticleEvent_EventTimer::OnFrameMove'),cpp.indexOf('void CKTDGParticleSystem::CParticleEvent_EventTimer::OnFrameMove')+650);
  assert.match(reset,/UpdateVelocityAccumPosAndEventTimer\( m_ActualTime\.m_Min \)/);assert.match(reset,/SetEventTimer\( m_EventTimer.GetRandomNumInRange\(\) \)/);
  assert.match(cpp,/SetPosCrash\( pPart->GetPos\(\) \+ pPart->GetCrash\(\) \);\s*pPart->SetCrash\( D3DXVECTOR3\( 0\.0f, 0\.0f, 0\.0f \) \)/);
});

test('original stun icon loops its own texture clock without resetting lifetime or accumulating extra particles',()=>{
  const runtime=createEffectRuntime({index});runtime.add('UnitStunA');runtime.step(.01,{});
  const p=[...runtime.particles.values()][0];assert.equal(p.values.Texture,'State_Stun.tga');
  for(let i=0;i<11;i++)runtime.step(.01,{});assert.equal(p.values.Texture,'State_Stun2.tga');
  for(let i=0;i<51;i++)runtime.step(.01,{});
  assert.equal(p.values.Texture,'State_Stun2.tga','the source .1 second texture event has repeated after the .5 -> .01 reset');
  assert.ok(p.age>.6);assert.ok(p.particleControl.time<.2);assert.equal(runtime.count,1);assert.deepEqual([...runtime.notes],[]);
});

test('Crash resamples only at source timer intervals and rendering consumes the offset once',()=>{
  const c=createParticleControlEvents({events:[{property:'ResetCrash',start:0,end:0,fade:false,value:.02},
    {property:'Crash',start:0,end:1,fade:true,value:[3,-2,1]}]});let sampled=0;
  const resolve=v=>{if(Array.isArray(v))sampled++;return v;};
  advanceParticleEventClock(c,.01);runParticleControlEvents(c,resolve);assert.deepEqual(consumeParticleCrash(c),[0,0,0]);assert.equal(sampled,0);
  advanceParticleEventClock(c,.01);runParticleControlEvents(c,resolve);assert.deepEqual(consumeParticleCrash(c),[3,-2,1]);assert.equal(sampled,1);
  assert.deepEqual(consumeParticleCrash(c),[0,0,0]);
  advanceParticleEventClock(c,.01);runParticleControlEvents(c,resolve);assert.equal(sampled,1);
  advanceParticleEventClock(c,.01);runParticleControlEvents(c,resolve);assert.equal(sampled,2);
});

test('original Armageddon repeated skin uses strict end pulses and original loop reset rather than being rejected',()=>{
  const mesh=source('KTDGXMeshPlayer.cpp'),skin=source('KTDGXSkinAnim.cpp');
  assert.match(mesh,/m_NowPlayCount\+\+;\s*if\( m_NowPlayCount == m_MaxPlayCount \)/);
  assert.match(skin,/case XAP_LOOP:[\s\S]*?m_bAnimEnd = true;\s*ChangeAnim\( m_NowAnimIndex \)/);
  const original=index.templates.ELK_ArmagedonBladeM;assert.equal(original.fields.PlayCount,999999);
  const template={...original,fields:{...original.fields,PlayCount:2},animationClips:[{name:'Normal',durationSeconds:.2}]};
  const r=createEffectRuntime({index:{templates:{[template.name]:template}}});assert.ok(r.add(template.name));
  const p=[...r.particles.values()][0];r.step(.17,{});assert.equal(p.meshEndPending,false);
  r.step(.001,{});assert.equal(p.meshEndPending,true);assert.equal(p.meshAnimationTime,0);
  r.step(.001,{});assert.equal(r.count,1);assert.equal(p.meshPlayCount,1);assert.equal(p.meshEndPending,false);
  r.step(.17,{});assert.equal(p.meshEndPending,true);r.step(.001,{});assert.equal(r.count,0);
  assert.deepEqual([...r.notes],[]);
});

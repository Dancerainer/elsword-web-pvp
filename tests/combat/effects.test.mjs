import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileEvents,sampleEvents,sampleProperty,resolveValue,createEffectRuntime,seededRandom,rotateNative} from '../../packages/effect-runtime/index.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
const index=JSON.parse(readFileSync(new URL('../../contracts/rf-fx-index.json',import.meta.url)));
const allIndex=mergeVisualEffectIndexes(index,...['rf-buff-display-fx-index','rf-shadow-weapon-fx-index'].map(name=>JSON.parse(readFileSync(new URL('../../contracts/'+name+'.json',import.meta.url)))));
function nativeParticleSource(name){
  const bytes=readFileSync(new URL('../../.cache/native-source-runtime/KTDXLIB/'+name,import.meta.url));
  const manifest=JSON.parse(readFileSync(new URL('../../contracts/rf-native-runtime-sources.json',import.meta.url)));
  const original=manifest.files.find(file=>file.relativePath==='KTDXLIB/'+name);
  assert.equal(bytes.length,original.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),original.sha256);
  return bytes.toString('latin1');
}
test('original RF hit declarations retain DDS, fade endpoints and source hashes',()=>{
  const t=index.templates.RF_HitP02;assert.equal(t.fields.TriggerCount,1);assert.equal(t.fields.BillBoardType,'BT_ALL');assert.equal(t.fields.DestBlendMode,'D3DBLEND_DESTALPHA');assert.ok(t.source.sha256.length===64&&t.declarationSha256.length===64);
  const c=compileEvents(t,()=>.5);assert.deepEqual(sampleEvents(c,.05).Size,[150,150,1]);assert.deepEqual(sampleEvents(c,.2).Color,[1,0,0,0]);assert.equal(sampleEvents(c,0).Texture,'LD_RingAlpha.dds');
});
test('reference emission carries fractional births, honors count/cap, and retires original lifetimes',()=>{
  const r=createEffectRuntime({index});r.add('RF_HitP01',{position:[1,2,3]});r.step(1/60,{});assert.equal(r.count,1);const p=[...r.particles.values()][0];assert.deepEqual(p.position,[1,2,3]);assert.equal(p.lifetime,.15);
  for(let i=0;i<12;i++)r.step(1/60,{});assert.equal(r.count,0);assert.equal(r.emitters.size,0);
  const t={name:'fraction',kind:'particle',unsupported:[],repeated:{},fields:{Emitrate:10,NumParticles:2,Lifetime:1,TriggerCount:2},events:[]};const x=createEffectRuntime({index:{templates:{fraction:t}}});x.add('fraction');x.step(.05,{});assert.equal(x.count,0);x.step(.05,{});assert.equal(x.count,0,'native excess check is >1, not >=1');x.step(.05,{});assert.equal(x.count,1);x.step(.2,{});assert.equal(x.count,2);
});
test('original child emission follows parent birth/movement and stops emission with parent',()=>{
  const r=createEffectRuntime({index}),root=r.add('RF_HitP03',{position:[0,0,0]});r.step(1/60,{});const parent=[...r.particles.values()].find(p=>p.name==='RF_HitP03');assert.ok(parent);assert.equal(parent.children.length,3);assert.deepEqual(parent.children.map(id=>r.emitters.get(id).name),['RavenHandFireP01','RavenHandFireP02','RavenHandFireP03']);
  r.stop(root.id,true);assert.equal(r.count,0);assert.ok([...r.emitters.values()].every(e=>e.done&&e.options.parentParticleId===null));
  r.step(1/60,{});assert.equal(r.emitters.size,0);
});
test('effect random resolution is seeded and never executes arbitrary source expressions',()=>{
  const a=seededRandom(42),b=seededRandom(42);for(let i=0;i<20;i++)assert.deepEqual(resolveValue([{random:[-10,10]},5],a),resolveValue([{random:[-10,10]},5],b));
  assert.equal(resolveValue({random:[5,1]},()=>.5),7); // original fabs width, first bound preserved
  assert.throws(()=>resolveValue({random:[NaN,1]},a),/interval/);
  assert.equal(resolveValue({random:[2,2]},()=>{throw Error('equal range must not consume RNG');}),2);
  const text='system("erase")';assert.equal(resolveValue(text,a),text);
});
test('invisible attack-box templates never acquire invented geometry or particles',()=>{
  const t=index.templates.Raven_WeaponDummy01;assert.equal(t.fields.DrawCount,0);const r=createEffectRuntime({index});r.add(t.name);const p=[...r.particles.values()][0];assert.equal(p.template.fields.DrawCount,0);assert.equal(p.values.Color[3],0);
});
test('native Scale changes current Size; a later absolute Size fade replaces that scaled size',()=>{
  const t=index.templates.RavenHandFireP03,c=compileEvents(t,()=>.75);
  assert.deepEqual(sampleEvents(c,0).Size,[5.5,5.5,Math.fround(1.1)]);
  assert.deepEqual(sampleEvents(c,.06).Size,[20,20,1]);
});
test('native velocity and DirSpeed use all three yaw/pitch/roll axes',()=>{
  const close=(a,b)=>a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<1e-10));
  close(rotateNative([1,0,0],[0,90,0]),[0,0,-1]);close(rotateNative([1,0,0],[0,0,90]),[0,1,0]);close(rotateNative([0,1,0],[90,0,0]),[0,0,1]);
  const t={name:'axis',kind:'particle',unsupported:[],repeated:{},fields:{Emitrate:60,NumParticles:1,Lifetime:1,TriggerCount:1},events:[{property:'DirSpeed',start:0,end:0,value:10},{property:'Rotate',start:0,end:0,value:[0,90,0]}]};
  const r=createEffectRuntime({index:{templates:{axis:t}}});r.add('axis');r.step(1/60,{});r.step(.1,{});close([...r.particles.values()][0].position,[0,0,-1]);
});
test('reset repeats presentation randomness; native SetAutoDie retains existing particle tails',()=>{
  const r=createEffectRuntime({index}),begin=()=>{r.add('RF_HitP03');r.step(1/60,{});return [...r.particles.values()].find(p=>p.name==='RF_HitP03');};
  const a=begin(),before=structuredClone(a.values);r.clear();const b=begin();assert.deepEqual(b.values,before);
  r.stop(b.emitterId);assert.ok(r.particles.has(b.id));r.step(1,{});assert.equal(r.count,0);
  assert.ok(r.add('Raven_SI_A_RF_Shadow_Step_Effect01'));assert.ok(!r.notes.has('Raven_SI_A_RF_Shadow_Step_Effect01:lifetime'));
});
test('single-play skin mesh consumes original previous-frame strict end pulse',()=>{
  const t={name:'skin-count-fixture',kind:'mesh',unsupported:[],repeated:{},
    fields:{MeshType:'X_SKIN_MESH',LifeType:'LT_PLAY_COUNT',PlayCount:1},
    events:[{property:'AniName',start:0,end:0,value:{animation:'Normal',playback:'XAP_LOOP'}}],
    animationClips:[{name:'Normal',durationSeconds:.2}]};
  const r=createEffectRuntime({index:{templates:{'skin-count-fixture':t}}});r.add(t.name);
  r.step(.17,{});assert.equal(r.count,1);assert.equal([...r.particles.values()][0].meshEndPending,false);
  r.step(.001,{});assert.equal(r.count,1);assert.equal([...r.particles.values()][0].meshEndPending,true);
  r.step(.001,{});assert.equal(r.count,0);
});
test('Major uppercase DirSpeed and UV fade start from independently pinned CParticle initial values',()=>{
  const header=nativeParticleSource('KTDGParticleSystem.h'),source=nativeParticleSource('KTDGParticleSystem.cpp');
  const uv=header.match(/INIT_VECTOR2\(\s*m_vTexStage0UV,\s*([^,]+),\s*([^)]+)\)/).slice(1).map(parseFloat);
  const speed=parseFloat(header.match(/m_fDirSpeed\s*=\s*([^;]+)/)[1]);
  assert.deepEqual(uv,[0,0]);assert.equal(speed,0);
  assert.match(source,/EventName\.compare\("DIRSPEED"\)/);assert.match(source,/EventName\.compare\("TEX0UV"\)/);
  const t={events:[{property:'DIRSPEED',start:0,end:1,fade:true,value:10},{property:'TEX0UV',start:0,end:1,fade:true,value:[1,.5]}]};
  const c=compileEvents(t),initial=sampleEvents(c,0),half=sampleEvents(c,.5);
  assert.equal(initial.DirSpeed,speed);assert.deepEqual(initial.Tex0UV,uv);
  assert.equal(half.DirSpeed,5);assert.deepEqual(half.Tex0UV,[.5,.25]);
  assert.equal(sampleProperty(c,'DIRSPEED',.5),5);assert.equal('DIRSPEED' in half,false);assert.equal('TEX0UV' in half,false);
  const notes=[],actual=allIndex.templates.ROT_NUCLEAR_NEW03,r=createEffectRuntime({index:allIndex,onUnsupported:note=>notes.push(note)});
  r.add(actual.name);for(let i=0;i<120;i++)r.step(.01,{});
  assert.ok(notes.some(note=>note.id===actual.name+':uv-render:Tex0UV'),'UV sampling does not claim texture-coordinate rendering');
});
test('Weapon Break Crash/timer requires stateful execution and preserves original position independently of render jitter',()=>{
  const source=nativeParticleSource('KTDGParticleSystem.cpp');
  const crash=source.slice(source.indexOf('void CKTDGParticleSystem::CParticleEvent_Crash::OnFrameMove'),source.indexOf('bool CKTDGParticleSystem::CParticleEvent_ResetCrash::ProcessTokenStream'));
  assert.match(crash,/GetNowResetCrash\(\)\s*<\s*part\.GetResetCrash\(\)/);
  assert.match(crash,/SetNowResetCrash\(\s*0\.0f\s*\)/);assert.match(crash,/m_vCrash\.GetRandomNumInRange\(\)/);
  assert.doesNotMatch(crash,/IsFade\(/,'Native Crash is periodic sampling, not normal fade interpolation');
  const t=allIndex.templates.StateError_Weapon_Break01,before=JSON.stringify(t),c=compileEvents(t,()=>.5);
  assert.deepEqual(c.unsupported.map(row=>row.event.property),['ResetCrash','Crash','EventTimer']);
  assert.equal(sampleProperty(c,'Crash',.01),null);
  const notes=[],r=createEffectRuntime({index:allIndex,onUnsupported:note=>notes.push(note)});
  r.add(t.name,{position:[20,40,60]});for(let i=0;i<120;i++)r.step(.01,{});
  const p=[...r.particles.values()].find(p=>p.name===t.name);assert.ok(p);
  assert.equal(p.values.Texture,'Weapon_Break01.dds');assert.deepEqual(p.position,[20,40,60]);
  assert.deepEqual(notes,[]);assert.ok(p.particleControl);assert.ok(p.particleControl.time<p.age);
  assert.equal(JSON.stringify(t),before,'Raw target declaration remains unchanged');
});
test('unknown or incompatible vector fades stay unsupported without invented initial values',()=>{
  const t={name:'unknown-fade',kind:'particle',unsupported:[],repeated:{},fields:{Emitrate:100,NumParticles:1,Lifetime:2,TriggerCount:1},
    events:[{property:'UnknownVector',start:.01,end:1,fade:true,value:[1,2,3]},{property:'Size',start:.01,end:1,fade:true,value:[1,2]}]};
  const c=compileEvents(t);assert.equal(c.unsupported.length,2);assert.equal(sampleProperty(c,'UnknownVector',.5),null);
  assert.deepEqual(sampleEvents(c,.5).Size,[1,1,1]);
  const notes=[],r=createEffectRuntime({index:{templates:{[t.name]:t}},onUnsupported:note=>notes.push(note)});
  r.add(t.name);assert.doesNotThrow(()=>{for(let i=0;i<120;i++)r.step(.01,{});});
  assert.equal(notes.length,2);assert.ok(notes.every(note=>note.type==='unsupported-visual'));
});
test('all 337 independent target templates sample every event boundary and continue 120 runtime ticks without throwing',()=>{
  assert.equal(Object.keys(allIndex.templates).length,337);
  const before=JSON.stringify(allIndex.templates);
  for(const t of Object.values(allIndex.templates)){
    const c=compileEvents(t,()=>.5),ages=new Set([0,1.2,...t.events.flatMap(event=>[event.start,(event.start+event.end)/2,event.end,event.end+.001])]);
    for(const age of ages)assert.doesNotThrow(()=>{
      const values=sampleEvents(c,age);
      for(const property of ['Color','Size','Rotate','Velocity','Tex0UV','Tex1UV','Tex2UV'])assert.ok(values[property].every(Number.isFinite),t.name+':'+property);
    },t.name+' at '+age);
    const r=createEffectRuntime({index:allIndex});
    assert.doesNotThrow(()=>{r.add(t.name);for(let i=0;i<120;i++)r.step(.01,{});},t.name);
  }
  assert.equal(JSON.stringify(allIndex.templates),before);
});

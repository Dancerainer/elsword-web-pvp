import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {originalMeshPlayCount,terminalTransparentMeshTime} from '../../packages/effect-runtime/mesh-play-count.mjs';
const index=JSON.parse(readFileSync(new URL('../../contracts/vc-fx-index.json',import.meta.url)));
const trace=index.templates.RWT_BARRAGE_ATTACK_TRACE_Stand,pillar=index.templates.B_RWT_GIGA_PROMINENCE_pillar_fire_B;
const source=file=>readFileSync(new URL('../../.cache/native-source-runtime/'+file,import.meta.url),'latin1');

test('independent fixed source proves zero constructor count and sticky ONE end, not three animation loops',()=>{
  const header=source('KTDXLIB/KTDGXMeshPlayer.h'),skin=source('KTDXLIB/KTDGXSkinAnim.cpp'),mesh=source('KTDXLIB/KTDGXMeshPlayer.cpp');
  assert.match(header,/playCount\s*= CMinMax<int>\(0,0\)/);
  assert.match(skin,/case XAP_ONE:[\s\S]*?m_bAnimEnd\s*= true;[\s\S]*?m_AnimState\s*= XAS_STOP;/);
  assert.match(mesh,/m_pXSkinAnim->IsAnimationEnd\(\) == true[\s\S]*?m_NowPlayCount\+\+;\s*if\( m_NowPlayCount == m_MaxPlayCount \)/);
  assert.equal(trace.fields.PlayCount,undefined);assert.equal(originalMeshPlayCount(trace),0);
  assert.equal(pillar.fields.PlayCount,3);assert.equal(pillar.events.find(e=>e.property==='AniName').value.playback,'XAP_ONE');
});

test('Giga three-count ONE mesh stops its original pose once then consumes three later end packets',()=>{
  const runtime=createEffectRuntime({index:{templates:{[pillar.name]:pillar}}});
  runtime.add(pillar.name);const p=[...runtime.particles.values()][0];assert.ok(p);
  for(let frames=0;frames<200&&!p.meshEndPending;frames++)runtime.step(1/60,{});
  assert.ok(p.meshEndPending);assert.equal(p.meshStopped,true);const stoppedAt=p.meshAnimationTime;
  for(const count of [1,2]){runtime.step(1/60,{});assert.equal(runtime.count,1);assert.equal(p.meshPlayCount,count);assert.equal(p.meshAnimationTime,stoppedAt);}
  runtime.step(1/60,{});assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
  assert.deepEqual([...runtime.notes],[]);
});

test('raw zero PlayCount remains infinite; opaque presentation retires only the proved zero-output tail',()=>{
  assert.equal(terminalTransparentMeshTime(trace),null,'DESTALPHA needs explicit opaque target');
  assert.equal(terminalTransparentMeshTime(trace,{opaqueTarget:true}),.4);
  const runtime=createEffectRuntime({index:{templates:{[trace.name]:trace}}});
  const e=runtime.add(trace.name);assert.ok(e);for(let i=0;i<180;i++)runtime.step(1/60,{});
  assert.equal(runtime.count,1);assert.equal([...runtime.particles.values()][0].meshMaxPlayCount,0);
  runtime.stop(e.id,true);assert.equal(runtime.count,0);
  const optimized=createEffectRuntime({index:{templates:{[trace.name]:trace}},opaqueTarget:true});
  for(let cast=0;cast<30;cast++){
    optimized.add(trace.name);for(let i=0;i<15;i++)optimized.step(1/60,{});
    assert.equal(optimized.count,1,'visible original .25-second phase survives');
    for(let i=0;i<15;i++)optimized.step(1/60,{});
    assert.equal(optimized.count,0);assert.equal(optimized.emitters.size,0);
  }
  assert.equal(trace.fields.PlayCount,undefined,'source declaration is not repaired into an invented count');
});

test('permanent-transparent optimization rejects depth, children, future alpha and unhandled controls',()=>{
  const invalid=[
    {...trace,fields:{...trace.fields,ZWriteEnable:true}},
    {...trace,fields:{...trace.fields,ZWriteEnable:1}},
    {...trace,fields:{...trace.fields,TraceParticleList:'tail'}},
    {...trace,repeated:{FinalParticleList:['tail']}},
    {...trace,events:[...trace.events,{property:'Color',start:2,end:2,value:[1,1,1,1]}]},
    {...trace,events:[...trace.events,{property:'SlashTrace',start:2,end:2,value:true}]},
    {...trace,events:trace.events.map(e=>e.property==='Color'?{...e,clock:'animation'}:e)},
    {...trace,unsupported:['unknown']},
  ];
  for(const t of invalid)assert.equal(terminalTransparentMeshTime(t,{opaqueTarget:true}),null);
});

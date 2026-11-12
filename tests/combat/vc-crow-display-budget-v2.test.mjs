import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {DEFAULT_EFFECT_QUALITY,FULL_EFFECT_QUALITY,particlePresentationBudget} from '../../packages/effect-runtime/presentation-quality.mjs';
const index=JSON.parse(readFileSync(new URL('../../artifacts/vc/fx/index.json',import.meta.url)));
test('Crow short flame and wing packets produce visible source particles before the original trigger ends',()=>{
  for(const name of ['RVC_SA_ignitionCrow_crow_P02','RVC_SA_ignitionCrow_crowWing_P01']){
    const t=index.templates[name];assert.equal(t.fields.Emitrate,15);assert.ok(t.fields.TriggerTime<=.5);
    const r=createEffectRuntime({index,effectQuality:DEFAULT_EFFECT_QUALITY}),e=r.add(name);
    let peak=0;for(let i=0;i<18;i++){r.step(1/60,{});peak=Math.max(peak,r.count);}
    assert.ok(peak>=3,'short original flame structure must be present');assert.equal(e.divisor,1);
    for(let i=0;i<120;i++)r.step(1/60,{});assert.equal(r.count,0);assert.equal(r.emitters.size,0);
  }
});
test('ground flame restores a bounded continuous path while smoke and source declarations retain their policy',()=>{
  const name='RVC_C_dashJumpX_hitGround_P07',t=index.templates[name],before=JSON.stringify(t);
  const budget=particlePresentationBudget(t,40,-1,DEFAULT_EFFECT_QUALITY);assert.deepEqual(budget,{divisor:4,max:10,limit:-1});
  assert.equal(particlePresentationBudget(t,40,-1,FULL_EFFECT_QUALITY).divisor,1);
  const r=createEffectRuntime({index,effectQuality:DEFAULT_EFFECT_QUALITY}),e=r.add(name);let visible=0;
  for(let i=0;i<60;i++){r.step(1/60,{});if(r.count)visible++;assert.ok(r.count<=4);}
  assert.ok(visible>=48,'flame must cover frames between births, with a small active count');r.stop(e.id,false);
  for(let i=0;i<60;i++)r.step(1/60,{});assert.equal(r.count,0);
  for(const n of ['RVC_C_dashJumpX_hitGround_P02','RVC_C_dashJumpX_hitGround_P08','RVC_SA_ignitionCrow_crow_P03']){
    const x=index.templates[n];assert.equal(particlePresentationBudget(x,x.fields.NumParticles,-1,DEFAULT_EFFECT_QUALITY).divisor,8);
  }
  assert.equal(JSON.stringify(t),before);
});

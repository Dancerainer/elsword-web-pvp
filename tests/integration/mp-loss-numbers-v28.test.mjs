import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {emitBuffMpLossNumber} from '../../apps/web/damage-number-layout.mjs';
const manifest=JSON.parse(readFileSync(new URL('../../artifacts/ui/damage-numbers/manifest.json',import.meta.url)));
const event={type:'buffMpChanged',delta:-90.9,drawText:true,resourceNumber:{resource:'mp',style:'red',position:[100,450,0]}};
for(const delta of [-90,-108])test(`Luna user display is MP -30% for actual delta${delta}, without changing the event`,()=>{
  const runtime=createEffectRuntime({index:manifest}),e={...event,delta,templateId:98,resourceNumber:{...event.resourceNumber,percent:-30}},before=structuredClone(e);
  assert.equal(emitBuffMpLossNumber(runtime,manifest,e),6);
  assert.deepEqual([...runtime.particles.values()].map(p=>p.options.digit),['M','P','-','3','0','%']);assert.deepEqual(e,before);
});
for(const type of ['buffMpChanged','observedBuffMpChanged'])test(`${type} uses original red MP-minus glyphs, center advance and signed integer delta`,()=>{
  const runtime=createEffectRuntime({index:manifest}),e={...event,type},before=structuredClone(e);
  assert.equal(emitBuffMpLossNumber(runtime,manifest,e),5);const rows=[...runtime.particles.values()];
  assert.deepEqual(rows.map(p=>p.options.digit),['M','P','-','9','0']);
  assert.deepEqual(rows.map(p=>p.position),[[22,450,0],[48,450,0],[100,450,0],[126,450,0],[152,450,0]]);
  assert.ok(rows.every(p=>p.name==='PicCharRed'&&p.values.Color[0]===1));assert.deepEqual(e,before);
});
test('missing source DrawText, non-loss, invalid anchor and capacity exhaustion never invent text',()=>{
  for(const patch of [{drawText:false},{delta:0},{delta:90},{delta:NaN},{resourceNumber:null},{resourceNumber:{resource:'mp',style:'red',position:[NaN,0,0]}}])assert.equal(emitBuffMpLossNumber(createEffectRuntime({index:manifest}),manifest,{...event,...patch}),0);
  const runtime=createEffectRuntime({index:manifest});for(let i=0;i<100;i++)emitBuffMpLossNumber(runtime,manifest,event);
  assert.equal(runtime.count,manifest.templates.PicCharRed.fields.NumParticles);
});

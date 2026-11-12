import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {emitGuildRecoveryNumbers,emitAwakeningRecoveryNumbers} from '../../apps/web/damage-number-layout.mjs';
const manifest=JSON.parse(readFileSync(new URL('../../artifacts/ui/damage-numbers/manifest.json',import.meta.url)));

test('guild heal displays actual recovery in original green glyphs at the source y+50 anchor exactly once',()=>{
  const runtime=createEffectRuntime({index:manifest});
  const event={type:'guildHpRecovered',skillId:510,restoredHp:120000.9,requestedHp:200000,position:[100,550,4]};
  const copy=structuredClone(event);
  assert.equal(emitAwakeningRecoveryNumbers(runtime,manifest,event),0);
  assert.equal(emitGuildRecoveryNumbers(runtime,manifest,event),9);
  const particles=[...runtime.particles.values()];
  assert.equal(particles.map(p=>p.options.digit).join(''),'HP+120000');
  assert.ok(particles.every(p=>p.name==='PicCharGreen'&&p.position[1]===550));
  assert.deepEqual(event,copy);
  assert.equal(emitGuildRecoveryNumbers(runtime,manifest,{...event,restoredHp:0}),0);
  assert.equal(emitGuildRecoveryNumbers(runtime,manifest,{...event,type:'guildHeroSacrifice'}),0);
  runtime.step(1.501);assert.equal(runtime.count,0);
});

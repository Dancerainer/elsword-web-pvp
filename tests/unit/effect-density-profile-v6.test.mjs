import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,metricPeaks,compareCombatTraces} from '../../tools/effect-density-profile-v6.mjs';

test('density profile totals include every measured frame and preserve independent peaks',()=>{
  const rows=[{frame:0,totalCpuMs:5,fxParticles:30,fxEmitters:1,totalDraws:2},
    {frame:1,totalCpuMs:20,fxParticles:20,fxEmitters:5,totalDraws:3},
    {frame:2,totalCpuMs:10,fxParticles:10,fxEmitters:2,totalDraws:10}];
  assert.deepEqual(summarize(rows).totalCpuMs,{median:10,p95:10,max:20,sum:35});
  const peaks=metricPeaks(rows);
  assert.deepEqual(peaks.fxParticles,{value:30,frame:0});
  assert.deepEqual(peaks.fxEmitters,{value:5,frame:1});
  assert.deepEqual(peaks.totalDraws,{value:10,frame:2});
});

test('quality comparison checks every combat state and event frame, including tail and missing frames',()=>{
  const reference={frames:[{combatStateHash:'a',combatEventsHash:'b'},{combatStateHash:'c',combatEventsHash:'d'}]};
  assert.equal(compareCombatTraces(reference,structuredClone(reference)).equal,true);
  const changed=structuredClone(reference);changed.frames[1].combatEventsHash='e';
  assert.deepEqual(compareCombatTraces(reference,changed).differences,[{frame:1,field:'combatEventsHash',reference:'d',candidate:'e'}]);
  assert.equal(compareCombatTraces(reference,{frames:reference.frames.slice(0,1)}).equal,false);
});

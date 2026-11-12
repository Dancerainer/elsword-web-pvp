/** Source-field timing regressions; selected web density is not native medium. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {DEFAULT_EFFECT_QUALITY,FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
const root=resolve(process.env.ELESIS_ASSET_ROOT??resolve(import.meta.dirname,'../../artifacts'));
const index=id=>JSON.parse(readFileSync(resolve(root,id+'/fx/index.json'),'utf8'));
for(const [id,name,time] of [['gm','SA_SSK_SPIRAL_BLAST_P02',.1],['bh','EffectSet_SBH_FireBall_Explosion02',.4],
 ['ca','EffectSet_P_EL_DARK_FORCE_demolition_wake_04',.1]])test(`${id} short original ${name} appears before its source trigger closes at both densities`,()=>{
  const source=index(id),template=source.templates[name];assert.equal(template.fields.TriggerTime,time);
  const births=[];
  for(const quality of [FULL_EFFECT_QUALITY,DEFAULT_EFFECT_QUALITY]){
    const runtime=createEffectRuntime({index:source,effectQuality:quality});runtime.add(name,{position:[0,0,0]});
    let first=null;
    for(let frame=1;frame<=Math.ceil(time*120)+2;frame++){
      runtime.step(1/120);if(first===null&&runtime.count>0)first=frame/120;
    }
    assert.ok(first!==null&&first<=time+1/120,'whole original cue must not disappear behind /8 emission delay');births.push(first);
    runtime.clear();assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
  }
  assert.equal(births[1],births[0],'structural cue retains its actual source birth clock');
});
test('BH dense original fire smoke remains reduced while the source fields stay intact',()=>{
  const source=index('bh'),name='fire_Smoke01',before=JSON.stringify(source.templates[name]),peaks=[];
  for(const quality of [FULL_EFFECT_QUALITY,DEFAULT_EFFECT_QUALITY]){
    const runtime=createEffectRuntime({index:source,effectQuality:quality});runtime.add(name,{position:[0,0,0]});let peak=0;
    for(let i=0;i<120;i++){runtime.step(1/120);peak=Math.max(peak,runtime.count);}peaks.push(peak);runtime.clear();
  }
  assert.ok(peaks[0]>0&&peaks[1]>0&&peaks[1]<peaks[0]);assert.equal(JSON.stringify(source.templates[name]),before);
});

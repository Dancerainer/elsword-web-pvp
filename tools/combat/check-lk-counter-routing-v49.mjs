/** Current web/native inputs and declaration interpreter, not original-client gold. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {lkCommandFixture} from '../../tests/helpers/lk-command-fixture.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createCounterWaitEffects} from '../../apps/web/counter-wait-effects-v49.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url))),index=read('artifacts/lk/counter-v49/index.json');
const report={schemaVersion:1,evidenceClass:'current-web-native-keyboard-and-render-routing',targetClientMeasured:false,gpuMeasured:false,runs:[]};
for(const facing of [-1,1])for(const mode of [-2,2]){
 const {sim,actor}=await lkCommandFixture({facing,gap:1000,preset:{passives:[],guildPassives:[]}});
 sim.configureLoadout([{skillId:21206},...Array(7).fill(null)],actor.id);sim.prepareWayOfSword(actor.id,mode);sim.drainEvents();
 const runtime=createEffectRuntime({index,quality:'high'}),controller=createCounterWaitEffects({runtime}),ids=new Set();
 const row={facing,mode,skillId:21206,cues:[],sample:null};
 for(let frame=0;frame<120;frame++){
  sim.step(1/60,{lk:frame===0?{pressed:['A']}:{}},{snapshot:false});
  for(const e of sim.drainEvents())if(e.type==='counterWaitVisual'){
   row.cues.push({frame,time:e.time,state:actor.state,animationTime:actor.animationTime,ownerStateSerial:e.ownerStateSerial,position:e.position,rotation:e.rotation});
   controller.event(e,sim.state);controller.event(e,sim.state);
  }
  runtime.step(1/60,sim.state);controller.step(sim.state);
  for(const p of runtime.particles.values()){
   ids.add(p.id);if(p.age>.1&&!row.sample)row.sample={texture:p.values.Texture,position:p.position,size:p.values.Size,color:p.values.Color,rotation:p.visualRotation};
  }
 }
 row.particlesCreated=ids.size;row.after={particles:runtime.count,emitters:runtime.emitters.size,controller:controller.proof()};
 assert.equal(row.cues.length,1);assert.equal(row.particlesCreated,5);assert.equal(row.after.particles,0);assert.equal(row.after.emitters,0);assert.equal(row.sample.texture,'Revenge.dds');report.runs.push(row);
}
writeFileSync(new URL('../../reports/lk-counter-routing-v49.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.runs.map(r=>({facing:r.facing,mode:r.mode,cues:r.cues.length,particles:r.particlesCreated,ended:r.after.particles===0}))));

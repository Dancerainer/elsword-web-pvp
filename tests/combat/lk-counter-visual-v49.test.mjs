import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lkCommandFixture} from '../helpers/lk-command-fixture.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createCounterWaitEffects} from '../../apps/web/counter-wait-effects-v49.mjs';
import {arcLineBasis} from '../../packages/combat-core/archenemy-mesh.mjs';
const index=JSON.parse(readFileSync(new URL('../../artifacts/lk/counter-v49/index.json',import.meta.url)));
for(const facing of [-1,1])for(const swordMode of [-2,2])test(`Counter visual keyboard, facing ${facing}, sword mode ${swordMode}: target .09 callback and original five-particle tail`,async()=>{
 const {sim,actor,map}=await lkCommandFixture({facing,gap:1000,preset:{passives:[],guildPassives:[]}});
 sim.configureLoadout([{skillId:21206},...Array(7).fill(null)],actor.id);sim.prepareWayOfSword(actor.id,swordMode);sim.drainEvents();
 const runtime=createEffectRuntime({index,quality:'high'}),controller=createCounterWaitEffects({runtime});
 let cue=null,total=0;const particleIds=new Set();let sample=null;
 for(let frame=0;frame<120;frame++){
  const beforePosition=[actor.x,actor.y,actor.z];
  sim.step(1/60,{lk:frame===0?{pressed:['A']}:{}},{snapshot:false});
  for(const e of sim.drainEvents())if(e.type==='counterWaitVisual'){
   total++;cue=e;assert.equal(actor.state,'ESSI_REVENGE_WAIT');assert.ok(actor.animationTime>=Math.fround(.09));assert.ok(actor.animationTime<.15);
   const basis=arcLineBasis(actor,map.lines);
   assert.deepEqual(e.position,beforePosition.map((v,i)=>v+(i===1?70:0)+basis.direction[i]*facing*100),'FrameMove cue precedes same-tick root movement');
   assert.deepEqual(e.rotation,[0,basis.rotation[1]+70,0]);
   assert.equal(controller.event(e,sim.state),true);controller.event(e,sim.state);
  }
  runtime.step(1/60,sim.state);controller.step(sim.state);
  for(const p of runtime.particles.values()){
   particleIds.add(p.id);assert.equal(p.name,'RevengeWait');assert.equal(p.values.Texture,'Revenge.dds');assert.deepEqual(p.visualRotation,cue.rotation);
   if(p.age>.1&&p.age<.4)sample={size:p.values.Size,color:p.values.Color};
  }
 }
 assert.equal(total,1);assert.equal(particleIds.size,5);assert.ok(sample.size[0]>0&&sample.size[0]<384);assert.ok(sample.color[3]>0&&sample.color[3]<1);
 assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);assert.equal(controller.proof().liveHandles,0);
 assert.equal(controller.proof().duplicates,1);assert.equal(controller.proof().triggers,1);
});
test('counter visual lifecycle permits a new life/reset and rejects malformed or foreign actor cues',()=>{
 const runtime=createEffectRuntime({index,quality:'high'}),controller=createCounterWaitEffects({runtime});
 const actor={id:'a',professionId:'LK',lifeEpoch:1},state={time:1,actors:[actor]},event={type:'counterWaitVisual',actorId:'a',ownerStateSerial:2,position:[1,2,3],rotation:[0,70,0]};
 assert.equal(controller.event({...event,position:[NaN,0,0]},state),false);actor.professionId='BH';assert.equal(controller.event(event,state),false);actor.professionId='LK';
 controller.event(event,state);controller.event(event,state);assert.equal(controller.proof().triggers,1);
 actor.lifeEpoch=2;controller.event(event,state);assert.equal(controller.proof().triggers,2);
 state.time=0;controller.event(event,state);assert.equal(controller.proof().triggers,3);assert.equal(runtime.emitters.size,1);
 controller.clear();assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
});

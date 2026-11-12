import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {createDestructionRageEffects,DESTRUCTION_RAGE_PARTICLES} from '../../apps/web/destruction-rage-effects.mjs';
import {tryAddTimeRingRevive} from '../../packages/combat-core/add-systems.mjs';
const index=JSON.parse(readFileSync(new URL('../../contracts/lk-fx-index.json',import.meta.url)));
function fixture(){
  const runtime=createEffectRuntime({index,effectQuality:FULL_EFFECT_QUALITY}),controller=createDestructionRageEffects({runtime});
  const actor={id:'lk',professionId:'LK',state:'RSI_WAIT',stateSerial:7,hp:100,x:0,y:0,z:0,landPosition:[0,0,0]};
  const state={time:10,actors:[actor],effects:[]};
  const event=(serial=8,eventId=1)=>({type:'destructionRageStarted',actorId:actor.id,ownerStateSerial:serial,eventId,time:state.time,
    position:[0,80,0],particles:DESTRUCTION_RAGE_PARTICLES});
  const step=(frames=1)=>{for(let i=0;i<frames;i++){state.time+=1/60;controller.step(state);runtime.step(1/60,state);}};
  return {runtime,controller,actor,state,event,step};
}
test('temporary remote-victim clones with different event IDs retain one source burst per post-entry serial',()=>{
  const f=fixture(),before=JSON.stringify(index.templates.Counter_Particle01);
  f.controller.event(f.event(),f.state);f.step(1);
  const count=f.runtime.count,emitters=f.runtime.emitters.size;
  for(let i=2;i<10;i++){f.controller.event(f.event(8,i),f.state);f.step(1);}
  assert.equal(f.actor.stateSerial,7,'observed pre-entry serial is never rewritten');
  assert.equal(f.controller.proof().bursts,1);assert.equal(f.controller.proof().duplicates,8);
  assert.equal(f.runtime.emitters.size,emitters);assert.ok(f.runtime.count>=count);
  assert.equal(JSON.stringify(index.templates.Counter_Particle01),before);
  f.step(120);assert.equal(f.runtime.count,0);assert.equal(f.runtime.emitters.size,0);
  f.controller.event(f.event(8,999),f.state);assert.equal(f.controller.proof().bursts,1,'late duplicate does not restart an expired burst');
});
test('new real state entries remain distinct even inside the old six-second armor window',()=>{
  const f=fixture();f.controller.event(f.event(8),f.state);f.step();
  f.controller.event(f.event(9,2),f.state);assert.equal(f.controller.proof().bursts,2);assert.equal(f.runtime.emitters.size,4);
  f.step(120);assert.equal(f.runtime.count,0);assert.equal(f.runtime.emitters.size,0);
});
test('clock rollback, life epoch, leaving and clear each permit a new identity without stale suppression',()=>{
  for(const boundary of ['clock','life','network','leave','clear']){
    const f=fixture();f.controller.event(f.event(),f.state);f.step();
    if(boundary==='clock')f.state.time=0;
    if(boundary==='life')f.actor.pvpLifeEpoch=2;
    if(boundary==='network')f.actor.networkFrameEpoch=2;
    if(boundary==='leave'){f.state.actors=[];f.controller.step(f.state);f.state.actors=[f.actor];}
    if(boundary==='clear'){f.controller.clear();assert.equal(f.runtime.count,0);assert.equal(f.controller.proof().rememberedIdentities,0);}
    const previous=f.controller.proof().bursts;f.controller.event(f.event(),f.state);
    assert.equal(f.controller.proof().bursts,previous+1,boundary);
  }
});
test('old events suppress exact replay only, and identity memory stays bounded during long matches',()=>{
  const f=fixture(),old=f.event();delete old.ownerStateSerial;
  f.controller.event(old,f.state);f.controller.event({...old},f.state);
  assert.equal(f.controller.proof().bursts,1);
  f.controller.event({...old,eventId:2},f.state);assert.equal(f.controller.proof().bursts,2);
  for(let serial=10;serial<80;serial++){f.controller.event(f.event(serial,serial),f.state);f.step(120);}
  assert.equal(f.controller.proof().rememberedIdentities,32);assert.equal(f.runtime.count,0);
  f.controller.clear();assert.equal(f.runtime.emitters.size,0);
});
test('Time Ring restores resources without rewinding the rage state serial',()=>{
  const f=fixture();Object.assign(f.actor,{hp:100,hpMax:100,mp:10,mpMax:300,sourceTimeSickness:0,
    sourceTimeRing:{remaining:10,hp:50,mp:100,dp:null,mutation:null,wayOfSword:null,sourceActorId:'de'}});
  assert.equal(tryAddTimeRingRevive({emit(){}},f.actor,{damage:100}),true);
  assert.equal(f.actor.stateSerial,7);assert.equal(f.actor.hp,50);
  f.controller.event(f.event(8),f.state);f.controller.event(f.event(9,2),f.state);
  assert.equal(f.controller.proof().bursts,2,'a genuinely new entry still starts');
});

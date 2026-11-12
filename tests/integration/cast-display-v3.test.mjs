import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import index from '../../contracts/cast-display-index-v1.json' with {type:'json'};
import bmOverlay from '../fixtures/evidence/bm-feedback-overlay-v4.json' with {type:'json'};
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createCastDisplay} from '../../apps/web/cast-display.mjs';
import {actorWorldColor} from '../../apps/web/world-color.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createOwnedPresentation} from '../../apps/web/owned-presentation.mjs';
const json=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const map={lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
for(const id of ['RF','LK','VC','RS','BM','IS']){
 const profile=json('packages/combat-core/'+id.toLowerCase()+'-profile.json'),rows=index.professions[id].states;
 test(id+' all declared skill branches and awakening retain their frozen source triggers, colors and STOP_OTHER_UNIT times',()=>{
  const bytes=readFileSync(new URL('../../packages/combat-core/'+id.toLowerCase()+'-profile.json',import.meta.url));
  // The historical audit stays frozen. BM adds a user-authorized RF XXX
  // resource closure without changing any of the audited state declarations.
  if(id==='BM')assert.equal(index.professions[id].profileSha256,bmOverlay.beforeProfileSha256LF);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),id==='BM'?bmOverlay.afterProfileSha256LF:index.professions[id].profileSha256);
  for(const state of new Set(profile.skillCatalog.flatMap(s=>s.states??[])))assert.ok(rows[state],'missing audit: '+state);
  const sim=createSimulation({profile,map,actors:[{id:'cast',professionId:id,team:0,position:[0,0,0]},{id:'target',professionId:id,team:1,position:[1200,0,0]}]});
  for(const [state,row]of Object.entries(rows)){
   const a=sim.actor('cast'),b=sim.actor('target');a.state=state;a.stateSerial++;a.fired=[];a.awakening.remaining=0;
   if(row.dark)assert.deepEqual(actorWorldColor(a,profile),[34/255,34/255,34/255],state);
   const raw=profile.states[state].raw;
   for(const [field,value]of Object.entries(row.stops))assert.deepEqual(raw[field],value,'original stop declaration remains unchanged: '+state);
   if(raw.SHOW_SKILL_CUT_IN_TIME>=0)assert.deepEqual(row.lightTimes,[raw.SHOW_SKILL_CUT_IN_TIME]);
   for(const [field,entry]of Object.entries(row.stops)){
    // Exercise the common consumer at the source animation boundary, not a
    // fabricated skill-time golden generated from this implementation.
    a.fired=[];b.worldStop=0;sim.drainEvents();sim.processStateEvents(a,entry['1']-1e-6,entry['1']+1e-6);
    const event=sim.drainEvents().find(e=>e.type==='worldStop'&&e.duration===entry['2']);assert.ok(event,id+':'+state+':'+field);
    assert.equal(b.worldStop,entry['2']);
    // Original partial radius + explicit web latency compensation, once.
    b.x=1600;b.worldStop=0;a.animationTime=entry['1']+.2;a.animationPlaybackSpeed=1.4;a.fired=[field];
    const remote=createOwnedPresentation();remote.consume(sim,new Map(),'target',()=>1,()=>.05);
    assert.ok(Math.abs(b.worldStop-Math.max(0,entry['2']/2-.2/1.4-.05))<1e-9);
    const after=b.worldStop;remote.consume(sim,new Map(),'target',()=>1,()=>0);assert.equal(b.worldStop,after);b.x=1200;
   }
  }
 });
 test(id+' user display policy removes casting and awakening hand lights while retaining one ground shock',()=>{
  const raven=['RF','VC','BM'].includes(id),state=raven?'RSI_SI1_MAXIMUM_CANNON':'ESSI_SA_ASSAULT_SLASH';
  const selected=rows[state]??Object.values(rows).find(row=>row.lightTimes.length),name=rows[state]?state:Object.keys(rows).find(n=>rows[n]===selected);
  assert.equal(selected.bone,raven?'Dummy2_Lhand':'Dummy1_Rhand');
  const runtime=createEffectRuntime({index}),bones=[],display=createCastDisplay({runtime,index:{...index,castDisplay:index},profile,samplers:{effectAnchorSampler:(e)=>{bones.push(e.definition.BONE_NAME);return {position:[20,150,0]};}}});
  const actor={id:'cast',professionId:id,hp:100,x:0,y:0,z:0,state:name,stateSerial:1,animationTime:0,awakening:{remaining:0}},view={actors:[actor]};
  display.step(view);actor.animationTime=selected.lightTimes[0];display.step(view);display.step(view);
  assert.deepEqual(display.proof().triggers,{});assert.deepEqual(bones,[]);assert.equal(runtime.emitters.size,0);
  assert.equal(display.proof().handLights,false);
  actor.state=id==='RF'||raven?'RSI_HYPER_MODE':'ESSI_HYPER_MODE';actor.stateSerial++;actor.animationTime=.05;display.step(view);
  actor.animationTime=.83;display.step(view);display.step(view);
  assert.deepEqual(display.proof().triggers,{GroundShockWave:1});assert.deepEqual(bones,[]);
  runtime.step(.25,view);assert.ok(runtime.count>0);assert.ok([...runtime.particles.values()].every(p=>p.position.every(Number.isFinite)));
  for(let i=0;i<240;i++)runtime.step(1/60,view);assert.equal(runtime.count,0);display.clear();assert.equal(display.proof().actors,0);
 });
}
test('independent original source constants: Raven stop1.5 vs Elsword1.3; Blade Rain2.5 and Maximum Cannon .1 light',()=>{
 assert.equal(index.professions.RF.states.RSI_HYPER_MODE.stops.STOP_OTHER_UNIT0['2'],1.5);
 assert.equal(index.professions.LK.states.ESSI_HYPER_MODE.stops.STOP_OTHER_UNIT0['2'],1.3);
 const rain=Object.entries(index.professions.IS.states).find(([n])=>/BLADE_RAIN/.test(n));assert.ok(rain);
 assert.ok(Object.values(rain[1].stops).some(v=>v['2']===2.5));assert.deepEqual(index.professions.RF.states.RSI_SI1_MAXIMUM_CANNON.lightTimes,[.1]);
});

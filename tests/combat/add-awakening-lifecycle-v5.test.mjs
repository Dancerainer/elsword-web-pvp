/** Real profession/template declarations, isolated from pose/GPU resources.
 * The anchor stub verifies ownership only, not original-client geometry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {PROFESSION_PROFILES,PROFESSION_PRESETS} from '../../packages/professions/profiles.mjs';
import {ADD_FORMATION_EFFECT_SET,addFormationPersistentMembers,createAddFormationEffects} from '../../apps/web/add-formation-effects.mjs';
import {changeAddDp,createAddResourcePools,syncAddAwakening,tryAddTimeRingRevive} from '../../packages/combat-core/add-systems.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

const dt=1/60;
const map={sceneId:'add-awakening-lifecycle-v5',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(professionId){
 const profile=PROFESSION_PROFILES[professionId];
 const sim=createSimulation({profile,profiles:PROFESSION_PROFILES,preset:{...PROFESSION_PRESETS[professionId],passives:[],guildPassives:[]},map,
  actors:[{id:'add',professionId,team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)}],
  effectAnchorSampler:(e,a)=>({position:[a.x,a.y,a.z],facing:a.facing,rotation:[0,0,0]})});
 const runtime=createEffectRuntime({index:{templates:profile.effectTemplates},effectQuality:FULL_EFFECT_QUALITY});
 const handles=new Map(),births=[],ends=[];
 function start(event){
  const emitter=runtime.add(event.name,{position:event.birthAnchor.position});assert.ok(emitter,event.name);
  handles.set(event.effectId,emitter.id);
 }
 const formation=createAddFormationEffects({profile,samplers:{effectAnchorSampler:(e,a)=>({position:[a.x,a.y,a.z],facing:a.facing,rotation:[0,0,0]})},
  start,stop:id=>{const handle=handles.get(id);if(handle!==undefined)runtime.stop(handle,true);handles.delete(id);ends.push(id);},
  hasEffect:id=>handles.has(id)&&runtime.emitters.has(handles.get(id))});
 function events(){
  for(const e of sim.drainEvents()){
   if(e.type==='effectStarted'&&e.setName===ADD_FORMATION_EFFECT_SET){
    births.push(e);if(!formation.event(e,sim.state))start(e);
   }
   if(e.type==='effectEnded'){
    const id=handles.get(e.effectId);if(id!==undefined)runtime.stop(id,e.setName===ADD_FORMATION_EFFECT_SET||e.reason==='original-stop-effect-set'||e.reason==='delete-owner-died');
    handles.delete(e.effectId);
   }
  }
  for(const [effectId,id]of handles)if(!runtime.emitters.has(id))handles.delete(effectId);
 }
 const step=(frames=1)=>{for(let i=0;i<frames;i++){sim.step(dt,{}, {snapshot:false});events();formation.step(sim.state);runtime.step(dt,sim.state);}events();};
 const activate=()=>{const a=sim.actor('add');a.sourceAdd.dp=8000;a.sourceAdd.switchCooldown=0;
  assert.equal(sim.tryAwakening(a),true);step(180);assert.equal(a.sourceAdd.formation,true);};
 return {sim,profile,runtime,formation,handles,births,ends,events,step,activate,get a(){return sim.actor('add');}};
}
const report=(f,frameSeq)=>JSON.parse(JSON.stringify(encodeOwnedState(f.sim,'add',{epoch:1,frameSeq})));
function receive(f,value){
 const state=validateOwnedState(value);validateOwnedReferences(state,f.a,f.profile,map,{actors:f.sim.state.actors,profiles:PROFESSION_PROFILES});
 applyOwnedState(f.sim,'add',state);f.events();f.formation.step(f.sim.state);
}

for(const id of ['LP','MM','DE']){
 test(`${id} repeated formation preserves all 37 layers and retires all 25 persistent sequences`,()=>{
  const f=fixture(id),steady=[];
  for(let cycle=0;cycle<12;cycle++){
   const before=f.births.length;f.activate();
   assert.equal(f.births.length-before,37,'every authored startup member still starts exactly once');
   assert.equal(f.formation.proof().handles,25);
   assert.equal(f.sim.state.effects.length,0,'visual attachments add no combat records to later owner packets');
   assert.equal(f.a.sourceAwakeningAuraEffectGroup,undefined);
   assert.equal(f.runtime.emitters.size,25);steady.push(f.runtime.count);
   assert.equal(f.sim.tryAwakening(f.a),true);f.events();f.formation.step(f.sim.state);
   assert.equal(f.runtime.emitters.size,0,'release destroys the original handles immediately');
   assert.equal(f.runtime.count,0);assert.equal(f.a.sourceAwakeningAuraEffectGroup,undefined);
   f.step(180);assert.equal(f.sim.state.effects.length,0);assert.equal(f.handles.size,0);
  }
  assert.ok(steady.every(n=>n===steady[0]),'native particle occupancy cannot grow between activations');
 });

 test(`${id} source-owned formation survives action changes but ends on resource/death/reset paths`,()=>{
  for(const path of ['dp-empty','death','resource-write','old-snapshot','time-ring']){
   const f=fixture(id);f.activate();const ids=f.formation.proof().attachments.map(e=>e.id);
   f.sim.enter(f.a,'RSI_DAMAGE_SMALL_FRONT','lifecycle-probe');f.step(90);
   assert.equal(f.a.sourceAdd.formation,true);assert.deepEqual(f.formation.proof().attachments.map(e=>e.id),ids);
   assert.equal(f.runtime.emitters.size,25,'a new state cannot cancel actor-owned formation');
   if(path==='dp-empty')changeAddDp(f.a,-16000,{profile:f.profile,emit:(...args)=>f.sim.emit(...args)});
   if(path==='death')f.a.hp=0;
   if(path==='resource-write')createAddResourcePools()[0].write(f.a,4000);
   if(path==='old-snapshot'){
    const saved=f.sim.snapshot();const a=saved.actors[0];a.sourceAdd.formation=false;a.sourceAdd.formationPending=false;
    delete a.sourceAwakeningAuraEffectGroup;syncAddAwakening(a);f.sim.restore(saved);
   }
   if(path==='time-ring'){
    f.a.sourceTimeRing={remaining:10,hp:Math.max(1,f.a.hpMax/2),mp:100,dp:0,mutation:2,wayOfSword:null,sourceActorId:'add'};
    assert.equal(tryAddTimeRingRevive(f.sim,f.a,{damage:f.a.hp}),true);
   }
   f.step();assert.equal(f.a.sourceAdd.formation,false,path);
   assert.equal(f.runtime.emitters.size,0,path);assert.equal(f.runtime.count,0,path);
   assert.equal(f.sim.state.effects.length,0,path);assert.equal(f.a.sourceAwakeningAuraEffectGroup,undefined,path);
   assert.equal(f.ends.filter(id=>ids.includes(id)).length,25,path);
  }
 });

 test(`${id} complete owner reports restore formation with zero added records and no residual peers`,()=>{
  const source=fixture(id),peer=fixture(id);peer.sim.state.nextEffectId=50000;
  for(let cycle=0;cycle<6;cycle++){
   source.activate();const value=report(source,cycle*400+180);receive(peer,value);
   assert.equal(value.effects.length,0);assert.equal(peer.sim.state.effects.length,0);
   assert.equal(peer.formation.proof().handles,25);
   for(const entry of peer.formation.proof().attachments){
    assert.ok(entry.id.startsWith('add-formation:add:'),'presentation identity never occupies the combat/network ID namespace');
   }
   peer.step(180);assert.equal(peer.runtime.emitters.size,25);
   source.sim.tryAwakening(source.a);source.step();receive(peer,report(source,cycle*400+181));
   assert.equal(peer.runtime.emitters.size,0);assert.equal(peer.runtime.count,0);
   assert.equal(peer.a.sourceAwakeningAuraEffectGroup,undefined);assert.equal(peer.sim.state.effects.length,0);
   peer.step(180);assert.equal(peer.handles.size,0);
  }
 });
}

test('interrupted Add awakening does not start persistent formation sequences',()=>{
 const f=fixture('LP');f.a.sourceAdd.dp=8000;f.sim.tryAwakening(f.a);
 f.sim.enter(f.a,'RSI_DAMAGE_SMALL_FRONT','interrupt-before-formation-apply');f.step(180);
 assert.equal(f.a.sourceAdd.formation,false);assert.equal(f.births.length,0);
 assert.equal(f.a.sourceAwakeningAuraEffectGroup,undefined);assert.equal(f.runtime.emitters.size,0);
});

test('same-name attachments remain on distinct source bones, replayed births deduplicate and late joins skip finite bursts',()=>{
 const f=fixture('LP');f.activate();const before=f.runtime.emitters.size;
 for(const event of f.births)if(addFormationPersistentMembers(f.profile).some(row=>row.definition.NAME===event.name)){
  assert.equal(f.formation.event({...event,effectId:event.effectId+50000},f.sim.state),true);
 }
 assert.equal(f.runtime.emitters.size,before);
 const line=f.formation.proof().attachments.filter(row=>row.member.match(/^EFFECT(?:1[2-7])$/));
 assert.equal(line.length,6);assert.equal(new Set(line.map(row=>row.bone)).size,6);
 const peer=fixture('LP');receive(peer,report(f,180));assert.equal(peer.runtime.emitters.size,25);
 assert.equal(peer.births.length,0,'late join cannot replay finite startup explosions');
 assert.equal(peer.formation.proof().wireFieldsAdded,0);assert.equal(peer.formation.proof().combatRecordsAdded,0);
});

test('release/removal/profession change revoke attachment slots and a rapid reactivation creates one fresh set',()=>{
 for(const path of ['release','remove','profession']){
  const f=fixture('MM');f.activate();const state=f.sim.state;
  if(path==='release')f.a.sourceAdd.formation=false;
  if(path==='remove')state.actors=[];
  if(path==='profession')f.a.professionId='LP';
  f.formation.step(state);assert.equal(f.runtime.count,0);assert.equal(f.runtime.emitters.size,0);assert.equal(f.formation.proof().actors,0);
  f.formation.clear();assert.equal(f.ends.length,25,'repeated clear cannot double-destroy handles');
 }
 const f=fixture('DE');f.activate();f.a.sourceAdd.formation=false;f.formation.step(f.sim.state);
 f.a.sourceAdd.formation=true;f.formation.step(f.sim.state);assert.equal(f.runtime.emitters.size,25);
 f.formation.clear();assert.equal(f.runtime.emitters.size,0);
});

test('persistent reconciliation respects source startup timing and leaves finite bursts to their original lifetimes',()=>{
 const f=fixture('LP');f.a.sourceAdd.formation=true;f.a.state='RSI_HYPER_MODE';f.a.animationTime=.46;
 f.formation.step(f.sim.state);assert.equal(f.formation.proof().handles,18,'absolute .3/.4 layers are already due at the original .46 apply callback');
 const early=f.formation.proof().attachments;
 for(const row of addFormationPersistentMembers(f.profile).filter(row=>[.3,.4].includes(row.definition.START_TIME)))
  assert.ok(early.some(entry=>entry.member===row.member),row.member);
 assert.equal(early.some(entry=>/^EFFECT1[1-7]$/.test(entry.member)),false,'the authored .5 layers remain pending');
 f.a.animationTime=.5-1e-5;f.formation.step(f.sim.state);assert.equal(f.formation.proof().handles,18);
 f.a.animationTime=.5;f.formation.step(f.sim.state);assert.equal(f.formation.proof().handles,25);
 f.formation.clear();assert.equal(f.runtime.emitters.size,0);
 const g=fixture('LP');g.a.sourceAdd.dp=8000;g.sim.tryAwakening(g.a);g.step(60);
 const persistentNames=new Set(addFormationPersistentMembers(g.profile).map(row=>row.definition.NAME));
 const finite=[...g.runtime.emitters.values()].filter(e=>!persistentNames.has(e.name));
 assert.ok(finite.length>0,'original startup burst is still playing');
 const ids=finite.map(e=>e.id);g.sim.tryAwakening(g.a);g.formation.step(g.sim.state);
 assert.ok(ids.some(id=>g.runtime.emitters.has(id)),'releasing attachments does not hard-cut finite burst tails');
 g.step(180);assert.equal(g.runtime.emitters.size,0);assert.equal(g.runtime.count,0);
});

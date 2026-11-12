import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
/** Actual mixed target poses, Garpai collision and sealed RF commands.
 * LK v2 uses its target-declaration JavaScript adapter. It must retain that
 * executor, never consume Raven callbacks through shared RSI aliases.
 * These are current Web simulation checks, not original-client recordings.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createSimulation,CORE_VERSION} from '../../packages/combat-core/index.mjs';
import {lordKnightCommands} from '../../packages/combat-core/lk-commands.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {PROFESSION_IDS} from '../../packages/professions/catalog.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const assets=await loadServerCombatAssets({root,assetRoot:resolve(root,'artifacts')});
assert.deepEqual(assets.professions,Object.fromEntries(PROFESSION_IDS.map(id=>[id,true])),'complete actual profession asset closure required');

async function mixed(defaultProfession,adaptation){
  const {native:n,samplers}=await assets.createRuntime(),calls=[];
  const commands=Object.fromEntries(Object.entries(n.commands).map(([name,value])=>[name,
    typeof value!=='function'?value:(...args)=>{
      const actor=args[0];
      assert.equal(actor.professionId,'RF',`${name} must never execute the RF bridge for LK`);
      if(name==='runEvent')assert.equal(args[2].target.unitClass,107,'RF acceptance must use the actor RF profile');
      calls.push({name,actorId:actor.id});return value(...args);
    }]));
  const s=createSimulation({profile:assets.profiles[defaultProfession],profiles:assets.profiles,map:assets.map,
    // The global diagnostic flag intentionally disagrees with RF's frozen
    // preset. Both capture and replay must resolve the actor's own preset.
    preset:{...authoredEquipmentPreset(assets.presets[defaultProfession]),sampledComboStopLatch:false},
    presets:{RF:{...authoredEquipmentPreset(assets.presets.RF),sampledComboStopLatch:adaptation},LK:authoredEquipmentPreset(assets.presets.LK)},commonBuffs:assets.commonBuffs,
    seed:20161010,actors:[
      {id:'rf',professionId:'RF',team:0,position:[0,3080,0],lineId:2,facing:1},
      {id:'lk-target',professionId:'LK',team:1,position:[70,3080,0],lineId:2,facing:-1},
      {id:'lk',professionId:'LK',team:0,position:[1200,3080,0],lineId:2,facing:1},
      {id:'rf-target',professionId:'RF',team:1,position:[1270,3080,0],lineId:2,facing:-1},
    ],...samplers,nativeGeometry:n.geometry,nativeCommands:commands,nativeSkills:n.skills,nativeSkillValues:n.skillValues,
    nativeNasod:n.nasod,nativeCritical:n.critical,nativeManaBreak:n.manaBreak});
  const devices=Object.fromEntries(['rf','lk'].map(id=>[id,createInputBuffer({sampledLevels:true})]));
  for(const device of Object.values(devices))device.down('RIGHT',.001);
  const samples=[];
  for(let frame=1;frame<=100;frame++){
    for(const device of Object.values(devices)){
      if((frame-1)%15===0)device.down('X',(frame-.5)/60);
      if((frame-1)%15===2)device.up('X',(frame-.5)/60);
    }
    const inputs=Object.fromEntries(Object.entries(devices).map(([id,device])=>[id,device.consume(frame/60)]));
    const before=Object.fromEntries(['rf','lk'].map(id=>[id,{state:s.actor(id).state,hitStop:s.actor(id).hitStop}]));
    s.step(1/60,inputs,{snapshot:false});
    samples.push({frame,before,inputs,...Object.fromEntries(['rf','lk'].map(id=>{
      const a=s.actor(id);return [id,{state:a.state,animationTime:a.animationTime,hitStop:a.hitStop,
        flags:a.sourceCommandFlags,latch:a.comboStopInput,position:[a.x,a.y,a.z],wayOfSword:a.wayOfSword}];
    }))});
  }
  return {s,calls,samples,events:s.drainEvents()};
}

for(const defaultProfession of ['RF','LK'])test(`actual mixed RF/LK hitstop keeps command/profile/preset isolation with ${defaultProfession} local default`,async()=>{
  const current=await mixed(defaultProfession,true),old=await mixed(defaultProfession,false);
  assert.equal(current.s.snapshot().versions.program,CORE_VERSION);
  for(const actor of current.s.state.actors)assert.equal(actor.actorVersions.program,CORE_VERSION);
  assert.throws(()=>current.s.restore({...current.s.snapshot(),versions:{...current.s.versions,program:'incompatible-mixed-fixture'}}),RangeError);
  assert.equal(current.s.commandsFor(current.s.actor('lk')),lordKnightCommands,'LK retains its independent target binding');
  assert.equal(current.s.presetFor(current.s.actor('rf')).sampledComboStopLatch,true);
  const stopped=current.samples.find(row=>row.frame===16);
  assert.equal(stopped.before.rf.state,'RSI_COMBO_X');assert.equal(stopped.before.lk.state,'RSI_COMBO_X');
  assert.ok(stopped.before.rf.hitStop>0);assert.ok(stopped.before.lk.hitStop>0);
  assert.deepEqual(stopped.inputs.rf.pressed,['X']);assert.deepEqual(stopped.inputs.lk.pressed,['X']);
  assert.equal(stopped.rf.latch.flags,1);assert.equal(stopped.lk.latch,null);
  assert.ok(current.events.some(event=>event.type==='hit'&&event.actorId==='rf'));
  assert.ok(current.events.some(event=>event.type==='hit'&&event.actorId==='lk'));
  assert.ok(current.events.some(event=>event.type==='comboStopInputReplayed'&&event.actorId==='rf'));
  assert.ok(current.events.some(event=>event.type==='stateChanged'&&event.actorId==='rf'&&event.state==='RSI_COMBO_XX'));
  assert.ok(!old.events.some(event=>event.type==='comboStopInputLatched'));
  assert.ok(!old.events.some(event=>event.type==='stateChanged'&&event.actorId==='rf'&&event.state==='RSI_COMBO_XX'));
  assert.ok(!current.events.some(event=>/^comboStopInput/.test(event.type)&&event.actorId.startsWith('lk')));
  assert.deepEqual(current.samples.map(row=>row.lk),old.samples.map(row=>row.lk),'LK motion/clock/stops/flags/gauge retain their existing path');
  assert.ok(current.calls.some(call=>call.name==='runEvent'&&call.actorId==='rf'));
});

/** Actual native accepted lethal hit and same-frame Web owner report.
 * This verifies the merged host lifecycle, not an original client trace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.MERGED_ROOM_PROGRAM_ROOT??resolve(import.meta.dirname,'../..');
const load=path=>import(pathToFileURL(resolve(root,path)));
const {createSimulation}=await import(pathToFileURL(process.env.TIME_RING_CORE_MODULE??resolve(root,'packages/combat-core/index.mjs')));
const {applyAddTimeRingToActor}=await load('packages/combat-core/add-systems.mjs');
const {PROFESSION_PROFILES:profiles,PROFESSION_PRESETS:presets}=await load('packages/professions/profiles.mjs');
const {addMap:map,addNative:native}=await load('tests/helpers/add-fixture.mjs');
const {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState}=await load('packages/online/owned-state.mjs');
function fixture(professionId){
  const sim=createSimulation({profile:profiles.DE,profiles,presets,map,seed:2016,
    actors:[{id:'seal',professionId:'DE',team:0,position:[0,3080,0],lineId:2,loadout:[{skillId:29213},...Array(7).fill(null)],passives:[],guildPassives:[]},
      {id:'recipient',professionId,team:0,position:[100,3080,0],lineId:2,loadout:Array(8).fill(null),passives:[],guildPassives:[]},
      {id:'enemy',professionId:'RF',team:1,position:[200,3080,0],lineId:2,loadout:Array(8).fill(null),passives:[],guildPassives:[]}],
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeCritical:native.critical,nativeNasod:native.nasod,nativeManaBreak:native.manaBreak});
  return {sim,actor:sim.actor('recipient'),caster:sim.actor('seal')};
}
for(const professionId of ['GM','BH','CA','LK','RS','IS'])test(`${professionId}: Time Ring partial sword restore reconciles mode before lethal owner report`,()=>{
  const {sim,actor:a,caster}=fixture(professionId),isElesis=['GM','BH','CA'].includes(professionId);
  sim.applyWayOfSwordDelta(a,-4800,'test-fill');sim.applyWayOfSwordDelta(a,2400,'test-partial');
  assert.deepEqual(a.wayOfSword,{point:-2400,state:-2});
  const activeBuffs=a.buffs.filter(b=>[240,247,434,435].includes(b.templateId)).map(b=>b.templateId);
  if(professionId==='CA')assert.ok(activeBuffs.length,'actual source mode factor was granted');
  if(isElesis){a.sourceElesisBreakCharge=1000;a.manaBreak.charge=50;}
  a.mp=45;const savedHp=a.hpMax*.5;assert.equal(applyAddTimeRingToActor(sim,caster,a),true);
  const receiver=structuredClone(a),epoch=a.lifeEpoch;
  a.hp=1;a.mp=0;
  const hit=sim.injectHit({attackerId:'enemy',targetId:a.id,damageData:{DAMAGE_TYPE:1,DAMAGE:{MAGIC:100},ATTACK_TYPE:1,
    REACT_TYPE:0,IGNORE_DEFENCE:1,BACK_SPEED_X:0,BACK_SPEED_Y:0}});
  assert.equal(hit.accepted,true);assert.equal(a.hp,savedHp);assert.equal(a.mp,45);assert.equal(a.lifeEpoch,epoch);
  assert.equal(a.sourceTimeRing,null);assert.equal(a.sourceTimeSickness,120);assert.equal(a.death,false);
  assert.match(a.state,/DAMAGE_(?:DOWN|AIR_DOWN)/);assert.deepEqual(a.wayOfSword,{point:-2400,state:-1});
  assert.equal(a.buffs.some(b=>activeBuffs.includes(b.templateId)),false,'mode buff ended in this accepted hit');
  assert.equal(sim.state.effects.some(e=>!e.dead&&e.ownerId===a.id&&activeBuffs.includes(e.buffTemplateId)),false,'bound mode effects ended');
  if(isElesis){assert.equal(a.sourceElesisBreakCharge,0);assert.equal(a.manaBreak.charge,0);assert.equal(a.destructionRageRemaining,undefined);}
  const report=encodeOwnedState(sim,a.id,{epoch:1,frameSeq:1});
  assert.doesNotThrow(()=>validateOwnedState(report));
  assert.doesNotThrow(()=>validateOwnedReferences(report,receiver,profiles[professionId],map,{actors:sim.state.actors,profiles}));
  applyOwnedState(sim,a.id,report);assert.deepEqual(a.wayOfSword,{point:-2400,state:-1});
  if(isElesis)assert.equal(a.sourceElesisBreakCharge,0);
});

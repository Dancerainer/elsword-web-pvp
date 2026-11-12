/** Production actor/Buff/wire regression cases. Numeric expectations come
 * from target declarations and hand-evaluated reference consumer formulas;
 * this test is not an original-client trajectory or a naked-stat baseline.
 * Level99 here is an explicit test input, not a new default character value.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {synchronizeBuffStats} from '../../packages/combat-core/passive-attributes-v20.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=name=>JSON.parse(readFileSync(resolve(root,name)));
const profiles=Object.fromEntries(['RF','LK','VC'].map(id=>[id,read('packages/combat-core/'+id.toLowerCase()+'-profile.json')]));
const originalPresets=Object.fromEntries(['RF','LK','VC'].map(id=>[id,authoredEquipmentPreset(read('config/'+id.toLowerCase()+'-preset.json'))]));
const nativeRoot=process.env.RF_EFFECTS_V13_NATIVE_ROOT??root;
const manifest=JSON.parse(readFileSync(resolve(nativeRoot,'artifacts/native/manifest.json')));
const bytes=readFileSync(resolve(nativeRoot,'artifacts/native/skill-values.wasm'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.modules['skill-values'].sha256,'frozen original skill/Buff value binary');
const nativeSkillValues=await instantiateNativeSkillValues(bytes);
const f=Math.fround,empty=()=>Array(8).fill(null);
const map={sceneId:'equipment-composition-integration',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LT_NORMAL'}]};
const selected={formulaVersion:'pvp-equipment-source-candidate-v1',attributeSemantics:'equipment-combat-values-and-final-options',combatLevel:99};
function make({presetPatch={},actors=[],productionPreset=false}={}){
  const presets=Object.fromEntries(Object.entries(originalPresets).map(([id,preset])=>[id,{...preset,...(productionPreset?{}:selected),...presetPatch,loadout:empty()}]));
  return createSimulation({profile:profiles.RF,profiles,map,preset:presets.RF,presets,nativeSkillValues,
    actors:[{id:'rf',professionId:'RF',team:0,position:[0,0,0],lineId:0},
      {id:'lk',professionId:'LK',team:1,position:[1000,0,0],lineId:0},
      {id:'vc',professionId:'VC',team:1,position:[2000,0,0],lineId:0}].map((row,i)=>({...row,...actors[i]}))});
}

test('historical RF/LK/VC preserve the authored equipment numbers and enable the selected level85 formula with600 total MP',()=>{
  // Literal user-defined equipment, independent of the mutable preset files.
  const equipment={hpMax:800000,mpMax:300,physicalAttack:1000,magicAttack:1000,
    animationSpeedMultiplier:1.4,moveSpeedMultiplier:1.23,jumpSpeedMultiplier:1.23,
    damageReduction:.3,awakeningChargeBonus:.5};
  const sim=make({productionPreset:true});
  for(const id of ['RF','LK','VC']){
    assert.deepEqual(originalPresets[id].attributes,equipment,id+' equipment values must not be rebalanced in this formula migration');
    assert.equal(originalPresets[id].formulaVersion,'pvp-equipment-source-candidate-v1');
    assert.equal(originalPresets[id].attributeSemantics,'equipment-combat-values-and-final-options');
    assert.equal(originalPresets[id].combatLevel,85);
    const actor=sim.actor(id.toLowerCase());
    assert.deepEqual(actor.equipmentAttributes,equipment);
    assert.equal(actor.formulaRules.version,'pvp-equipment-source-candidate-v1');
    assert.equal(actor.formulaRules.combatLevel,85);
    assert.equal(actor.formulaRules.characterBase.mpMax,300);
    assert.equal(actor.equipmentAttributes.mpMax,300);
    assert.equal(actor.stats.mpMax,600,'source baseMP300 + equipmentMP300');
    assert.equal(actor.mpMax,600);assert.equal(actor.mp,600);
  }
});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.000001,`${actual} != ${expected}`);
function receive(sim,packet,id='lk'){
  const valid=validateOwnedState(packet),actor=sim.actor(id);
  validateOwnedReferences(valid,actor,sim.profileFor(actor),sim.map,{actors:sim.state.actors,profiles:sim.profiles});
  return applyOwnedState(sim,id,valid);
}

test('RF and LK retain authored equipment independently of profession and guild additions',()=>{
  const sim=make(),rf=sim.actor('rf'),lk=sim.actor('lk');
  for(const actor of [rf,lk]){
    assert.deepEqual(actor.equipmentAttributes,originalPresets[actor.professionId].attributes);
    assert.notEqual(actor.equipmentAttributes,actor.stats);
    assert.notEqual(actor.equipmentAttributes,actor.buffBaseStats);
    assert.equal(actor.formulaRules.version,selected.formulaVersion);
    assert.equal(actor.formulaRules.combatLevel,99);
    assert.equal(actor.equipmentAttributes.physicalAttack,1000);
    assert.equal(actor.equipmentAttributes.magicAttack,1000);
    assert.equal(Object.hasOwn(actor.equipmentAttributes,'physicalDefence'),false,'undefined equipment defence is not rewritten as the guild bonus');
    assert.equal(Object.hasOwn(actor.equipmentAttributes,'magicDefence'),false);
    assert.equal(actor.stats.physicalDefence,50);assert.equal(actor.stats.magicDefence,50);
  }
  assert.equal(rf.stats.physicalAttack,2100,'equipment1000 + RF Focus1000 + guild100');
  // Original326a9860 consumes localMagic after Focus and guild, then adds
  // localMagic*float(SA8-1+epsilon); it does not replace the stage by *SA8.
  const magicDelta=f(f(1.075)-1+4.999999873689376e-5);
  assert.equal(rf.stats.magicAttack,f(2100+2100*magicDelta));
  assert.equal(rf.stats.hpMax,800000);
  assert.equal(lk.stats.physicalAttack,1100);assert.equal(lk.stats.magicAttack,1100);
  assert.equal(lk.equipmentAttributes.hpMax,800000);
  assert.equal(lk.stats.hpMax,f(800000*f(1.06)),'LK StrongBone follows the equipment HP contribution');
});

test('per-actor equipment overrides are captured once and do not overwrite the preset or peer',()=>{
  const before=structuredClone(originalPresets),sim=make({actors:[{attributes:{physicalAttack:1700,physicalDefence:250}}]}),a=sim.actor('rf');
  assert.equal(a.equipmentAttributes.physicalAttack,1700);assert.equal(a.stats.physicalAttack,2800);
  assert.equal(a.equipmentAttributes.physicalDefence,250);assert.equal(a.stats.physicalDefence,300);
  assert.equal(sim.actor('lk').equipmentAttributes.physicalAttack,1000);
  assert.deepEqual(originalPresets,before);
  const equipped=structuredClone(a.equipmentAttributes),base=structuredClone(a.buffBaseStats);
  synchronizeBuffStats(a);synchronizeBuffStats(a);
  assert.deepEqual(a.equipmentAttributes,equipped);assert.deepEqual(a.buffBaseStats,base);
});

test('real target LK Buff18 composes equipment before speed halving and never compounds on reapply',()=>{
  const sim=make(),lk=sim.actor('lk'),equipped=structuredClone(lk.equipmentAttributes);
  close(lk.stats.moveSpeedMultiplier,1.115);
  assert.ok(sim.grantBuff(lk,lk,18,1,null));
  close(lk.stats.moveSpeedMultiplier,1.499375,'(1.23 * 1.625 - 1) / 2 + 1');
  close(lk.stats.jumpSpeedMultiplier,1.115);
  const first=structuredClone(lk.stats);
  sim.grantBuff(lk,lk,18,1,null);synchronizeBuffStats(lk);synchronizeBuffStats(lk);
  assert.equal(lk.buffs.filter(buff=>buff.templateId===18).length,1);
  assert.deepEqual(lk.stats,first);assert.deepEqual(lk.equipmentAttributes,equipped);
  const restored=make();restored.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  const remaining=lk.buffs.find(buff=>buff.templateId===18).finalizers.find(row=>row.kind==='time').remaining;
  sim.advanceActorBuffs(lk,remaining+.1);restored.advanceActorBuffs(restored.actor('lk'),remaining+.1);
  assert.equal(lk.buffs.some(buff=>buff.templateId===18),false);
  close(lk.stats.moveSpeedMultiplier,1.115);close(lk.stats.jumpSpeedMultiplier,1.115);
  assert.deepEqual(lk.equipmentAttributes,equipped);
  assert.equal(lk.stats.physicalAttack,1100);assert.equal(lk.stats.hpMax,f(800000*f(1.06)));
  assert.deepEqual(restored.snapshot(),sim.snapshot());
});

test('formula and equipment identity mutations are rejected before snapshot restoration',()=>{
  const changes=[
    actor=>{actor.equipmentAttributes.physicalAttack=99999;},
    actor=>{actor.equipmentAttributes.moveSpeedMultiplier=9;},
    actor=>{delete actor.equipmentAttributes;},
    actor=>{actor.formulaRules.version='unverified-formula';},
    actor=>{actor.formulaRules.combatLevel=1;},
    actor=>{actor.formulaRules.attributeSemantics='raw-socket-points';},
    actor=>{delete actor.formulaRules;},
  ];
  for(const change of changes){
    const sim=make(),before=sim.snapshot(),mutated=structuredClone(before);change(mutated.actors[0]);
    assert.throws(()=>sim.restore(mutated),/Snapshot actor.*mismatch/);
    assert.deepEqual(sim.snapshot(),before,'invalid restore must not mutate the simulation');
  }
});

test('owner wire carries mutable action state and cannot replace equipment, formula, or computed stat objects',()=>{
  const sender=make(),receiver=make(),a=receiver.actor('lk');
  const report=encodeOwnedState(sender,'lk',{epoch:1,frameSeq:1});
  for(const key of ['equipmentAttributes','formulaRules','stats','buffBaseStats'])assert.equal(Object.hasOwn(report.actor,key),false,key);
  for(const [key,value] of [['equipmentAttributes',{physicalAttack:99999}],['formulaRules',{version:'other',combatLevel:1}],
    ['stats',{physicalAttack:99999,moveSpeedMultiplier:9}],['buffBaseStats',{physicalAttack:99999}]]){
    const bad=structuredClone(report);bad.actor[key]=value;const before=receiver.snapshot();
    assert.throws(()=>receive(receiver,bad),/invalid-owner-state/);
    assert.deepEqual(receiver.snapshot(),before);
  }
  // A valid packet with an actual source Buff is recomposed against the
  // receiving room's retained equipment, then expires through normal code.
  const originalEquipment=structuredClone(a.equipmentAttributes),originalRules=structuredClone(a.formulaRules);
  sender.grantBuff(sender.actor('lk'),sender.actor('lk'),18,1,null);
  receive(receiver,encodeOwnedState(sender,'lk',{epoch:1,frameSeq:2}));
  assert.deepEqual(a.equipmentAttributes,originalEquipment);assert.deepEqual(a.formulaRules,originalRules);
  close(a.stats.moveSpeedMultiplier,1.499375);
  assert.equal(a.stats.physicalAttack,1100);assert.equal(a.stats.magicAttack,1100);
});

test('invalid configured attribute types and unsupported formula identities fail at actor creation',()=>{
  for(const value of ['1000',null,NaN,Infinity,-1])assert.throws(()=>make({actors:[{attributes:{physicalAttack:value}}]}),/Invalid equipment attribute/);
  for(const value of ['1.4',null,NaN,Infinity,.9])assert.throws(()=>make({actors:[{attributes:{animationSpeedMultiplier:value}}]}));
  assert.throws(()=>make({presetPatch:{formulaVersion:'unknown'}}),/Unsupported combat formula/);
  assert.throws(()=>make({presetPatch:{attributeSemantics:'raw-socket'}}),/equipment attribute semantics/);
  for(const value of [undefined,0,-1,1.5,'99'])assert.throws(()=>make({presetPatch:{combatLevel:value}}),/combatLevel/);
});

test('owner wire shape supports both final-damage Buff channels without accepting computed stats',()=>{
  // Synthetic protocol-only fixture, not a claim that the current preset
  // grants this Buff. Source factor/reference validation remains separate.
  const sim=make(),actor=sim.actor('rf');
  actor.buffs=[{schemaVersion:1,templateId:1,skillLevel:1,accumulationLimit:1,resistance:0,durationMultiplier:1,
    behaviors:[['BBT_CHANGE_FINAL_DAMAGE_MULTIPLIER_MELEE_ATTACK','finalDamageMultiplierMelee'],
      ['BBT_CHANGE_FINAL_DAMAGE_MULTIPLIER_RANGE_ATTACK','finalDamageMultiplierRange']].map(([name,stat])=>({
        type:profiles.RF.enums.BUFF_BEHAVIOR_TYPE[name],kind:'stat',stat,value:1.2,changeType:3})),
    finalizers:[{kind:'time',remaining:1,sourceDuration:1}],displayer:{}}];
  const packet=encodeOwnedState(sim,'rf',{epoch:1,frameSeq:1});
  assert.deepEqual(validateOwnedState(packet).actor.buffs[0].behaviors,actor.buffs[0].behaviors);
  assert.equal(Object.hasOwn(packet.actor,'stats'),false);
});

test('new equipment formula initializes all speeds without the legacy speed semantic field',()=>{
  const sim=make({presetPatch:{speedAttributeSemantics:undefined}}),a=sim.actor('lk');
  close(a.stats.animationSpeedMultiplier,1.4);close(a.stats.moveSpeedMultiplier,1.115);close(a.stats.jumpSpeedMultiplier,1.115);
  assert.equal(a.stats.animationSpeedMultiplier,f(1.4),'initial animation has the same float32 precision as later recomposition');
  assert.deepEqual(a.speedAttributeOptions,{animationSpeedMultiplier:1.4,moveSpeedMultiplier:1.23,jumpSpeedMultiplier:1.23});
  const initial=structuredClone(a.stats);
  synchronizeBuffStats(a);assert.deepEqual(a.stats,initial,'first synchronization does not change the initialized speed');
  sim.grantBuff(a,a,18,1,null);close(a.stats.moveSpeedMultiplier,1.499375);
  const remaining=a.buffs.find(buff=>buff.templateId===18).finalizers.find(row=>row.kind==='time').remaining;
  sim.advanceActorBuffs(a,remaining+.1);assert.deepEqual(a.stats,initial);
});

test('finite double values which overflow binary32 are rejected before actor execution',()=>{
  assert.equal(Number.isFinite(1e100),true);assert.equal(Number.isFinite(f(1e100)),false);
  for(const key of ['physicalAttack','physicalDefence','animationSpeedMultiplier','hpMax'])
    assert.throws(()=>make({actors:[{attributes:{[key]:1e100}}]}),new RegExp('Invalid equipment attribute '+key));
});

test('combat level rejects integers outside the exact safe-integer range',()=>{
  const unsafe=Number.MAX_SAFE_INTEGER+1;
  assert.equal(Number.isInteger(unsafe),true);assert.equal(Number.isSafeInteger(unsafe),false);
  assert.throws(()=>make({presetPatch:{combatLevel:unsafe}}),/combatLevel/);
});

test('unsupported raw-point speed Buff types remain rejected by the actor composition boundary',()=>{
  for(const changeType of [1,2]){
    const sim=make(),a=sim.actor('lk');assert.ok(sim.grantBuff(a,a,18,1,null));
    const row=a.buffs.find(buff=>buff.templateId===18).behaviors.find(row=>row.stat==='moveSpeedMultiplier');row.changeType=changeType;
    assert.throws(()=>synchronizeBuffStats(a),/verified option converter/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PVP_FORMULA_VERSION,composeEquipmentCombatStats} from '../../packages/combat-core/equipment-attributes.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
import {requestActorStop} from '../../packages/combat-core/source-stop-queues-v53.mjs';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const profile=read('../../packages/combat-core/rf-profile.json');
const productionPreset=authoredEquipmentPreset(read('../../config/rf-preset.json'));
// Geometry is a test-only carrier for direct source-equation injections, not
// a native-map or movement acceptance fixture. The explicit level99 below is
// a test variable, never evidence for an undefined production character level.
const map={sceneId:'pvp-resource-formula-test',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.1},PVP_RATE:1,REACT_TYPE:1,HIT_ADD_MP:5,FORCE_DOWN:0,STOP_TIME_ATT:0,STOP_TIME_DEF:0};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
function fixture({networkOwnerId=null,onlineMatch=false,attributes={}}={}){
  return createSimulation({profile,map,networkOwnerId,
    preset:{...productionPreset,formulaVersion:PVP_FORMULA_VERSION,attributeSemantics:'equipment-combat-values-and-final-options',
      combatLevel:99,onlineMatch,passives:[],guildPassives:[],loadout:Array(8).fill(null)},
    actors:[{id:'a',team:0,position:[-400,0,0],lineId:0,mp:0,passives:[],guildPassives:[],attributes},
      {id:'b',team:1,position:[400,0,0],lineId:0,mp:0,passives:[],guildPassives:[]}]});
}
const hit=(sim,attackerId='a',targetId='b',damageData=data)=>sim.injectHit({attackerId,targetId,damageData});

test('authored equipment MP300 adds to sourced character MP300 without changing the equipment input',()=>{
  const sim=fixture(),a=sim.actor('a');
  assert.equal(productionPreset.attributes.mpMax,300);
  assert.equal(a.equipmentAttributes.mpMax,300);assert.equal(a.stats.mpMax,600);assert.equal(a.mpMax,600);
  assert.equal(a.formulaRules.characterBase.mpMax,300);
  assert.deepEqual(a.formulaRules.characterBase.unresolved,['hpMax','physicalAttack','magicAttack','physicalDefence','magicDefence']);
  const plain={mpMax:300,hpMax:800000,physicalAttack:1000};
  assert.deepEqual(composeEquipmentCombatStats(plain),{mpMax:600,hpMax:800000,physicalAttack:1000});
  assert.deepEqual(plain,{mpMax:300,hpMax:800000,physicalAttack:1000},'composition does not mutate equipment');
  const naked=fixture({attributes:{mpMax:0}});assert.equal(naked.actor('a').mpMax,300);
});

test('target RF/LK/VC default passive declarations contain no maximum MP addition',()=>{
  for(const id of ['rf','lk','vc']){
    const p=read(`../../packages/combat-core/${id}-profile.json`);
    const passiveRows=p.skillCatalog.filter(row=>p.defaultPassiveSkillIds.includes(row.id??row.skillId));
    assert.equal(passiveRows.length,p.defaultPassiveSkillIds.length);
    for(const row of passiveRows)assert.equal(/SA_MAX_MP|m_iAddMPValue|m_fIncreaseMPRate/.test(JSON.stringify(row.raw)),false);
  }
});

test('new equipment formula gates repeated character/effect hit MP and soul together',()=>{
  const sim=fixture(),a=sim.actor('a'),b=sim.actor('b');
  assert.equal(hit(sim).accepted,true);assert.equal(a.mp,5);assert.equal(b.mp,3);
  assert.equal(a.awakening.gauge,1.5);assert.equal(b.awakening.gauge,3);
  assert.equal(hit(sim).accepted,true);
  sim.applyHit(a,b,data,{kind:'effect',powerMultiplier:1});
  assert.equal(a.mp,5);assert.equal(b.mp,3);assert.equal(a.awakening.gauge,1.5);assert.equal(b.awakening.gauge,3);
  sim.step(.25,{}, {snapshot:false});hit(sim);
  close(a.mp,10.25);close(b.mp,6.25);assert.equal(a.awakening.gauge,3);assert.equal(b.awakening.gauge,6);
});

test('attacking and receiving share the same actor resource budget in either order',()=>{
  const sim=fixture();hit(sim);hit(sim,'b','a');
  assert.equal(sim.actor('a').mp,5);assert.equal(sim.actor('b').mp,3);
  assert.equal(sim.actor('a').awakening.gauge,1.5);assert.equal(sim.actor('b').awakening.gauge,3);
  const reversed=fixture();hit(reversed,'b','a');hit(reversed);
  assert.equal(reversed.actor('a').mp,3);assert.equal(reversed.actor('b').mp,5);
});

test('dummy damage uses the source damaged reaction resource path',()=>{
  const sim=fixture();hit(sim,'a','b',{...data,REACT_TYPE:7});
  assert.equal(sim.actor('a').mp,5);assert.equal(sim.actor('b').mp,3);
  assert.equal(sim.actor('b').awakening.gauge,3);
});

test('PvP roster bonus remains outside equipment hit MP and awakening options',()=>{
  const sim=fixture({onlineMatch:true,attributes:{mpGainBonus:.5}}),a=sim.actor('a');
  a.pvpModifiers={outnumbered:1,hitMpBonus:3,receivedMpBonus:2};
  hit(sim);
  assert.equal(a.mp,10.5,'(5*1.5+3), not (5+3)*1.5');
  assert.equal(a.awakening.gauge,3.5,'1*1.5+2, not (1+2)*1.5');
  assert.equal(sim.actor('b').mp,3);
});

test('natural MP follows unfrozen elapsed and caps at equipment MP maximum',()=>{
  const sim=fixture(),a=sim.actor('a');requestActorStop(a,'hit',.5);
  sim.step(.25,{}, {snapshot:false});assert.equal(a.mp,0);close(sim.actor('b').mp,.25);
  // Native queues deduct before their gate. The exact exhaustion packet
  // resumes with its full elapsed; a shorter world stop has no residual slice.
  sim.step(.25,{}, {snapshot:false});close(a.mp,.25);
  requestActorStop(a,'world',.1);sim.step(.25,{}, {snapshot:false});close(a.mp,.5);
  a.mp=a.mpMax-.1;sim.step(.25,{}, {snapshot:false});assert.equal(a.mp,a.mpMax);
});

test('missing target natural recovery declaration remains unsupported instead of inheriting one MP',()=>{
  const sim=fixture();delete sim.profile.components.MP_CHANGE_RATE;
  sim.step(.25,{}, {snapshot:false});assert.equal(sim.actor('a').mp,0);assert.equal(sim.actor('b').mp,0);
  assert.ok(sim.actor('a').unsupported.some(row=>JSON.stringify(row).includes('natural-mp-source-missing')));
});

test('Raven socket integer MP recovery uses its independently sourced received clock through STOP',()=>{
  const sim=fixture({attributes:{mpRecoveryPerSecond:10}}),a=sim.actor('a');
  sim.step(.25,{}, {snapshot:false});close(a.mp,2.75,'Gage.25 plus independently sourced socket2.5');
  assert.ok(!a.unsupported.some(row=>row.id==='equipment-mp-clock-unsupported'));
  requestActorStop(a,'hit',.5);sim.step(.25,{}, {snapshot:false});close(a.mp,5.25,'socket runs in later received callback');
  sim.step(.25,{}, {snapshot:false});close(a.mp,8,'Gage resumes on the complete exhaustion packet; socket is still once');
});

test('natural MP continues during unfrozen death animation, stopping at existing deathComplete lifecycle',()=>{
  const sim=fixture(),a=sim.actor('a');a.hp=0;
  sim.step(.25,{}, {snapshot:false});close(a.mp,.25);
  a.deathComplete=true;sim.step(.25,{}, {snapshot:false});close(a.mp,.25);
});

test('local-owner attack/receive resource gate and HP writes never mutate remote observations',()=>{
  const sim=fixture({networkOwnerId:'a'}),a=sim.actor('a'),b=sim.actor('b');
  const remote=structuredClone(b);hit(sim);
  assert.equal(a.mp,5);assert.equal(a.awakening.gauge,1.5);assert.deepEqual(b,remote);
  const hp=a.hp;hit(sim,'b','a');assert.ok(a.hp<hp);assert.equal(a.mp,5,'received route sees the local attack gate');
  assert.deepEqual(b,remote,'disposable remote attacker gate never leaks into observed actor');
  sim.step(.25,{}, {snapshot:false});close(a.mp,5.25);assert.equal(b.hp,remote.hp);assert.equal(b.mp,remote.mp);
});

test('trusted replay snapshots retain shared frame; player wire protocol cannot send the gate',()=>{
  const sim=fixture();hit(sim);
  const restored=fixture();restored.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  hit(sim);hit(restored);assert.deepEqual(restored.snapshot(),sim.snapshot());
  assert.equal(restored.actor('a').mp,5);
  const report=encodeOwnedState(sim,'a',{frameSeq:1});
  assert.equal(Object.hasOwn(report.actor,'lastCombatResourceStep'),false);
  assert.throws(()=>validateOwnedState({...report,actor:{...report.actor,lastCombatResourceStep:0}}),/invalid-owner-state/);
});

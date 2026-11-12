/** Cross-module regressions: fixed SwordMan priority and target2016 skill rows.
 * The map only hosts state/received-hit tests; posed collision is tested separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const preset=JSON.parse(readFileSync(new URL('../../config/lk-preset.json',import.meta.url)));
const map={sceneId:'lk-combined-consumers',lines:[{lineId:0,start:[-4000,0,0],end:[4000,0,0]}]};
const root=process.env.LK_NATIVE_FIXTURE_ROOT??fileURLToPath(new URL('../../',import.meta.url));
const native=await createNativeRuntime({manifest:JSON.parse(readFileSync(resolve(root,'artifacts/native/manifest.json'))),map,
  loadBinary:path=>readFileSync(resolve(root,'artifacts/native',path))});
function make({passives=[],loadout=[{skillId:21217},{skillId:21219}]}={}){
  const sim=createSimulation({profile,map,nativeSkillValues:native.skillValues,nativeCritical:native.critical,
    preset:{...preset,loadout:[...loadout,...Array(8-loadout.length).fill(null)],guildPassives:[],passives},
    actors:[{id:'lk',professionId:'LK',team:0,x:0,y:0,lineId:0,facing:1,passives},
      {id:'other',professionId:'LK',team:1,x:1500,y:0,lineId:0,facing:-1,passives:[],loadout:Array(8).fill(null)}]});
  sim.rng=()=>.99;return {sim,a:sim.actor('lk'),b:sim.actor('other')};
}
const incoming={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:1,ATTACK_TYPE:0,STOP_TIME_ATT:0,STOP_TIME_DEF:0};
function hit(sim,data=incoming){return sim.injectHit({attackerId:'other',targetId:'lk',damageData:data});}
function advance(sim,seconds){for(let t=0;t<seconds;t+=1/60){sim.step(1/60,{});sim.drainEvents();}}

test('active destruction Auto Guard has priority over rage and accepts only real Roll input',()=>{
  const {sim,a}=make({passives:[21401]});sim.prepareWayOfSword('lk',-2);sim.rng=()=>0;sim.drainEvents();
  const result=hit(sim);assert.ok(result.amount>0);assert.match(a.state,/^ESSI_SI_P_ESK_AUTO_GUARD/);
  assert.equal(a.wayOfSword.point,-4800);assert.equal(a.destructionRageRemaining,0);
  assert.ok(!sim.drainEvents().some(e=>e.type==='destructionRageStarted'));
  assert.equal(sim.skillAvailability('lk',0).available,true);assert.equal(sim.skillAvailability('lk',1).available,false);
  sim.step(1/60,{lk:{pressed:['S']}});assert.equal(a.skillId,null);
  const before=a.mp;sim.step(1/60,{lk:{pressed:['A']}});
  assert.equal(a.skillId,21217);assert.equal(a.state,'ESSI_SI_A_ES_ROLLING');assert.equal(a.mp,before-15);
});

test('front Counter returns before Auto Guard and destruction rage without consuming either resource',()=>{
  const {sim,a}=make({passives:[21401],loadout:[{skillId:21206}]});sim.prepareWayOfSword('lk',-2);
  sim.step(1/60,{lk:{pressed:['A']}});a.animationTime=.1;a.invincible=false;sim.rng=()=>0;sim.drainEvents();
  const hp=a.hp,result=hit(sim,{...incoming,DAMAGE:{PHYSIC:2},CAN_REVENGE:1});
  assert.equal(result.countered,true);assert.equal(a.hp,hp);assert.equal(a.state,'ESSI_REVENGE_ATTACK');
  assert.equal(a.sourceLordKnight.revengePower,2);assert.equal(a.sourceLordKnight.autoGuardCooldown,0);
  assert.equal(a.wayOfSword.point,-4800);assert.equal(a.destructionRageRemaining,0);
  assert.deepEqual(sim.drainEvents().filter(e=>['lkCounter','lkAutoGuard','destructionRageStarted'].includes(e.type)).map(e=>e.type),['lkCounter']);
});

test('IronBody same-packet armor suppresses destruction rage and its expiry restores rage eligibility',()=>{
  const {sim,a}=make({loadout:[{skillId:21218}]});sim.prepareWayOfSword('lk',-2);
  sim.step(1/60,{lk:{pressed:['A']}});assert.equal(a.superArmor,true);const state=a.state;
  assert.ok(hit(sim).amount>0);assert.equal(a.state,state);assert.equal(a.destructionRageRemaining,0);
  advance(sim,5.2);assert.equal(a.superArmor,false);assert.equal(a.stats.finalDefenceMultiplier,undefined);
  const result=hit(sim);assert.ok(Math.abs(result.amount-1.5*.2*1810)<.002,'fixed-V5 additional stage follows destruction ordinary-damage suppression');assert.equal(a.state,'ESSI_DESTRUCTION_RAGE');assert.equal(a.destructionRageRemaining,6);
});

test('independent IronBody pauses an existing destruction armor clock, then its remaining time resumes',()=>{
  const {sim,a}=make({loadout:[{skillId:21218}]});sim.prepareWayOfSword('lk',-2);hit(sim);
  advance(sim,1);assert.equal(a.state,'ESSI_SWORD_WAIT');assert.ok(a.destructionRageRemaining>4&&a.destructionRageRemaining<6);
  sim.step(1/60,{lk:{pressed:['A']}});assert.ok(a.buffs.some(b=>b.templateId===18));
  const remaining=a.destructionRageRemaining;advance(sim,4.5);assert.equal(a.destructionRageRemaining,remaining);
  advance(sim,1);assert.ok(!a.buffs.some(b=>b.templateId===18));assert.ok(a.destructionRageRemaining<remaining&&a.destructionRageRemaining>0);
  advance(sim,6);assert.equal(a.destructionRageRemaining,0);assert.equal(a.superArmor,false);
});

for(const mode of [-2,2])test(`target Kick skill ends at sword wait and accepts Z into Z2, sword mode ${mode}`,()=>{
  const {sim,a}=make({loadout:[{skillId:21219,branchId:'memo-28'}]});sim.prepareWayOfSword('lk',mode);
  const expected=mode===2?10.5:15;assert.equal(sim.skillAvailability('lk',0).mpCost,expected);
  sim.step(1/60,{lk:{pressed:['A']}});assert.equal(a.mp,300-expected,'baseMP300 + equipment0 - source skill cost');assert.equal(a.skillId,21219);
  advance(sim,2);assert.equal(a.state,'ESSI_SWORD_WAIT');assert.equal(a.skillId,null);assert.equal(a.skillContext,null);
  assert.equal(a.animationName,mode===2?'Wait_W0':'Wait_W1');sim.step(1/60,{lk:{pressed:['Z']}});assert.equal(a.state,'RSI_COMBO_Z');
  for(let i=0;i<30&&a.state==='RSI_COMBO_Z';i++)sim.step(1/60,{lk:{pressed:i===10?['Z']:[],held:i>=10?['Z']:[]}});
  assert.equal(a.state,'RSI_COMBO_ZZ');
});

test('vitality hit MP composes with the target absorb branch multiplier once',()=>{
  for(const mode of [0,2]){
    const {sim,a}=make();sim.prepareWayOfSword('lk',mode);a.mp=0;
    // Use accepted-hit origin metadata, as the actual skill/effect path does.
    const b=sim.actor('other');
    sim.applyHit(a,b,{...incoming,HIT_ADD_MP:8,ATTACK_TYPE:2,WAY_OF_SWORD_TYPE:2},{traitPolicy:{hitMpMultiplier:1.4}});
    assert.equal(a.mp,Math.fround(Math.fround(Math.fround(8*Math.fround(1.4))*Math.fround(1.3))*(mode===2?4:1)),
      'target8 * source float32 absorb1.4 * equipment1.3 * vitality4, without a second recovery');
  }
});

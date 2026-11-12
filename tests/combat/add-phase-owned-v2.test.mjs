/** Real LP input and original map/native geometry. ADD_CORE_FIXTURE_ROOT only
 * selects read-only resource inputs; the tested program is always this tree. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {PROFESSION_PROFILES,PROFESSION_PRESETS} from '../../packages/professions/profiles.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

const inputRoot=process.env.ADD_CORE_FIXTURE_ROOT??fileURLToPath(new URL('../../',import.meta.url));
const read=p=>JSON.parse(readFileSync(path.join(inputRoot,p)));
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,
  loadBinary:p=>readFileSync(path.join(inputRoot,'artifacts/native',p))});
const keys={pressed:new Set(['A']),held:new Set(),released:new Set(),ordered:[]};
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture(networkOwnerId){
  return createSimulation({profile:PROFESSION_PROFILES.LP,profiles:PROFESSION_PROFILES,
    preset:{...PROFESSION_PRESETS.LP,guildPassives:[],passives:[]},map,seed:2016,networkOwnerId,
    actors:[{id:'lp',professionId:'LP',team:0,position:[0,3080,0],lineId:2,facing:1,
      loadout:[{skillId:29216,branchId:'none'},...Array(7).fill(null)]}],
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeCritical:native.critical,nativeNasod:native.nasod,nativeManaBreak:native.manaBreak});
}
function checked(sim){
  const actor=sim.actor('lp'),value=validateOwnedState(clone(encodeOwnedState(sim,'lp',{epoch:1,frameSeq:1})));
  validateOwnedReferences(value,actor,sim.profileFor(actor),sim.map,{actors:sim.state.actors,profiles:sim.profiles});return value;
}

for(const networkOwnerId of [null,'lp'])test('LP Phase Shift return preserves required geometry until next support solve, owner='+networkOwnerId,()=>{
  const sim=fixture(networkOwnerId),a=sim.actor('lp');
  sim.processInput(a,keys);assert.equal(a.state,'ANSI_A_AN_PHASE_SHIFT');sim.processStateEvents(a,0,.11);
  assert.ok(a.sourceAddCombat.phase);const saved=structuredClone(a.sourceAddCombat.phase);
  const effect=sim.state.effects.find(e=>e.name==='DamageEffect_Add_Phase_Shift');assert.ok(effect);
  // Isolate the second input after its ordinary free-state gate; do not claim
  // this deliberate QA state transition is an original-client cancel trace.
  sim.enter(a,'RSI_WAIT','qa-phase-return-input');a.x+=100;
  const before=[a.x,a.y,a.z],oldLand=[...a.landPosition],mp=a.mp,dp=a.sourceAdd.dp,mutation=a.sourceAdd.mutation,cooldown=a.cooldowns[29216];
  const plan=sim.skillAvailability(a.id,0);assert.equal(plan.mode,'phase-return');assert.equal(plan.available,true);
  sim.processInput(a,keys);assert.equal(a.state,'ANSI_A_AN_PHASE_SHIFT_BLINK');
  assert.equal(a.grounded,false);assert.equal(a.lineId,null);assert.deepEqual(a.landPosition,oldLand);
  assert.deepEqual([a.x,a.y,a.z],saved.position,'original nearest-line result remains the saved point on this authored segment');
  assert.deepEqual([effect.x,effect.y,effect.z],before,'dummy moves to the previous caster position');
  assert.equal(a.sourceAddCombat.phase,null);assert.equal(a.mp,mp-plan.mpCost);
  assert.equal(a.sourceAdd.dp,dp);assert.equal(a.sourceAdd.mutation,mutation);assert.equal(a.cooldowns[29216],cooldown);
  // No step or repair occurs before encoding: the old null vector failed here.
  // Restore a receiver copy: its live core gains local collision receipts,
  // while the canonical sent JSON remains the exact round-trip expectation.
  const packet=checked(sim),received=clone(packet),mirror=fixture(networkOwnerId);
  assert.deepEqual(validateOwnedState(received),packet);applyOwnedState(mirror,'lp',received);
  assert.deepEqual(mirror.actor('lp').landPosition,oldLand);assert.deepEqual(checked(mirror),packet);
  const restored=fixture(networkOwnerId);restored.restore(clone(sim.snapshot()));assert.deepEqual(checked(restored),packet);
  sim.step(1/60,{}, {snapshot:false});checked(sim);
});

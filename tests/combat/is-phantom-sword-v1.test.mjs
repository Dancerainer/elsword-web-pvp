/** Fixed-V5 consumer expectations and target2016 declaration checks are
 * independent of the port; these are not original-client measurements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {phantomSwordSync,phantomSwordStateStart,phantomSwordStateEnd,phantomSwordFrame,phantomSwordEffectControls} from '../../packages/combat-core/is-phantom-sword.mjs';
const read=file=>JSON.parse(readFileSync(new URL(file,import.meta.url)));
const original=read('../../packages/combat-core/is-profile.json');
const contract=read('../../contracts/is-phantom-sword-source-v1.json');
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
const matrix=x=>[1,0,0,0,0,0,1,0,0,-1,0,0,x,20,30,1];
function fixture(){
  const profile=structuredClone(original);
  // Small declaration fixture below is copied from target damage bytecode,
  // and deliberately does not depend on whether conversion has run locally.
  profile.damageEffects.THIRD_BLADE??={raw:{MAIN_EFFECT_NAME:'ThirdBlade',ATTACK_TIME_START:1.4,ATTACK_TIME_END:1.5,
    DAMAGE_TIME:99999,USE_GLOBAL_TIME:1,DAMAGE_DATA:{DAMAGE:{PHYSIC:23.43},PVP_RATE:.42,REACT_TYPE:2,ATTACK_TYPE:1}}};
  profile.effectTemplates.ThirdBladeCenter??={};
  const a={id:'is',hp:100,state:'RSI_WAIT',stateSerial:1,facing:1,skillId:21022,skillScale:1,
    buffs:[{templateId:29,behaviors:[{kind:'phantomSword'}],finalizers:[{remaining:25}]}]};
  const sim={state:{time:0,effects:[],nextEffectId:1},profileFor:()=>profile,animationSpeed:()=>1,
    effectAnchorSampler:()=>({position:[sim.state.time*1000,20,30],rotation:[0,0,0],facing:a.facing,matrix:matrix(sim.state.time*1000)}),
    createEffect(actor,definition,{birthAnchor}){const e={id:this.state.nextEffectId++,ownerId:actor.id,name:definition.NAME,definition,
      damage:structuredClone(profile.damageEffects[definition.NAME]?.raw??null),birthAnchor,elapsed:0,hits:{},hitGaps:{}};this.state.effects.push(e);return e;},
    note(id){throw new Error(id);}};
  phantomSwordSync(sim,a);return {sim,a,profile,state:a.sourceInfinitySword.phantomSword,blade:sim.state.effects[0],center:sim.state.effects[1]};
}
test('Phantom Sword source identity is independently pinned and old memo26 is excluded',()=>{
  assert.equal(contract.source.gitBlob,'81a8cc4ba5adc167078789a123feb74e0bb39816');
  assert.equal(contract.consumer.delaySeconds,.2);assert.equal(contract.consumer.damageMultiplier,1.2);
  assert.equal(contract.consumer.maxQueueCatchUpPerFrame,2);assert.equal(contract.clientMeasured,false);
  assert.deepEqual(original.skillCatalog.find(s=>s.skillId===21022).branches.map(b=>b.memoId),[47,58]);
});
test('constructor preserves target summon attack and retains one blade and center across refresh',()=>{
  const {sim,a,blade,center}=fixture();
  near(blade.damage.DAMAGE_DATA.DAMAGE.PHYSIC,23.43);assert.equal(blade.damage.ATTACK_TIME_START,1.4);
  assert.equal(blade.buffTemplateId,29);assert.equal(center.buffTemplateId,29);
  phantomSwordSync(sim,a);assert.equal(sim.state.effects.length,2);assert.equal(a.sourceInfinitySword.phantomSword.effectId,blade.id);
});
test('selected second sword segment uses target DAMAGE_DATA_NEXT, play speed, delayed window and fresh receipts',()=>{
  const {sim,a,state,blade}=fixture();a.state='ESSI_ETK_COMBO_XX';a.stateSerial=2;sim.animationSpeed=()=>2;
  blade.hits.enemy=1;blade.hitGaps.enemy=.3;blade.powerMultiplier=3;blade.traitPolicy={forceCritical:true};phantomSwordStateStart(sim,a);
  near(state.currentAttack.start,.493);near(state.currentAttack.end,.5265);
  near(blade.damage.DAMAGE_DATA.DAMAGE.PHYSIC,1.788);near(blade.damage.DAMAGE_DATA.STOP_TIME_DEF,.099);
  assert.equal(blade.damage.DAMAGE_DATA.BACK_SPEED_X,400);assert.equal(blade.damage.DAMAGE_DATA.FORCE_DOWN,0);
  assert.equal(blade.damage.DAMAGE_DATA.HIT_ADD_MP,0);assert.equal(blade.damage.DAMAGE_DATA.ATTACK_TYPE,1);
  assert.equal(blade.damage.DAMAGE_DATA.ARRANGED_FLY,1);assert.deepEqual(blade.hits,{});assert.deepEqual(blade.hitGaps,{});
  assert.equal(blade.powerMultiplier,1);assert.equal(blade.traitPolicy,null);
  blade.hits.enemy=2;phantomSwordEffectControls(sim.profileFor(a),a,blade);assert.deepEqual(blade.hits,{enemy:2},'same row never erases accepted hits');
});
test('one hundred second air window is clamped on interruption, with subsequent reaction override preserved',()=>{
  const {sim,a,state,blade}=fixture();a.state='RSI_JUMP_COMBO_Z';a.stateSerial=2;phantomSwordStateStart(sim,a);
  near(state.currentAttack.end,100.21);state.time=.4;phantomSwordStateEnd(sim,a);near(state.currentAttack.end,.6);near(blade.damage.ATTACK_TIME_END,.6);
  a.state='ESSI_ETK_COMBO_XXXZ';a.stateSerial=3;a.facing=-1;phantomSwordStateStart(sim,a);
  assert.equal(state.attacks.length,2);blade.elapsed=.6;sim.state.time=.65;phantomSwordFrame(sim,a,.05);
  assert.equal(state.currentAttack.serial,3);assert.equal(blade.damage.DAMAGE_DATA.REACT_TYPE,4);
  assert.equal(blade.damage.DAMAGE_DATA.BACK_SPEED_Y,1800);assert.equal(blade.damageDirectionRight,false);
});
test('delayed complete right-hand matrix is shared by both meshes and catch-up is capped at two samples',()=>{
  const {sim,a,state,blade,center}=fixture();
  for(const time of [.05,.1,.15,.2,.25,.3]){sim.state.time=time;phantomSwordFrame(sim,a,.05);blade.elapsed+=.05;}
  near(blade.sourcePosedAnchor.position[0],150);assert.deepEqual(blade.sourcePosedAnchor.matrix,matrix(150));
  assert.deepEqual(center.sourcePosedAnchor,blade.sourcePosedAnchor);assert.notDeepEqual(blade.sourcePosedAnchor.matrix,matrix(300));
  state.matrixQueue=[0,.01,.02,.03,.04].map(time=>({time,anchor:{position:[time*1000,20,30],rotation:[0,0,0],facing:1,matrix:matrix(time*1000)}}));
  sim.state.time=1;phantomSwordFrame(sim,a,.05);assert.equal(state.matrixQueue.length,4);assert.equal(blade.sourcePosedAnchor.position[0],20);
});
test('expiry, manual buff removal and death destroy both identities and clear queued attacks',()=>{
  for(const cancel of [a=>{a.buffs[0].finalizers[0].remaining=0;},a=>{a.buffs=[];},a=>{a.hp=0;}]){
    const {sim,a,blade,center}=fixture();a.state='RSI_JUMP_COMBO_Z';phantomSwordStateStart(sim,a);cancel(a);phantomSwordSync(sim,a);
    assert.equal(a.sourceInfinitySword.phantomSword,undefined);assert.equal(blade.dead,true);assert.equal(center.dead,true);
  }
});

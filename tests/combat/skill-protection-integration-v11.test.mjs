import {historicalRfPreset} from '../helpers/rf-historical-preset-v20.mjs';
/** Actual keyboard/source-state integration. Literal expectations are from
 * target2016 state declarations and pinned V5 consumers, not current output.
 * Controlled enemy hits isolate protection/counter semantics; they are not
 * measured target-client trajectories. The fixture bundle remains read-only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {NATIVE_RUNTIME_VERSION,NATIVE_RUNTIME_MODULE_COUNT} from '../../packages/native-source/runtime-version.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';

const project=fileURLToPath(new URL('../../',import.meta.url));
const fixtureRoot=process.env.RF_SKILL_PROTECTION_FIXTURE_ROOT??
  (existsSync(resolve(project,'artifacts/native/critical.wasm'))?project:
    resolve(project,'../../rf-native-v11/elsword_2016_webpvp'));
const read=p=>JSON.parse(readFileSync(resolve(project,p)));
const nativeRoot=process.env.RF_NATIVE_FIXTURE_ROOT??fixtureRoot;
const fixture=p=>JSON.parse(readFileSync(resolve(p.startsWith('artifacts/native/')?nativeRoot:fixtureRoot,p)));
const profile=read('packages/combat-core/rf-profile.json'),preset=historicalRfPreset(read('config/rf-preset.json'));
const manifest=fixture('artifacts/native/manifest.json');
const map={...fixture('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),
  ...fixture('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const indexes=['rf-fx-index.json','rf-buff-display-fx-index.json','rf-shadow-weapon-fx-index.json',
  'rf-awakening-fx-index.json','rf-command-fx-index-v9.json','rf-skill-fx-index-v11.json',
  'rf-core-shield-fx-index-v11.json','rf-critical-fx-index-v11.json'].map(n=>read('contracts/'+n));
const effectIndex=mergeEffectIndexes(fixture('artifacts/rf/effect-assets.json'),mergeVisualEffectIndexes(...indexes));
const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))]
  .map(p=>[p,fixture('artifacts/rf/'+p)]));
const pose=fixture('artifacts/rf/runtime-pose.json');
const strike=Object.freeze({DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:3,HIT_TYPE:1,
  BACK_SPEED_X:500,BACK_SPEED_Y:1000,STOP_TIME_DEF:.1});
const frame=(f,rf={},target={})=>f.s.step(1/60,{rf,target},{snapshot:false});
function until(f,predicate,label,input={},limit=300){
  for(let i=0;i<limit&&!predicate();i++)frame(f,input);
  assert.ok(predicate(),label+'; actual state '+f.a.state+' clock '+f.a.animationTime);
}
async function make(skillId,{position=[2022.98,2840,0],lineId=6,facing=-1,gap=120,orbs=0}={}){
  const n=await createNativeRuntime({manifest,map,loadBinary:p=>readFileSync(resolve(nativeRoot,'artifacts/native',p))});
  const s=createSimulation({profile,map,...createNativeSamplers({profile,characterPose:pose,effectIndex,effectPoses}),
    preset:{...preset,passives:[],loadout:[skillId?{skillId}:null,...Array(7).fill(null)]},
    actors:[{id:'rf',team:0,position,lineId,facing,awakening:{orbs}},
      {id:'target',team:1,position:[position[0]+gap,position[1],position[2]],lineId,facing:-facing}],
    nativeGeometry:n.geometry,nativeCommands:n.commands,nativeSkills:n.skills,nativeSkillValues:n.skillValues,
    nativeNasod:n.nasod,nativeCritical:n.critical,nativeManaBreak:n.manaBreak,seed:2016,versions:n.versions});
  // Known .5 roll isolates noncritical hits. This is a host fixture, not a claim
  // about original per-category random table consumption.
  s.rng=()=>.5;s.drainEvents();return {s,a:s.actor('rf'),b:s.actor('target'),n};
}
function armoredHit(f,{amount=1000}={}){
  const state=f.a.state,serial=f.a.stateSerial,hp=f.a.hp;
  assert.equal(f.a.superArmor,true);assert.equal(f.a.invincible,false);
  const result=f.s.applyHit(f.b,f.a,strike,{kind:'controlled-enemy-protection-hit'});
  assert.equal(result.accepted,true);assert.equal(result.amount,amount);assert.equal(f.a.hp,hp-amount);
  assert.equal(f.a.state,state);assert.equal(f.a.stateSerial,serial);assert.equal(f.a.hitStop,0);
  assert.equal(f.s.state.events.filter(e=>e.type==='hit'&&e.actorId==='target').at(-1).deleteDamageReactEffects,false);
}
function dash(f){
  const key=f.a.facing>0?'RIGHT':'LEFT';frame(f,{pressed:[key],held:[key]});
  frame(f,{released:[key]});frame(f,{pressed:[key],held:[key]});return key;
}

test('production fixture has the complete frozen modules and independent2016 armor declarations',()=>{
  assert.equal(manifest.runtimeVersion,NATIVE_RUNTIME_VERSION);
  assert.equal(Object.keys(manifest.modules).length,NATIVE_RUNTIME_MODULE_COUNT);
  assert.deepEqual(Object.keys(manifest.modules).sort(),['camera','commands','commands-recovery','critical',
    'effect-random','geometry','nasod','skill-values','skills','mana-break'].sort());
  const expected={
    RSI_A_RRF_HELL_DIVE_UPGRADE:{SUPER_ARMOR_TIME0:{1:0,2:.57},SUPER_ARMOR_NOT_RED:0},
    RSI_A_RRF_LIMIT_CRUSHER_CHARGE:{SUPER_ARMOR:1,SUPER_ARMOR_NOT_RED:0},
    RSI_A_RRF_LIMIT_CRUSHER_REVENGE_ATTACK:{SUPER_ARMOR:1,SUPER_ARMOR_NOT_RED:0},
    RSI_A_RRF_LIMIT_CRUSHER_AVOID_ATTACK:{SUPER_ARMOR:1,SUPER_ARMOR_NOT_RED:0},
    RSI_SA_RRF_WILD_CHARGING:{SUPER_ARMOR:1},
    RSI_SHADOW_STEP_Z_UPGRADE:{SUPER_ARMOR:1,SUPER_ARMOR_NOT_RED:0},
    RSI_OVER_TAKER_DASH_COMBO_ZX:{SUPER_ARMOR_TIME0:{1:.325,2:1.1},SUPER_ARMOR_NOT_RED:0},
    RSI_OVER_TAKER_COMBO_XXfrontX:{SUPER_ARMOR_TIME0:{1:.1,2:100},SUPER_ARMOR_NOT_RED:0},
    RSI_OVER_TAKER_COMBO_XXfrontXX:{SUPER_ARMOR:1,SUPER_ARMOR_NOT_RED:0},
    RSI_OVER_TAKER_COMBO_XXfrontXX2:{SUPER_ARMOR:1,SUPER_ARMOR_NOT_RED:0},
    RSI_OVER_TAKER_COMBO_XXfrontXX3:{SUPER_ARMOR:1,SUPER_ARMOR_NOT_RED:0},
    RSI_OVER_TAKER_COMBO_XXfrontXX4:{SUPER_ARMOR:1,SUPER_ARMOR_NOT_RED:0},
  };
  for(const [name,fields]of Object.entries(expected))assert.deepEqual(
    Object.fromEntries(Object.entries(profile.states[name].raw).filter(([k])=>k.startsWith('SUPER_ARMOR'))),fields,name);
});

test('actual WildCharge A held entersReady thenCharging, original +30 applies, release subtracts30 and stops group',async()=>{
  const f=await make(24009,{gap:1200});frame(f,{pressed:['A'],held:['A']});
  assert.equal(f.a.state,'RSI_SA_RRF_WILD_CHARGE_READY');assert.equal(f.a.skillDamageReducePercent??0,0);
  until(f,()=>f.a.state==='RSI_SA_RRF_WILD_CHARGING','held skill reaches charging',{held:['A']});
  assert.equal(f.a.skillDamageReducePercent,30);assert.equal(f.a.superArmor,true);
  frame(f,{held:['A']});assert.equal(f.a.superArmorNotRed,false,'original Now SetSuperArmorNotRed(false) reaches actor gate');
  armoredHit(f,{amount:700});
  assert.ok(f.s.state.events.some(e=>e.type==='originalSkillCommand'&&e.commandType==='effectSet'&&e.name==='EffectSet_RF_WILD_CHARGE_CHARGING'));
  assert.ok(f.a.sourceWildChargeEffectGroup?.length>0,'source charging binds its real generated effect group');
  frame(f,{released:['A']});assert.equal(f.a.state,'RSI_SA_RRF_WILD_CHARGE_DASH');
  assert.equal(f.a.skillDamageReducePercent,0);assert.equal(f.a.sourceWildChargeEffectGroup,undefined);
  assert.equal(f.a.skillSuperArmorNotRed,undefined,'charging-only override cannot leak into dash');
  assert.ok(f.s.state.events.some(e=>e.type==='effectEnded'&&e.setName==='EffectSet_RF_WILD_CHARGE_CHARGING'&&e.reason==='original-stop-effect-set'));
  until(f,()=>f.a.skillId===null,'source dash exits');assert.equal(f.a.skillDamageReducePercent,0);
  assert.equal(f.a.superArmor,false);assert.equal(f.a.superArmorNotRed,true);
});

test('a fatal accepted hit during actualWildCharge also runs original chargingEnd and clears its30 reduction',async()=>{
  const f=await make(24009,{gap:1200});frame(f,{pressed:['A'],held:['A']});
  until(f,()=>f.a.state==='RSI_SA_RRF_WILD_CHARGING','held skill reaches charging',{held:['A']});
  frame(f,{held:['A']});assert.equal(f.a.skillDamageReducePercent,30);
  const hit=f.s.applyHit(f.b,f.a,{...strike,DAMAGE:{PHYSIC:2000}},{kind:'controlled-fatal-hit'});
  assert.equal(hit.accepted,true);assert.equal(f.a.hp,0);assert.match(f.a.state,/RSI_DIE/);
  assert.equal(f.a.skillDamageReducePercent,0);assert.equal(f.a.sourceWildChargeEffectGroup,undefined);
});

for(const state of ['RSI_PARRYING_SMALL','RSI_PARRYING'])test(`actual core ${state} acceptsShadow keyboard cancel and cleans guard flags`,async()=>{
  // First Z's original damage effect is offset ahead of the attacker. At -300
  // it hits RF from the front; -120 incorrectly put the effect behind RF.
  const f=await make(24217,{orbs:1,gap:state==='RSI_PARRYING_SMALL'?-300:-120});frame(f,{pressed:['CTRL'],held:['CTRL']});
  for(let i=0;i<89;i++)frame(f);
  assert.equal(f.a.core.level,2);assert.equal(f.a.core.gauge,40);assert.equal(f.a.core.helperLive,true);
  if(state==='RSI_PARRYING_SMALL'){
    for(let i=0;i<100&&f.a.state!==state;i++)frame(f,{},i===0||i===8?{pressed:['Z'],held:['Z']}:{});
    assert.ok(f.s.state.events.some(e=>e.type==='hit'&&e.guarded&&e.origin?.kind==='effect'&&e.data.REACT_TYPE===1));
  }else{
    const hit=f.s.applyHit(f.b,f.a,{...strike,REACT_TYPE:2},{kind:'controlled-front-big-hit'});
    assert.equal(hit.guarded,true);
  }
  assert.equal(f.a.state,state);assert.equal(f.a.core.parrying,true);assert.equal(f.a.core.canParry,true);
  assert.equal(f.a.core.level,1);assert.equal(f.a.core.gauge,20);
  until(f,()=>f.a.animationTime>=.31,'source .3 parry skill-cancel window');
  assert.equal(f.a.state,state);const mp=f.a.mp;
  frame(f,{pressed:['A'],held:['A']});assert.equal(f.a.state,'RSI_SI_A_RF_SHADOW_STEP');
  assert.equal(f.a.skillId,24217);assert.equal(f.a.mp,mp-20);
  assert.deepEqual([f.a.core.parrying,f.a.core.canParry,f.a.core.guardRemaining],[false,false,0]);
  assert.equal(f.a.core.phase,'idle');assert.equal(f.a.core.helper.scale,1);
  assert.equal(f.s.state.events.filter(e=>e.type==='coreGuardEnded'&&e.actorId==='rf').length,1);
  until(f,()=>f.a.skillId===null,'Shadow source action ends');
  assert.deepEqual([f.a.core.parrying,f.a.core.canParry,f.a.core.guardRemaining],[false,false,0]);
});

test('actual upgradedShadow Z has source stateArmor and survives a damaging received hit',async()=>{
  const f=await make(24217,{gap:1200});frame(f,{pressed:['A'],held:['A']});
  until(f,()=>f.a.stateTime>.2,'strict Shadow follow-up window');frame(f,{pressed:['Z']});
  assert.equal(f.a.state,'RSI_SHADOW_STEP_Z_UPGRADE');assert.equal(f.a.superArmorNotRed,false);armoredHit(f);
  until(f,()=>f.a.skillId===null,'upgraded Z ends');assert.equal(f.a.superArmor,false);
});

test('actualHellDive survives its0..0.57 armor window and can be interrupted after it',async()=>{
  const f=await make(24219,{gap:1200});frame(f,{pressed:['A'],held:['A']});
  until(f,()=>f.a.animationTime>=.1,'HellDive inside armor');assert.equal(f.a.state,'RSI_A_RRF_HELL_DIVE_UPGRADE');
  armoredHit(f);until(f,()=>f.a.animationTime>.57,'HellDive armor expires');
  assert.equal(f.a.state,'RSI_A_RRF_HELL_DIVE_UPGRADE');assert.equal(f.a.superArmor,false);
  const previous=f.a.state,result=f.s.applyHit(f.b,f.a,strike,{kind:'controlled-after-armor-hit'});
  assert.equal(result.accepted,true);assert.notEqual(f.a.state,previous);assert.equal(f.a.skillId,null);
});

test('actualLimitCrusher held/released uses source .45 successor, whose armor preserves received hits',async()=>{
  const f=await make(24205,{gap:1200});frame(f,{pressed:['A'],held:['A']});
  assert.equal(f.a.state,'RSI_A_RRF_LIMIT_CRUSHER_CHARGE');assert.equal(f.a.superArmor,true);
  until(f,()=>f.a.animationTime>=.5,'source release threshold',{held:['A']});
  frame(f,{released:['A']});assert.equal(f.a.state,'RSI_A_RRF_LIMIT_CRUSHER_REVENGE_ATTACK');armoredHit(f);
  until(f,()=>f.a.skillId===null,'source counter action ends');assert.equal(f.a.superArmor,false);
});

// GUUser11469..11479 is a special counter before generic armor/reaction.
// DamageManager.cpp309 defaults CAN_REVENGE to true. Charge being armored
// must not suppress this transition or make the AVOID state unreachable.
for(const canRevenge of [undefined,1,0])test(`actualLimitCrusher charge receivedHit CAN_REVENGE=${canRevenge??'default'} picks original counter`,async()=>{
  const f=await make(24205,{gap:1200});frame(f,{pressed:['A'],held:['A']});
  assert.equal(f.a.state,'RSI_A_RRF_LIMIT_CRUSHER_CHARGE');const hp=f.a.hp;
  const data=canRevenge===undefined?strike:{...strike,CAN_REVENGE:canRevenge};
  const hit=f.s.applyHit(f.b,f.a,data,{kind:'controlled-limit-counter-hit'});
  assert.equal(hit.accepted,true);assert.equal(f.a.hp,hp-1000);
  assert.equal(f.a.state,canRevenge===0?'RSI_A_RRF_LIMIT_CRUSHER_AVOID_ATTACK':'RSI_A_RRF_LIMIT_CRUSHER_REVENGE_ATTACK');
  assert.equal(f.a.superArmor,true);assert.equal(f.a.hitStop,0);armoredHit(f);
  until(f,()=>f.a.skillId===null,'selected counter source Event ends');assert.equal(f.a.superArmor,false);
});

test('real66ZX accepts a hit inside target .325..1.1 rushing armor without losing the action',async()=>{
  const f=await make(null,{position:[-1100,3080,0],lineId:2,facing:1,gap:2400}),key=dash(f);
  frame(f,{pressed:['Z'],held:[key,'Z']});for(let i=0;i<3;i++)frame(f,{held:[key]});
  frame(f,{pressed:['X'],held:[key,'X']});
  until(f,()=>f.a.state==='RSI_OVER_TAKER_DASH_COMBO_ZX'&&f.a.animationTime>=.4,'66ZX armor begins');
  assert.equal(f.a.superArmorNotRed,false);armoredHit(f);
});

test('realXX6XXXXX progression preserves received hits in timedthirdX and each state-armored continuation',async()=>{
  const f=await make(null,{position:[-1100,3080,0],lineId:2,facing:1,gap:2400}),held=['RIGHT'];
  frame(f,{pressed:['X'],held});for(let i=0;i<10;i++)frame(f,{held});frame(f,{pressed:['X'],held});
  until(f,()=>f.a.state==='RSI_COMBO_XX','second X',{held});for(let i=0;i<10;i++)frame(f,{held});
  frame(f,{pressed:['X'],held});until(f,()=>f.a.state==='RSI_OVER_TAKER_COMBO_XXfrontX','forward third X',{held});
  assert.equal(f.a.superArmor,false,'timed .1 is not entry armor');
  const states=['RSI_OVER_TAKER_COMBO_XXfrontX','RSI_OVER_TAKER_COMBO_XXfrontXX',
    'RSI_OVER_TAKER_COMBO_XXfrontXX2','RSI_OVER_TAKER_COMBO_XXfrontXX3','RSI_OVER_TAKER_COMBO_XXfrontXX4'];
  for(const state of states){
    until(f,()=>f.a.state===state&&f.a.animationTime>=.35,state+' input/protection window',{held});
    assert.equal(f.a.superArmorNotRed,false);armoredHit(f);
    if(state!==states.at(-1))frame(f,{pressed:['X'],held});
  }
});

test('source-only MegaDrill without the user protection override can be interrupted',async()=>{
  const f=await make(24203,{gap:1200});f.s.preset.customStateProtection={};frame(f,{pressed:['A'],held:['A']});
  until(f,()=>f.a.animationTime>=.15,'MegaDrill action');assert.equal(f.a.state,'RSI_A_RF_MEGADRILL_BREAK');
  assert.equal(f.a.superArmor,false);assert.equal(f.a.invincible,false);
  const hit=f.s.applyHit(f.b,f.a,strike,{kind:'controlled-unprotected-skill-hit'});
  assert.equal(hit.accepted,true);assert.notEqual(f.a.state,'RSI_A_RF_MEGADRILL_BREAK');assert.equal(f.a.skillId,null);
});

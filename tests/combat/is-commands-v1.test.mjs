import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createSampledKeyboardBuffer} from '../../apps/web/sampled-keyboard.mjs';
import {infinitySwordCommands,isCommandSkillCancelAllowed} from '../../packages/combat-core/is-commands.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/is-profile.json',import.meta.url)));
const asset=(p)=>JSON.parse(readFileSync(new URL('../../artifacts/'+p,import.meta.url)));
const map={...asset('scene/sander-garpai-rock-pvp/manifest.json'),...asset('scene/sander-garpai-rock-pvp/collision.json')};
const native=await createNativeRuntime({manifest:asset('native/manifest.json'),map,
 loadBinary:p=>readFileSync(new URL('../../artifacts/native/'+p,import.meta.url))});
const empty=()=>Array(8).fill(null);
function fixture(facing=1){
 const sim=createSimulation({profile,preset:{guildPassives:[],doubleTapWindowSeconds:.4,loadout:empty()},
  map,nativeGeometry:native.geometry,
  actors:[{id:'is',professionId:'IS',team:0,position:[-600*facing,3080,0],lineId:2,facing,loadout:empty(),awakening:{orbs:3}}]});
 const a=sim.actor('is'),input=createSampledKeyboardBuffer(),forward=facing===1?'RIGHT':'LEFT';
 const source=()=>profile.states[a.state].sourceState;
 const step=()=>sim.step(1/60,{is:input.consume(sim.state.time+1/60)});
 const down=k=>{input.down(k,sim.state.time+.001);step();},up=k=>{input.up(k,sim.state.time+.001);step();};
 const tap=k=>{down(k);up(k);};
 const wait=(fn,label,max=360)=>{for(let i=0;i<max&&!fn();i++)step();assert.ok(fn(),label+' got '+source()+' @ '+a.animationTime);};
 const state=n=>wait(()=>source()===n,'expected '+n);
 const time=t=>{const serial=a.stateSerial;wait(()=>a.animationTime>=t||a.stateSerial!==serial,'time '+t);assert.equal(a.stateSerial,serial);};
 const next=(k,n,at=.05)=>{time(at);const before=a.stateSerial;tap(k);wait(()=>a.stateSerial>before,'source transition');state(n);};
 const dash=()=>{tap(forward);down(forward);assert.equal(a.state,'RSI_DASH');};
 return {sim,a,input,forward,source,step,tap,down,up,wait,state,time,next,dash};
}
// Successors and timing are explicit target tables plus independently read
// SwordMan callback branches, never expectations generated from a run.
for(const facing of [-1,1]){
 test(`IS ${facing}: sampled ZZZZZ reaches five authored attacks and recovers`,()=>{
  const f=fixture(facing);f.tap('Z');f.next('Z','ESSI_COMBO_Z2');f.next('Z','ESSI_ETK_COMBO_ZZZ');
  f.next('Z','ESSI_ETK_COMBO_ZZZZ',.28);f.next('Z','ESSI_ETK_COMBO_ZZZZZ',.28);f.state('ESSI_WAIT');
 });
 test(`IS ${facing}: sampled double X inside XX reaches loop, loop limit is three`,()=>{
  const f=fixture(facing);f.tap('X');f.next('X','ESSI_ETK_COMBO_XX');f.tap('X');f.next('X','ESSI_ETK_COMBO_XXX_LOOP');
  f.next('X','ESSI_ETK_COMBO_XXX_LOOP');
  const before=f.a.stateSerial;f.time(.05);f.tap('X');f.wait(()=>f.a.stateSerial>before,'repeat loop');
  assert.equal(f.a.sourceInfinitySword.comboLoops,3);f.time(.05);f.tap('X');f.state('ESSI_ETK_COMBO_XXX_END');f.state('ESSI_WAIT');
 });
 test(`IS ${facing}: source loop Z branch and 66XXX reuse shared entry`,()=>{
  const z=fixture(facing);z.tap('X');z.next('X','ESSI_ETK_COMBO_XX');z.tap('X');z.next('X','ESSI_ETK_COMBO_XXX_LOOP');z.next('Z','ESSI_ETK_COMBO_XXXZ');z.state('ESSI_WAIT');
  const x=fixture(facing);x.dash();x.tap('X');x.next('X','ESSI_EIS_DASH_COMBO_XX',.3);x.next('X','ESSI_EIS_DASH_COMBO_XXX',.3);x.up(x.forward);x.state('ESSI_WAIT');
 });
 test(`IS ${facing}: final Z after all three sampled X loops retains its complete source pose`,()=>{
  const f=fixture(facing);f.tap('X');f.next('X','ESSI_ETK_COMBO_XX');f.tap('X');f.next('X','ESSI_ETK_COMBO_XXX_LOOP');
  f.next('X','ESSI_ETK_COMBO_XXX_LOOP');f.next('X','ESSI_ETK_COMBO_XXX_LOOP');
  assert.equal(f.a.sourceInfinitySword.comboLoops,3);f.next('Z','ESSI_ETK_COMBO_XXXZ');
  f.time(.40001);assert.equal(f.source(),'ESSI_ETK_COMBO_XXXZ');f.time(1.05);assert.equal(f.source(),'ESSI_ETK_COMBO_XXXZ');
  f.state('ESSI_WAIT');
 });
 test(`IS ${facing}: XX sheath deadline does not dash-cancel and loop armor tint restores`,()=>{
  const f=fixture(facing);f.sim.enter(f.a,'RSI_COMBO_XX','source-XX-cancel-fixture');
  f.a.animationTime=.10001;
  assert.equal(infinitySwordCommands.runEvent(f.a,{held:new Set(),pressed:new Set(['DASH'])},profile).state,null);
  f.a.animationTime=1.00001;
  assert.equal(infinitySwordCommands.runEvent(f.a,{held:new Set([f.forward]),pressed:new Set()},profile).state,'RSI_WAIT');
  // Independent SwordMan Start16073–16077 / End16121–16126 expectations.
  f.sim.enter(f.a,'ESSI_ETK_COMBO_XXX_LOOP','source-loop-armor-fixture');
  assert.equal(f.a.skillSuperArmorNotRed,false);assert.equal(f.a.superArmorNotRed,false);
  f.step();assert.equal(f.a.superArmor,true);assert.equal(f.a.superArmorNotRed,false);
  f.sim.enter(f.a,'RSI_COMBO_XXX','source-loop-armor-end');
  assert.equal(f.a.skillSuperArmorNotRed,undefined);assert.equal(f.a.superArmorNotRed,true);
 });
 test(`IS ${facing}: strict trait/awakening cancel and retained stop input`,()=>{
  const f=fixture(facing);f.sim.enter(f.a,'RSI_COMBO_ZZZZ','feedback-window-fixture');f.a.animationTime=.24;
  const k={held:new Set(),pressed:new Set(['AWAKEN'])};assert.equal(infinitySwordCommands.runEvent(f.a,k,profile).state,null);
  f.a.animationTime=.24001;assert.equal(infinitySwordCommands.runEvent(f.a,k,profile).state,'AWAKEN_REQUEST');
  const z=fixture(facing);z.tap('Z');z.time(.1);z.a.hitStop=.1;z.tap('Z');z.state('ESSI_COMBO_Z2');
 });
 test(`IS ${facing}: ZZZ uses literal cancel gates while 66ZZ sheath timer grants no dash`,()=>{
  const f=fixture(facing);f.sim.enter(f.a,'RSI_DASH_COMBO_ZZ','source-dash-ZZ-cancel-fixture');
  f.a.animationTime=.20001;
  const dash={held:new Set(),pressed:new Set(),[facing===1?'pureDoubleRight':'pureDoubleLeft']:true};
  assert.equal(infinitySwordCommands.runEvent(f.a,dash,profile).state,null);
  // SwordMan15857–15888 explicitly puts un-timed dash and .01 skill cancel
  // before the buffered next-Z branch; neither is the raw .2 sheath timer.
  f.sim.enter(f.a,'RSI_COMBO_ZZZ','source-ZZZ-literal-cancel');f.a.animationTime=0;
  assert.equal(infinitySwordCommands.runEvent(f.a,dash,profile).state,'DASH_REQUEST');
  const awaken={held:new Set(),pressed:new Set(['AWAKEN'])};
  f.a.animationTime=.01;assert.equal(infinitySwordCommands.runEvent(f.a,awaken,profile).state,null);
  assert.equal(isCommandSkillCancelAllowed(f.a,profile.states[f.a.state]),false);
  f.a.animationTime=.01001;assert.equal(infinitySwordCommands.runEvent(f.a,awaken,profile).state,'AWAKEN_REQUEST');
  assert.equal(isCommandSkillCancelAllowed(f.a,profile.states[f.a.state]),true);
 });
 test(`IS ${facing}: 66ZZ and 668ZZZ retain original shared entry and landing`,()=>{
  const z=fixture(facing);z.dash();z.tap('Z');z.next('Z','ESSI_ETK_DASH_COMBO_ZZ');z.up(z.forward);z.state('ESSI_WAIT');
  const j=fixture(facing);j.dash();j.tap('UP');for(let i=0;i<4;i++)j.step();j.tap('Z');
  j.next('Z','ESSI_DASH_JUMP_COMBO_Z2');j.next('Z','ESSI_ETK_DASH_JUMP_ZZZ');j.up(j.forward);j.state('ESSI_WAIT');
 });
 test(`IS ${facing}: 668XX stores the X/Z landing choice`,()=>{
  for(const [key,last]of [['X','ESSI_EIS_DASHJUMP_COMBO_XXX'],['Z','ESSI_COMBO_Z1'],[null,'ESSI_DASH_JUMP_COMBO_X2_LANDING']]){
   const j=fixture(facing);j.dash();j.tap('UP');for(let i=0;i<4;i++)j.step();j.tap('X');j.next('X','ESSI_EIS_DASHJUMP_COMBO_XX');
   if(key)j.tap(key);j.state(last);assert.equal(j.a.grounded,true);
  }
 });
}

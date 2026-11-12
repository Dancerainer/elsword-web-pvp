/** Actual original pose/WASM/Garpai execution; independent source expectations
 * are the two additional XZ attacks and original four-MP effect emission. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
const dt=1/60;
const noSkills=()=>Array(8).fill(null);
const source=(p,state)=>p.states[state]?.sourceState??state;
function highAir(facing=1){
 const f=elesisFixture('BH',{skillId:28220,passives:[],position:[0,10000,0],gap:2000,facing});
 f.sim.configureLoadout(noSkills(),f.a.id);f.a.grounded=false;f.a.lineId=null;f.a.mp=f.a.mpMax;
 // Native character ticks also run the independent MP_CHANGE_RATE recovery
 // clock (index CommonFrameMove boundary). Observe this command's callback
 // debit directly, before a later recovery tick can mask it. The expected
 // four MP is the fixed source constant; no recovered net loss becomes gold.
 const fire=f.sim.fire.bind(f.sim);f.commandMpDebits=[];
 f.sim.fire=(a,key,at,before,after,callback)=>fire(a,key,at,before,after,()=>{
  const isCommand=a.id===f.a.id&&key==='elesis-command-carrier'&&source(f.profile,a.state)==='ESI_DASH_JUMP_COMBO_SPK_XZ';
  const oldMp=a.mp;callback();if(isCommand)f.commandMpDebits.push(oldMp-a.mp);
 });
 f.sim.enter(f.a,'ESI_DASH_JUMP_COMBO_SPK_XZ','independent-air-repeat-fixture');return f;
}
function step(f,held=[],pressed=[]){f.sim.step(dt,{elesis:{held,pressed,sampledDevice:true}},{snapshot:false});}
function wait(f,predicate,limit=120){for(let i=0;i<limit&&!predicate();i++)step(f);assert.ok(predicate(),f.a.state+' '+f.a.animationTime);}
for(const facing of [-1,1])test(`BH Native ${facing}: 668XZZZ emits exactly three original fireballs and passes full-wire validation`,()=>{
 const f=highAir(facing);
 assert.deepEqual(f.profile.states.ESI_DASH_JUMP_COMBO_SPK_XZ.raw.EVENT_PROCESS_TIME0,{'1':0,'2':100,'3':.383});
 for(let i=0;i<2;i++){
  const serial=f.a.stateSerial;wait(f,()=>f.a.animationTime>.21);step(f,['Z'],['Z']);step(f);
  wait(f,()=>f.a.stateSerial!==serial);assert.equal(source(f.profile,f.a.state),'ESI_DASH_JUMP_COMBO_SPK_XZ');
 }
 wait(f,()=>f.a.animationTime>.21);const last=f.a.stateSerial;step(f,['Z'],['Z']);step(f);
 // Give the exhausted fourth request its original dispatch clock, but keep
 // the current third attack before animation end.
 wait(f,()=>f.a.animationTime>.40);assert.equal(f.a.stateSerial,last);
 const events=f.sim.drainEvents();
 const emissions=events.filter(e=>e.type==='effectStarted'&&e.actorId===f.a.id&&e.setName==='EffectSet_A_EL_DashJump_Combo_XZ'&&e.name==='DamageEffect_Elesis_SPK_DashJump_Combo_XZ');
 assert.equal(emissions.length,3,'original emission callback runs once per real action');
 assert.equal(f.commandMpDebits.length,3,'one actual MP debit per original command callback');
 for(const debit of f.commandMpDebits)assert.ok(Math.abs(debit-4)<.0001,'original four-MP callback debit, within binary32 rounding');
 assert.ok(Math.abs(f.commandMpDebits.reduce((n,v)=>n+v,0)-12)<.0003,'original four-MP cost times three, independently of natural MP recovery');
 validateOwnedState(encodeOwnedState(f.sim,f.a.id));
});
for(const facing of [-1,1])test(`BH Native ${facing}: leaving a step does not delete XZ's buffered XZZ branch`,()=>{
 const f=elesisFixture('BH',{skillId:28220,position:[0,5000,0],gap:2000,facing});
 f.sim.configureLoadout(noSkills(),f.a.id);f.a.grounded=false;f.a.lineId=null;
 f.sim.enter(f.a,'ESI_COMBO_SBH_XZ','independent-ledge-followup');const serial=f.a.stateSerial;
 step(f,['Z'],['Z']);step(f);wait(f,()=>f.a.stateSerial!==serial);
 assert.equal(source(f.profile,f.a.state),'ESI_COMBO_SBH_XZZ');assert.equal(f.a.grounded,false);
 validateOwnedState(encodeOwnedState(f.sim,f.a.id));
});

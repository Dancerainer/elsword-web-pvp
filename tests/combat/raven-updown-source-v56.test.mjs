import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {ravenLocalUpDownRequest,runRavenLocalCommandPost} from '../../packages/combat-core/raven-local-command-v56.mjs';
import {applySourceStateRequest} from '../../packages/combat-core/source-state-requests-v53.mjs';
const read=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
const keys=(held=[],pressed=[])=>({held:new Set(held),pressed:new Set(pressed),released:new Set(),edges:[]});
const f=Math.fround;
function fixture(id='RF'){
 const sim=createSimulation({profile:read('packages/combat-core/'+id.toLowerCase()+'-profile.json'),
  map:{sceneId:'source-raven132',lines:[{lineId:0,start:[-6000,0,0],end:[6000,0,0],type:'LT_NORMAL'}]},
  preset:{passives:[],guildPassives:[],loadout:Array(8).fill(null)},actors:[{id:'a',professionId:id,team:0,position:[0,0,0],lineId:0},{id:'b',professionId:id,team:1,position:[5000,0,0],lineId:0}]});
 const a=sim.actor('a');sim.enter(a,'RSI_COMBO_ZZXX','original132-fixture');a.inputLock=0;sim.drainEvents();return {sim,a};
}
test('original132 predicate keeps zero/nonnegative field, strict float32 threshold and unordered rejection',()=>{
 for(const limit of [0,f(.6)])for(const direction of ['UP','DOWN']){
  assert.equal(ravenLocalUpDownRequest({grounded:true,time:limit,limit,held:new Set([direction])}),false);
  assert.equal(ravenLocalUpDownRequest({grounded:true,time:limit+.0001,limit,held:new Set([direction])}),true);
 }
 for(const [time,limit]of [[1,-1],[1,NaN],[NaN,.6]])assert.equal(ravenLocalUpDownRequest({grounded:true,time,limit,held:new Set(['UP'])}),false);
 assert.equal(ravenLocalUpDownRequest({grounded:false,time:1,limit:.6,held:new Set(['UP'])}),false);
});
for(const id of ['BM','RF','VC'])test(id+' shared132 held direction requests WAIT after .6 and does not execute a jump in the post',()=>{
 for(const direction of ['UP','DOWN']){
  const {sim,a}=fixture(id);a.animationTime=f(.6);const serial=a.stateSerial;
  assert.equal(runRavenLocalCommandPost(sim,a,keys([direction])),true);assert.equal(a.sourcePendingState,undefined);
  a.animationTime=f(.601);runRavenLocalCommandPost(sim,a,keys([direction]));
  assert.equal(a.sourcePendingState.state,'RSI_WAIT');assert.equal(a.state,'RSI_COMBO_ZZXX');assert.equal(a.stateSerial,serial);assert.equal(a.vy,0);
  assert.equal(applySourceStateRequest(sim,a),true);assert.equal(a.state,'RSI_WAIT');assert.equal(a.vy,0);
 }
});
test('original132 loses contact before up/down, decrements Y once and preserves end overwrite',()=>{
 const {sim,a}=fixture();a.grounded=false;a.animationTime=.8;const y=a.y;
 runRavenLocalCommandPost(sim,a,keys(['UP']));assert.equal(a.sourcePendingState.state,'RSI_JUMP_DOWN');assert.equal(a.y,f(y-45));
 a.animationStopped=true;runRavenLocalCommandPost(sim,a,keys(['UP']));assert.equal(a.sourcePendingState.state,'RSI_WAIT');
});
test('explicit user ordered82 preinput remains in its existing product adapter',()=>{
 const {sim,a}=fixture();a.animationTime=.8;a.cancelInput={stage:'pending',commands:['UP','DOWN','X']};
 assert.equal(runRavenLocalCommandPost(sim,a,keys(['UP'])),false);assert.equal(a.sourcePendingState,undefined);
 assert.deepEqual(a.cancelInput.commands,['UP','DOWN','X']);
});
test('132 pending request survives JSON and only applies on the next normal step',()=>{
 const {sim,a}=fixture();a.animationTime=.7;runRavenLocalCommandPost(sim,a,keys(['UP']));
 const next=fixture();next.sim.restore(JSON.parse(JSON.stringify(sim.snapshot())));
 assert.equal(next.a.state,'RSI_COMBO_ZZXX');sim.step(1/120,{}, {snapshot:false});next.sim.step(1/120,{}, {snapshot:false});
 assert.equal(a.state,'RSI_WAIT');assert.deepEqual(JSON.parse(JSON.stringify(next.sim.snapshot())),JSON.parse(JSON.stringify(sim.snapshot())));
});
test('normal step queues original held-UP WAIT while preserving zero vertical impulse',()=>{
 const {sim,a}=fixture();a.animationTime=f(.601);sim.step(1/240,{a:{held:['UP']}},{snapshot:false});
 assert.equal(a.state,'RSI_COMBO_ZZXX');assert.equal(a.sourcePendingState.state,'RSI_WAIT');assert.equal(a.vy,0);
 sim.step(1/240,{}, {snapshot:false});assert.equal(a.state,'RSI_WAIT');assert.equal(a.vy,0);
});

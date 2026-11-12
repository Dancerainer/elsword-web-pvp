import test from 'node:test';
import assert from 'node:assert/strict';
import {ravenSocketMpValue,advanceRavenSocketMp} from '../../packages/combat-core/raven-socket-mp-v56.mjs';
import {PVP_FORMULA_VERSION} from '../../packages/combat-core/equipment-attributes.mjs';
test('original socket absolute setter preserves signed integer input, float32 store and its one-sided cap',()=>{
 assert.equal(ravenSocketMpValue({current:1,max:300,rate:-10,delta:.25}),-1.5);
 assert.equal(ravenSocketMpValue({current:299,max:300,rate:10,delta:.25}),300);
 assert.equal(ravenSocketMpValue({current:310,max:300,rate:-10,delta:.25}),310,'caller only attempts when max>current');
 const expected=Math.fround(Math.fround(1.1)+3*Math.fround(1/60));assert.equal(ravenSocketMpValue({current:1.1,max:300,rate:3,delta:1/60}),expected);
 for(const rate of [1.5,2147483648,NaN])assert.throws(()=>ravenSocketMpValue({current:1,max:300,rate,delta:.1}),/socket MP/);
});
test('Web socket bridge is Raven-only, current owner-only and preserves retired actor lifecycle',()=>{
 const a={id:'a',hp:0,mp:1,mpMax:300,formulaRules:{version:PVP_FORMULA_VERSION},equipmentAttributes:{mpRecoveryPerSecond:10}};
 const sim={networkOwnerId:null,profileFor:()=>({target:{unitClass:107}}),note(){}};
 advanceRavenSocketMp(sim,a,.25);assert.equal(a.mp,3.5,'no invented HP>0 gate');
 sim.networkOwnerId='other';advanceRavenSocketMp(sim,a,.25);assert.equal(a.mp,3.5);
 sim.networkOwnerId=null;a.deathComplete=true;advanceRavenSocketMp(sim,a,.25);assert.equal(a.mp,3.5);
 a.deathComplete=false;sim.profileFor=()=>({target:{unitClass:100}});advanceRavenSocketMp(sim,a,.25);assert.equal(a.mp,3.5);
});

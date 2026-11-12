/** Original mode-change consumer32771560→3275cec0 independently creates
 * Pylon Start+Impact as well as the three cosmetic switch sets. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
test('MM switches generator without a cast state and produces original Pylon Impact damage/big-stun',()=>{
 const {sim,a,b}=originalAddFixture('MM',{skillId:29013});a.loadout[1]={skillId:29016,requestedSkillId:29016,level:1,branchId:'none'};a.mp=a.mpMax;a.sourceAdd.dp=5000;b.x=1500;
 for(let i=0;i<150;i++)sim.step(1/60,{add:{pressed:i===0?['A']:[],held:i===0?['A']:[]}});
 assert.ok([29013,29035].includes(a.sourceAdd.generator.skillId));assert.equal(a.state,'RSI_WAIT');
 b.x=200;const first=sim.state.nextEffectId,hp=b.hp,mp=a.mp,stateSerial=a.stateSerial,dp=a.sourceAdd.dp;
 sim.step(1/60,{add:{pressed:['S'],held:['S']}});
 assert.equal(a.sourceAdd.generator.skillId,29016);assert.equal(a.stateSerial,stateSerial,'mode switch retains native current action');
 assert.equal(a.mp,mp);assert.ok(a.sourceAdd.dp<dp);
 for(let i=0;i<25;i++)sim.step(1/60,{});
 const start=sim.state.events.find(e=>e.type==='effectStarted'&&e.effectId>=first&&e.setName==='EffectSet_A_APT_Pylon_Dynamo_Start');
 const impact=sim.state.events.find(e=>e.type==='effectStarted'&&e.effectId>=first&&e.name==='DamageEffect_A_APT_Pylon_Dynamo_Impact');
 assert.ok(start,'original native switch starts its source visual');assert.ok(impact,'original native switch creates the original attack');
 const hit=sim.state.events.find(e=>e.type==='hit'&&e.origin?.id===impact.effectId);
 assert.ok(hit?.amount>0);assert.equal(hit.data.DAMAGE.MAGIC,2.2);assert.equal(hit.data.REACT_TYPE,2);assert.equal(hit.data.PVP_RATE,.6);
 assert.equal(hit.data.CAN_REVENGE,0);assert.equal(hit.data.FORCE_FLY,0);assert.ok(b.hp<hp);
});

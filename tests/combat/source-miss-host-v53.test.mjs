import test from 'node:test';
import assert from 'node:assert/strict';
import {addFixture} from '../helpers/add-fixture.mjs';
import {actorSourceAccuracy2016,currentMissSeedInput2016,currentSourceMiss2016,SOURCE_MISS_SEED_POLICY} from '../../packages/combat-core/source-miss-host-v53.mjs';
import {sourceRandomFloat2016} from '../../packages/combat-core/source-miss-v53.mjs';
import {synchronizeBuffStats} from '../../packages/combat-core/passive-attributes-v20.mjs';
const packet={DAMAGE_TYPE:1,DAMAGE_PERCENT:1,ATTACK_TYPE:0,REACT_TYPE:1,NO_MISS:0,HP_PERCENT_UP:0,MP_PERCENT_UP:0,INCREASE_MP:0};
// Explicit product seed inputs are independent from the recovered table/threshold.
// These exercise the real public hit consumer, not fabricated original traces.
test('ordinary default player inputs guarantee contact without consuming a random seed',()=>{
 const {sim,a,b}=addFixture();sim.state.sourceHitSeedPolicy='unavailable';
 const result=currentSourceMiss2016(sim,a,b,packet,{kind:'character'});
 assert.equal(result.supported,true);assert.equal(result.miss,false);assert.equal(result.seedIndependent,true);
});
test('decoded original avoidance buff changes the next public hit and Miss has no hit feedback or HP loss',()=>{
 const {sim,a,b}=addFixture();b.buffs.push({behaviors:[{kind:'stat',type:15,stat:'avoidance',changeType:0,value:3}]});
 synchronizeBuffStats(b);assert.equal(b.stats.avoidance,3);
 assert.equal(actorSourceAccuracy2016(b,15).value,3);
 const hp=b.hp,mp=b.mp,result=sim.applyHit(a,b,packet,{kind:'character'});
 assert.equal(result.miss,true);assert.equal(result.accepted,false);assert.equal(b.hp,hp);assert.equal(b.mp,mp);
 assert.equal(sim.state.events.filter(e=>e.type==='evasion').length,1);
 assert.ok(!sim.state.events.some(e=>e.type==='hit'||e.type==='hitFeedback'));
 b.buffs=[];synchronizeBuffStats(b);assert.equal(b.stats.avoidance,1);
 assert.equal(currentSourceMiss2016(sim,a,b,packet,{kind:'character'}).miss,false);
});
test('nontrivial threshold requires explicit source seed or the versioned frozen Web seed policy',()=>{
 const {sim,a,b}=addFixture();b.buffs.push({behaviors:[{kind:'stat',type:15,stat:'avoidance',changeType:0,value:1.5}]});
 sim.state.sourceHitSeedPolicy='unavailable';assert.equal(currentSourceMiss2016(sim,a,b,packet,{kind:'effect'}).supported,false);
 sim.state.sourceHitSeedPolicy=SOURCE_MISS_SEED_POLICY;
 const first=currentMissSeedInput2016(sim,b);assert.equal(first,currentMissSeedInput2016(sim,b));
 const expected=sourceRandomFloat2016(first,2).value,result=currentSourceMiss2016(sim,a,b,packet,{kind:'effect'});
 assert.equal(result.sample,expected);assert.equal(result.miss,.5<expected);
 const frozen=structuredClone(sim.state);sim.state.step++;assert.notEqual(currentMissSeedInput2016(sim,b),first);
 sim.state=frozen;assert.equal(currentMissSeedInput2016(sim,b),first);
 b.sourceHitSeed=123;assert.equal(currentMissSeedInput2016(sim,b),123);
});
test('NO_MISS bypass and additive zero socket curve follow source while unsupported NPC accuracy stays qualified',()=>{
 const {sim,a,b}=addFixture();b.buffs.push({behaviors:[{kind:'stat',type:15,stat:'avoidance',changeType:1,value:10000}]});
 assert.equal(actorSourceAccuracy2016(b,15).value,1);
 b.buffs.push({behaviors:[{kind:'stat',type:15,stat:'avoidance',changeType:0,value:3}]});
 assert.equal(currentSourceMiss2016(sim,a,b,{...packet,NO_MISS:1},{kind:'effect'}).miss,false);
 assert.equal(currentSourceMiss2016(sim,a,b,packet,{kind:'effect',sourceAddSummonSerial:1}).reason,'npc-accuracy-instance-unavailable');
});

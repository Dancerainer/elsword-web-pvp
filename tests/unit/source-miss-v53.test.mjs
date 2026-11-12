import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import table from '../../contracts/source-random-table-2016.json' with {type:'json'};
import {sourceRandomFloat2016,sourceRandomInteger2016,sourceAccuracyMultiplier2016,sourceAccuracyProperty2016,sourceAccuracyBuffGroups2016,sourceMissThreshold2016,evaluateSourceMiss2016} from '../../packages/combat-core/source-miss-v53.mjs';
const f=Math.fround,blank={swap:[],add1:[],add2:[],multiply:[]};
function participants(){return {owner:{kind:'player',classId:106,accuracy:.8,accuracyMultiplier:.9,skills:{},accuracyBonus:0},target:{kind:'player',modelPresent:true,windows:[],evasionRecords:0,avoidance:1.2,invincible:false,seed:0}};}
const damage={NO_MISS:false,HP_PERCENT_UP:0,MP_PERCENT_UP:0,INCREASE_MP:0};
const close=(a,b)=>assert.ok(Math.abs(a-b)<.000001,`${a} != ${b}`);
// Expectations: source table SHA and fixed captured words; native threshold
// arithmetic/priorities are transcribed from 324dae50's attested contract.
test('captured source random table retains all 32000 original u16 words and source SHA',()=>{
 const b=Buffer.from(table.data,'base64');assert.equal(b.length,64000);
 assert.equal(createHash('sha256').update(b).digest('hex'),'3ce4be0c27f2772951ebb07473af27b343bcd98958dbc86f8d2d0a2444cf966c');
 const words=Array.from({length:32000},(_,i)=>b.readUInt16LE(2*i));assert.equal(new Set(words).size,32000);
 assert.deepEqual(words.slice(0,8),[15332,7703,31397,30278,11392,5695,13729,7491]);
 assert.equal(words[29174],0);assert.equal(words[10141],31999);
});
test('source random getter uses explicit u16 seed and signed wrap/modulo without advancing any sequence',()=>{
 assert.equal(sourceRandomFloat2016(0,0).value,f(15332/32000));
 assert.equal(sourceRandomFloat2016(0).value,f(31397/32000));
 assert.equal(sourceRandomFloat2016(29172).value,0);
 assert.equal(sourceRandomFloat2016(10139).value,0.9999687671661377);
 assert.equal(sourceRandomFloat2016(0,-1).index,31999);
 assert.equal(sourceRandomFloat2016(65535,2147483647).index,5886);
 assert.deepEqual(sourceRandomFloat2016(12,7),sourceRandomFloat2016(12,7));
 assert.equal(sourceRandomInteger2016(0).value,47);
 for(const seed of [undefined,-1,65536,1.5])assert.equal(sourceRandomFloat2016(seed).supported,false);
});
test('native v1a8 gate uses its own property rather than another random draw',()=>{
 assert.equal(sourceAccuracyMultiplier2016(0,undefined).value,1);
 assert.equal(sourceAccuracyMultiplier2016(1,.75).value,.75);
 assert.equal(sourceAccuracyMultiplier2016(1,undefined).supported,false);
});
test('zero socket curves do not import old hit/evade formulas, while ordered Buff14/15 multiplier and swap survive',()=>{
 const args={base:1,temporaryPercent:0,temporaryMultiplier:1,temporaryAdd:9999,groups:{...blank,add1:[123],add2:[456]}};
 const zero=sourceAccuracyProperty2016(args);assert.equal(zero.curveResult,0);assert.equal(zero.value,1);
 assert.equal(sourceAccuracyProperty2016({...args,groups:{...blank,multiply:[.5,.8]}}).value,f(f(.5)*f(.8)));
 assert.equal(sourceAccuracyProperty2016({...args,groups:{...blank,swap:[3,-2],multiply:[.1]}}).value,-2,'last swap bypasses lower clamp and multiplier');
 assert.equal(sourceAccuracyProperty2016({...args,base:-.5,temporaryMultiplier:2}).value,0);
 assert.equal(sourceAccuracyProperty2016({...args,base:0,temporaryMultiplier:2}).value,1);
 assert.equal(sourceAccuracyProperty2016({...args,temporaryMultiplier:-2}).value,1,'nonpositive factor skips multiply');
 const rows=[{type:14,kind:'stat',stat:'accuracy',changeType:3,value:.5},{type:15,kind:'stat',stat:'avoidance',changeType:0,value:.75}];
 assert.deepEqual(sourceAccuracyBuffGroups2016(rows,14).groups.multiply,[.5]);
 assert.deepEqual(sourceAccuracyBuffGroups2016(rows,15).groups.swap,[.75]);
 assert.equal(sourceAccuracyBuffGroups2016([{type:15,kind:'unsupported'}],15).supported,false);
 assert.equal(sourceAccuracyProperty2016({base:1,groups:blank}).supported,false);
});
test('ordinary threshold honors NPC penalty, learned skill/class gates, capped positive temporary addition and final invincibility override',()=>{
 const p=participants();close(sourceMissThreshold2016(p).threshold,.52);
 p.owner.skills={24406:{level:4,accuracyPercent:.1},104:{level:2,accuracyPercent:.04}};p.owner.accuracyBonus=.2;
 close(sourceMissThreshold2016(p).threshold,.86);
 p.owner.classId=107;close(sourceMissThreshold2016(p).threshold,.76);
 p.owner.accuracyBonus=2;close(sourceMissThreshold2016(p).threshold,1.56);
 p.target.invincible=true;assert.equal(sourceMissThreshold2016(p).threshold,1);
 const n={owner:{kind:'npc',accuracy:.8,accuracyMultiplier:.9},target:{kind:'npc',evasionRecords:0,avoidance:1.2,npcAccuracyPenalty:.2,invincible:false}};
 close(sourceMissThreshold2016(n).threshold,.32);
});
test('REVENGE/REFLEX use strict endpoints; missing player model and evasion collection take their original priorities',()=>{
 for(const kind of ['REVENGE','REFLEX_MAGIC']){
  const p=participants();Object.assign(p.target,{windows:[{kind,begin:.2,end:.4}],directionByte:1,modelClock:.2});
  close(sourceMissThreshold2016(p).threshold,.52);p.target.modelClock=.3;assert.equal(sourceMissThreshold2016(p).threshold,1);
  p.target.modelClock=.4;close(sourceMissThreshold2016(p).threshold,.52);p.target.modelClock=.3;p.target.directionByte=0;close(sourceMissThreshold2016(p).threshold,.52);
 }
 const p=participants();p.target.modelPresent=false;assert.equal(sourceMissThreshold2016(p).threshold,1);
 assert.equal(sourceMissThreshold2016({owner:null,target:null}).threshold,1);
 p.target.modelPresent=true;p.target.evasionRecords=1;p.owner.accuracy=undefined;assert.equal(sourceMissThreshold2016(p).threshold,1);
});
test('ordinary Miss comparison is strictly threshold<sample, with no artificial min/max chance',()=>{
 const p=participants();p.owner.accuracy=sourceRandomFloat2016(0).value;p.owner.accuracyMultiplier=1;p.target.avoidance=1;
 assert.equal(evaluateSourceMiss2016({selector:1,...p,damage}).miss,false);
 p.owner.accuracy=f(p.owner.accuracy-.00001);assert.equal(evaluateSourceMiss2016({selector:1,...p,damage}).miss,true);
 p.target.seed=undefined;p.owner.accuracy=1;assert.equal(evaluateSourceMiss2016({selector:1,...p,damage}).miss,false);
 p.owner.accuracy=-.01;assert.equal(evaluateSourceMiss2016({selector:1,...p,damage}).miss,true);
 p.owner.accuracy=.5;assert.equal(evaluateSourceMiss2016({selector:1,...p,damage}).supported,false,'middle range requires original seed');
});
test('positive recovery bypass and NO_MISS remain separate from ordinary properties and unbound entropy',()=>{
 const p=participants();delete p.target.seed;
 assert.equal(evaluateSourceMiss2016({selector:0,...p,damage:{...damage,NO_MISS:true}}).miss,false);
 for(const field of ['HP_PERCENT_UP','MP_PERCENT_UP','INCREASE_MP'])assert.equal(evaluateSourceMiss2016({selector:0,damage:{...damage,[field]:.01}}).path,'positive-recovery-bypass');
 assert.equal(evaluateSourceMiss2016({selector:23,...p,damage}).supported,false);
 assert.equal(evaluateSourceMiss2016({selector:1,...p,damage:{NO_MISS:false}}).supported,false);
});
test('NPC special sampling offset uses correlated source integer lookup and exposes the separate NPC side-effect boundary',()=>{
 const p=participants();p.target={kind:'npc',evasionRecords:0,avoidance:1,invincible:false,seed:7};p.owner.accuracy=.5;p.owner.accuracyMultiplier=1;
 const result=evaluateSourceMiss2016({selector:3,...p,damage,npcSpecialOffset:{enabled:true,sourcePresent:true,ownerSeed:0}});
 assert.equal(result.supported,true);assert.equal(result.random.offset,49);assert.equal(result.order,'target60-before-miss');
 assert.equal(result.npcSideEffect.required,true);assert.match(result.guild509,/after-nonzero-reaction-gate/);
 assert.equal(evaluateSourceMiss2016({selector:0,...p,damage,npcSpecialOffset:{enabled:true,sourcePresent:true}}).supported,false);
});

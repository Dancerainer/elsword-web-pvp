/** Matrix transcribed from the independent exact-byte native callback and
 * the separate HP-recovery / Raven field consumers, not a generated oracle. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {addMoonlightHitParameters,addMoonlightPowerFor} from '../../packages/combat-core/add-moonlight-receipts-v45.mjs';
function fixture(){
 const a={id:'current-attacker',professionId:'RF',sourceAdd:null,awakening:{remaining:0}},notes=[];
 const target={id:'recipient',buffs:[{templateId:439,factorId:477,accumulationCount:1,behaviors:[{kind:'sourceCallback',type:43}],finalizers:[]}]};
 const sim={note:(...args)=>notes.push(args),profileFor:()=>({skillCatalog:[]})};
 return {sim,a,target,notes,data:{REACT_TYPE:1,HIT_TYPE:1,DAMAGE:{PHYSIC:1}}};
}
for(const [name,patch,origin]of [
 ['NoDamage number',{NO_DAMAGE:1}],['NoDamage bool',{NO_DAMAGE:true}],['HP percent recovery',{HP_PERCENT_UP:.1}],
 ['no reaction',{REACT_TYPE:0}],['create damage effect',{REACT_TYPE:11}],['create effect-set shared early-return',{REACT_TYPE:12}],
 ['dummy result',{}, {reactResult:7}],['sensor result',{}, {reactResult:10}],['ground-hit type26',{HIT_TYPE:26}],
 ['attack-trigger7 scalar',{ATTACK_TRIGGER_TYPE:7}],['attack-trigger7 vector',{ATTACK_TRIGGER_TYPE:{1:0,2:7}}],
 ['unknown hit type',{HIT_TYPE:'HIT_TYPE.HT_UNRESOLVED'}],['malformed trigger',{ATTACK_TRIGGER_TYPE:{1:'7'}}],
 ['malformed heal',{HP_PERCENT_UP:NaN}],['malformed NoDamage',{NO_DAMAGE:2}]
])test(`Moonlight native guard rejects ${name}`,()=>{
 const f=fixture();assert.equal(addMoonlightHitParameters(f.sim,f.a,f.target,{...f.data,...patch},origin),null);
 assert.equal(f.notes.length,0,'excluded hits do not request an unsupported skill modifier');
});
test('native+490 excludes HP-percent healing, while positive IncreaseMP is not misidentified as that guard',()=>{
 const f=fixture(),result=addMoonlightHitParameters(f.sim,f.a,f.target,{...f.data,INCREASE_MP:10,HP_PERCENT_UP:0});
 assert.deepEqual(result,{sourceGuardsPassed:true,power:1,hyperMode:false});
 assert.deepEqual(addMoonlightHitParameters(f.sim,f.a,f.target,{...f.data,HP_PERCENT_UP:-.1}),result);
 assert.equal(f.notes.length,0,'the adopted target2016 exact-key query is supported and a missing key returns0');
});
test('power belongs to the current attacker, preserves only confirmed base scalar and samples formation/awakening',()=>{
 const f=fixture();f.a.skillScale=99;f.a.skillId=24401;
 assert.deepEqual(addMoonlightPowerFor(f.sim,f.a,{power:999}),{power:1,hyperMode:false});
 f.a.awakening.remaining=10;assert.equal(addMoonlightPowerFor(f.sim,f.a,{}).hyperMode,true);
 f.a.sourceAdd={formation:false};assert.equal(addMoonlightPowerFor(f.sim,f.a,{}).hyperMode,false);
 f.a.sourceAdd.formation=true;assert.equal(addMoonlightPowerFor(f.sim,f.a,{}).hyperMode,true);
 f.a.equipmentAttributes={skillPowerDeltas:{29024:.25}};assert.equal(addMoonlightPowerFor(f.sim,f.a,{}).power,1.25);
 assert.equal(addMoonlightPowerFor(f.sim,null,{}),null);
});

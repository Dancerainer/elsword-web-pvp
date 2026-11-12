import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSkillTraitPolicy} from '../../packages/combat-core/skill-traits.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeCritical} from '../../packages/native-source/critical.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {isAdditionalAttackRatio,isAdditionalAttackDamage} from '../../packages/combat-core/is-additional-attack.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const ids=['RF','LK','VC','RS','BM','IS'];
const rows={RF:[248160,330,50,1.65,1.37,.1],LK:[269988,300,60,1.7,1.37,.2],VC:[233337,330,40,1.5,1.33,0],RS:[234832,360,70,1.5,1.37,0],BM:[254824,330,41,1.6,1.4606,.3],IS:[233337,360,50,1.6,1.4522,.2]};
const profiles=Object.fromEntries(ids.map(id=>[id,read(`packages/combat-core/${id.toLowerCase()}-profile.json`)]));
const presets=Object.fromEntries(ids.map(id=>[id,read(`config/${id.toLowerCase()}-preset.json`)]));
const [critical,values]=await Promise.all([instantiateNativeCritical(readFileSync(new URL('../../artifacts/native/critical.wasm',import.meta.url))),instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values.wasm',import.meta.url)))]);
const f=Math.fround,near=(a,b)=>assert.ok(Math.abs(a-b)<.002,`${a} != ${b}`);
const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1,MAGIC:1},PVP_RATE:1,REACT_TYPE:1,HIT_TYPE:-1,FORCE_DOWN:0,HIT_ADD_MP:0,STOP_TIME_ATT:0,STOP_TIME_DEF:0};
function make(id,fixture=false){return createSimulation({profile:profiles[id],preset:presets[id],nativeSkillValues:values,nativeCritical:critical,
 map:{lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LT_NORMAL'}]},
 actors:['a','b'].map((name,i)=>({id:name,professionId:id,team:i,position:[i*500,0,0],lineId:0,...(fixture?{passives:[],guildPassives:[],attributes:{hpMax:100000,physicalAttack:1000,magicAttack:1000,physicalDefence:400,magicDefence:400,criticalRate:i?0:100,damageReduction:i?.5:0}}:{})}))});}
for(const id of ids)test(`${id} six-profession v3 user equipment composes with its own default career`,()=>{
 const sim=make(id),a=sim.actor('a'),[hp,mp,crit,critD,speed,add]=rows[id];
 assert.equal(a.hpMax,hp);assert.equal(a.mpMax,mp);near(a.stats.criticalRate,crit);near(a.stats.criticalAttack,critD);near(a.stats.animationSpeedMultiplier,speed);assert.equal(a.equipmentAttributes.additionalAttackRatio,add);
 assert.equal(a.awakening.orbs,0);assert.equal(a.awakening.gauge,50);assert.equal(presets[id].unsupportedEquipmentOptions,undefined);
 const restored=make(id);restored.restore(JSON.parse(JSON.stringify(sim.snapshot())));assert.deepEqual(JSON.parse(JSON.stringify(restored.snapshot())),JSON.parse(JSON.stringify(sim.snapshot())));
});
for(const id of ids)test(`${id} critical bonus adds to1.5; additional damage follows critical/reduction and uses pre-Buff attack`,()=>{
 const sim=make(id,true),a=sim.actor('a'),b=sim.actor('b');sim.rng=()=>0;
 a.stats.physicalAttack=2000;a.stats.magicAttack=2000;
 const hit=sim.applyHit(a,b,data,{kind:'character',skillId:null,powerMultiplier:1});
 assert.equal(hit.accepted,true);
 const ordinary=f(f(2000*f(1-f(400/875)))*f(1.5+presets[id].attributes.criticalDamageBonus));
 const reduced=f(ordinary-ordinary*.5);
 // Independent pow(1,.65)=1; extra uses1000 source-stat snapshot, not buffed2000.
 const additional=f(f(1.5*f(f(1+f(rows[id][5]))-1))*1000);
 near(hit.amount,f(reduced+additional));
});
test('resolved equipment option and IS FIX points combine before one target curve',()=>{
 // equipment20% inversion solves -.4*x*x+1.32*x-.064 = .2/.375.
 const x=(1.32-Math.sqrt(1.32**2-1.6*(.064+.2/.375)))/.8;
 const y=x+.1,expected=(y*(-.4*y+1.32)-.064)*.375;
 near(isAdditionalAttackRatio(10,85,.2),expected);assert.ok(Math.abs(expected-(.2+.0375))>.001);
 const sim=make('IS',true),a=sim.actor('a'),b=sim.actor('b');a.stats.additionalAttackPercent=10;a.stats.criticalRate=0;sim.rng=()=>.99;
 const base=f(1000*f(1-f(400/875))),extra=f(1.5*f(expected)*1000);
 near(sim.applyHit(a,b,data,{kind:'character',skillId:null,powerMultiplier:1}).amount,f(f(base*.5)+extra));
});
test('additional source channel excludes no-damage, level and unknown damage; accepts physical/magic/mix and recorded power',()=>{
 for(const type of [0,1,2,3,4,5])near(isAdditionalAttackDamage({equipmentRatio:.1,level:85,data:{...data,DAMAGE_TYPE:type},stats:{physicalAttack:1000,magicAttack:1000}}),150);
 for(const d of [{...data,NO_DAMAGE:1},{...data,LV_DAMAGE:true},{...data,DAMAGE_TYPE:6}])assert.equal(isAdditionalAttackDamage({equipmentRatio:.1,level:85,data:d,stats:{physicalAttack:1000,magicAttack:1000}}),0);
 near(isAdditionalAttackDamage({equipmentRatio:.1,level:85,data,stats:{physicalAttack:1000,magicAttack:1000},powerMultiplier:2}),150*2**.65);
 assert.throws(()=>isAdditionalAttackRatio(0,85,.4),/ratio/);
});

for(const id of ids)test(`${id} every lethal branch retains25% defence penetration with its v3 skill/extra options`,()=>{
 for(const skill of profiles[id].skillCatalog)for(const branch of skill.branches??[]){
  if(branch.memoTypeName!=='MI_CRITICAL')continue;
  const policy=createSkillTraitPolicy(skill,branch.id),sim=make(id,true),a=sim.actor('a'),b=sim.actor('b');
  a.stats.criticalRate=0;sim.rng=()=>.99;
  assert.equal(policy.defencePierceMultiplier,.75);assert.equal(policy.mpMultiplier,branch.parameters[0]);
  const bonuses={RF:.05,LK:0,VC:.1,RS:.1,BM:0,IS:.1};
  const ordinary=f(f(1000*f(1-f(f(400/875)*.75)))*(1+bonuses[id]));
  const extra=f(f(1.5*f(f(1+f(rows[id][5]))-1))*1000);
  near(sim.applyHit(a,b,data,{kind:'effect',skillId:skill.skillId,traitPolicy:policy,powerMultiplier:1}).amount,f(f(ordinary*.5)+extra));
 }
});

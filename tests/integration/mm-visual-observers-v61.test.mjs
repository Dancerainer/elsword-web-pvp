/** Tiny current-Web event fixture; no Babylon, Native runtime or browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bindFactoryDpContacts,settleFactoryOperationDp} from '../../tools/validation/mm-visual-observers-v61.mjs';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/mm-visual-dp-events-v61.json',import.meta.url))),
 source={state:'RSI_COMBO_Z',setName:'EffectSet_AN_Combo_Z_Attack',damageName:'DamageEffect_AN_Combo_Z',
  data:{DYNAMO_PARTICLE_RATE_TYPE:2,DAMAGE_TYPE:0,HIT_TYPE:41,REACT_TYPE:1,DAMAGE:{PHYSIC:1.52}}};
const input=()=>({...structuredClone(fixture),source});
test('actual MM-b seven ordinary-Z carrier contacts account for every prepared raw DP increment',()=>{
 const args=input(),before=structuredClone(args),result=bindFactoryDpContacts(args);
 assert.equal(result.contacts.length,7);assert.equal(result.hits.length,7);assert.equal(result.gains.at(-1).dp,1276.800048828125);
 assert.deepEqual(args,before,'observation never mutates events/source');
 assert.equal(args.events.filter(e=>e.type==='hit'&&e.origin.kind==='character').length,0,'old character-only predicate was the harness defect');
});
for(const [name,mutate]of [
 ['unbound carrier',args=>{args.events.find(e=>e.type==='hit').origin.id=999999;}],
 ['wrong command state',args=>{args.events.find(e=>e.type==='stateChanged').state='RSI_COMBO_X';}],
 ['wrong set',args=>{args.events.find(e=>e.type==='effectStarted').setName='another-set';}],
 ['wrong recipient',args=>{args.events.find(e=>e.type==='hit').targetId='not-the-mirror';}],
 ['different-tick grant',args=>{args.events.find(e=>e.type==='addDpChanged').time+=.01;}],
 ['different command data',args=>{args.events.find(e=>e.type==='hit').data.DAMAGE.PHYSIC=999;}],
 ['unaccounted final DP',args=>{args.finalDp+=1;}],
])test('reject '+name,()=>{const args=input();mutate(args);assert.throws(()=>bindFactoryDpContacts(args));});

const installFixture=JSON.parse(readFileSync(new URL('../fixtures/mm-factory-install-events-v61.json',import.meta.url))),
 impact={state:'ANSI_AAT_CREATE_DYNAMO_FACTORY',setName:'EffectSet_A_APT_Pylon_Dynamo_Impact',damageName:'DamageEffect_A_APT_Pylon_Dynamo_Impact',
  data:{DYNAMO_PARTICLE_RATE_TYPE:1,DAMAGE_TYPE:1,HIT_TYPE:41,REACT_TYPE:2,APPLIED_SKILL_ID:29204,DAMAGE:{MAGIC:2.2}}},
 installation=()=>({...structuredClone(installFixture),impact});
test('actual MM-c fixed600 payment plus original Pylon132 recovery explains net808.800048828125',()=>{
 const args=installation(),before=structuredClone(args),result=settleFactoryOperationDp(args);
 assert.equal(result.committed.dpCost,600);assert.equal(result.paidDp,676.800048828125);assert.equal(result.restored,132);
 assert.equal(result.finalDp,808.800048828125);assert.equal(result.contacts.length,1);assert.deepEqual(args,before);
});
test('original installation whiff has the full fee and no fabricated on-hit recovery',()=>{
 const args=installation();args.events=args.events.filter(e=>!['hit','addDpChanged'].includes(e.type));args.finalDp=676.800048828125;
 assert.equal(settleFactoryOperationDp(args).restored,0);
});
test('same-generator fire receipt0DP does not repeat the installation fee',()=>{
 const args=installation();args.mode='generator-fire';args.expectedCost=0;args.finalDp=args.initialDp;
 args.events=args.events.filter(e=>e.type==='addSkillResourcesCommitted');Object.assign(args.events[0],{mode:args.mode,dpCost:0,mpCost:104});
 assert.equal(settleFactoryOperationDp(args).paidDp,args.initialDp);
});
for(const [name,mutate]of [
 ['infer fee468 from net',a=>{a.events.find(e=>e.type==='addSkillResourcesCommitted').dpCost=468;}],
 ['unbound Pylon',a=>{a.events.find(e=>e.type==='hit').origin.id=99999;}],
 ['missing on-hit DP',a=>{a.events=a.events.filter(e=>e.type!=='addDpChanged');a.finalDp=676.800048828125;}],
 ['unexplained net DP',a=>{a.finalDp+=1;}],
 ['excess original recovery',a=>{const g=a.events.find(e=>e.type==='addDpChanged');g.delta=133;g.dp=g.before+133;a.finalDp=g.dp;}],
 ['wrong impact declaration',a=>{a.events.find(e=>e.type==='hit').data.DAMAGE.MAGIC=9;}],
])test('reject factory settlement '+name,()=>{const args=installation();mutate(args);assert.throws(()=>settleFactoryOperationDp(args));});

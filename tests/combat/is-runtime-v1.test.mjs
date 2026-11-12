// Historical zero-equipment additional option isolates the original IS FIX curve.
import {beforeBalanceV3} from '../helpers/equipment-balance-before-v3.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),assets=resolve(root,'artifacts/is');
const read=p=>JSON.parse(readFileSync(p));
const profile=read(resolve(root,'packages/combat-core/is-profile.json')),preset=beforeBalanceV3(read(resolve(root,'config/is-preset.json')));
const map={...read(resolve(root,'artifacts/scene/sander-garpai-rock-pvp/manifest.json')),...read(resolve(root,'artifacts/scene/sander-garpai-rock-pvp/collision.json'))};
const fx=read(resolve(assets,'fx/index.json')),index=mergeEffectIndexes(read(resolve(assets,'effect-assets.json')),fx);
const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(resolve(assets,p))]));
const rawPose=read(resolve(assets,'runtime-pose.json')),characterPose=composeCharacterPose(rawPose,read(resolve(assets,rawPose.sharedPose)));
const native=await createNativeRuntime({manifest:read(resolve(root,'artifacts/native/manifest.json')),map,loadBinary:p=>readFileSync(resolve(root,'artifacts/native',p))});
function make(id,branchId='none',passives=[]){return createSimulation({profile,map,preset:{...preset,guildPassives:[],passives,
  loadout:[id?{skillId:id,branchId}:null,...Array(7).fill(null)]},seed:2016,
  actors:[{id:'is',professionId:'IS',team:0,position:[2022.98,2840,0],lineId:6,facing:-1,guildPassives:[],passives},
    {id:'target',professionId:'IS',team:1,position:[1858.11,2840,0],lineId:6,facing:1,guildPassives:[],passives:[],loadout:Array(8).fill(null)}],
  ...createNativeSamplers({profile,map,characterPose,effectIndex:index,effectPoses:poses}),
  nativeGeometry:native.geometry,nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeManaBreak:native.manaBreak});}
for(const id of [21026,21217,21027,21028,21029,21221,21033,21030,21218,21036,21213,21214,21021,21022,21215,21023,21024,21216,21025,21605]){
  test(`IS ${id}: real source assets cast, damage events, recovery and serializable snapshot`,()=>{
    const sim=make(id),a=sim.actor('is');sim.step(1/60,{is:{pressed:['A'],held:['A']}});
    const events=sim.drainEvents();
    for(let i=0;i<600;i++){sim.step(1/60,{is:{held:id===21026&&i<80?['A']:[]}});events.push(...sim.drainEvents());}
    assert.equal(events.filter(e=>e.type==='skillStarted'&&e.skillId===id).length,1);
    assert.equal(a.skillId,null,`${id} stuck in ${a.state}`);
    assert.ok(events.filter(e=>e.type==='hit').every(e=>Number.isFinite(e.amount)&&e.amount>=0));
    assert.ok(!sim.state.unsupported.some(n=>n.id.startsWith('damage:')));
    if(![21218,21216,21217].includes(id))assert.ok(events.some(e=>e.actorId==='is'&&e.type==='hit'&&e.amount>0),`${id} no hit; ${JSON.stringify(sim.state.unsupported.map(x=>x.id))}`);
    validateOwnedState(encodeOwnedState(sim,'is'));
  });
}
test('IS original identities, independent five passives and shared source skill declarations',()=>{
  assert.equal(profile.target.unitClass,112);assert.equal(profile.skillCatalog.length,37);
  assert.deepEqual(profile.defaultPassiveSkillIds,[21410,21412,21411,21413,21414]);
  const sim=make(null,'none',profile.defaultPassiveSkillIds),a=sim.actor('is');
  assert.equal(a.passivePolicy.stats.hpMultiplier,undefined);assert.equal(a.passivePolicy.professionId,'IS');
  assert.equal(a.wayOfSword.point,0);assert.ok(a.stats.moveSpeedMultiplier>1.075);assert.ok(a.stats.animationSpeedMultiplier>1.06);
});
test('IS Phantom critical and Lightning dash stacks expire using common buff lifetime',()=>{
  const sim=make(null,'none',[21414]),a=sim.actor('is');sim.rng=()=>0;
  const before=a.stats.criticalRate;assert.ok(sim.grantBuff(a,a,30,1,null));assert.equal(a.stats.criticalRate,before+20);
  for(let i=0;i<5;i++)assert.ok(sim.grantBuff(a,a,81,3,null));
  assert.equal(a.buffs.find(b=>b.templateId===94).accumulationCount,5);
  for(let i=0;i<1600;i++)sim.step(1/60,{});
  assert.equal(a.buffs.length,0);assert.equal(a.stats.criticalRate,before);
});

const commandHit={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},ATTACK_TYPE:2,HIT_TYPE:1,REACT_TYPE:1,HIT_ADD_MP:0,PVP_RATE:.6,FORCE_DOWN:0};
test('IS Cruel source socket curve adds independent damage at five stacks and expires',()=>{
 const baseline=make(),stacked=make();
 for(const sim of [baseline,stacked])sim.rng=()=>.99;
 const a=stacked.actor('is'),b=stacked.actor('target');
 for(let i=0;i<5;i++)assert.ok(stacked.grantBuff(a,a,20,4,null));
 assert.equal(a.stats.additionalAttackPercent,50);
 const before=b.hp;stacked.applyHit(a,b,commandHit,{powerMultiplier:1});const boosted=before-b.hp;
 const plain=baseline.actor('target'),plainBefore=plain.hp;baseline.applyHit(baseline.actor('is'),plain,commandHit,{powerMultiplier:1});
 // Independent target2016 SocketOptionForm: (x(-.4x+1.32)-.064)*.375 at x=.5.
 const ratio=(.5*(-.4*.5+1.32)-.064)*.375;
 assert.ok(Math.abs(boosted-(plainBefore-plain.hp)-1.5*ratio*a.buffBaseStats.physicalAttack)<.02);
 stacked.advanceActorBuffs(a,11);assert.equal(a.stats.additionalAttackPercent??0,0);
});
test('IS five-hit Cruel, Sudden critical, command Brutal MP burn/cooldown, and Sharp bleed execute',()=>{
 const cruel=make(null,'none',[21410]);cruel.rng=()=>0;const ca=cruel.actor('is'),cb=cruel.actor('target');
 for(let i=0;i<5;i++)cruel.applyHit(ca,cb,commandHit,{powerMultiplier:1});
 assert.equal(ca.buffs.find(b=>b.templateId===19)?.accumulationCount,1);
 const sudden=make(null,'none',[21411]);sudden.rng=()=>0;const sa=sudden.actor('is');
 sudden.applyHit(sa,sudden.actor('target'),commandHit,{powerMultiplier:1});assert.equal(sa.stats.criticalRate,100);
 const brutal=make(null,'none',[21412]);brutal.rng=()=>0;const ba=brutal.actor('is'),bb=brutal.actor('target');
 ba.cooldowns={21026:10,21605:50,900:40};brutal.applyHit(ba,bb,commandHit,{powerMultiplier:1});const mp=bb.mp;
 brutal.advanceActorBuffs(bb,1/60);assert.ok(Math.abs(bb.mp-(mp-10.6))<.001);
 assert.equal(ba.cooldowns[21026],9);assert.equal(ba.cooldowns[21605],50);assert.equal(ba.cooldowns[900],40);
 const sharp=make(null,'none',[21413]);sharp.rng=()=>0;const sha=sharp.actor('is'),shb=sharp.actor('target');
 sharp.applyHit(sha,shb,commandHit,{powerMultiplier:1});assert.ok(shb.buffs.some(b=>b.templateId===99));assert.ok(sha.buffs.some(b=>b.templateId===540));
 assert.ok(![...cruel.state.unsupported,...brutal.state.unsupported,...sharp.state.unsupported].some(n=>n.id.startsWith('buff-factor:')));
 for(const sim of [cruel,sudden,brutal,sharp])validateOwnedState(encodeOwnedState(sim,'is'));
});

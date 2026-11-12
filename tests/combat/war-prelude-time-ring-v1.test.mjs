/** Production buff/ring/owner-packet trajectory, not a target client trace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {initializeAddSystems,applyAddTimeRingToActor,advanceAddSystems,tryAddTimeRingRevive} from '../../packages/combat-core/add-systems.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {timeRingSavedMpLimit} from '../../packages/online/time-ring-resource-bounds.mjs';
const {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState}=await import(
  process.env.TIME_RING_OWNED_MODULE?pathToFileURL(resolve(process.env.TIME_RING_OWNED_MODULE)):
    new URL('../../packages/online/owned-state.mjs',import.meta.url));
const sourceRoot=process.env.TIME_RING_SOURCE_ROOT??resolve(import.meta.dirname,'../..');
const json=path=>JSON.parse(readFileSync(resolve(sourceRoot,path)));
const base=json('packages/combat-core/rf-profile.json'),gmProfile=json('packages/combat-core/gm-profile.json');
const addSource=json('contracts/add-systems-source-v1.json');
const nativeRoot=process.env.TIME_RING_NATIVE_ROOT??resolve(sourceRoot,'artifacts/native');
const manifest=JSON.parse(readFileSync(resolve(nativeRoot,'manifest.json'))),record=manifest.modules['skill-values'];
const bytes=readFileSync(resolve(nativeRoot,record.file));
assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);
const nativeValues=await instantiateNativeSkillValues(bytes);
const map={sceneId:'war-prelude-time-ring',lines:[{lineId:0,start:[-1000,0,0],end:[1000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(){
  // The ordinary RF constructor supplies the recipient's actual wire shape.
  // Caster declarations come from the frozen GM profile and Add source contract.
  const sim=createSimulation({profile:base,map,preset:{passives:[],guildPassives:[],buffResistances:{0:0},debuffDurationMultiplier:1},nativeSkillValues:nativeValues,
    actors:['a','gm','seal'].map(id=>({id,team:0,position:[0,0,0],lineId:0}))});
  const a=sim.actor('a'),gm=sim.actor('gm'),seal=sim.actor('seal');
  const profiles={RF:base,GM:gmProfile,DE:{...base,profileId:'time-ring-DE',target:{unitClass:126,unitType:9},
    components:addSource.components,skillCatalog:Object.entries(addSource.skills).map(([id,raw])=>({skillId:Number(id),raw}))}};
  Object.assign(gm,{professionId:'GM',profileId:gmProfile.profileId,loadout:[{skillId:28009}]});
  Object.assign(seal,{professionId:'DE',profileId:profiles.DE.profileId,loadout:[{skillId:29213}]});initializeAddSystems(seal);
  sim.profiles=profiles;sim.profileFor=actor=>profiles[actor.professionId];
  const context={actors:sim.state.actors,profiles},receiver=structuredClone(a);
  const packet=()=>{const p=encodeOwnedState(sim,'a',{epoch:2,frameSeq:10});p.effects=[];return p;};
  const check=p=>{validateOwnedState(p);validateOwnedReferences(p,receiver,base,map,context);};
  return {sim,a,gm,seal,profiles,context,receiver,packet,check};
}
function grantAndSave(f){
  const {sim,a,gm,seal}=f;assert.equal(a.mpMax,300);
  const buff=sim.grantBuff(gm,a,298,1);assert.ok(buff,JSON.stringify(sim.state.unsupported));assert.equal(buff.templateId,297);assert.equal(a.mpMax,350);
  // Save near the end of the 30-second buff, while the seal has 16.5s left.
  sim.advanceActorBuffs(a,29);a.mp=350;
  assert.equal(applyAddTimeRingToActor(sim,seal,a),true);
  assert.equal(a.sourceTimeRing.mp,350);
}

test('original ally carrier/factor/template permits one +50 history grant, regardless of GM count',()=>{
  const f=fixture();assert.equal(timeRingSavedMpLimit(f.a,base,f.context),350);
  f.context.actors.push({...f.gm,id:'second-gm'});
  assert.equal(timeRingSavedMpLimit(f.a,base,f.context),350);
  f.a.buffBaseStats.mpMax=360;assert.equal(timeRingSavedMpLimit(f.a,base,f.context),410);
});
test('new boosted report is valid before the receiver has seen War Prelude or its changed maximum',()=>{
  const f=fixture();grantAndSave(f);
  assert.equal(f.receiver.mpMax,300);assert.equal(f.packet().actor.mp,350);
  assert.doesNotThrow(()=>f.check(f.packet()));
});
test('War Prelude expiry preserves the saved 350 MP; current resources and lethal revival use current 300 cap',()=>{
  const f=fixture();grantAndSave(f);
  f.sim.advanceActorBuffs(f.a,1.1);advanceAddSystems(f.a,1.1,{profile:base});
  assert.equal(f.a.buffs.some(b=>b.templateId===297),false);
  assert.equal(f.a.mpMax,300);assert.equal(f.a.mp,300);assert.equal(f.a.sourceTimeRing.mp,350);
  const packet=f.packet();assert.doesNotThrow(()=>f.check(packet));
  applyOwnedState(f.sim,'a',packet,{effects:false});assert.equal(f.a.sourceTimeRing.mp,350);
  f.a.mp=0;
  assert.equal(tryAddTimeRingRevive(f.sim,f.a,{damage:f.a.hp+1}),true);
  assert.equal(f.a.mp,300);assert.equal(f.a.sourceTimeRing,null);assert.equal(f.a.sourceTimeSickness,120);
  assert.doesNotThrow(()=>f.check(f.packet()));
});
test('a later -50 maximum debuff neither invalidates nor raises saved MP; revival caps at 250',()=>{
  const f=fixture();grantAndSave(f);f.sim.advanceActorBuffs(f.a,1.1);
  assert.equal(f.sim.grantBuff(f.gm,f.a,657,1).templateId,567);
  assert.equal(f.a.mpMax,250);assert.equal(f.a.sourceTimeRing.mp,350);
  assert.doesNotThrow(()=>f.check(f.packet()));f.a.mp=0;
  assert.equal(tryAddTimeRingRevive(f.sim,f.a,{damage:f.a.hp}),true);assert.equal(f.a.mp,250);
});
test('historical grant requires a frozen same-team equipped GM and preserves DE seal-source checks',()=>{
  const f=fixture();grantAndSave(f);f.sim.advanceActorBuffs(f.a,1.1);const packet=f.packet();
  f.gm.hp=0;f.gm.x=9000;assert.doesNotThrow(()=>f.check(packet),'death or leaving range cannot erase an earlier grant');
  for(const change of [()=>f.gm.team=1,()=>f.gm.loadout=[],()=>f.gm.profileId='foreign']){
    const old={team:f.gm.team,loadout:f.gm.loadout,profileId:f.gm.profileId};change();
    assert.throws(()=>f.check(packet),/time-ring-resources/);Object.assign(f.gm,old);
  }
  for(const amount of [350.01,400,1000]){const bad=structuredClone(packet);bad.actor.sourceTimeRing.mp=amount;
    assert.throws(()=>f.check(bad),/time-ring-resources/);}
  f.seal.loadout=[];assert.throws(()=>f.check(packet),/time-ring-source/);
});
test('no eligible GM keeps the permanent-base bound after a negative maximum buff; source-chain mismatches add nothing',()=>{
  const f=fixture();f.gm.team=1;assert.equal(timeRingSavedMpLimit(f.a,base,f.context),300);
  f.sim.grantBuff(f.gm,f.a,657,1);assert.equal(f.a.mpMax,250);
  assert.equal(timeRingSavedMpLimit(f.a,base,f.context),300);
  f.gm.team=0;const profile=structuredClone(gmProfile);f.profiles.GM=profile;
  profile.buffTemplates[297].raw.ACCUMULATION_LIMIT=2;
  assert.equal(timeRingSavedMpLimit(f.a,base,f.context),300);
  profile.buffTemplates[297].raw.ACCUMULATION_LIMIT=1;
  profile.damageEffects.DamageEffect_SA_SGM_War_Prelude_Buff.raw.DAMAGE_DATA.ATTACK_OUR_TEAM=0;
  assert.equal(timeRingSavedMpLimit(f.a,base,f.context),300);
});

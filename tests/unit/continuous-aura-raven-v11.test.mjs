/** Versioned Web lifecycle contract only. These tests deliberately use the
 * frozen source declarations and no Native runtime, WAN or capacity claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CONTINUOUS_AURA_VERSION,CONTINUOUS_AURA_NAME,CONTINUOUS_AURA_SET,isRFContinuousAura,
  isContinuousRavenAura,isManagedContinuousAura,validateContinuousAuraMarker,setContinuousAuraVersion,
  acceptContinuousAuraState,endContinuousAura,prepareContinuousAuraLives,clearContinuousAuraOwner,
  observeContinuousAuraAbsence,hasNewerContinuousAuraPhase,retainNewerContinuousAura,
  continuousAuraBaseline} from '../../packages/combat-core/continuous-aura.mjs';

const profiles=Object.fromEntries(['RF','BM','VC'].map(id=>[id,JSON.parse(readFileSync(
  new URL(`../../packages/combat-core/${id.toLowerCase()}-profile.json`,import.meta.url)))]));
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?
  '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const marker=(revision=1,phase='active',version=2)=>({version,revision,phase});
function aura(profile,patch={}){
  return {id:1,ownerId:'source',name:CONTINUOUS_AURA_NAME,setName:CONTINUOUS_AURA_SET,definitionMember:'EFFECT0',
    definition:structuredClone(profile.effectSets[CONTINUOUS_AURA_SET].raw.EFFECT0),
    damage:structuredClone(profile.damageEffects[CONTINUOUS_AURA_NAME].raw),mainEffectName:'Raven_Aura',
    active:true,dead:false,parentEffectId:null,sourceContinuousAura:marker(),hits:{},hitGaps:{},...patch};
}
function fixture(professionId='RF',version=2){
  const effect=aura(profiles[professionId]);
  const actor={id:'source',professionId,hp:100,awakening:{full:true,remaining:30},sourceAwakeningAuraEffectGroup:[{id:effect.id}]};
  const sim={state:{effects:[effect],actors:[actor,{id:'victim',hp:100},{id:'other',hp:100}]},events:[],
    emit(type,ownerId,value){this.events.push({type,ownerId,...value});}};
  setContinuousAuraVersion(sim,version);return {sim,effect,actor};
}

test('v2 audited RF/BM/VC contracts use the same complete frozen damage and effect-set declarations',()=>{
  assert.equal(CONTINUOUS_AURA_VERSION,2);
  for(const [id,profile]of Object.entries(profiles)){
    assert.equal(digest(profile.damageEffects[CONTINUOUS_AURA_NAME].raw),'7fc94d9f4d5edf38d4b90840fe673e0c90cd9a22877bd39d8cf75d9adbe9c715',id+' damage');
    assert.equal(digest(profile.effectSets[CONTINUOUS_AURA_SET].raw),'15485500d6fdf52dcd009c1b58d971a36a78b02bbd6e36d8c13c9dafac6634cb',id+' set');
    assert.equal(isContinuousRavenAura(aura(profile),profile),true,id);
    assert.equal(validateContinuousAuraMarker(aura(profile),profile),true,id);
  }
});

test('v1 remains RF-only; unsupported modes and professions do not acquire the v2 adapter',()=>{
  for(const [id,profile]of Object.entries(profiles)){
    const effect=aura(profile,{sourceContinuousAura:marker(1,'active',1)});
    assert.equal(isRFContinuousAura(effect,profile),id==='RF');
    assert.equal(isContinuousRavenAura(effect,profile,1),id==='RF');
    assert.equal(isManagedContinuousAura(effect,{professionId:id}),id==='RF');
    if(id==='RF')assert.equal(validateContinuousAuraMarker(effect,profile),true);
    else assert.throws(()=>validateContinuousAuraMarker(effect,profile),/invalid-owner-continuous-aura/);
    assert.equal(isContinuousRavenAura(effect,profile,0),false);assert.equal(isContinuousRavenAura(effect,profile,3),false);
    for(const badId of ['LK','LP','DE','MM','rf',undefined])assert.equal(isManagedContinuousAura(aura(profile),{professionId:badId}),false);
  }
  for(const alter of [p=>{p.target.unitClass=103;},p=>{p.target.unitType=1;},p=>{delete p.target.unitClass;}]){
    const profile=structuredClone(profiles.RF);alter(profile);assert.equal(isContinuousRavenAura(aura(profiles.RF),profile),false);
  }
});

for(const [id,profile]of Object.entries(profiles)){
  test(id+' v2 refuses changed frozen damage, effect members or mesh/event semantics',()=>{
    for(const alter of [
      p=>{p.damageEffects[CONTINUOUS_AURA_NAME].raw.DAMAGE_DATA.DAMAGE.PHYSIC=9999;},
      p=>{p.damageEffects[CONTINUOUS_AURA_NAME].raw.DAMAGE_DATA.PVP_RATE=1;},
      p=>{p.damageEffects[CONTINUOUS_AURA_NAME].raw.DAMAGE_DATA.HIT_GAP=.01;},
      p=>{p.damageEffects[CONTINUOUS_AURA_NAME].raw.DAMAGE_DATA.RE_ATTACK=0;},
      p=>{delete p.damageEffects[CONTINUOUS_AURA_NAME].raw.REFLECT;},
      p=>{p.damageEffects[CONTINUOUS_AURA_NAME].raw.NEW_FIELD=1;},
      p=>{p.effectSets[CONTINUOUS_AURA_SET].raw.EFFECT0.TRACE=0;},
      p=>{p.effectSets[CONTINUOUS_AURA_SET].raw.EFFECT0.BONE_NAME='Bip01 Head';},
      p=>{p.effectSets[CONTINUOUS_AURA_SET].raw.EFFECT0.EFFECT_TYPE=8;},
      p=>{p.effectSets[CONTINUOUS_AURA_SET].raw.EFFECT1.NAME='replacement';},
      p=>{p.effectTemplates.Raven_Aura.kind='particle';},
      p=>{p.effectTemplates.Raven_Aura.fields.LifeTime=1;},
      p=>{p.effectTemplates.Raven_Aura.helperNames=['ATTACK_SPHERE2'];},
      p=>{p.effectTemplates.Raven_Aura.events[3].value=[60,60,60];},
      p=>{p.effectTemplates.Raven_Aura.repeated.Size=[1];},
      p=>{p.effectTemplates.Raven_Aura.unsupported=['unknown'];},
      p=>{p.effectTemplates.Raven_Aura.animationClips[0].durationSeconds=1;},
    ]){
      const changed=structuredClone(profile);alter(changed);const effect=aura(profile);
      assert.equal(isContinuousRavenAura(effect,changed),false);
      assert.throws(()=>validateContinuousAuraMarker(effect,changed),/invalid-owner-continuous-aura/);
    }
    const metadataOnly=structuredClone(profile);metadataOnly.damageEffects[CONTINUOUS_AURA_NAME].sourcePc={instruction:-1};
    metadataOnly.effectTemplates.Raven_Aura.source={different:'provenance'};
    assert.equal(isContinuousRavenAura(aura(profile),metadataOnly),true,'provenance does not alter the frozen collider');
  });

  test(id+' v2 refuses borrowed carriers, effect substitutions and malformed lifecycle markers',()=>{
    for(const alter of [
      e=>{e.name='RAVEN_OTHER';},e=>{e.setName=null;},e=>{e.definitionMember='EFFECT1';},
      e=>{e.definition.BONE_NAME='Bip01 Head';},e=>{e.damage.DAMAGE_DATA.DAMAGE.MAGIC=9999;},
      e=>{e.mainEffectName='OtherMesh';},e=>{e.sourceProfessionId=id;},e=>{e.parentEffectId=10;},
      e=>{e.sourceShadowMesh=true;},e=>{e.sourceArcHandle=1;},e=>{e.sourceSetTargetMesh=true;},
      e=>{e.sourceAddSummonSerial=1;},e=>{e.sourceReflected={};},e=>{e.sourceBoneEffectSetId=1;},
      e=>{e.sourceContinuousAura.version=3;},e=>{e.sourceContinuousAura.revision=0;},
      e=>{e.sourceContinuousAura.revision=1.5;},e=>{e.sourceContinuousAura.phase='changed';},
      e=>{e.sourceContinuousAura.extra=1;},e=>{e.dead=true;},e=>{e.active=false;},
      e=>{e.sourceContinuousAura.phase='ended';},
    ]){const changed=aura(profile);alter(changed);assert.throws(()=>validateContinuousAuraMarker(changed,profile),/invalid-owner-continuous-aura/);}
    const ended=aura(profile,{active:false,dead:true,sourceContinuousAura:marker(2,'ended')});
    assert.equal(validateContinuousAuraMarker(ended,profile),true);
    assert.equal(isManagedContinuousAura(aura(profile),{professionId:id}),true);
    assert.equal(continuousAuraBaseline(aura(profile)).sourceContinuousAura,undefined);
  });

  test(id+' v2 preserves newer phase frontiers, hard terminal IDs and new owner lives',()=>{
    const {sim,effect}=fixture(id);
    assert.equal(acceptContinuousAuraState(sim,'source',0,20,effect),true);
    assert.equal(hasNewerContinuousAuraPhase(sim,'source',0,19),true);
    assert.equal(retainNewerContinuousAura(sim,'source',0,effect,19),true);
    assert.equal(acceptContinuousAuraState(sim,'source',0,19,effect),false);
    const renewal={...effect,sourceContinuousAura:marker(2)};
    assert.equal(acceptContinuousAuraState(sim,'source',0,25,renewal),true);
    assert.equal(acceptContinuousAuraState(sim,'source',0,30,effect),false,'older revision stays rejected despite newer frame');
    assert.equal(endContinuousAura(sim,'source',0,effect.id,30,3),true);
    assert.equal(effect.dead,true);assert.equal(sim.state.effects.length,0);
    assert.equal(sim.state.continuousAuraReceipts[0].phase,'ended');
    assert.equal(acceptContinuousAuraState(sim,'source',0,40,{...effect,sourceContinuousAura:marker(4)}),false);
    assert.equal(acceptContinuousAuraState(sim,'source',1,1,{...effect,sourceContinuousAura:marker()}),true);
    assert.equal(sim.state.continuousAuraReceipts.every(row=>row.epoch===1),true);
  });

  test(id+' v2 retains soft-expiry renewal semantics and hardens a subsequent wire end',()=>{
    const {sim,effect,actor}=fixture(id);acceptContinuousAuraState(sim,'source',0,5,effect);
    actor.awakening.remaining=0;prepareContinuousAuraLives(sim,()=>0);
    const row=sim.state.continuousAuraReceipts[0];assert.equal(row.phase,'ended');assert.equal(row.locallyExpired,true);
    assert.equal(acceptContinuousAuraState(sim,'source',0,6,{...effect,sourceContinuousAura:marker()}),false);
    assert.equal(acceptContinuousAuraState(sim,'source',0,7,{...effect,sourceContinuousAura:marker(2)}),true);
    assert.equal(row.locallyExpired,undefined);assert.equal(row.phase,'active');
    assert.equal(endContinuousAura(sim,'source',0,1,8,3),true);
    assert.equal(acceptContinuousAuraState(sim,'source',0,9,{...effect,sourceContinuousAura:marker(4)}),false);
  });

  test(id+' v2 keeps shared per-target receipts and clears only the target whose life changed',()=>{
    const {sim,effect}=fixture(id),epochs={source:0,victim:0,other:0},epochFor=target=>epochs[target];
    prepareContinuousAuraLives(sim,epochFor);
    const sharedHits=effect.hits,sharedGaps=effect.hitGaps;
    Object.assign(sharedHits,{victim:1,other:1.1});Object.assign(sharedGaps,{victim:2.5,other:2.5});epochs.victim=1;
    prepareContinuousAuraLives(sim,epochFor);
    assert.equal(effect.hits,sharedHits);assert.equal(effect.hitGaps,sharedGaps);
    assert.equal(sharedHits.victim,undefined);assert.equal(sharedGaps.victim,undefined);
    assert.equal(sharedHits.other,1.1);assert.equal(sharedGaps.other,2.5);
    sim.state.actors[0].pvpDisconnected=true;prepareContinuousAuraLives(sim,epochFor);
    assert.equal(effect.dead,true);assert.equal(sim.state.effects.length,0);
  });
}

test('v2 empty/retired frontiers remain bounded and do not revive unseen old births',()=>{
  const {sim}=fixture('BM');sim.state.effects=[];
  observeContinuousAuraAbsence(sim,'source',0,10);
  assert.equal(acceptContinuousAuraState(sim,'source',0,10,aura(profiles.BM)),false);
  assert.equal(acceptContinuousAuraState(sim,'source',0,11,aura(profiles.BM)),true);
  endContinuousAura(sim,'source',0,1,12,2);
  for(let id=2;id<142;id++){
    assert.equal(acceptContinuousAuraState(sim,'source',0,id*2+10,aura(profiles.BM,{id})),true);
    assert.equal(endContinuousAura(sim,'source',0,id,id*2+11,2),true);
  }
  assert.ok(sim.state.continuousAuraReceipts.length<=128);
  assert.equal(acceptContinuousAuraState(sim,'source',0,11,aura(profiles.BM)),false);
  clearContinuousAuraOwner(sim,'source');assert.equal(sim.state.continuousAuraReceipts.length,0);
  assert.equal(sim.state.continuousAuraAbsenceFrames.source,undefined);
  assert.equal(sim.state.continuousAuraRetirementFrames.source,undefined);
  assert.equal(acceptContinuousAuraState(sim,'source',1,1,aura(profiles.BM)),true);
});

test('mode negotiation cannot mix v1/v2 markers, and mode zero clears all managed colliders',()=>{
  const {sim}=fixture('RF',1);
  assert.equal(acceptContinuousAuraState(sim,'source',0,1,aura(profiles.RF)),false);
  setContinuousAuraVersion(sim,2);
  assert.equal(acceptContinuousAuraState(sim,'source',0,1,aura(profiles.RF,{sourceContinuousAura:marker(1,'active',1)})),false);
  assert.equal(acceptContinuousAuraState(sim,'source',0,1,aura(profiles.RF)),true);
  for(const version of [-1,3,'2',true,undefined])assert.throws(()=>setContinuousAuraVersion(sim,version),/invalid-continuous-aura-version/);
  sim.state.effects.push(aura(profiles.RF,{id:2,sourceContinuousAura:marker(1,'active',1)}));
  setContinuousAuraVersion(sim,0);assert.equal(sim.state.effects.length,0);assert.equal(sim.continuousAuraVersion,0);
  assert.equal(sim.state.continuousAuraReceipts,undefined);assert.equal(sim.events.length,2);
});

test('v2 caches immutable source declarations, rechecking replaced raw/template references',()=>{
  const profile=structuredClone(profiles.BM),effect=aura(profile),damage=profile.damageEffects[CONTINUOUS_AURA_NAME].raw;
  let visits=0;const data=damage.DAMAGE_DATA;
  Object.defineProperty(damage,'DAMAGE_DATA',{enumerable:true,configurable:true,get(){visits++;return data;}});
  assert.equal(isContinuousRavenAura(effect,profile),true);const firstVisits=visits;assert.ok(firstVisits>0);
  for(let i=0;i<120;i++)assert.equal(isContinuousRavenAura(effect,profile),true);
  assert.equal(visits,firstVisits,'unchanged source references never walk the nested damage again');
  const changedDamage=structuredClone(profiles.BM.damageEffects[CONTINUOUS_AURA_NAME].raw);
  changedDamage.DAMAGE_DATA.DAMAGE.PHYSIC=99;profile.damageEffects[CONTINUOUS_AURA_NAME].raw=changedDamage;
  assert.equal(isContinuousRavenAura(effect,profile),false);
  profile.damageEffects[CONTINUOUS_AURA_NAME].raw=damage;assert.equal(isContinuousRavenAura(effect,profile),true);
  const set=profile.effectSets[CONTINUOUS_AURA_SET].raw,changedSet=structuredClone(set);changedSet.EFFECT0.TRACE=0;
  profile.effectSets[CONTINUOUS_AURA_SET].raw=changedSet;assert.equal(isContinuousRavenAura(effect,profile),false);
  profile.effectSets[CONTINUOUS_AURA_SET].raw=set;assert.equal(isContinuousRavenAura(effect,profile),true);
  const template=profile.effectTemplates.Raven_Aura,changedTemplate=structuredClone(template);changedTemplate.events=[];
  profile.effectTemplates.Raven_Aura=changedTemplate;assert.equal(isContinuousRavenAura(effect,profile),false);
  profile.effectTemplates.Raven_Aura=template;assert.equal(isContinuousRavenAura(effect,profile),true);
});

test('v2 effect cache rechecks every declaration replacement and fresh clone; mutable carrier fields remain guarded',()=>{
  const profile=profiles.VC,effect=aura(profile),definition=effect.definition;let visits=0;
  Object.defineProperty(definition,'BONE_NAME',{enumerable:true,configurable:true,get(){visits++;return 'Bip01';}});
  assert.equal(isContinuousRavenAura(effect,profile),true);const firstVisits=visits;assert.ok(firstVisits>0);
  for(let i=0;i<120;i++)assert.equal(isContinuousRavenAura(effect,profile),true);
  assert.equal(visits,firstVisits,'unchanged aura declaration is checked once per object');
  effect.definition={...definition,TRACE:0};assert.equal(isContinuousRavenAura(effect,profile),false);
  effect.definition=definition;assert.equal(isContinuousRavenAura(effect,profile),true);
  const damage=effect.damage;effect.damage=structuredClone(damage);effect.damage.DAMAGE_DATA.PVP_RATE=10;
  assert.equal(isContinuousRavenAura(effect,profile),false);effect.damage=damage;assert.equal(isContinuousRavenAura(effect,profile),true);
  const illegalClone=structuredClone(effect);illegalClone.damage.DAMAGE_DATA.HIT_GAP=0;
  assert.equal(isContinuousRavenAura(illegalClone,profile),false,'a new clone cannot inherit another object\'s cached verdict');
  for(const [field,value]of [['sourceProfessionId','RF'],['definitionMember','EFFECT1'],['mainEffectName','Other'],['parentEffectId',99]]){
    const old=effect[field];effect[field]=value;assert.equal(isContinuousRavenAura(effect,profile),false,field);
    if(old===undefined)delete effect[field];else effect[field]=old;assert.equal(isContinuousRavenAura(effect,profile),true);
  }
});

/** Read original target declarations and qualified source; never simulator output. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const read=p=>JSON.parse(readFileSync(p,'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
const declarations=Object.fromEntries(['elsword','damage','effect','battle-buff','buff-factor','skill'].map(n=>[n,read('.cache/rs-feedback-review/'+n+'-declarations.json')]));
for(const d of Object.values(declarations))assert.equal(sha(readFileSync(d.source.path)),d.source.sha256);
const refs=[['X2Lib/X2GUElsword_SwordMan.cpp',[[3911,3942],[13970,14197],[14655,14900],[15023,15036]],'.cache/native-source-runtime/'],
  ['X2Lib/X2GUUser.cpp',[[11499,11556],[11720,11798],[11799,11830],[20485,20530],[26006,26038],[26371,26395]],'.cache/native-source-runtime/'],
  ['X2Lib/X2GUUser.h',[[1954,1960]],'.cache/native-source-runtime/'],
  ['X2Lib/X2GameUnit.cpp',[[12203,12226],[13664,13723]],'.cache/native-source-runtime/'],
  ['X2Lib/X2EffectSet.cpp',[[124,185],[1800,1869],[2218,2218],[2641,2660]],'.cache/native-source-runtime/'],
  ['KTDXLIB/KTDGXSkinAfterImage.cpp',[[19,54],[79,129]],'.cache/rs-afterimage-source/']].map(([path,spans,cache])=>{
    const bytes=readFileSync(cache+path),lines=bytes.toString('latin1').split(/\r?\n/),blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if(path.endsWith('KTDGXSkinAfterImage.cpp'))assert.equal(blob,read('.cache/rs-afterimage-source/tree-selected.json').find(r=>r.path==='KTDGXSkinAfterImage.cpp').sha);
    return {path:'JP_TW_EU_CN_US/Trunk/'+path,cachePath:cache+path,sha256:sha(bytes),gitBlob:blob,bytes:bytes.length,
      fragments:spans.map(([firstLine,lastLine])=>({firstLine,lastLine,sha256:sha(Buffer.from(lines.slice(firstLine-1,lastLine).join('\n'),'latin1'))}))};
  });
const target={sources:Object.fromEntries(Object.entries(declarations).map(([k,d])=>[k,d.source])),
  states:Object.fromEntries(['ESSI_ERS_DASH_COMBO_XZ','ESSI_ERS_XZ_CHARGE','ESSI_SA_EMK_SWORD_FIRE','ESSI_SA_EMK_SWORD_FIRE_LANDING','ESSI_SI3_ES_STORM_BLADE','ESSI_SA_ERS_SPLASH_EXPLOSION','ESSI_SI2_ES_RISING_SLASH']
    .map(n=>[n,{raw:declarations.elsword.globals[n],sourcePc:declarations.elsword.locations[n]}])),
  damage:Object.fromEntries(['ELSWORD_RUNE_SLAYER_DASH_JUMP_XZ','ELSWORD_RUNE_SLAYER_DASH_JUMP_XZZ','DamageEffect_SA_EMK_StromBlade','DamageEffect_SA_EMK_StromBladeCenter','DamageEffect_SA_ERS_SplashExplosion_Attack','DamageEffect_SA_ERS_SplashExplosion_Attack_2','DamageEffect_EMK_SwordFire_Fire_Attack','DamageEffect_EMK_Sand_RisingSlashFX','DamageEffect_EMK_Sand_RisingSlashFX2'].map(n=>[n,declarations.damage.globals[n]])),
  runeSets:Object.fromEntries(['EffectSet_ERS_COMBO_XZ','EffectSet_ERS_COMBO_XZZ','EffectSet_ERS_COMBO_FULL_CHARGE_XZZ','EffectSet_ELSWORD_DASH_JUMP_XZ','EffectSet_ELSWORD_DASH_JUMP_XZZ']
    .map(n=>[n,declarations.effect.nativeCalls.find(c=>c.args?.[1]?.NAME===n)])),
  splashSet:declarations.effect.nativeCalls.find(c=>c.args?.[1]?.NAME==='EffectSet_ELSWORD_SPLASH_EXPLOSION'),
  splashSkill:declarations.skill.nativeCalls.find(c=>c.target==='g_pSkillTree.AddSkillTemplet_LUA'&&c.args?.[1]?.m_eID===21018),
  splashIdentity:{skillId:21018,originalName:'Splash Explosive',
    feedbackMappingEvidence:'Target 2016 skill 21018 declares the Splash Explosive state and damage IDs.',
    supersededMapping:{skillId:21032,reason:'Prior fire-pillar feedback mapping was incorrect for this request; Rising Slash no longer represents this item.'}},
  phoenixBuff:declarations['battle-buff'].nativeCalls.find(c=>c.args?.[1]?.BUFF_TEMPLET_ID===4),phoenixColor:declarations['battle-buff'].nativeCalls[4]};
assert.equal(target.phoenixColor.target,'D3DXCOLOR');assert.deepEqual(target.phoenixColor.args,[1,.157,0,1]);
const effectSetRef=refs.find(r=>r.path.endsWith('X2EffectSet.cpp'));
assert.equal(effectSetRef.sha256,'395a9f57eda3aec4011b65bbd186b612987c9e4f85e96766dd3c13b0d8288440');
assert.equal(effectSetRef.gitBlob,'b561ce3408224a5d15a3cab8be54cfb91bcf76c9');
assert.equal(target.splashSkill.args[1].m_wstrName,target.splashIdentity.originalName);
assert.equal(target.splashSet.args[1].EVENT_TIMER_TYPE,undefined);
const out={schemaVersion:1,originalClientMeasurements:0,referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
  evidenceClass:'target2016-static+qualified-fixedV5-consumer+web-display-budget',references:refs,target,
  independentExpectations:{airRuneBirthAnimationTime:.26,releaseAnimationTime:.01,chargeGateAnimationTime:.5,chargeMaximumStateSeconds:1,
    swordFirePassiveSpeed:[-1,-1],swordFireGravityReleaseAnimationTime:1.3,swordFireAdditionalGravityMultiplier:2,
    swordFireAirEnd:'XAP_ONE_WAIT holds last pose until floor, then LANDING; no unsupported airborne cancel invented',
    phoenixAfterimage:{color:[1,.157,0,1],interval:.02,birthAlpha:.5,fadePerSecond:1.6,localImages:10,remoteImages:5},
    phoenixAbsorption:{targetBuffTemplate:4,factorId:46,eligibility:'CAN_REFLEX',mp:10},
    splashLaunch:{markBirthAnimationTime:.36,setClock:'default ESTT_ANIM; StateStart direct PlayEffectSet retains m_bUseAnimationTiming=true',markMeshLifeGlobalSeconds:.8,
      markReaction:2,launchReaction:5,launchY:1000,forceFly:1,skipAnimationTime:1.4,
      nearGroundPickup:'RT_SMALL heightAboveLand<150 OR AT_UNIT attackerHeightAboveLand<90 clears only positive Y; original hit geometry still required'},
    stormNext:{centerReaction:16,centerY:450,outerReaction:16,outerY:700,forceFly:1}},
  boundaries:['Target2016 runtime/client trajectory count remains zero; matching V6 C++ unacquired.',
    'Dash held-Z entry into target-only charge state is a declared input adapter, matching V6 callback unavailable.',
    'Medium SwordFire flame capacity is a web display tradeoff, not an original option numeric value.',
    'Afterimage uses actual current displayed skinned geometry with source colour/timer/fade; GPU colour-edge pass is a host adapter.',
    'Storm near-ground front-facing interruption is reproduced; do not change target450/700 or force infinite float without matching target evidence.',
    'Splash original-client follow-up trajectory is unavailable; default timer and declared .8s mesh/RT_FLY1000 are independently supported, no subjective launch delay or larger pickup box invented.']};
writeFileSync('contracts/rs-feedback-review-source.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({references:refs.length,targetSources:Object.keys(target.sources).length,states:Object.keys(target.states).length}));

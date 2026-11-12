/** Freeze expectations from the read-only target declaration cache and fixed
 * consumer bytes. Never import combat-core or record simulator output as gold.
 * Run once to review source changes; tests consume the committed fixture.
 */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>JSON.parse(readFileSync(resolve(root,path)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const target=read('.cache/rf-skills-v1/raven-declarations.json');
const skills=read('.cache/rf-skills-v1/skill-declarations.json');
const notes=read('.cache/rf-skills-v1/skill-note-declarations.json');
// Reviewed target spelling/registration candidates. This list is deliberately
// independent of the runtime catalog and policy under test.
const bindings=[
  [24025,'RSI_SI1_MAXIMUM_CANNON'],[24026,'RSI_SI2_CANNON_BLADE'],
  [24027,'RSI_SI2_POWER_ASSAULT'],[24028,'RSI_SI3_SEVEN_BURST'],
  [24032,'RSI_SI1_OVER_TAKER_CHARGED_BOLT'],
  [24203,'RSI_A_RF_MEGADRILL_BREAK'],[24204,'RSI_A_ROT_WEAPON_BREAK'],
  [24006,'RSI_SI3_OVER_TAKER_GUARDIAN_STRIKE'],[24007,'RSI_A_ROT_NUCLEAR'],
  [24205,'RSI_A_RRF_LIMIT_CRUSHER_CHARGE','RSI_A_RRF_LIMIT_CRUSHER_REVENGE_ATTACK','RSI_A_RRF_LIMIT_CRUSHER_AVOID_ATTACK'],
  [24008,'RSI_SI2_OVER_TAKER_ARC_ENEMY'],
  [24009,'RSI_SA_RRF_WILD_CHARGE_READY','RSI_SA_RRF_WILD_CHARGING','RSI_SA_RRF_WILD_CHARGE_DASH'],
  [24206,'RSI_A_RRF_ENCHANT_HAND'],[24010,'SI_SA_RRF_X_CRASH'],[24603,'RSI_HA_RRF_INFERNAL_ARM'],
  [24217,'RSI_SI_A_RF_SHADOW_STEP','RSI_SHADOW_BACK_SLIDE_UPGRADE','RSI_SHADOW_BACK_SLIDE_END_UPGRADE','RSI_SHADOW_STEP_Z','RSI_SHADOW_STEP_Z_UPGRADE','RSI_SHADOW_STEP_X_UPGRADE'],
  [24218,'RSI_A_RWT_FLAME_SWORD','RSI_A_RWT_FLAME_SWORD_GROUND','RSI_A_RWT_FLAME_SWORD_FLY'],
  [24219,'RSI_A_RRF_HELL_DIVE_UPGRADE','RSI_A_RRF_HELL_DIVE'],
  [24029,'RSI_SA_ROT_VALKYRIESJAVELIN','RSI_SA_ROT_VALKYRIESJAVELIN_LANDING'],[900,'RSI_THROW_ITEM'],
];
const templates=new Map(skills.nativeCalls.filter(c=>c.target.endsWith('AddSkillTemplet_LUA')).map(c=>[c.args.at(-1).m_eID,c.args.at(-1)]));
const multipliers=[.5,1,1.5];
const rows=bindings.map(([skillId,...states])=>{
  const template=templates.get(skillId);
  if(!template)throw new Error('Missing target skill '+skillId);
  const family=new Set([skillId]);let old=template.m_DeleteSkillIDByUpgrade;
  while(old){family.add(old);old=templates.get(old)?.m_DeleteSkillIDByUpgrade;}
  const branches=notes.nativeCalls.filter(c=>c.target.endsWith('AddNewSkillNoteTemplet'))
    .flatMap(c=>Object.values(c.args.at(-1).MEMO_LIST??{})).filter(b=>family.has(b['2']))
    .map(b=>({id:'memo-'+b['3'],memoType:b['1'],rawPositions:b}));
  return {skillId,originalName:template.m_wstrName,branches,states:states.map(state=>{
    const raw=target.globals[state];if(!raw)throw new Error('Missing target state '+state);
    const originalItemAbility=raw.APPLY_ANIM_SPEED_BY_ITEM_ABILITY??true;
    const webItemAbility=skillId===24203?false:originalItemAbility!==0&&originalItemAbility!==false;
    const authoredSpeed=raw.ANIM_SPEED??1;
    return {state,sourcePc:target.locations[state],animationName:raw.ANIM_NAME,
      raw:{...(Object.hasOwn(raw,'ANIM_SPEED')?{ANIM_SPEED:raw.ANIM_SPEED}:{}),
        ...(Object.hasOwn(raw,'APPLY_ANIM_SPEED_BY_ITEM_ABILITY')?{APPLY_ANIM_SPEED_BY_ITEM_ABILITY:raw.APPLY_ANIM_SPEED_BY_ITEM_ABILITY}:{}),
        ...(Object.hasOwn(raw,'TRANSITION')?{TRANSITION:raw.TRANSITION}:{})},
      authoredSpeed,originalItemAbility:originalItemAbility!==0&&originalItemAbility!==false,
      webItemAbility,expectedSpeeds:multipliers.map(m=>authoredSpeed*(webItemAbility?m:1)),
      userOverride:skillId===24203,hyperAliasPresent:Object.hasOwn(target.globals,state+'_HYPER')};
  })};
});
const referenceHashes={
  'X2Lib/X2GUUser.cpp':'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38',
  'X2Lib/X2GURaven.cpp':'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237',
  'KTDXLIB/KTDGXSkinAnim.h':'03ab46e51d622495dd15d800f664440b0c63f3b9875f7d7692f8435cbda206a4',
  'KTDXLIB/KTDGXSkinAnim.cpp':'4ff5e681c5b63eb828d00e0e6fc848066af93ed39b0750615765da248911c76d',
};
const referenceSpans=[
  ['X2Lib/X2GUUser.cpp',13625,13654,'Future state reads authored speed; item-ability default true and ResetAnimSpeed gate'],
  ['X2Lib/X2GUUser.cpp',14182,14197,'Now state reads the same default/gate'],
  ['X2Lib/X2GUUser.cpp',26853,26880,'ResetAnimSpeed: optional extra multiplier then gated GetAnimSpeedValue'],
  ['X2Lib/X2GUUser.cpp',26939,26971,'Independent status/world speed layer and Now/Future track assignment'],
  ['KTDXLIB/KTDGXSkinAnim.h',152,160,'SetPlaySpeed keys linear speed over authored transition duration divided by target speed'],
  ['KTDXLIB/KTDGXSkinAnim.cpp',1199,1215,'ChangeAnim true starts incoming track at zero and keys speed/weight'],
  ['KTDXLIB/KTDGXSkinAnim.cpp',1258,1282,'Default transition clip-period/10 with floor .03'],
  ['X2Lib/X2GURaven.cpp',4132,4157,'MegaDrill same normal table for Hyper; old item-note alias conditional'],
  ['X2Lib/X2GURaven.cpp',22104,22236,'MegaDrill callbacks consume animation timers; no private speed reset'],
].map(([path,startLine,endLine,purpose])=>{
  const bytes=readFileSync(resolve(root,'.cache/native-reference',path));
  if(sha(bytes)!==referenceHashes[path])throw new Error('Pinned fixedV5 source hash mismatch '+path);
  const lines=bytes.toString('latin1').split('\n');
  return {path,startLine,endLine,purpose,fileSha256:sha(bytes),fragmentSha256:sha(Buffer.from(lines.slice(startLine-1,endLine).join('\n')+'\n','latin1'))};
});
const nativeManifest=read('artifacts/native/manifest.json');
const nativeModules=Object.entries(nativeManifest.modules).map(([name,m])=>{
  const file=m.file??m.wasmFile??m.wasm;if(!file)throw new Error('Native file missing '+name);
  return {name,file,sha256:sha(readFileSync(resolve(root,'artifacts/native',file)))};
});
const cacheInputs=['raven','skill','skill-note'].map(name=>{
  const path='.cache/rf-skills-v1/'+name+'-declarations.json',cache=read(path);
  if(existsSync(cache.source.path)&&sha(readFileSync(cache.source.path))!==cache.source.sha256)throw new Error('Read-only target source hash mismatch '+cache.source.path);
  return {cachePath:path,cacheSha256:sha(readFileSync(resolve(root,path))),targetSource:cache.source};
});
const fixture={schemaVersion:1,evidenceClass:'target2016-static-plus-fixedV5-default-gate; independent-frozen-expectations',
  targetClientMeasured:false,multipliers,rows,nativeModules};
const contract={schemaVersion:1,referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',targetClientMeasured:false,
  inputs:cacheInputs,referenceSpans,activeCount:rows.length,branchCount:rows.reduce((n,r)=>n+r.branches.length,0),
  stateCount:rows.reduce((n,r)=>n+r.states.length,0),targetExplicitFalseCount:rows.flatMap(r=>r.states).filter(s=>!s.originalItemAbility).length,
  userRule:{skillId:24203,displayName:'Mega Drill Break',animationName:'SI_A_RF_MEGADRILL_BREAK',
    appliesItemAbility:false,evidenceClass:'user-requested-web-correction',
    targetConflict:'2016 state omits gate; fixedV5 defaults true. Preserve original declaration and label this override independently.',
    coverage:'normal and awakened casts, both selectable traits, any state using this exact character animation'},
  boundaries:{traits:'36 arrays have no recovered action-speed modifier. MI_FASTEST is the target-described cooldown candidate, not animation acceleration.',
    hyper:'No target _HYPER alias exists for the 31 audited action tables. Existing casts share normal table, with separate effect/callback Hyper mode.',
    buffs:'Current RF supported buff behaviors do not compose an animation-speed additional stat. Resolved final-stat multiplier is gated; hit/world stops remain independent. Do not claim full ResetAnimSpeed status/world layers or live buff rekeying as restored.',
    clock:'Keep authored speed and transition integral driving both events and pose. Effect USE_GLOBAL_TIME and native movement consumers stay separate.',
    native:'Ten compiled module bytes retained; no rebuild or ABI/network change.'},
  fixture:'tests/fixtures/rf-skill-animation-speed-v6.json',fixtureSha256:sha(Buffer.from(JSON.stringify(fixture,null,2)+'\n'))};
writeFileSync(resolve(root,contract.fixture),JSON.stringify(fixture,null,2)+'\n');
writeFileSync(resolve(root,'contracts/rf-skill-animation-speed-source-v6.json'),JSON.stringify(contract,null,2)+'\n');
console.log(JSON.stringify({actives:contract.activeCount,traits:contract.branchCount,states:contract.stateCount,explicitFalse:contract.targetExplicitFalseCount,nativeModules:nativeModules.length}));

/** Read-only audit of already pinned fixed-V5 inputs; no source download or
 * client execution. Generated hashes identify evidence, not a GPU golden. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('../../',import.meta.url));
const reference=resolve(process.argv[2]??resolve(project,'.cache/native-reference'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const previous=JSON.parse(readFileSync(resolve(project,'contracts/rf-screen-landing-source-v1.json')));
const full=JSON.parse(readFileSync(resolve(project,'contracts/rf-full-skill-source.json')));
const reactions=JSON.parse(readFileSync(resolve(project,'contracts/rf-command-reactions-source-v9.json')));
const expected=new Map();
for(const row of [...previous.files,...full.referenceFiles,...reactions.sourceFiles])if(row.relativePath)expected.set(row.relativePath,row);
// Existing evidence inventories use several schemas; these two frozen files
// are also present in rf-hit-audio-source-v17 and rf-guild-source-v20.
const audio=JSON.parse(readFileSync(resolve(project,'contracts/rf-hit-audio-source-v17.json')));
for(const row of audio.cppSources)expected.set(row.path,{...expected.get(row.path),...row});
const inputs=[
  ['X2Lib/X2DamageManager.cpp',[[586,620],[1628,1645],[1959,1965]]],
  ['X2Lib/X2DamageEffect.cpp',[[3663,3680],[4480,4530],[4599,4618],[4994,5027],[5463,5490],[6305,6327]]],
  ['X2Lib/X2GUUser.cpp',[[4286,4305],[12830,12862],[12893,12973],[13006,13039]]],
  ['X2Lib/X2GURaven.cpp',[[474,481],[5110,5143],[14265,14373]]],
  ['X2Lib/X2GameUnit.h',[[3448,3470]]],
  ['KTDXLIB/KTDGParticleSystem.h',[[1474,1486]]],
  ['KTDXLIB/KTDGParticleSystem.cpp',[[3000,3030],[3194,3240]]],
  ['KTDXLIB/Always.h',[[3250,3250]]],
];
const files=inputs.map(([file,spans])=>{
  const bytes=readFileSync(resolve(reference,file)),hash=digest(bytes),prior=expected.get(file);
  if(!prior||prior.sha256!==hash)throw Error('Reference bytes differ from prior source inventory: '+file);
  const lines=bytes.toString('latin1').split('\n');
  return {relativePath:file,sha256:hash,bytes:bytes.length,...(prior.gitBlob?{gitBlob:prior.gitBlob}:{}),
    spans:spans.map(([startLine,endLine])=>({startLine,endLine,sha256:digest(Buffer.from(lines.slice(startLine-1,endLine).join('\n'),'latin1'))}))};
});
const profile=JSON.parse(readFileSync(resolve(project,'packages/combat-core/rf-profile.json')));
const targetEffects=['DamageEffect_SA_RRF_XCrash1_Damage','DamageEffect_SA_RRF_XCrash2_Damage','DamageEffect_SA_RRF_XCrash_Fire_Damage',
  'DamageEffect_SA_ROT_GuardianStrike','DamageEffect_A_RRF_EnchantHand','RAVEN_NASOD_BALL'];
const contract={schemaVersion:1,evidenceClass:'fixed-V5 consumer + target2016 static declaration + web simulation regression',
  referenceCommit:previous.referenceCommit,targetClientMeasured:false,gpuCompared:false,spanHashEncoding:'original bytes; inclusive lines joined with LF, retaining source CR bytes',files,
  consumers:{character:'DamageCheck AT_UNIT -> UnitToUnit -> GUUser AttackResult -> virtual Raven AttackResultPlayEffect -> GUUser common per-actor sequence handles',
    effect:'DamageCheck AT_EFFECT -> EffectToUnit -> CEffect AttackResult -> SetHitParticle; virtual Raven AttackResultByType handles core gauge/launch without calling common AttackResultPlayEffect',
    retrigger:'SetPosition + SetLandPosition + SetEmitRate + SetTriggerCount; resets Count only, preserves live particles, sequence clock and fractional carry',
    persistent:'Raven CreateMajorParticleArray SetTriggerWait(true) keeps idle common handles until actor removal',
    impactPoint:'SetParticleData DEPT_IMPACT_POINT only sets position, not owner yaw/axis/add-rotation'},
  commonCharacterSequences:{small:[['DamageImpact',100,200,10,2],['DamageImpactCore',100,200,10,2],['DamageImpactSlash',50,50,2,2]],
    other:[['DamageImpactRed',100,200,10,2],['DamageImpactRingRed',100,200,1,1],['DamageImpactCoreRed',100,100,1,1],['DamageImpactSlashRed',50,50,1,1]],
    columns:['name','minEmitRate','maxEmitRate','triggerCount','sequenceDrawCount']},
  targetDamageEffects:targetEffects.map(name=>{const row=profile.damageEffects[name];return {name,sourcePc:row.sourcePc??null,
    extractedRawSha256:digest(JSON.stringify(row.raw)),hitParticles:Object.entries(row.raw).filter(([key])=>/^HIT_PARTICLE\d+$/.test(key)).map(([key,entry])=>({key,...entry}))};}),
  unchanged:['target particle count/cap/lifetime/trigger values','damage hit clocks/gaps/spheres','native ten-module binaries','combat and presentation RNG policies'],
  pending:['target2016 full native consumer/runtime measurement','original GPU/frame scheduling and cross-template sequence draw ordering']};
writeFileSync(resolve(project,'contracts/rf-hit-particle-consumers-source-v2.json'),JSON.stringify(contract,null,2)+'\n');
console.log(JSON.stringify({files:files.length,targetDamageEffects:targetEffects.length,output:'contracts/rf-hit-particle-consumers-source-v2.json'}));

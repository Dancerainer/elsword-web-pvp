/** Independent target declarations and pinned consumer bytes; never export
 * simulation observations as native expectations. Run prepare_lk_declarations
 * into .cache/rs-feedback-v3/declarations before this read-only source audit. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const decl=name=>read('.cache/rs-feedback-v3/declarations/'+name+'-declarations.json');
const damage=decl('damage'),state=decl('elsword'),fx=read('contracts/rs-fx-index.json');
const pinned=[
 ['X2GUElsword_SwordMan.cpp','40dde7e70da2cd2888b1a08bcfe10cdab444e037','ebf61b55464e6c43a0d5fd0b75b1cef8be6bf1049a3e1a4c818104bb6c03e84d',[[3911,3942],[15023,15036]]],
 ['X2GUUser.cpp','f608ea3f556770d5aa5b43d5b00270d6351b6fcd','ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38',[[26371,26395]]],
 ['X2GUUser.h','aae9761ea40f4e6d5edbb298e0a7b8e4a26c274c','c0f49d892b2639281d0196f90ff650d52421887bbad43189e6d6b9d841937adc',[[40,46]]],
 ['X2DamageEffect.cpp','b5e926abecbde51f7ed29d6b7dc0448eb0d30e91','8a76540f2d6e318ce474cf6d63e1822be3d90b880f647bae480f26ea3d6afed8',[[2330,2348],[2395,2418],[4717,4728],[6072,6082],[7201,7239]]],
];
const references=pinned.map(([name,gitBlob,sha256,spans])=>{
 const file='.cache/native-source-runtime/X2Lib/'+name,bytes=readFileSync(file);
 assert.equal(sha(bytes),sha256,name);
 assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),gitBlob,name);
 const lines=bytes.toString('latin1').split(/\r?\n/);
 return{path:'JP_TW_EU_CN_US/Trunk/X2Lib/'+name,cachePath:file,gitBlob,sha256,bytes:bytes.length,
   fragments:spans.map(([firstLine,lastLine])=>({firstLine,lastLine,sha256:sha(Buffer.from(lines.slice(firstLine-1,lastLine).join('\n'),'latin1')),
     normalization:'original Latin1 bytes with LF, no final LF'}))};
});
for(const d of [damage,state])assert.equal(sha(readFileSync(d.source.path)),d.source.sha256);
const names=['ERS_SplashExplosionSL01','ERS_SplashExplosionSL02','ERS_SplashExplosionS01','ERS_SplashExplosionS02','ERS_SplashExplosionE01','ERS_SplashExplosionE02'];
const templates=names.map(name=>{const t=fx.templates[name];assert.equal(sha(readFileSync('asset_work/'+t.source.rawPath)),t.source.sha256);return{name,fields:t.fields,source:t.source,declarationSha256:t.declarationSha256};});
const out={schemaVersion:1,originalClientMeasurements:0,
 evidenceClass:'target2016-static+qualified-fixedV5-consumer',
 referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',references,
 targetSources:{state:state.source,damage:damage.source},
 splash:{rawState:state.globals.ESSI_SA_ERS_SPLASH_EXPLOSION,sourcePc:state.locations.ESSI_SA_ERS_SPLASH_EXPLOSION,
   marking:damage.globals.DamageEffect_SA_ERS_SplashExplosion_Attack,
   explosion:damage.globals.DamageEffect_SA_ERS_SplashExplosion_Attack_2,
   markingMesh:fx.templates.SA_ERS_SplashExplosion_AttackBox_01,
   explosionMesh:fx.templates.SA_ERS_SplashExplosion_AttackBox_02,
   independentExpectations:{skipTime:1.4,skipComparison:'strict animation time >1.4 and held arrow/ZXASDCQWER; animation end first',
     markBirth:.36,markMeshLife:.8,markReaction:2,explosionMeshLife:.5,explosionReaction:5,explosionYSpeed:1000,explosionForceFly:1},
   passiveLifetimeScope:'SwordMan multiplies EffectSetInstance.m_fLifeTime, not its spawned attack mesh lifetime. This set has only one birth at.36; preserve the mesh.8s die-child clock.',
   childScaleConsumer:'CEffect SetScale4717 sets DieDamageScale; CreateDieDamageEffect6079 applies it to child SetScale. Preserve the same validated rune level and instance size on explosion.',
   templates},
 phoenix:{raw:damage.globals.DamageEffect_SA_ERS_PhoenixTalon,sourcePc:damage.locations.DamageEffect_SA_ERS_PhoenixTalon,
   independentExpectations:{ascendingReaction:16,ascendingHitGap:.1,phaseChangeAnimationTime:1.35,returningReaction:2,returningDefenderStop:.7,returningReattack:0},
   receiptConsumer:'Repeat-hit entries expire before damage-stage switching; SetDamageDataNext retains only entries still present. Expired ascending entries must not block a returning contact forever.',
   correctionScope:'Only RS Phoenix first stage; do not blanket-clear live gaps or replay a returning one-shot hit. Preserve prior user-authorized ascending FORCE_FLY1 override.'},
 limitations:['Fixed V5 includes later reconstruction and conditional SKILL_BALANCE_PATCH consumer; not a recovered target2016 executable.',
   'Original client dynamic comparison remains unmeasured; current model collision, owner reports and GPU are separately recorded.',
   'Medium particle density preservation is a web presentation policy, not a native medium-setting particle-count claim.']};
writeFileSync('contracts/rs-splash-phoenix-source-v3.json',JSON.stringify(out,null,2)+'\n');
console.log('Verified target declarations and4 independent fixed-reference file/blob identities.');

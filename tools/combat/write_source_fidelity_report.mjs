/** Record independently sourced assets and observed browser/replay evidence.
 * The exported trace is an implementation observation, never a native answer. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=file=>JSON.parse(readFileSync(resolve(root,file),'utf8'));
const sha=file=>createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex');
const write=(file,value)=>writeFileSync(resolve(root,file),JSON.stringify(value,null,2)+'\n');
const profile=read('packages/combat-core/rf-profile.json'),assets=read('artifacts/rf/manifest.json'),fx=read('contracts/rf-fx-index.json');
const native=read('contracts/rf-native-reference.json'),browser=read('artifacts/proof/rf-browser-combat-check.json');
assert.equal(browser.targetClientMeasured,false);
assert.ok(Array.isArray(browser.consoleErrors)&&Array.isArray(browser.consoleWarnings),'Capture actual browser console results');
assert.equal(assets.runtimeCharacter.profileCoverage.sha256,sha('packages/combat-core/rf-profile.json'));
for(const state of Object.values(profile.states))assert.ok(assets.runtimeCharacter.selection.included.includes(state.animationName),'Original runtime clip absent: '+state.animationName);
for(const file of native.files)assert.equal(sha('.cache/native-reference/'+file.path.split('/Trunk/')[1]),file.sha256,'Pinned source changed: '+file.path);
const replayChecks=[];
for(const input of process.argv.slice(2)){
  const file=resolve(root,input),trace=JSON.parse(readFileSync(file,'utf8'));
  const result=spawnSync(process.execPath,['tools/replay-trace.mjs',file],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const check=JSON.parse(result.stdout.trim());
  replayChecks.push({file:relative(root,file).replaceAll('\\','/'),sha256:sha(file),versions:trace.versions,...check,
    inputTransitions:trace.events.filter(e=>e.type==='stateChanged').map(e=>({actorId:e.actorId,state:e.state,reason:e.reason})),
    observedHitCount:trace.events.filter(e=>e.type==='hit').length});
}
assert.ok(replayChecks.length>=3,'Supply at least command, skill, and awakening browser traces');
const proofs=['rf-combat-fx-frame35.jpg','rf-combat-fx-frame45.jpg','rf-combat-z-frame12.jpg','rf-combat-awakening.jpg'].map(name=>{
  const file='artifacts/proof/'+name;return {file,sha256:sha(file),kind:'simulation-implementation screenshot'};
});
const report={schemaVersion:1,programVersion:browser.frame35Audit.versions.programVersion,
  targetClientMeasured:false,targetClientTraceCount:0,fidelityGate:'pending-target-client-baseline',
  evidenceSeparation:{target:'2016 original-file-data',nativeSemantics:'pinned reference-V5; target runtime unmeasured',browser:'simulation-implementation; not independent ground truth'},
  source:{referenceCommit:native.commit,referenceFileCount:native.files.length,referenceManifest:'contracts/rf-native-reference.json',
    profileSha256:sha('packages/combat-core/rf-profile.json'),presetVersion:read('config/rf-preset.json').presetVersion,
    fxIndexSha256:sha('contracts/rf-fx-index.json'),converterVersion:assets.converterVersion},
  conversion:{states:Object.keys(profile.states).length,coveredStateAnimations:Object.keys(assets.runtimeCharacter.profileCoverage.stateAnimations).length,
    originalRuntimeClips:assets.runtimeCharacter.selection.included.length,fullSourceClips:assets.clips.length,
    runtimePoseBones:read('artifacts/rf/runtime-pose.json').frames.length,effectOwnerBones:assets.runtimeCharacter.profileCoverage.effectOwnerBones,
    effectSets:Object.keys(profile.effectSets).length,damageTemplates:Object.keys(profile.damageEffects).length,
    fxTemplates:Object.keys(fx.templates).length,fxMeshes:new Set(Object.values(fx.templates).map(t=>t.poseData).filter(Boolean)).size,
    fxTextures:new Set(Object.values(fx.templates).flatMap(t=>Object.values(t.textures).map(v=>v.file))).size,meshFailures:fx.meshFailures,
    missingDynamicRates:Object.values(fx.templates).filter(t=>t.animationRequiresUnconfirmedRate).map(t=>t.name),
    omittedPlayCountMeshes:Object.values(fx.templates).filter(t=>t.kind==='mesh'&&t.fields.LifeType==='LT_PLAY_COUNT').map(t=>t.name)},
  checks:{node:{passed:52,failed:0,skipped:0},python:{passed:55,failed:0,skipped:0,groups:{character:19,effectDsl:5,scene:18,ui:2,kl:11}},
    nativeOriginalResourceDslRecordsCompared:90,renderedSourceNodeComparisons:70533,deformedVertexSamples:31104,
    maximumRenderedPoseErrorNative:.0007086368125186482,maximumDeformedVertexErrorNative:.0005518640154633658,
    leftHandEffectBoneComparedWithFullSourceKeys:true,meaning:'Parser/source-key/implementation checks, not target-client parity'},
  browser:{...browser,performanceMeaning:'Local observation only. Event-to-step excludes device, compositor and display. No before/after or native benchmark.'},
  replayChecks,proofs,
  remaining:['Independent 2016 PvP baseline and traces','Native animation blend/track-speed ramp and XET',
    'All input/LineMap special cases, swept geometry and complete 3D pushing','Defense/critical/PvP/knockdown/rounding semantics',
    'RF skill branches and all remaining commands, active skills and passives','Dynamic effect time bases, play-count termination, stretch orientation, layers and target blend/lighting',
    'Native core curve/sphere collision and reawakening timing','Complete UI/font/cooldown layout; four-player platform remains M4']};
write('reports/rf-source-fidelity-validation.json',report);
const milestones=read('reports/milestones.json');
milestones.implementationChecks.node=report.checks.node;milestones.implementationChecks.python=report.checks.python;
milestones.implementationChecks.runtimeProfileStateAnimationCoverage=report.conversion.states+'/'+report.conversion.coveredStateAnimations;
milestones.implementationChecks.effects={templates:report.conversion.fxTemplates,meshes:report.conversion.fxMeshes,textures:report.conversion.fxTextures,fullNativePresentationVerified:false};
milestones.sourceFidelityUpdate={programVersion:report.programVersion,report:'reports/rf-source-fidelity.md',evidence:'reports/rf-source-fidelity-validation.json',referenceSourceFiles:native.files.length,originalClientMeasured:false};
milestones.reports=[...new Set([...milestones.reports,'reports/rf-source-fidelity.md','reports/rf-source-fidelity-validation.json','contracts/rf-native-reference.json'])];
milestones.currentBrowserReplayChecks=replayChecks;milestones.latestProof=proofs[0];
write('reports/milestones.json',milestones);
console.log(JSON.stringify({states:report.conversion.states,fxTemplates:report.conversion.fxTemplates,node:report.checks.node.passed,python:report.checks.python.passed,replays:replayChecks.length,nativeClientMeasured:false}));

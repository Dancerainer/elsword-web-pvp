/** Current implementation observations are distinct from original-client gold. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const sha=p=>createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex');
const write=(p,v)=>writeFileSync(resolve(root,p),JSON.stringify(v,null,2)+'\n');
const profile=read('packages/combat-core/rf-profile.json'),assets=read('artifacts/rf/manifest.json');
const audio=read('reports/rf-audio.json'),fx=read('contracts/rf-fx-index.json');
const fxRecords=Object.values(fx.templates),meshFiles=new Set(fxRecords.flatMap(t=>t.glb?[t.glb]:[]));
const textureFiles=new Set(fxRecords.flatMap(t=>Object.values(t.textures??{}).map(t=>t.file)));
const effectCounts={templates:fxRecords.length,
  sourceMeshInputs:new Set(fxRecords.flatMap(t=>{const name=t.fields.MeshName??t.fields.Mesh;return name?[name.toLowerCase()]:[]})).size,
  meshes:meshFiles.size,textures:textureFiles.size,fullNativePresentationVerified:false};
for(const file of [...meshFiles,...textureFiles])sha('artifacts/rf/'+file);
const browser=read('artifacts/proof/rf-fidelity-v4-browser.json'),checks=read('artifacts/proof/rf-fidelity-v4-tests.json');
for(const proof of browser.proofs)proof.sha256=sha(proof.file);
for(const log of checks.logs)assert.equal(sha(log.file),log.sha256,'Verified run log '+log.file);
assert.equal(browser.targetClientMeasured,false);
assert.deepEqual(browser.consoleErrors,[]);assert.deepEqual(browser.consoleWarnings,[]);
assert.equal(assets.runtimeCharacter.profileCoverage.sha256,sha('packages/combat-core/rf-profile.json'));
for(const state of Object.values(profile.states))assert.ok(assets.runtimeCharacter.selection.included.includes(state.animationName));
const manifests=['contracts/rf-native-reference.json','reports/rf-movement-source-index.json','reports/rf-presentation-ui-native-reference.json','contracts/rf-reaction-source.json'];
const sources=new Map();
for(const path of manifests){const doc=read(path);for(const f of doc.files??doc.referenceFiles??doc.sources){
  assert.equal(sha('.cache/native-reference/'+f.path.split('/Trunk/')[1]),f.sha256,'Pinned source hash: '+f.path);
  const prev=sources.get(f.path);if(prev)assert.equal(prev.sha256,f.sha256);sources.set(f.path,f);
}}
const replayChecks=[];
for(const arg of process.argv.slice(2)){
  const file=resolve(root,arg),trace=JSON.parse(readFileSync(file,'utf8'));
  const result=spawnSync(process.execPath,['tools/replay-trace.mjs',file],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
  replayChecks.push({file:relative(root,file).replaceAll('\\','/'),sha256:sha(file),versions:trace.versions,...JSON.parse(result.stdout.trim()),
    states:[...new Set(trace.events.filter(e=>e.type==='stateChanged').map(e=>e.state))]});
}
assert.ok(replayChecks.length>=3,'Provide browser down/movement, skill and death traces');
const report={schemaVersion:1,programVersion:browser.programVersion,
  targetClientMeasured:false,targetClientTraceCount:0,fidelityGate:'pending-target-client-baseline',
  evidenceSeparation:{target:'2016 literal KL/mesh/animation/UI data',semantics:'hashed fixed-V5 source candidates; patched XX chain explicitly unresolved',
    browser:'current implementation observation, never native ground truth'},
  source:{manifests,referenceFiles:sources.size,profileSha256:sha('packages/combat-core/rf-profile.json'),presetVersion:read('config/rf-preset.json').presetVersion},
  conversion:{states:Object.keys(profile.states).length,runtimeClips:assets.runtimeCharacter.selection.included.length,fullClips:assets.clips.length,
    coveredStateAnimations:Object.keys(assets.runtimeCharacter.profileCoverage.stateAnimations).length,runtimePoseBones:read('artifacts/rf/runtime-pose.json').frames.length,
    effects:effectCounts,audio:audio.summary},
  checks,browser,replayChecks,
  remaining:['Independent target2016 PvP baseline and trace comparisons','Compiled2016 macro gates, D3DX overlapping speed events and XET overrides',
    'XX6XXX native2016 callback, all remaining commands/skills/passives/trait branches','Complete 3D lane push/pass, swept collisions and native motion-offset blending',
    'MP break, defense/critical/PvP normalization and native rounding','Complete native font/effect/material/camera comparison','Four-player platform remains M4']};
write('reports/rf-fidelity-v4-validation.json',report);
const milestones=read('reports/milestones.json');
milestones.implementationChecks.node=checks.node;milestones.implementationChecks.python=checks.python;
milestones.implementationChecks.runtimeProfileStateAnimationCoverage=report.conversion.states+'/'+report.conversion.coveredStateAnimations;
milestones.implementationChecks.runtimeCharacterClips=report.conversion.runtimeClips;
milestones.implementationChecks.effects=effectCounts;
milestones.implementationChecks.audio={originalFiles:audio.summary.copiedFiles,bytes:audio.summary.bytes,containerAndSourceHashesVerified:true,originalAudibleTimingVerified:false};
milestones.implementationChecks.animationTransition=checks.animationTransition;
milestones.fidelityV4Update={programVersion:report.programVersion,report:'reports/rf-fidelity-v4.md',evidence:'reports/rf-fidelity-v4-validation.json',referenceSourceFiles:sources.size,originalClientMeasured:false};
milestones.currentBrowserReplayChecks=replayChecks;
milestones.latestProof=browser.proofs[0];
milestones.reports=[...new Set([...milestones.reports,'reports/rf-fidelity-v4.md','reports/rf-fidelity-v4-validation.json',...manifests])];
write('reports/milestones.json',milestones);
console.log(JSON.stringify({states:report.conversion.states,runtimeClips:report.conversion.runtimeClips,referenceFiles:sources.size,replays:replayChecks.length,node:checks.node,python:checks.python,targetClientMeasured:false}));

/** Record actual source, test and browser observations, never native answers. */
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
const sources=read('reports/rf-v5-native-reference.json'),checks=read('artifacts/proof/rf-fidelity-v5-tests.json');
const browser=read('artifacts/proof/rf-fidelity-v5-browser.json');
assert.equal(browser.targetClientMeasured,false);
assert.deepEqual(browser.consoleErrors,[]);assert.deepEqual(browser.consoleWarnings,[]);
assert.equal(checks.node.failed,0);assert.equal(checks.python.failed,0);
for(const log of checks.logs)assert.equal(sha(log.file),log.sha256);
for(const f of sources.files)assert.equal(sha('.cache/native-reference/'+f.path.split('/Trunk/')[1]),f.sha256);
assert.equal(assets.runtimeCharacter.profileCoverage.sha256,sha('packages/combat-core/rf-profile.json'));
for(const state of Object.values(profile.states))assert.ok(assets.runtimeCharacter.selection.included.includes(state.animationName));
for(const proof of browser.proofs)proof.sha256=sha(proof.file);
const replayChecks=[];
for(const input of process.argv.slice(2)){
  const file=resolve(root,input),trace=JSON.parse(readFileSync(file,'utf8'));
  const result=spawnSync(process.execPath,['tools/replay-trace.mjs',file],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
  replayChecks.push({file:relative(root,file).replaceAll('\\','/'),sha256:sha(file),versions:trace.versions,
    ...JSON.parse(result.stdout.trim()),states:[...new Set(trace.events.filter(e=>e.type==='stateChanged').map(e=>e.state))]});
}
assert.ok(replayChecks.length>=4,'Supply movement, command, air-down and skill browser traces');
const fx=Object.values(read('contracts/rf-fx-index.json').templates);
const effectCounts={templates:fx.length,meshes:new Set(fx.map(t=>t.glb).filter(Boolean)).size,
  textures:new Set(fx.flatMap(t=>Object.values(t.textures??{}).map(v=>v.file))).size,fullNativePresentationVerified:false};
const report={schemaVersion:1,programVersion:browser.programVersion,
  targetClientMeasured:false,targetClientTraceCount:0,fidelityGate:'pending-target-client-baseline',
  evidenceSeparation:{target:'2016 original KL, KSM, .X, map and UI declarations',
    semantics:'pinned V5 source candidates; target callback/time-base gaps explicit',
    browser:'current simulation observation, never native ground truth'},
  source:{manifest:'reports/rf-v5-native-reference.json',referenceFiles:sources.files.length,
    profileSha256:sha('packages/combat-core/rf-profile.json'),presetVersion:read('config/rf-preset.json').presetVersion},
  conversion:{states:Object.keys(profile.states).length,runtimeClips:assets.runtimeCharacter.selection.included.length,
    fullClips:assets.clips.length,runtimePoseBones:read('artifacts/rf/runtime-pose.json').frames.length,effects:effectCounts},
  unresolvedMechanics:profile.referenceSemantics.mechanicBindings,checks,browser,replayChecks,
  remaining:['Independent native2016 PvP reference and input/output traces',
    '668ZXX effect trigger binding, dynamic .X tick rate and LT_PLAY_COUNT completion',
    'D3DX rapid-interrupt track weights, compiled macro gates and XET overrides',
    'Full native lane direction, continuous geometry collision, multiplayer body interactions',
    'All RF skills/passives/trait branches, MP break, defense/critical/PvP normalization',
    'Native shader/font/layers/lighting and exact 1x UI label mapping; M4 remains unimplemented']};
write('reports/rf-fidelity-v5-validation.json',report);
const milestones=read('reports/milestones.json');
milestones.implementationChecks.node=checks.node;milestones.implementationChecks.python=checks.python;
milestones.implementationChecks.runtimeProfileStateAnimationCoverage=report.conversion.states+'/'+report.conversion.states;
milestones.implementationChecks.runtimeCharacterClips=report.conversion.runtimeClips;
milestones.implementationChecks.effects=effectCounts;
milestones.fidelityV5Update={programVersion:report.programVersion,report:'reports/rf-fidelity-v5.md',
  evidence:'reports/rf-fidelity-v5-validation.json',referenceSourceFiles:sources.files.length,originalClientMeasured:false};
milestones.currentBrowserReplayChecks=replayChecks;milestones.latestProof=browser.proofs[0];
milestones.reports=[...new Set([...milestones.reports,'reports/rf-fidelity-v5.md','reports/rf-fidelity-v5-validation.json','reports/rf-v5-native-reference.json'])];
write('reports/milestones.json',milestones);
console.log(JSON.stringify({states:report.conversion.states,runtimeClips:report.conversion.runtimeClips,
  referenceFiles:sources.files.length,replays:replayChecks.length,node:checks.node,python:checks.python,targetClientMeasured:false}));

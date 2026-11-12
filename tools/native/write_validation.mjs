/** Actual build/test/browser evidence, kept separate from original PvP traces. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bytes=p=>readFileSync(resolve(root,p));
const read=p=>JSON.parse(bytes(p));
const sha=p=>createHash('sha256').update(bytes(p)).digest('hex');
const write=(p,data)=>writeFileSync(resolve(root,p),JSON.stringify(data,null,2)+'\n');
const modules=read('artifacts/native/manifest.json');
for(const m of Object.values(modules.modules))assert.equal(sha('artifacts/native/'+m.file),m.sha256);
const source=read('contracts/rf-native-runtime-sources.json');
for(const record of source.files)assert.equal(sha('.cache/native-source-runtime/'+record.relativePath),record.sha256);
const camera=read('.cache/native-camera-generated/execution.json');assert.equal(camera.success,true);
for(const build of camera.builds){assert.equal(build.compile.success,true);assert.equal(build.execute.success,true);}
const logs=[];
function nodeCheck(file){const log=bytes(file).toString('utf8');
  const n=key=>Number(log.match(new RegExp('(?:ℹ|#) '+key+' (\\d+)'))?.[1]);
  assert.equal(n('fail'),0,file);assert.equal(n('skipped'),0,file);assert.ok(n('pass')>0,file);
  logs.push({file,sha256:sha(file),passed:n('pass'),failed:0,skipped:0});return n('pass');}
function pythonCheck(file){const log=bytes(file).toString('utf8');
  assert.ok(/\nOK\s*$/.test(log),file);assert.ok(!/skipped=/.test(log),file);
  const passed=Number(log.match(/Ran (\d+) tests? in/)?.[1]);assert.ok(passed>0,file);
  logs.push({file,sha256:sha(file),passed,failed:0,skipped:0});return passed;}
const node=nodeCheck('artifacts/proof/rf-native-node-tests.log');
const measuredAssetsAfterProvenanceFix=nodeCheck('artifacts/proof/rf-native-measured-assets-final.log');
const pythonGroups={};
for(const group of ['character','scene','ui','combat','camera','geometry'])
  pythonGroups[group]=pythonCheck(`artifacts/proof/rf-native-python-${group}-tests.log`);
const browser=read('artifacts/proof/rf-native-browser.json');
assert.deepEqual(browser.consoleErrors,[]);assert.deepEqual(browser.consoleWarnings,[]);
for(const proof of browser.proofs)proof.sha256=sha(proof.file);
const replays=[];
for(const file of process.argv.slice(2)){
  const r=spawnSync(process.execPath,['tools/replay-trace.mjs',resolve(root,file)],{cwd:root,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr||r.stdout);
  const trace=read(file);replays.push({file,sha256:sha(file),versions:trace.versions,...JSON.parse(r.stdout.trim()),
    states:[...new Set(trace.events.filter(e=>e.type==='stateChanged').map(e=>e.state))]});
}
assert.ok(replays.length>=4,'Browser movement, air-down, attack and skill traces required');
const report={schemaVersion:1,programVersion:'rf-m3-native-v0.1',coreVersion:'rf-executor-m3-native-v1',
  evidenceSeparation:{fullTargetClientExecuted:false,targetPvPTraceCount:0,
    originalCpp:'pinned V5 exact function bodies compiled and called; V5 vs 2016 parity pending',
    originalDll:'actual target2016 shipped D3DX DLL; synthetic and original-asset input/output',
    browser:'current implementation observation and same-WASM replay'},
  source:{files:source.files.length,manifest:'contracts/rf-native-runtime-sources.json',sha256:sha('contracts/rf-native-runtime-sources.json')},
  native:{manifest:modules,manifestSha256:sha('artifacts/native/manifest.json'),cameraBuilds:camera.builds,
    geometryContract:read('artifacts/native/geometry/source-contract.json'),
    dllReport:'reports/rf-native-d3dx-execution.json',dllReportSha256:sha('reports/rf-native-d3dx-execution.json'),
    effectClockReport:'reports/rf-native-d3dx-effects.json',effectClockReportSha256:sha('reports/rf-native-d3dx-effects.json'),
    keyframesManifest:'reports/rf-native-d3dx-keyframes.json',keyframesManifestSha256:sha('reports/rf-native-d3dx-keyframes.json'),
    keyframesArtifactSha256:sha('artifacts/native-d3dx/keyframes.json')},
  checks:{node:{passed:node,failed:0,skipped:0},python:{passed:Object.values(pythonGroups).reduce((a,b)=>a+b,0),failed:0,skipped:0,groups:pythonGroups},
    measuredAssetsAfterProvenanceFix:{passed:measuredAssetsAfterProvenanceFix,failed:0,skipped:0,subsetOfNode:true},logs},
  browser,replays,fidelityGate:'pending-target2016-PvP-baseline',
  remaining:read('artifacts/proof/rf-native-remaining.json')};
write('reports/rf-native-runtime-validation.json',report);
const milestones=read('reports/milestones.json');
milestones.implementationChecks.node=report.checks.node;milestones.implementationChecks.python=report.checks.python;
milestones.nativeSourceExecution={programVersion:report.programVersion,sourceFiles:source.files.length,
  manifestHashes:Object.fromEntries(Object.entries(modules.modules).map(([k,v])=>[k,v.sha256])),
  report:'reports/rf-native-runtime-validation.json',fullTargetClientExecuted:false,targetPvPTraceCount:0};
milestones.milestones.M2='Pinned V5 geometry/camera compiled and executed; target2016 DLL animation probes; full target combat reference pending';
milestones.milestones.M3='Native modules integrated and implementation replays verified; full RF source execution and original parity pending';
milestones.currentBrowserReplayChecks=replays;milestones.latestProof=browser.proofs[0];
milestones.reports=[...new Set([...milestones.reports,'docs/NATIVE_SOURCE_ROUTE.md',
  'reports/rf-native-runtime-validation.json','reports/rf-native-d3dx-execution.md','reports/rf-native-geometry-execution.md','reports/rf-native-execution-camera.md'])];
milestones.reports=[...new Set([...milestones.reports,'reports/rf-native-runtime.md','reports/rf-native-d3dx-effects.md'])];
write('reports/milestones.json',milestones);
console.log(JSON.stringify({node:report.checks.node,python:report.checks.python,replays:replays.length,fullTargetClientExecuted:false}));

/** Current implementation observations, separate from frozen original sources. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {observeGuardian} from '../../tests/helpers/guardian-reaction-v17.mjs';
const out=resolve(process.argv[2]??'artifacts/proof-guardian-v17/simulation');
mkdirSync(out,{recursive:true});
const rows=[],options=[];
for(const facing of [-1,1])for(const fromFront of [false,true])for(const awakened of [false,true])options.push({facing,fromFront,awakened});
for(const facing of [-1,1])options.push({facing,speed:1});
for(const [index,option] of options.entries()){
  const run=await observeGuardian(option);
  assert.equal(run.ruleVersions.program,'rf-executor-m3-native-v17');
  const file=resolve(out,index+'.json');writeFileSync(file,JSON.stringify(run)+'\n');
  const bytes=readFileSync(file);
  rows.push({options:option,ruleVersions:run.ruleVersions,
    trace:relative(process.cwd(),file).replaceAll('\\','/'),bytes:bytes.length,
    sha256:createHash('sha256').update(bytes).digest('hex'),
    observedHitReactions:run.hits.map(hit=>hit.damage.REACT_TYPE),
    firstStopBefore:run.hits[0]?.before.worldStop,firstStopAfter:run.hits[0]?.after.worldStop,
    animationsRestartWithoutBlend:run.hits.every(hit=>!hit.after.blendEnabled),
    observedEndState:run.samples.at(-1)?.state});
}
const report={schemaVersion:1,evidenceClass:'current-host-observations-not-original-oracle',
  targetClientMeasured:false,browserGpuMeasured:false,source:'contracts/rf-guardian-reaction-source-v17.json',
  beforeFix:'reports/rf-guardian-reaction-observations-v17.json#beforeFix',
  input:'first of280 fixed1/60 packets presses/holds A; all remaining packets empty',
  awakening:'remaining20/fullfalse initial fixture for awakened cases, not an actual device Ctrl trace',rows};
writeFileSync('reports/rf-guardian-final-simulation-v17.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({observations:rows.length,currentCodeVersion:rows[0].ruleVersions.program,originalClientMeasured:false}));

import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'../..'),research=resolve(process.argv[2]??'asset_sources/analysis-project');
const paths=['docs/COMMON_CANCEL_TERMINAL_2016.md','docs/COMMON_CANCEL_PRODUCER_2016.md','docs/RECOVERY_LOCAL_ORDER_2016.md',
 'docs/HISTORICAL_CANCEL_TERMINAL_2016.md','reports/analysis/common-cancel-terminal-2016/behavior-contract.json',
 'reports/analysis/common-cancel-producer-2016/contracts.json','reports/analysis/common-cancel-producer-2016/source-bodies.json.gz',
 'reports/analysis/common-cancel-terminal-2016/source-bodies.json.gz','reports/analysis/historical-cancel-terminal-2016/state-consumers.json',
 'reports/analysis/historical-cancel-terminal-2016/function-contracts.json.gz'];
const files=paths.map(path=>{const bytes=readFileSync(resolve(research,path));return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
const seal={schema:'cancel-consumers-v53',researchCommit:execFileSync('git',['-C',research,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 originalX2Sha256:'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
 derivedInputSha256:'b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba',originalClientExecuted:false,
 semantics:['own post, optional Raven common post, then independent base mode3 entrance',
 'permitted force0 requests overwrite one pending state; next eligible local apply claims request byte before exit and reads final request after exit',
 'skill payment happens only on successful dispatch, while old state and skill context remain visible to the remaining old callbacks',
 'eight ordinary enter floats clamp to binary32 .1; missing ATTACK falls back to WALK; finite gates are strict',
 'normalization is a consumption view; original raw profile declarations remain unchanged'],
 boundaries:['Device input and grounded flag are current Web projections, not captured original actor values',
 'Original dash helper flags 36e4/36e5/6d7e are not exposed; supported Web dash policy remains explicit',
 'Hidden original component guards and secret chain pending consumers are not reconstructed from absent live instances',
 'No original runtime input/state trace has been acquired; tests compare static conditional contracts'],files};
writeFileSync(resolve(root,'contracts/cancel-consumers-v53.json'),JSON.stringify(seal,null,2)+'\n');
const historical=JSON.parse(readFileSync(resolve(research,'reports/analysis/historical-cancel-terminal-2016/state-consumers.json'),'utf8'));
writeFileSync(resolve(root,'contracts/historical-cancel-consumers-v53.json'),JSON.stringify({schema:'historical-cancel-consumers-v53',
 sourceSha256:files.find(x=>x.path.endsWith('/state-consumers.json')).sha256,qualification:historical.qualification,
 counts:historical.counts,rows:historical.rows.map(r=>({sourceState:r.sourceState,status:r.status,states:r.states,
 postContracts:r.postContracts,cancelFields:Object.fromEntries(Object.values(r.cancelFieldsIfInitializedByOriginalEnter).map(v=>[v.key,v.afterOriginalEnter]))}))},null,2)+'\n');
console.log(JSON.stringify({files:files.length,researchCommit:seal.researchCommit}));

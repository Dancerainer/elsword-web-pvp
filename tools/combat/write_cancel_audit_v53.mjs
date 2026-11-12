import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import historical from '../../contracts/historical-cancel-consumers-v53.json' with {type:'json'};
import {HISTORICAL_EXPLICIT_POSTS} from '../../packages/combat-core/historical-cancel-post-v53.mjs';
const root=resolve(import.meta.dirname,'../..');
const products=new Set(['RBM_DASH_JUMP_COMBO_X','RSI_RBM_COMBO_ZZZupZ','RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ',
 'RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZZ','RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ_Landing']);
const rows=historical.rows.map(row=>({...row,implementation:row.status==='positive-non-animation-skill-route'?'existing non-animation21201/21218 dispatch':
 row.status==='legacy-declaration-normal-route-bounded-exclusion'?'excluded from normal route; no new table binding':
 row.status==='selected-local-enter-router-and-child-control-contract'?'existing ground/air cast router plus explicit196/197 posts and user-confirmed finished-air follow-ups':
 row.sourceState==='RSI_A_RWT_MENTAL_BREAK'?'nine-group own/common/base source adapter':
 products.has(row.sourceState)?'existing BM adapter with explicit user extensions; now original enter gates and deferred phase':
 HISTORICAL_EXPLICIT_POSTS.has(row.sourceState)?'explicit target2016 post branches and deferred apply':'unported',
 ...(row.sourceState==='ESSI_ELK_XXXXX'?{knownUnported:'Original post requests native207 on EPT0. Its record/name/template binding is absent from the selected closure. This branch is detected and noted but does not execute a guessed state.'}:{}),
 ...(row.sourceState==='ESSI_DESTRUCTION_RAGE'?{inputBoundary:'Only unmounted Web actors exist. Original typed1cc riding branch to71/74 is not represented.'}:{}),
 ...(row.sourceState==='ESSI_DASH_JUMP_COMBO_Z3'?{inputBoundary:'Original5fd0 is projected through current Web accepted contact history; original producer/heap instance is not asserted.'}:{}),
 ...(row.sourceState==='ESSI_DASH_JUMP_COMBO_Z3_LANDING'?{inputBoundary:'Original recovery uses (main period-transition)/6. Current Web pose period and existing animation-transition timing supply those instance inputs.'}:{})}));
writeFileSync(resolve(root,'reports/cancel-state-difference-v53.json'),JSON.stringify({schema:'implementation-inventory-not-original-expectations-v53',
 originalSourceSha256:historical.sourceSha256,counts:historical.counts,explicitPostGroups:60,bmProductAdapterGroups:5,
 commonOverlapGroups:1,rows},null,2)+'\n');
console.log(JSON.stringify({groups:rows.length,unportedGroups:rows.filter(r=>r.implementation==='unported').length,knownPartialBranches:rows.filter(r=>r.knownUnported).map(r=>r.sourceState)}));

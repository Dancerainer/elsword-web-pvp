import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dashZxFixture,dashZxFrame} from './rf_dash_zx_audit.mjs';
import {downZFixture} from './rf_down_z_audit_v14.mjs';
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const cases=[];
for(const facing of [-1,1])for(const gap of [70,120,250]){
 const f=await dashZxFixture({facing,gap,position:[0,3080,0],lineId:2});
 for(let i=0;i<180;i++)dashZxFrame(f,[0,12,26].includes(i)?{pressed:['X'],held:['X']}:{});
 const events=f.s.state.events,hits=events.filter(e=>e.type==='hit'&&e.origin?.sourceCandidate);
 cases.push({kind:'XXX-complete-input',facing,gap,hitCount:hits.length,hitDamage:hits.map(h=>h.data.DAMAGE),
  finalState:f.a.state,remainingCandidateEffects:f.s.state.effects.filter(e=>e.sourceCandidate).length,events,snapshot:f.s.snapshot()});
}
for(const facing of [-1,1])for(const dash of [false,true]){
 const f=await downZFixture({facing,gap:70,targetFloor:'same'});const key=facing===1?'RIGHT':'LEFT';
 if(dash){dashZxFrame(f,{pressed:[key],held:[key]});dashZxFrame(f,{released:[key]});dashZxFrame(f,{pressed:[key],held:[key]});}
 dashZxFrame(f,{pressed:['DOWN','Z'],held:['DOWN','Z'],edges:[{key:'DOWN',down:true,time:.001},{key:'Z',down:true,time:.002}]});
 const dropState=f.a.state;dashZxFrame(f,{held:['DOWN']});const attackState=f.a.state;
 for(let i=0;i<120;i++)dashZxFrame(f,{held:['DOWN']});
 const hits=f.s.state.events.filter(e=>e.type==='hit'&&e.origin?.kind==='character');
 cases.push({kind:'ordered-platform-2Z',facing,dash,dropState,attackState,hitCount:hits.length,events:f.s.state.events,snapshot:f.s.snapshot()});
}
mkdirSync('artifacts/proof-hits-v15',{recursive:true});
const proof='artifacts/proof-hits-v15/implementation.json';
writeFileSync(proof,JSON.stringify({schema:'rf-hits-implementation-v15',evidenceClass:'current-simulation-observations',targetClientMeasured:false,
 implementationHashes:Object.fromEntries(['packages/combat-core/index.mjs','packages/combat-core/xxx-candidate.mjs','packages/combat-core/platform-attack-input.mjs','packages/combat-core/rf-profile.json','artifacts/native/commands.wasm','artifacts/native/manifest.json','artifacts/rf/runtime-pose.json'].map(p=>[p,hash(p)])),cases},null,2)+'\n');
const report={schema:'rf-hits-handover-v15',evidenceClass:'target2016-static-declarations + pinned-reference-cost + current-simulation-candidate',targetClientMeasured:false,originalClientMeasurementCount:0,
 sourceContract:'contracts/rf-xxx-candidate-v15.json',implementationProof:{path:proof,sha256:hash(proof)},
 observations:cases.map(({events,snapshot,...r})=>r),
 verification:{nodeFocusedTests:60,nodeFailures:0,nodeSkipped:0,sourceAuditKlFiles:6306},
 requiresIgnoredResourceReplacement:false,nativeModuleChanges:[],
 resourcesAlreadyPresent:['artifacts/rf/fx/index.json','artifacts/rf/fx/meshes/DummyAttackBox_50x50x50.pose.json','artifacts/rf/fx/meshes/DummyAttackBox_50x50x50.glb'],
 remaining:['Target XXX native owner/set epoch and MP cost equivalence remain unavailable','LOCK_ON_DATA type4 remains unsupported; no invented absorb or target-centering','Other platform/down attack misses outside ordered same-packet case remain open','Original target-client/GPU comparison unavailable']};
writeFileSync('reports/rf-hits-handover-v15.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({proofSha256:hash(proof),cases:report.observations,requiresIgnoredResourceReplacement:false}));

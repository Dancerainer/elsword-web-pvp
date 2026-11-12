/** Existing gameplay gates, with an explicit registered collection mode.
 * Comparison identity errors remain fatal in both modes. No threshold changes. */
export const collectionMode='collect-invariant-failures-v1';
export const invariantFailureExitCode=2;
export function validateCollectionMode(enabled,registration){
 const declared=registration?.invariantCollection?.mode;
 if(enabled?declared!==collectionMode:declared!==undefined)throw Error('invariant-collection-registration-mismatch');
}
export function gameplayViolations(row){
 const failures=[];
 if(row.integrity?.duplicateHitIds||row.integrity?.coordinatorDuplicateHits||row.integrity?.allSettledHitsReported===false)failures.push('local-hit-integrity-failed');
 if(row.integrity?.singleAttack&&(row.integrity.singleAttack.atMostOneHit===false||row.integrity.singleAttack.hpMatchesEvents===false))failures.push('single-attack-integrity-failed');
 if(row.kind==='late-missed-hit'&&row.integrity.localHits.length)failures.push('late-missed-attack-did-damage');
 return failures;
}
export function enforceRow(row,file,collect=false){
 if(!row.sameInputsAsBaseline)throw Error('input-source-mismatch:'+file);
 if(['movement','lk-replay'].includes(row.kind)&&!row.sameOwnerTrajectoryAsBaseline)throw Error('fixed-owner-source-mismatch:'+file);
 const failures=gameplayViolations(row);
 if(!collect&&failures.length)throw Error(failures[0]+':'+file);
 return failures;
}
export function invariantResult(rows){
 const violationsByVersion={v50:[],v51:[]};
 for(const row of rows){
  const violations=gameplayViolations(row);
  if(violations.length)violationsByVersion[row.version].push({scenario:row.scenario,seed:row.seed,kind:row.kind,runFile:row.runFile,violations});
 }
 return {invariantsPassed:Object.values(violationsByVersion).every(rows=>rows.length===0),violationsByVersion};
}

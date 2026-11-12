/** Known failed-candidate cases, not a new independent holdout or a claim about
 * original 2016 hit correctness. Reuse sealed Native inputs read-only; compare
 * current default against immutable V50, without tuning timings or geometry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const metadataFile=process.env.RF_V51_REPRO_METADATA,candidateRoot=process.env.RF_V51_REPRO_ROOT,
  output=process.env.RF_V51_REPRO_OUTPUT,baselineCommit=process.env.WEB_PVP_V50_REF,
  enabled=Boolean(metadataFile&&candidateRoot&&output&&baselineCommit);
let preparation;
async function prepare(){
  const metadata=JSON.parse(readFileSync(metadataFile)),baselineRoot=metadata.versions.find(v=>v.id==='v50').root;
  execFileSync('git',['-C',baselineRoot,'diff','--quiet',baselineCommit,'--','apps/web','apps/server','packages','config']);
  const imported=file=>import(pathToFileURL(resolve(candidateRoot,'tools/validation',file)).href);
  const [{loadProductionTransport},{loadLkNetworkAssets,calibrateLkInputs},{runPairedProbe},{scenarios}]=await Promise.all([
    imported('network-production-client-v51.mjs'),imported('network-native-fixture-v51.mjs'),
    imported('network-gameplay-probes-v51.mjs'),imported('network-application-wire-v40.mjs')]);
  const versions=[];
  for(const [id,root] of [['v50',baselineRoot],['default',candidateRoot]]){
    const version={id,root,transport:await loadProductionTransport(root)};
    for(const [key,file] of Object.entries({simulation:'packages/combat-core/index.mjs',ownership:'apps/web/input-prediction.mjs',
      playback:'packages/online/combat-playback.mjs',ownedState:'packages/online/owned-state.mjs',statusClock:'packages/online/owner-status-clock.mjs'}))
      version[key]=await import(pathToFileURL(resolve(root,file)).href);
    versions.push(version);
  }
  const nativeAssets=await loadLkNetworkAssets(baselineRoot,metadata.assetsPath),calibrated={};
  for(const facing of [1,-1])calibrated[facing]=calibrateLkInputs(versions[0],await nativeAssets.isolated(versions[0]),{facing});
  assert.equal(existsSync(output),false,'preserve previous regression attempts');mkdirSync(output,{recursive:true});
  writeFileSync(resolve(output,'metadata.json'),JSON.stringify({baselineCommit,baselineRoot,candidateRoot,
    candidateCommit:execFileSync('git',['-C',candidateRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    assetsPath:metadata.assetsPath,assetSeals:nativeAssets.seals,
    scope:'Known adversarial regression cases, not an independent performance matrix. No experimental option is passed.'},null,2)+'\n');
  return {versions,nativeAssets,calibrated,runPairedProbe,scenarios};
}

for(const [scenarioId,seed,hitFrame] of [
  ['asymmetric-burst-v37',2016511009,139],
  ['severe-jitter-loss-10pct',2016512001,111],
])test(`default LK motion keeps V50 down-hit in known ${scenarioId}/${seed} phase-position counterexample`,{skip:!enabled},async t=>{
  const {versions,nativeAssets,calibrated,runPairedProbe,scenarios}=await(preparation??=prepare()),results=[];
  for(const version of versions){
    const value=await runPairedProbe(version,{scenario:scenarios.find(s=>s.id===scenarioId),seed,kind:'lk-combo',nativeAssets,calibrated});
    const {wirePackets,...saved}=value,text=JSON.stringify({...saved,wirePacketCount:wirePackets.length,
      wirePacketSha256:createHash('sha256').update(JSON.stringify(wirePackets)).digest('hex')});
    writeFileSync(resolve(output,`${scenarioId}-${seed}-${version.id}.json`),text+'\n');results.push(value);
  }
  const [before,after]=results,hitIdentity=hit=>[hit.frame,hit.damage,hit.sourceState,hit.targetState],
    expectedStates=['RSI_DASH_COMBO_X','RSI_JUMP_COMBO_X','RSI_COMBO_Z'];
  assert.deepEqual(before.integrity.localHits.map(hit=>hit.sourceState),expectedStates,'immutable V50 must reproduce the known three-hit case');
  assert.deepEqual(after.integrity.localHits.map(hitIdentity),before.integrity.localHits.map(hitIdentity));
  assert.equal(after.inputSha256,before.inputSha256);assert.equal(after.ownerTraceSha256,before.ownerTraceSha256);
  const at=value=>value.trace.find(row=>row.frame===hitFrame&&row.direction===0),a=at(before),b=at(after);
  for(const key of ['observedY','observedVy','observedState','observedPhase','sourcePhase'])assert.equal(b[key],a[key],key);
  for(const value of results){assert.equal(value.integrity.observerMatchesOwnerHp,true);assert.equal(value.integrity.allSettledHitsReported,true);
    assert.equal(value.integrity.duplicateHitIds,0);assert.equal(value.transport.errors.length,0);}
  t.diagnostic(JSON.stringify({scenario:scenarioId,seed,hitFrame,beforeHits:before.integrity.localHits.length,
    afterHits:after.integrity.localHits.length,ownerTrajectoryEqual:before.ownerTraceSha256===after.ownerTraceSha256,
    sourceY:a.y,defaultObservedY:b.observedY,sourcePhase:b.sourcePhase,defaultObservedPhase:b.observedPhase}));
});

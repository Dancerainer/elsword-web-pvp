/** Known failed holdout regression, not an independent validation seed.
 * Original failing V50 and rejected c3 artifacts remain separate evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const metadataFile=process.env.RF_START_WIRE_METADATA,candidateRoot=process.env.RF_START_WIRE_ROOT,
  output=process.env.RF_START_WIRE_OUTPUT,enabled=Boolean(metadataFile&&candidateRoot&&output),sha=b=>createHash('sha256').update(b).digest('hex');
test('known 2016522003 late attack damages on V50 but expires on candidate through the actual application pipeline',
  {skip:!enabled},async t=>{
    const metadata=JSON.parse(readFileSync(metadataFile)),baseline=metadata.versions.find(v=>v.id==='v50');
    for(const [file,expected]of Object.entries(baseline.sourceHashes))assert.equal(sha(readFileSync(resolve(baseline.root,file))),expected,file);
    const imported=file=>import(pathToFileURL(resolve(candidateRoot,'tools/validation',file)).href),
      [{loadProductionTransport},{runPairedProbe},{scenarios}]=await Promise.all([
        imported('network-production-client-v51.mjs'),imported('network-gameplay-probes-v51.mjs'),imported('network-application-wire-v40.mjs')]);
    assert.equal(existsSync(output),false,'do not overwrite a failed run');mkdirSync(output,{recursive:true});
    const seals=Object.fromEntries(Object.keys(baseline.sourceHashes).map(file=>[file,sha(readFileSync(resolve(candidateRoot,file)))])),results=[];
    writeFileSync(resolve(output,'metadata.json'),JSON.stringify({originalMetadata:metadataFile,
      originalMetadataSha256:sha(readFileSync(metadataFile)),baseline,candidateRoot,candidateSourceHashes:seals,
      scope:'Known failed holdout regression only; no original-client or new independent sample claim.'},null,2)+'\n');
    for(const [id,root]of [['v50',baseline.root],['candidate',candidateRoot]]){
      const version={id,root,transport:await loadProductionTransport(root)};
      for(const [key,file]of Object.entries({simulation:'packages/combat-core/index.mjs',ownership:'apps/web/input-prediction.mjs',
        playback:'packages/online/combat-playback.mjs',ownedState:'packages/online/owned-state.mjs',statusClock:'packages/online/owner-status-clock.mjs'}))
        version[key]=await import(pathToFileURL(resolve(root,file)).href);
      const value=await runPairedProbe(version,{scenario:scenarios.find(s=>s.id==='asymmetric-burst-1000ms'),seed:2016522003,kind:'late-missed-hit'});
      writeFileSync(resolve(output,id+'.json'),JSON.stringify(value)+'\n');results.push(value);
    }
    for(const [file,expected]of Object.entries(seals))assert.equal(sha(readFileSync(resolve(candidateRoot,file))),expected,file+' remained frozen');
    const [before,after]=results;
    assert.equal(before.integrity.localHits.length,1);assert.equal(before.integrity.localHits[0].frame,49);
    assert.equal(before.integrity.localHits[0].damage,500);assert.equal(before.integrity.endHp,0);
    assert.equal(after.integrity.localHits.length,0);assert.equal(after.integrity.endHp,1);
    assert.equal(after.diagnostics[1].expiredWitnessedStarts,1);assert.equal(after.diagnostics[1].starts,0);
    assert.equal(after.inputSha256,before.inputSha256);
    for(const v of results){assert.equal(v.integrity.duplicateHitIds,0);assert.equal(v.integrity.allSettledHitsReported,true);
      assert.equal(v.integrity.observerMatchesOwnerHp,true);assert.equal(v.transport.errors.length,0);}
    t.diagnostic(JSON.stringify({beforeHits:before.integrity.localHits,afterHits:after.integrity.localHits,
      beforeHp:before.integrity.endHp,afterHp:after.integrity.endHp,afterReceiver:after.diagnostics[1]}));
  });

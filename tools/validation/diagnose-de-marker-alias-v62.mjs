/** Explicit JSON-only diagnostic; no browser, test, build or sealer execution.
 * node tools/validation/diagnose-de-marker-alias-v62.mjs RESULT_JSON
 * Does not modify producer evidence. Only the proven live sorting distance is
 * separated from strict identity; every other nested field remains exact.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function deMarkerIdentity(marker){
 const copy=structuredClone(marker);assert.ok(Array.isArray(copy.batches));
 for(const batch of copy.batches){
  assert.ok(batch.sequence&&Object.hasOwn(batch.sequence,'distance'));
  assert.ok(Number.isFinite(batch.sequence.distance)&&batch.sequence.distance>=0,'Finite nonnegative native sorting distance required');
  // nativeSequenceRenderOrder returns the renderer's mutable WeakMap entry.
  // Its derived distance is diagnostic, not an immutable screenshot identity.
  delete batch.sequence.distance;
 }
 return copy;
}

export async function diagnoseDeMarkerAlias(file){
 const input=path.resolve(file),data=await readFile(input);assert.ok(data.length<=2*1024**2,'Small explicit result only');
 const report=JSON.parse(data),markers=new Map();assert.equal(report.schema,'de-void-tail-production-ui-v62');
 for(const row of report.cases)for(const marker of row.frameCaptureMarkers){assert.ok(!markers.has(marker.name));markers.set(marker.name,marker);}
 const comparisons=[];let changedImages=0,differentLeaves=0,maximumAbsoluteDelta=0;
 for(const image of report.images){
  const trigger=image.trigger,marker=markers.get(trigger.name);assert.ok(marker);assert.equal(image.file,trigger.name+'.png');
  assert.deepEqual(deMarkerIdentity(trigger),deMarkerIdentity(marker),'An immutable field differs in '+image.file);
  const distances=trigger.batches.map((batch,i)=>{
   const captured=batch.sequence.distance,retained=marker.batches[i].sequence.distance,delta=captured-retained;
   if(delta!==0){differentLeaves++;maximumAbsoluteDelta=Math.max(maximumAbsoluteDelta,Math.abs(delta));}
   return {path:'batches['+i+'].sequence.distance',batch:batch.name,emitterId:batch.sequence.emitterId,drawOrder:batch.sequence.drawOrder,captured,retained,delta};
  });
  const changed=distances.some(row=>row.delta!==0);if(changed)changedImages++;
  comparisons.push({file:image.file,strictIdentityEqual:true,changedDistances:distances.filter(row=>row.delta!==0)});
 }
 assert.equal(markers.size,report.images.length,'Every marker has one image');
 return {schemaVersion:1,source:{path:input,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')},
  images:comparisons.length,changedImages,differentLeaves,maximumAbsoluteDelta,strictIdentityEqual:true,
  exception:'Only batches[].sequence.distance is a proven mutable derived sorting diagnostic; values remain finite/nonnegative and are retained below without epsilon or rounding.',
  scope:'Static comparison of existing JSON. No screenshot, GPU, original client or sealer executed. Original producer bytes remain unchanged.',comparisons};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 assert.equal(process.argv.length,3,'Provide one explicit result JSON');
 console.log(JSON.stringify(await diagnoseDeMarkerAlias(process.argv[2]),null,2));
}

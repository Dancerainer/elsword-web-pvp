/** Pure contract checks and a failed preflight only. No server connection,
 * child process, full package, Native runtime or GPU is used. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyUpdatePlan,verifyInventory,below,redact,runOldClientUpdateProbe,validateExpectedAssetCount,parseExpectedAssetCount} from '../../tools/validation/probe-old-client-update-v38.mjs';
import {sha,updatePlan} from '../../apps/local-client/update-contract.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),runtime=path.join(root,'runtime');
const digest=character=>character.repeat(64);
function fixture(){
  const manifest=build=>({schemaVersion:1,buildSha256:build,remoteOrigin:'https://example.invalid',assets:{'native/manifest.json':digest('a')},
    files:{'dist/game.js':build,'assets/native/manifest.json':digest('a'),'runtime/node.exe':digest('b'),'apps/local-client/client.mjs':digest('c')}});
  const before=manifest(digest('d')),after=manifest(digest('e')),target={releaseId:sha(Buffer.from(JSON.stringify(after))),buildSha256:after.buildSha256};
  const plan=updatePlan(before,{manifest:after,releaseId:target.releaseId,transport:{'dist/game.js':{bytes:100,gzipBytes:50,gzipSha256:digest('f')}}});
  return {before,target,plan};
}
function encode(plan){for(let n=0;n<8;n++)plan.bytes=Buffer.byteLength(JSON.stringify(plan))+plan.changed.reduce((sum,r)=>sum+r.gzipBytes,0);return Buffer.from(JSON.stringify(plan));}

test('independent asset-count contract accepts only numeric safe integers from 1 through 20000',()=>{
  for(const count of [1,2,5558,20000])assert.equal(validateExpectedAssetCount(count),count);
  for(const count of [undefined,null,'5558',true,0,-1,1.1,20001,Number.MAX_SAFE_INTEGER+1,NaN,Infinity])
    assert.throws(()=>validateExpectedAssetCount(count),/invalid-expected-asset-count/);
});
test('the sixth CLI argument is mandatory canonical decimal with the same independent bounds',()=>{
  for(const count of ['1','5558','20000'])assert.equal(parseExpectedAssetCount(count),Number(count));
  for(const count of [undefined,null,5558,'','0','05558',' 5558','5558 ','+5558','-1','5.558e3','0x15b6','1.5','20001','9007199254740993'])
    assert.throws(()=>parseExpectedAssetCount(count),/expected-asset-count/);
});
test('inventory cannot default its expected count or accept missing/extra inventory metadata',()=>{
  const assets={'one.png':digest('a'),'two.png':digest('b')};
  assert.throws(()=>verifyInventory(assets,assets),/invalid-expected-asset-count/);
  assert.throws(()=>verifyInventory(assets,assets,'2'),/invalid-expected-asset-count/);
  assert.throws(()=>verifyInventory(assets,{'one.png':digest('a')},2),/asset-count/);
  assert.throws(()=>verifyInventory({...assets,'extra.png':digest('c')},assets,2),/asset-count/);
  assert.throws(()=>verifyInventory(assets,{...assets,'extra.png':digest('c')},2),/asset-count/);
  assert.throws(()=>verifyInventory(assets,null,2),/invalid-asset-inventory/);
  assert.throws(()=>verifyInventory(assets,[],2),/invalid-asset-inventory/);
  assert.throws(()=>verifyInventory({'one.png':'bad'}, {'one.png':'bad'},1),/asset-hash/);
});
test('a caller supplied 5558 inventory succeeds and cannot silently borrow the old release count',()=>{
  const assets=Object.fromEntries(Array.from({length:5558},(_,i)=>['fixture/'+i+'.png',digest('a')]));
  assert.equal(verifyInventory({...assets},assets,5558).count,5558);
  assert.throws(()=>verifyInventory(assets,assets,5518),/asset-count/);
  assert.throws(()=>verifyInventory({...assets,'fixture/0.png':digest('b')},assets,5558),/asset-hash/);
});
test('missing or invalid independent count rejects before filesystem, network or old CLI work',async t=>{
  let fetches=0;t.mock.method(globalThis,'fetch',()=>{fetches++;throw Error('unexpected-network');});
  const args={oldRoot:'unused-old-root',targetPointer:'unused-pointer',credentialFile:'unused-private-credential',
    outputBase:'unused-output',expectedOldBuild:digest('f')};
  await assert.rejects(()=>runOldClientUpdateProbe(args),/invalid-expected-asset-count/);
  await assert.rejects(()=>runOldClientUpdateProbe({...args,expectedAssetCount:0}),/invalid-expected-asset-count/);
  assert.equal(fetches,0);
});

test('complete update byte count includes the exact plan response and every payload',()=>{
  const f=fixture(),bytes=encode(f.plan),result=verifyUpdatePlan(f.before,f.target,bytes);
  assert.equal(result.completeBytes,bytes.length+50);assert.equal(result.planBytes,bytes.length);assert.equal(result.payloadBytes,50);
  assert.equal(result.plan.limitBytes,100_000_000);
});
test('partial plans, forged totals, changed runtime, wrong target and oversized complete differences fail',()=>{
  const cases=[
    {edit:f=>{f.plan.changed=[];},pattern:/incomplete-update-plan/},
    {edit:f=>{f.plan.bytes=1;},raw:true,pattern:/complete-update-byte-mismatch/},
    {edit:f=>{f.plan.changed[0].gzipBytes=100_000_000;},pattern:/exceeds-limit/},
    {edit:f=>{f.target.releaseId=digest('0');},pattern:/target-release-mismatch/},
    {edit:f=>{f.plan.changed[0].file='runtime/node.exe';},pattern:/invalid-update-file/},
  ];
  for(const row of cases){const f=fixture();row.edit(f);assert.throws(()=>verifyUpdatePlan(f.before,f.target,row.raw?Buffer.from(JSON.stringify(f.plan)):encode(f.plan)),row.pattern);}
});
test('inventory compares all hashes and exact key count, including an equal-size substituted key',()=>{
  const assets={'native/manifest.json':digest('a'),'image.png':digest('b')};
  assert.equal(verifyInventory({...assets},assets,2).count,2);
  assert.throws(()=>verifyInventory({'native/manifest.json':digest('a')},assets,2),/asset-count/);
  assert.throws(()=>verifyInventory({'native/manifest.json':digest('a'),'wrong.png':digest('b')},assets,2),/asset-hash/);
  assert.throws(()=>verifyInventory({...assets,'image.png':digest('c')},assets,2),/asset-hash/);
});
test('runtime containment rejects siblings and the runtime root itself',()=>{
  assert.equal(below(runtime,path.join(runtime,'probe/result')),true);
  assert.equal(below(runtime,runtime),false);assert.equal(below(runtime,path.join(root,'runtime-other/result')),false);
  assert.equal(below(runtime,path.join(runtime,'../reports/result')),false);
});
test('private values and any session token are removed before output persistence',()=>{
  const text='ordinary_test secret-password rf_session=unknownToken_A12';
  assert.equal(redact(text,['ordinary_test','secret-password']),'[redacted] [redacted] rf_session=[redacted]');
});
test('wrong expected old build leaves a failed result/log before touching target, credential, network or process',async t=>{
  await mkdir(runtime,{recursive:true});const directory=await mkdtemp(path.join(runtime,'old-update-probe-test-'));
  assert.ok(below(runtime,directory));t.after(async()=>{assert.ok(below(runtime,directory));await rm(directory,{recursive:true,force:true});});
  const client=path.join(directory,'old');await mkdir(client);const f=fixture();await writeFile(path.join(client,'client-manifest.json'),JSON.stringify(f.before));
  let fetches=0;t.mock.method(globalThis,'fetch',()=>{fetches++;throw Error('unexpected-network');});
  const output=path.join(directory,'receipt');
  const report=await runOldClientUpdateProbe({oldRoot:client,targetPointer:path.join(directory,'nonexistent-pointer'),credentialFile:path.join(directory,'nonexistent-private-credential'),outputBase:output,expectedOldBuild:digest('f'),expectedAssetCount:1});
  assert.equal(report.success,false);assert.equal(report.failure.message,'old-build-does-not-match-exactly');assert.equal(fetches,0);
  assert.deepEqual(report.cleanup.children,[]);assert.equal(JSON.parse(await readFile(output+'.json','utf8')).success,false);assert.equal(await readFile(output+'.log','utf8'),'');
});
test('malformed private JSON cannot leak its content through a parser error or failed receipt',async t=>{
  await mkdir(runtime,{recursive:true});const directory=await mkdtemp(path.join(runtime,'old-update-private-test-'));
  assert.ok(below(runtime,directory));t.after(async()=>{assert.ok(below(runtime,directory));await rm(directory,{recursive:true,force:true});});
  const client=path.join(directory,'old');await mkdir(client);const f=fixture();await writeFile(path.join(client,'client-manifest.json'),JSON.stringify(f.before));
  const pointer=path.join(directory,'pointer.json'),privateFile=path.join(directory,'private.json'),output=path.join(directory,'receipt');
  await writeFile(pointer,JSON.stringify(f.target));await writeFile(privateFile,'{"password":"FAKE-PRIVATE-SENTINEL" broken');
  let fetches=0;t.mock.method(globalThis,'fetch',()=>{fetches++;throw Error('unexpected-network');});
  const report=await runOldClientUpdateProbe({oldRoot:client,targetPointer:pointer,credentialFile:privateFile,outputBase:output,expectedOldBuild:f.before.buildSha256,expectedAssetCount:1});
  assert.equal(report.failure.message,'private-player-credential-read-or-parse-failed');assert.equal(fetches,0);assert.deepEqual(report.cleanup.children,[]);
  assert.equal((await readFile(output+'.json','utf8')).includes('FAKE-PRIVATE-SENTINEL'),false);assert.equal(await readFile(output+'.log','utf8'),'');
});

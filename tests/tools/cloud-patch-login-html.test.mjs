/** Actual local planner in an isolated Git fixture; no SSH or deployment. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {HOST_PROGRAM_DIRECTORIES,HOST_PROGRAM_FILES} from '../../packages/combat-assets/program-fingerprint.mjs';
const root=path.resolve(import.meta.dirname,'../..'),sha=v=>createHash('sha256').update(v).digest('hex');
test('changed committed login HTML enters the sealed plan with baseline and target hashes',async t=>{
  const runtime=path.join(root,'runtime');await mkdir(runtime,{recursive:true});
  const fixture=await mkdtemp(path.join(runtime,'cloud-html-fixture-'));
  t.after(async()=>{assert.ok(path.resolve(fixture).startsWith(path.resolve(runtime)+path.sep));await rm(fixture,{recursive:true,force:true});});
  const write=async(file,value)=>{await mkdir(path.dirname(path.join(fixture,file)),{recursive:true});await writeFile(path.join(fixture,file),value);};
  const git=(...args)=>execFileSync('git',['-c','core.autocrlf=false','-c','user.name=Planner Fixture','-c','user.email=fixture@example.invalid',...args],{cwd:fixture,encoding:'utf8'}).trim();
  for(const directory of HOST_PROGRAM_DIRECTORIES)await mkdir(path.join(fixture,directory),{recursive:true});
  for(const file of new Set([...HOST_PROGRAM_FILES,'apps/web/game.css','apps/web/frame-supervisor.mjs','packages/online/owned-state.mjs']))await write(file,file.endsWith('.json')?'{}\n':'/* labeled planner fixture */\n');
  for(const file of ['tools/prepare-cloud-network-patch.mjs','tools/cloud-patch-inventory.mjs','tools/git-batch-budget.mjs','packages/combat-assets/program-fingerprint.mjs']){
    await mkdir(path.dirname(path.join(fixture,file)),{recursive:true});await copyFile(path.join(root,file),path.join(fixture,file));
  }
  const before='<p>RF / LK / VC / RS / BM / IS</p>\n',after='<p>Class setup · Skills · Key bindings</p>\n';
  await write('apps/web/index.html',before);await write('apps/web/other.html','old other');
  git('init','--quiet');git('add','.');git('commit','--quiet','-m','baseline');const baseline=git('rev-parse','HEAD');
  await write('apps/web/index.html',after);await write('apps/web/other.html','new other');await write('reports/private.json','{}');
  git('add','.');git('commit','--quiet','-m','reviewed login text');
  const bundle='export const fixture=true;\n';await write('dist/game.js',bundle);await write('dist/game.css','');
  await write('snapshot.json',JSON.stringify({bundleSha256:sha(bundle),files:{'rf/manifest.json':'1'.repeat(64),'native/manifest.json':'2'.repeat(64)}}));
  const args=['tools/prepare-cloud-network-patch.mjs','--baseline='+baseline,'--old-build-sha256='+'3'.repeat(64),'--assets=snapshot.json'];
  const run=(extra=[])=>execFileSync(process.execPath,[...args,...extra],{cwd:fixture,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  run();const plan=JSON.parse(await readFile(path.join(fixture,'runtime/cloud-network-patch-plan.json'),'utf8'));
  const row=plan.files.find(file=>file.path==='apps/web/index.html');
  assert.ok(row,'automatic changed-source inventory contains the login page');
  assert.equal(row.sha256,sha(after));assert.equal(row.baselineSha256,sha(before));assert.equal(row.baselineCanonicalSha256,sha(before));
  assert.equal(plan.compatibilityFiles.find(file=>file.path==='apps/web/index.html').canonicalSha256,sha(before));
  assert.equal(plan.files.some(file=>['apps/web/other.html','reports/private.json'].includes(file.path)),false);
  run(['--include-source=apps/web/index.html']);
  assert.throws(()=>run(['--include-source=apps/web/other.html']),/Extra source/);
  await write('apps/web/index.html',after+'uncommitted');
  assert.throws(()=>run(),/differs from committed HEAD/);
});

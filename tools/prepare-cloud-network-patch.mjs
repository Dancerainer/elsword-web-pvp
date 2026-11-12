/** Freeze the small network patch and browser import closure; no asset copies. */
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {baselineBatchBudget} from './git-batch-budget.mjs';
import {fingerprintHostProgram} from '../packages/combat-assets/program-fingerprint.mjs';
import {snapshotAssets,changedAssetFiles,removedAssetFiles,isProgramSource,requiredProfessionManifests} from './cloud-patch-inventory.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{
  const cut=arg.indexOf('=');if(cut<0||!['--baseline','--old-build-sha256','--include-source','--assets','--baseline-assets'].includes(arg.slice(0,cut)))throw Error('Unexpected patch plan argument');
  return [arg.slice(2,cut),arg.slice(cut+1)];
}));
const root=process.cwd(),baseline=args.baseline;
const expectedOldBuildSha256=args['old-build-sha256'];
if(!/^[a-f0-9]{40}$/.test(baseline)||!/^[a-f0-9]{64}$/.test(expectedOldBuildSha256))throw Error('Full baseline commit and old bundle SHA256 required');
const extraSources=args['include-source']?.split(',')??[];
if(extraSources.some(file=>!isProgramSource(file)))throw Error('Extra source must be an allowed program/config/contract path');
if(args['baseline-assets']&&!args.assets)throw Error('Baseline assets require a target sealed snapshot');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=bytes=>Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
const tracked=execFileSync('git',['ls-tree','-r','--name-only',baseline],{encoding:'utf8'}).trim().split('\n');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const committed=new Set(execFileSync('git',['ls-tree','-r','--name-only',sourceCommit],{encoding:'utf8'}).trim().split('\n'));
const changedSources=execFileSync('git',['diff','--no-renames','--name-only',baseline,sourceCommit],{encoding:'utf8'}).trim().split('\n').filter(isProgramSource);
if(changedSources.some(file=>!committed.has(file)))throw Error('Program source deletion is not supported by this patch');
const baselineSources=tracked.filter(file=>/^(apps|packages|config|contracts)\//.test(file)||['package.json','package-lock.json','tools/assets/character/sample_pose.mjs'].includes(file));
// Size metadata is small; budget the complete frozen inventory before its one
// bounded blob read. Twelve profession profiles can exceed the former 64 MiB.
const batchInput=baselineSources.map(file=>baseline+':'+file+'\n').join('');
const batchSizes=execFileSync('git',['cat-file','--batch-check=%(objecttype) %(objectsize)'],{input:batchInput,encoding:'utf8',maxBuffer:1024*1024});
const batchBudget=baselineBatchBudget(batchSizes,baselineSources.length);
const batch=execFileSync('git',['cat-file','--batch'],{input:batchInput,maxBuffer:batchBudget.maxBuffer});
if(batch.length!==batchBudget.bytes)throw Error('Baseline Git blob sizes differ from size inventory');
const oldBytes=new Map();let offset=0;
for(const file of baselineSources){const end=batch.indexOf(10,offset),header=batch.subarray(offset,end).toString('ascii'),match=/^[a-f0-9]{40} blob (\d+)$/.exec(header);
  if(end<0||!match)throw Error('Invalid baseline Git blob: '+file);const size=Number(match[1]);offset=end+1;
  oldBytes.set(file,batch.subarray(offset,offset+size));offset+=size+1;
}
if(offset!==batch.length)throw Error('Unexpected baseline Git inventory bytes');
const old=file=>oldBytes.get(file)??execFileSync('git',['show',baseline+':'+file],{maxBuffer:32*1024*1024});
const compatibilityFiles=baselineSources
  // Match the actual deployed source domain. Git also retains Markdown proof
  // and CSV inputs; requiring those remotely invents undeployed dependencies.
  .filter(isProgramSource)
  .map(file=>({path:file,canonicalSha256:sha(canonical(old(file)))}));
const files=[];
async function add(file){const bytes=await readFile(path.join(root,file)),before=tracked.includes(file)?old(file):null;
  if(isProgramSource(file)){
    if(!committed.has(file))throw Error('Patch source must be committed: '+file);
    const head=execFileSync('git',['show',sourceCommit+':'+file],{maxBuffer:32*1024*1024});
    if(sha(canonical(bytes))!==sha(canonical(head)))throw Error('Patch source differs from committed HEAD: '+file);
  }
  files.push({path:file,sha256:sha(bytes),baselineSha256:before?sha(before):null,baselineCanonicalSha256:before?sha(canonical(before)):null});}
for(const file of new Set(['apps/web/frame-supervisor.mjs','apps/web/game.mjs','apps/web/game.css','apps/web/input-prediction.mjs','packages/online/owned-state.mjs',...changedSources,...extraSources]))await add(file);
const visited=new Set();
async function closure(file){if(visited.has(file))return;visited.add(file);const bytes=await readFile(path.join(root,file));
  for(const match of bytes.toString('utf8').matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)["'](\.\.?\/[^"']+\.js)["']/g)){
    const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1]));
    if(!dependency.startsWith('dist/'))throw Error('Browser import escaped dist');await closure(dependency);
  }
}
await closure('dist/game.js');for(const file of [...visited].sort())await add(file);await add('dist/game.css');
let assets=[],baselineAssets;const proof=/^(?:source|sources|proof|proofs|evidence|receipt|receipts|contracts|superseded|generated)(?:$|[-_])/i;
async function walk(relative){for(const item of await readdir(path.join(root,'artifacts',relative),{withFileTypes:true})){
  const file=relative+'/'+item.name;if(item.isSymbolicLink())throw Error('Asset entry is a link');
  if(item.isDirectory()){if(!item.name.startsWith('.')&&!proof.test(item.name))await walk(file);}
  else if(item.isFile()&&!item.name.startsWith('.')&&(/\.(glb|json|ogg|png|ttf|wav)$/i.test(file)||/\.json\.gz$/i.test(file)))
    assets.push({path:'artifacts/'+file,sha256:sha(await readFile(path.join(root,'artifacts',file)))});
}}
if(args.assets){
  const targetSnapshot=JSON.parse(await readFile(args.assets,'utf8'));
  assets=snapshotAssets(targetSnapshot,files.find(file=>file.path==='dist/game.js').sha256);
  if(args['baseline-assets']){
    baselineAssets=snapshotAssets(JSON.parse(await readFile(args['baseline-assets'],'utf8')),expectedOldBuildSha256);
    for(const row of changedAssetFiles(baselineAssets,assets)){
      if(sha(await readFile(path.join(targetSnapshot.assetRoot,row.path.slice('artifacts/'.length))))!==row.sha256)throw Error('Changed asset differs from target snapshot: '+row.path);
      files.push(row);
    }
  }
}else{
for(const directory of ['rf','ui','scene','audio'])await walk(directory);
const nativeFile='artifacts/native/manifest.json',nativeBytes=await readFile(nativeFile),native=JSON.parse(nativeBytes);
if(Object.keys(native.modules).length!==10)throw Error('Unexpected native module inventory');assets.push({path:nativeFile,sha256:sha(nativeBytes)});
for(const row of Object.values(native.modules)){const file='artifacts/native/'+row.file,bytes=await readFile(file);if(sha(bytes)!==row.sha256)throw Error('Native module digest mismatch');assets.push({path:file,sha256:sha(bytes)});}
}
assets.sort((a,b)=>a.path.localeCompare(b.path));
const host=await fingerprintHostProgram({root});
const plan={schemaVersion:1,baselineCommit:baseline,sourceCommit,
  expectedOldBuildSha256,
  buildSha256:files.find(file=>file.path==='dist/game.js').sha256,hostProgramSha256:host.sha256,
  files,compatibilityFiles,assets,...(baselineAssets?{baselineAssets,assetRemovals:removedAssetFiles(baselineAssets,assets)}:{}),
  hostProgramFiles:host.files,hostProgramDomain:host.domain,requiredProfessions:requiredProfessionManifests(assets),
  browserClosureFiles:visited.size,assetChanges:files.some(row=>row.path.startsWith('artifacts/'))||!!baselineAssets&&removedAssetFiles(baselineAssets,assets).length>0,dependencyChanges:changedSources.some(file=>['package.json','package-lock.json'].includes(file))};
await mkdir('runtime',{recursive:true});await writeFile('runtime/cloud-network-patch-plan.json',JSON.stringify(plan,null,2)+'\n');
console.log(JSON.stringify({sourceCommit:plan.sourceCommit,buildSha256:plan.buildSha256,hostProgramSha256:host.sha256,
  browserClosureFiles:visited.size,assets:assets.length,compatibilityFiles:compatibilityFiles.length,candidateFiles:files.length}));

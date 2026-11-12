import {readFile,writeFile,mkdir,copyFile,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {parseServerOrigin} from '../apps/local-client/server-config.mjs';
import {verifyRuntime} from './verify-public-runtime.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const hash=async file=>{const value=createHash('sha256');for await(const chunk of createReadStream(file))value.update(chunk);return value.digest('hex');};
const safe=file=>typeof file==='string'&&!file.includes('\\')&&!file.includes(':')&&file.split('/').every(p=>p&&p!=='.'&&p!=='..');
export async function packageLocalClient({root=ROOT,snapshot,destination,nodeBinary=process.execPath,remoteOrigin=process.env.WEB_PVP_SERVER_URL ?? 'http://127.0.0.1:4196'}={}){
  snapshot??=JSON.parse(await readFile(path.join(root,'dist/deployment.json'),'utf8'));
  destination=path.resolve(destination??path.join(root,'runtime/local-client/elsword-client'));
  // Build output belongs to this task. Never write into shared asset roots.
  if(!destination.startsWith(path.join(path.resolve(root),'runtime')+path.sep))throw Error('Client output must be inside task runtime');
  const serverUrl=parseServerOrigin(remoteOrigin);
  await mkdir(path.dirname(destination),{recursive:true});await mkdir(destination);
  const files={},sizes={};
  async function copy(input,name,expected){
    if(!safe(name)||(await lstat(input)).isSymbolicLink())throw Error('invalid-package-input');
    const target=path.join(destination,name);await mkdir(path.dirname(target),{recursive:true});await copyFile(input,target);
    const digest=await hash(target);if(expected&&digest!==expected)throw Error('Package source changed: '+name);
    files[name]=digest;sizes[name]=(await lstat(target)).size;
  }
  for(const [file,digest]of Object.entries(snapshot.files))await copy(path.join(snapshot.assetRoot,file),'assets/'+file,digest);
  const native=await verifyRuntime(file=>readFile(path.join(destination,'assets',file)));
  // The browser's current code is bundled; later code-only releases can use the
  // small authenticated /game stream while retaining identical local assets.
  const closure=new Set();
  async function browser(file){
    if(!safe(file)||!file.startsWith('dist/'))throw Error('invalid-browser-import');
    if(closure.has(file))return;closure.add(file);
    const bytes=await readFile(path.join(root,file));
    for(const match of bytes.toString('utf8').matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)["'](\.\.?\/[^"']+\.js)["']/g))await browser(path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1])));
    await copy(path.join(root,file),file);
  }
  await browser('dist/game.js');await copy(path.join(root,'dist/game.css'),'dist/game.css');
  for(const file of ['apps/web/index.html','apps/web/login.mjs','apps/web/login.css','apps/local-client/client.mjs','apps/local-client/server-config.mjs','apps/local-client/updater.mjs','apps/local-client/update-contract.mjs','apps/local-client/update-messages.mjs','apps/server/asset-path-aliases.mjs'])await copy(path.join(root,file),file);
  for(const file of ['Start-Client.bat','Open-Client.ps1'])await copy(path.join(root,'apps/local-client',file),file);
  await copy(nodeBinary,'runtime/node.exe');
  // Bundle an installed runtime, no npm install or administrator setup on player PCs.
  const notice=path.join(root,'apps/local-client/NODE-LICENSE.txt');await copy(notice,'NODE-LICENSE.txt');
  const guide=await readFile(path.join(root,'docs/LOCAL_CLIENT_PLAYER.txt'),'utf8');
  await writeFile(path.join(destination,'PLAYER-GUIDE.txt'),'\uFEFF'+guide);
  files['PLAYER-GUIDE.txt']=await hash(path.join(destination,'PLAYER-GUIDE.txt'));sizes['PLAYER-GUIDE.txt']=(await lstat(path.join(destination,'PLAYER-GUIDE.txt'))).size;
  // Editable deployment settings are outside the immutable payload inventory.
  await writeFile(path.join(destination,'server-config.json'),JSON.stringify({serverUrl},null,2)+'\n');
  const manifest={schemaVersion:1,buildSha256:files['dist/game.js'],nativeVersion:native.runtimeVersion,
    sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),assets:snapshot.files,files};
  await writeFile(path.join(destination,'client-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const report={schemaVersion:1,destination,sourceCommit:manifest.sourceCommit,buildSha256:manifest.buildSha256,
    assetCount:Object.keys(snapshot.files).length,assetBytes:Object.keys(snapshot.files).reduce((sum,file)=>sum+sizes['assets/'+file],0),
    totalFiles:Object.keys(files).length,totalBytes:Object.values(sizes).reduce((sum,size)=>sum+size,0),nodeSha256:files['runtime/node.exe'],nativeVersion:native.runtimeVersion};
  await writeFile(path.join(root,'runtime/local-client-package.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const snapshot=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')):undefined;
  console.log(JSON.stringify(await packageLocalClient({snapshot,destination:process.argv[3]})));
}

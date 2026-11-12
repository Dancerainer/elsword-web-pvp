import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFile,writeFile,mkdir,readdir,lstat,copyFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolveServerOrigin} from '../apps/local-client/server-config.mjs';
import {verifyClientFiles} from '../apps/local-client/client.mjs';
import {validateManifest,sha} from '../apps/local-client/update-contract.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const DESKTOP_EXECUTABLE='web pvp.exe';
const hash=async file=>{const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');};
export async function packageDesktop({clientRoot,electronRoot,destination,root=ROOT}){
  destination=path.resolve(destination);
  if(!destination.startsWith(path.join(path.resolve(root),'runtime')+path.sep))throw Error('Desktop output must be task-local runtime');
  const manifest=validateManifest(JSON.parse(await readFile(path.join(clientRoot,'client-manifest.json'),'utf8')));
  await verifyClientFiles(clientRoot,manifest);
  const electronVersion=(await readFile(path.join(electronRoot,'version'),'utf8')).trim();
  const runtimeContract=JSON.parse(await readFile(path.join(root,'contracts/desktop-runtime-v1.json'),'utf8'));
  if(electronVersion!==runtimeContract.electronVersion)throw Error('Unverified Electron runtime version');
  await mkdir(path.dirname(destination),{recursive:true});await mkdir(destination);
  const files={};let totalBytes=0;
  async function copy(input,name,expected){
    if((await lstat(input)).isSymbolicLink())throw Error('Linked input');
    const target=path.join(destination,name);await mkdir(path.dirname(target),{recursive:true});await copyFile(input,target);
    const digest=await hash(target);if(expected&&digest!==expected)throw Error('Input changed: '+name);
    files[name]=digest;totalBytes+=(await lstat(target)).size;
  }
  async function tree(folder,prefix=''){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      const name=prefix+entry.name,input=path.join(folder,entry.name);
      if(entry.isSymbolicLink())throw Error('Linked runtime input');
      if(entry.isDirectory())await tree(input,name+'/');
      else {
        if(!runtimeContract.files[name])throw Error('Unexpected runtime file: '+name);
        if(name!=='resources/default_app.asar')await copy(input,name==='electron.exe'?DESKTOP_EXECUTABLE:name,runtimeContract.files[name]);
      }
    }
  }
  await tree(electronRoot);
  for(const name of Object.keys(runtimeContract.files))if(name!=='resources/default_app.asar'&&!files[name==='electron.exe'?DESKTOP_EXECUTABLE:name])throw Error('Missing runtime file: '+name);
  for(const file of ['package.json','main.cjs','policy.cjs','network.cjs','preload.cjs','game-preload.cjs','index.html','launcher.js','launcher.css'])await copy(path.join(root,'apps/desktop',file),'resources/app/'+file);
  // Preserve the canonical published content manifest byte identity so future
  // bounded updates work. The legacy Node/bat files remain inert inside content;
  // the desktop entry point never launches them or discovers their localhost port.
  for(const [file,digest] of Object.entries(manifest.files))await copy(path.join(clientRoot,file),'resources/content/'+file,digest);
  await copy(path.join(clientRoot,'client-manifest.json'),'resources/content/client-manifest.json');
  const serverUrl=await resolveServerOrigin({configPath:path.join(clientRoot,'server-config.json'),manifest});
  await writeFile(path.join(destination,'server-config.json'),JSON.stringify({serverUrl},null,2)+'\n');
  files['server-config.json']=await hash(path.join(destination,'server-config.json'));
  totalBytes+=(await lstat(path.join(destination,'server-config.json'))).size;
  await copy(path.join(root,'docs/DESKTOP_CLIENT_PLAYER.txt'),'PLAYER-GUIDE.txt');
  const record={schemaVersion:1,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    electronVersion,contentReleaseId:sha(Buffer.from(JSON.stringify(manifest))),contentSourceCommit:manifest.sourceCommit,
    buildSha256:manifest.buildSha256,assetCount:Object.keys(manifest.assets).length,totalBytes,files};
  await writeFile(path.join(destination,'package-manifest.json'),JSON.stringify(record,null,2)+'\n');
  return {...record,files:Object.keys(files).length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [clientRoot,electronRoot,destination]=process.argv.slice(2);
  if(!destination)throw Error('Usage: package-desktop-client.mjs <published client> <verified Electron runtime> <new task runtime destination>');
  console.log(JSON.stringify(await packageDesktop({clientRoot,electronRoot,destination})));
}

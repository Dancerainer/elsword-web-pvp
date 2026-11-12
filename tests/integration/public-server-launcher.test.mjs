import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const script=path.join(root,'scripts/public-server.ps1');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
function ps(code){return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',"$ErrorActionPreference='Stop'; "+code],{encoding:'utf8',timeout:20000}).trim();}
function bat(file){return execFileSync('cmd.exe',['/d','/s','/c',`""${file}" --no-pause"`],{windowsVerbatimArguments:true,encoding:'utf8',timeout:20000,stdio:'pipe'});}
const supported=process.platform==='win32';

test('Windows PowerShell 5.1 parses the launcher and process identity rejects reused PIDs and different executables',{skip:!supported},()=>{
  const result=ps(`$taskErrors=$null; [Management.Automation.Language.Parser]::ParseFile(${quote(script)},[ref]$null,[ref]$taskErrors)|Out-Null; if($taskErrors){throw ($taskErrors|Out-String)}; . ${quote(script)}; $taskSelf=Get-Process -Id $PID; $taskEntry=@{pid=$PID;startTicks=$taskSelf.StartTime.ToUniversalTime().Ticks;executable=$taskSelf.Path}; if(-not (Get-ManagedProcess $taskEntry)){throw 'own process rejected'}; $taskEntry.startTicks--; if(Get-ManagedProcess $taskEntry){throw 'reused PID accepted'}; Stop-ManagedProcess $taskEntry; $taskEntry.startTicks++; $taskEntry.executable='C:\\not-the-owned-executable.exe'; if(Get-ManagedProcess $taskEntry){throw 'different executable accepted'}; Stop-ManagedProcess $taskEntry; Write-Output 'identity-ok'`);
  assert.equal(result,'identity-ok');
});

test('online asset preflight requires the PvP HUD manifest before starting a public process',{skip:!supported},async()=>{
  const parent=path.join(root,'runtime/public-launcher-tests');await mkdir(parent,{recursive:true});
  const directory=await mkdtemp(path.join(parent,'assets with spaces '));
  try{
    for(const file of ['native/manifest.json','rf/manifest.json','scene/sander-garpai-rock-pvp/manifest.json','ui/online/manifest.json','audio/pvp/manifest.json']){
      await mkdir(path.dirname(path.join(directory,file)),{recursive:true});await writeFile(path.join(directory,file),'{}');
    }
    const check=()=>ps(`. ${quote(script)}; Assert-OnlineAssets ${quote(directory)}; Write-Output 'assets-ok'`);
    assert.throws(check,/Missing online resource: ui\/pvp-hud\/manifest\.json/);
    const hud=path.join(directory,'ui/pvp-hud/manifest.json');await mkdir(hud,{recursive:true});
    assert.throws(check,/Missing online resource: ui\/pvp-hud\/manifest\.json/,'a directory cannot stand in for a manifest file');
    await rmdir(hud);await writeFile(hud,'{"fixture":true}');assert.equal(check(),'assets-ok');
  }finally{assert.ok(path.resolve(directory).startsWith(path.resolve(parent)+path.sep));await rm(directory,{recursive:true,force:true});}
});

test('source fingerprint works without Get-FileHash and detects changed CSS in the prepared release',{skip:!supported},async()=>{
  const parent=path.join(root,'runtime/public-launcher-tests');await mkdir(parent,{recursive:true});
  const directory=await mkdtemp(path.join(parent,'fingerprint with spaces '));
  try{
    for(const folder of ['apps','packages','config','tools','scripts'])await mkdir(path.join(directory,folder));
    for(const file of ['apps/game.mjs','apps/game.css','packages/core.mjs','config/profile.json','package.json','pnpm-lock.yaml','tools/build-web.mjs','tools/prepare-public-deployment.mjs','tools/verify-public-runtime.mjs','tools/verify-public-accounts.mjs','tools/verify-public-online-transport.mjs','scripts/public-server.ps1','scripts/verify-public-https.ps1'])await writeFile(path.join(directory,file),'fixture\n');
    const calculate=()=>ps(`. ${quote(script)}; function Get-FileHash { throw 'Unavailable in this Windows environment' }; Get-SourceFingerprint ${quote(directory)}`);
    const before=calculate();assert.match(before,/^[0-9a-f]{64}$/);assert.equal(calculate(),before);
    await writeFile(path.join(directory,'apps/game.css'),'fixture changed\n');assert.notEqual(calculate(),before);
  }finally{assert.ok(path.resolve(directory).startsWith(path.resolve(parent)+path.sep));await rm(directory,{recursive:true,force:true});}
});

async function fixture(){
  const parent=path.join(root,'runtime/public-launcher-tests');await mkdir(parent,{recursive:true});
  const directory=await mkdtemp(path.join(parent,'bat with spaces '));
  await mkdir(path.join(directory,'scripts'));await mkdir(path.join(directory,'runtime/accounts'),{recursive:true});
  await copyFile(script,path.join(directory,'scripts/public-server.ps1'));
  await copyFile(path.join(root,'stop-public-server.bat'),path.join(directory,'stop-public-server.bat'));
  await writeFile(path.join(directory,'runtime/public-server-settings.json'),JSON.stringify({deploymentRoot:directory}));
  const accountFile=path.join(directory,'runtime/accounts/keep.json');const bytes='{"username":"fixture","password":"example-only","wins":4}';await writeFile(accountFile,bytes);
  const helper=path.join(directory,'helper.mjs');await writeFile(helper,'setInterval(()=>{},1000);');
  const identity=JSON.parse(ps(`. ${quote(script)}; $taskChild=Start-Process -FilePath ${quote(process.execPath)} -ArgumentList ('"'+${quote(helper)}+'"') -WindowStyle Hidden -PassThru -WorkingDirectory ${quote(directory)}; Get-ProcessIdentity $taskChild | ConvertTo-Json -Compress`));
  assert.ok(identity.executable?.length,'A newly started process must have a stoppable executable identity');
  return {parent,directory,identity,accountFile,bytes};
}
function alive(identity){return ps(`. ${quote(script)}; $taskEntry=${quote(JSON.stringify(identity))}|ConvertFrom-Json; if(Get-ManagedProcess $taskEntry){'alive'}else{'gone'}`)==='alive';}
async function cleanup(f){
  ps(`. ${quote(script)}; Stop-ManagedProcess (${quote(JSON.stringify(f.identity))}|ConvertFrom-Json)`);
  assert.ok(path.resolve(f.directory).startsWith(path.resolve(f.parent)+path.sep));await rm(f.directory,{recursive:true,force:true});
}
test('double-click stop bat works from a path with spaces, stops only its managed process and keeps account state',{skip:!supported},async()=>{
  const f=await fixture();
  try{
    assert.equal(alive(f.identity),true,'The identity must recognize the live process before testing stop');
    await writeFile(path.join(f.directory,'runtime/public-online.json'),JSON.stringify({deploymentRoot:f.directory,server:f.identity,tunnel:null}));
    await writeFile(path.join(f.directory,'runtime/public-address.txt'),'https://example.trycloudflare.com');
    const output=bat(path.join(f.directory,'stop-public-server.bat'));
    assert.match(output,/Public server stopped/);assert.equal(alive(f.identity),false);
    assert.equal(ps(`if(Get-Process -Id ${f.identity.pid} -ErrorAction SilentlyContinue){'still-running'}else{'gone'}`),'gone');
    assert.equal(await readFile(f.accountFile,'utf8'),f.bytes);
    await assert.rejects(readFile(path.join(f.directory,'runtime/public-online.json')),error=>error.code==='ENOENT');
    await assert.rejects(readFile(path.join(f.directory,'runtime/public-address.txt')),error=>error.code==='ENOENT');
  }finally{await cleanup(f);}
});
test('a foreign deployment record refuses stop and leaves its process and persistent data untouched',{skip:!supported},async()=>{
  const f=await fixture();
  try{
    await writeFile(path.join(f.directory,'runtime/public-online.json'),JSON.stringify({deploymentRoot:path.join(f.directory,'foreign'),server:f.identity}));
    assert.throws(()=>bat(path.join(f.directory,'stop-public-server.bat')),/State belongs to another deployment/);
    assert.equal(alive(f.identity),true);assert.equal(await readFile(f.accountFile,'utf8'),f.bytes);
  }finally{await cleanup(f);}
});

/** Actual copied old portable CLI -> public update -> restarted CLI/API probe.
 * No browser/GPU, package copy, account creation or server administration.
 * Usage: node tools/validation/probe-old-client-update-v38.mjs OLD_ROOT TARGET_POINTER CREDENTIAL_FILE OUTPUT_BASE EXPECTED_OLD_BUILD EXPECTED_ASSET_COUNT
 * OLD_ROOT and OUTPUT_BASE must be physical paths below this task's runtime/.
 * OUTPUT_BASE is extensionless; .json and .log are written even on failure.
 */
import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sha,digest,validateManifest,UPDATE_LIMIT} from '../../apps/local-client/update-contract.mjs';
import {createHash} from 'node:crypto';

const taskRoot=fileURLToPath(new URL('../../',import.meta.url)),runtime=path.join(taskRoot,'runtime');
const LOG_LIMIT=2*1024*1024;
// The independent sealed-package count is mandatory; never infer it from the target.
// validateManifest caps the complete files inventory at 20,000 entries.
export const MAX_EXPECTED_ASSET_COUNT=20000;
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
const json=bytes=>JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
const releaseId=manifest=>sha(Buffer.from(JSON.stringify(manifest)));
export function below(root,file){const relative=path.relative(path.resolve(root),path.resolve(file));return !!relative&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);}
export function redact(text,secrets=[]){
  let clean=String(text);for(const secret of secrets.filter(value=>typeof value==='string'&&value.length).sort((a,b)=>b.length-a.length))clean=clean.split(secret).join('[redacted]');
  return clean.replace(/rf_session=[A-Za-z0-9_-]+/g,'rf_session=[redacted]');
}
async function physicalPath(root,file,{createParent=false}={}){
  requireThat(below(root,file),'path-outside-task-runtime');
  let current=root;const parts=path.relative(root,file).split(path.sep);
  requireThat(!(await lstat(current)).isSymbolicLink(),'linked-task-runtime');
  for(let index=0;index<parts.length;index++){
    current=path.join(current,parts[index]);
    let stat;try{stat=await lstat(current);}catch(error){
      if(error.code!=='ENOENT')throw error;
      if(createParent&&index<parts.length-1){await mkdir(current);stat=await lstat(current);}else if(createParent)return;else throw error;
    }
    requireThat(!stat.isSymbolicLink(),'linked-probe-path');
    if(index<parts.length-1)requireThat(stat.isDirectory(),'non-directory-probe-parent');
  }
}
export function verifyUpdatePlan(before,target,bytes){
  const plan=json(bytes);validateManifest(plan.manifest);
  requireThat(plan.status==='update-available','expected-update-available');
  requireThat(plan.releaseId===target.releaseId&&releaseId(plan.manifest)===target.releaseId,'target-release-mismatch');
  requireThat(plan.manifest.buildSha256===target.buildSha256,'target-build-mismatch');
  requireThat(plan.manifest.remoteOrigin===before.remoteOrigin,'update-origin-changed');
  requireThat(plan.limitBytes===UPDATE_LIMIT,'expected-configured-update-limit');
  const required=Object.keys(plan.manifest.files).filter(file=>before.files[file]!==plan.manifest.files[file]);
  requireThat(Array.isArray(plan.changed)&&plan.changed.length===required.length&&new Set(plan.changed.map(row=>row.file)).size===required.length,'incomplete-update-plan');
  let total=bytes.length;
  for(const row of plan.changed){
    requireThat(required.includes(row.file)&&row.file!=='runtime/node.exe'&&row.sha256===plan.manifest.files[row.file]&&digest(row.gzipSha256)
      &&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=256*1024*1024&&Number.isSafeInteger(row.gzipBytes)&&row.gzipBytes>0,'invalid-update-file');
    total+=row.gzipBytes;
  }
  requireThat(Number.isSafeInteger(total)&&total===plan.bytes,'complete-update-byte-mismatch');
  requireThat(total<=UPDATE_LIMIT,'complete-update-exceeds-limit');
  return {plan,completeBytes:total,planBytes:bytes.length,payloadBytes:total-bytes.length};
}
export function validateExpectedAssetCount(value){
  requireThat(Number.isSafeInteger(value)&&value>=1&&value<=MAX_EXPECTED_ASSET_COUNT,'invalid-expected-asset-count');
  return value;
}
export function parseExpectedAssetCount(value){
  requireThat(typeof value==='string'&&/^[1-9]\d*$/.test(value),'expected-asset-count-must-be-canonical-decimal');
  return validateExpectedAssetCount(Number(value));
}
export function verifyInventory(files,manifestAssets,expectedCount){
  validateExpectedAssetCount(expectedCount);
  requireThat(files&&typeof files==='object'&&!Array.isArray(files)
    &&manifestAssets&&typeof manifestAssets==='object'&&!Array.isArray(manifestAssets),'invalid-asset-inventory');
  const names=Object.keys(files),expected=Object.keys(manifestAssets);
  requireThat(names.length===expectedCount&&expected.length===expectedCount,'asset-count-mismatch');
  requireThat(names.every(name=>Object.hasOwn(manifestAssets,name)&&digest(files[name])&&files[name]===manifestAssets[name]),'asset-hash-mismatch');
  return {count:names.length,mismatches:0,sortedEntriesSha256:sha(Buffer.from(JSON.stringify(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)))))};
}
async function hashFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function reservePort(){
  const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port:0,exclusive:true},resolve);});
  return {port:server.address().port,release:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
async function responseBytes(response,limit){
  const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;requireThat(bytes<=limit,'response-too-large');chunks.push(chunk);}return Buffer.concat(chunks);
}
function ownedChild(executable,entry,root,port,onOutput){
  const process=spawn(executable,[entry],{cwd:root,env:{...globalThis.process.env,EL_CLIENT_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let closed=false,error=null;
  const done=new Promise(resolve=>{process.once('error',value=>{error=value;});process.once('close',(code,signal)=>{closed=true;resolve({code,signal,error:error?.code??null});});});
  process.stdout.setEncoding('utf8');process.stderr.setEncoding('utf8');
  process.stdout.on('data',chunk=>onOutput('stdout',chunk));process.stderr.on('data',chunk=>onOutput('stderr',chunk));
  return {process,done,get closed(){return closed;}};
}
async function withTimeout(promise,ms,signal,message){
  let timer,abort;try{return await Promise.race([promise,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error(message)),ms);abort=()=>reject(Error('probe-interrupted'));
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  })]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function stopOwned(child){
  if(!child||child.closed)return {alreadyClosed:true};
  child.process.kill('SIGTERM');
  try{return {requestedSignal:'SIGTERM',...await withTimeout(child.done,5000,null,'child-close-timeout')};}
  catch{if(!child.closed)child.process.kill('SIGKILL');return {requestedSignal:'SIGKILL',...await withTimeout(child.done,5000,null,'owned-child-not-closed')};}
}

export async function runOldClientUpdateProbe({oldRoot,targetPointer,credentialFile,outputBase,expectedOldBuild,expectedAssetCount}){
  requireThat([oldRoot,targetPointer,credentialFile,outputBase,expectedOldBuild].every(value=>typeof value==='string'&&value.length),'five-path-build-arguments-required');
  validateExpectedAssetCount(expectedAssetCount);
  const root=path.resolve(oldRoot),output=path.resolve(outputBase);
  requireThat(!/\.(json|log)$/i.test(output),'output-base-must-be-extensionless');
  await mkdir(runtime,{recursive:true});await physicalPath(runtime,output+'.json',{createParent:true});await physicalPath(runtime,output+'.log',{createParent:true});
  requireThat(!below(root,output+'.json'),'output-must-not-be-inside-client-copy');
  const result={schemaVersion:1,success:false,scope:'Actual old portable runtime/node.exe and apps/local-client/client.mjs; public update then restarted local CLI and authenticated API, no browser/GPU/WAN combat',
    expectedAssetCount,expectedAssetCountSource:'mandatory caller input from independent sealed package manifest',
    startedAt:new Date().toISOString(),stage:'preflight',checks:{},cleanup:{},limitations:['Plan plus advertised compressed payload bytes are verified; this probe does not measure TCP/TLS overhead or an independent packet capture.','The CLI verifies and serves local resources; no game rendering or multiplayer gameplay is run.']};
  const secrets=[],logs=[],children=[],abort=new AbortController();let logBytes=0,cookie=null,base=null,logoutAttempted=false;
  const log=(_kind,chunk)=>{const bytes=Buffer.from(chunk);if(logBytes<LOG_LIMIT){const keep=bytes.subarray(0,LOG_LIMIT-logBytes);logs.push(keep.toString());logBytes+=keep.length;if(keep.length<bytes.length)result.logTruncated=true;}else result.logTruncated=true;};
  const stage=name=>{result.stage=name;console.log(JSON.stringify({probe:'old-client-update-v38',stage:name}));};
  const interrupt=()=>abort.abort();process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  const request=async(origin,endpoint,{method='GET',body,timeout=30000,limit=4*1024*1024,cleanup=false}={})=>{
    const response=await fetch(origin+endpoint,{method,redirect:'manual',headers:{Origin:origin,'Accept-Encoding':'identity',...(cookie&&origin===base?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:cleanup?AbortSignal.timeout(timeout):AbortSignal.any([abort.signal,AbortSignal.timeout(timeout)])});
    return {status:response.status,headers:response.headers,bytes:await responseBytes(response,limit)};
  };
  const api=async(endpoint,options)=>{const response=await request(base,endpoint,options);let value;
    try{value=json(response.bytes);}catch{throw Error('api-response-json-invalid');}return {...response,value};};
  const start=async()=>{
    const reservation=await reservePort();const port=reservation.port;await reservation.release();
    const child=ownedChild(path.join(root,'runtime/node.exe'),path.join(root,'apps/local-client/client.mjs'),root,port,log);children.push(child);
    // The reservation is released immediately before spawn. A bind race makes
    // this owned child fail; a different process is never terminated/reused.
    return {child,port};
  };
  try{
    requireThat(digest(expectedOldBuild),'invalid-expected-old-build');
    await physicalPath(runtime,root);requireThat((await lstat(root)).isDirectory(),'old-client-copy-not-directory');
    await physicalPath(runtime,path.join(root,'client-manifest.json'));
    const beforeBytes=await readFile(path.join(root,'client-manifest.json')),before=validateManifest(json(beforeBytes));
    requireThat(before.buildSha256===expectedOldBuild,'old-build-does-not-match-exactly');
    result.before={buildSha256:before.buildSha256,releaseId:releaseId(before),manifestSha256:sha(beforeBytes),fileCount:Object.keys(before.files).length,assetCount:Object.keys(before.assets).length};
    const pointerBytes=await readFile(path.resolve(targetPointer)),target=json(pointerBytes);
    requireThat(digest(target.releaseId)&&digest(target.buildSha256),'invalid-target-pointer');
    requireThat(target.buildSha256!==expectedOldBuild,'target-is-not-a-new-build');
    let credential;try{credential=json(await readFile(path.resolve(credentialFile)));}catch{throw Error('private-player-credential-read-or-parse-failed');}
    requireThat(typeof credential.username==='string'&&credential.username.length&&typeof credential.password==='string'&&credential.password.length,'invalid-private-player-credential');
    secrets.push(credential.username,credential.password,encodeURIComponent(credential.username),encodeURIComponent(credential.password));
    for(const name of ['runtime/node.exe','apps/local-client/client.mjs','dist/game.js']){
      requireThat(digest(before.files[name]),'old-client-entry-not-manifested');await physicalPath(runtime,path.join(root,name));
      requireThat(await hashFile(path.join(root,name))===before.files[name],'old-client-entry-hash-mismatch');
    }
    result.target={releaseId:target.releaseId,buildSha256:target.buildSha256,pointerSha256:sha(pointerBytes)};
    result.probeSha256=await hashFile(fileURLToPath(import.meta.url));
    stage('public-update-plan');
    const response=await request(before.remoteOrigin,'/api/client-update/plan',{method:'POST',body:{baseReleaseId:releaseId(before)},timeout:900000,limit:UPDATE_LIMIT});
    requireThat(response.status===200,'update-plan-http-status');
    const checked=verifyUpdatePlan(before,target,response.bytes),{plan}=checked;
    requireThat(Object.keys(plan.manifest.assets).length===expectedAssetCount,'target-asset-count-mismatch');
    result.plan={status:plan.status,sha256:sha(response.bytes),limitBytes:UPDATE_LIMIT,completeBytes:checked.completeBytes,planBytes:checked.planBytes,payloadBytes:checked.payloadBytes,changedFiles:plan.changed.length};
    stage('old-updater');
    const first=await start();result.oldClientPort=first.port;
    const exit=await withTimeout(first.child.done,20*60*1000,abort.signal,'old-updater-timeout');
    result.oldUpdaterExit=exit;requireThat(exit.code===75&&!exit.error,'old-updater-did-not-request-exit75');
    const afterBytes=await readFile(path.join(root,'client-manifest.json')),after=validateManifest(json(afterBytes));
    requireThat(releaseId(after)===target.releaseId&&after.buildSha256===target.buildSha256,'written-manifest-target-mismatch');
    requireThat(Object.keys(after.assets).length===expectedAssetCount,'written-manifest-asset-count-mismatch');
    result.after={releaseId:releaseId(after),buildSha256:after.buildSha256,manifestSha256:sha(afterBytes),fileCount:Object.keys(after.files).length,assetCount:Object.keys(after.assets).length};
    stage('verify-all-local-files');
    let verified=0;for(const [name,expected]of Object.entries(after.files)){
      if(abort.signal.aborted)throw Error('probe-interrupted');
      const file=path.join(root,name);await physicalPath(runtime,file);requireThat(await hashFile(file)===expected,'updated-local-file-hash-mismatch');verified++;
    }
    result.checks.completeLocalFiles={verified,assetCount:expectedAssetCount,manifestMatched:true};
    stage('restart-updated-cli');
    const second=await start();base='http://127.0.0.1:'+second.port;result.updatedClientPort=second.port;
    await withTimeout(new Promise((resolve,reject)=>{
      let pending='';const ready=chunk=>{pending=(pending+chunk.toString()).slice(-8192);if(pending.split(/\r?\n/).some(line=>line.trimEnd().endsWith(base))){second.child.process.stdout.off('data',ready);resolve();}};
      second.child.process.stdout.on('data',ready);second.child.done.then(()=>{second.child.process.stdout.off('data',ready);reject(Error('updated-cli-exited-before-ready'));});
    }),180000,abort.signal,'updated-client-start-timeout');
    requireThat(!second.child.closed,'updated-client-not-running');
    const local=await api('/api/local-client');requireThat(local.status===200&&local.value.localResourceClient===true&&local.value.buildSha256===target.buildSha256&&local.value.assetCount===expectedAssetCount,'updated-local-identity-mismatch');
    result.checks.localClient={status:local.status,buildSha256:local.value.buildSha256,assetCount:local.value.assetCount};
    stage('ordinary-player-login');
    const login=await api('/api/login',{method:'POST',body:{username:credential.username,password:credential.password}});
    requireThat(login.status===200,'ordinary-player-login-failed');cookie=login.headers.getSetCookie().find(value=>value.startsWith('rf_session='))?.split(';')[0];
    requireThat(/^rf_session=[A-Za-z0-9_-]+$/.test(cookie??''),'session-cookie-missing');secrets.push(cookie,cookie.slice('rf_session='.length));
    const session=await api('/api/session');requireThat(session.status===200&&session.value.role==='player'&&session.value.buildVersion===target.buildSha256&&session.value.localResourceClient===true,'ordinary-session-build-mismatch');
    result.checks.session={loginStatus:login.status,status:session.status,role:session.value.role,buildVersion:session.value.buildVersion,localResourceClient:session.value.localResourceClient};
    stage('authenticated-inventory-and-served-bytes');
    const inventory=await api('/api/asset-versions');requireThat(inventory.status===200&&inventory.value.schemaVersion===1,'asset-inventory-http-failed');
    result.checks.inventory={status:inventory.status,...verifyInventory(inventory.value.files,after.assets,expectedAssetCount)};
    const program=await request(base,'/game/game.js?v='+after.buildSha256,{limit:64*1024*1024}),programSha=sha(program.bytes);
    requireThat(program.status===200&&programSha===after.files['dist/game.js']&&programSha===target.buildSha256,'served-game-program-hash-mismatch');
    const nativeExpected=after.assets['native/manifest.json'];requireThat(digest(nativeExpected),'native-manifest-not-sealed');
    const native=await request(base,'/assets/native/manifest.json?v='+nativeExpected,{limit:4*1024*1024}),nativeSha=sha(native.bytes);
    requireThat(native.status===200&&nativeSha===nativeExpected,'served-local-native-manifest-hash-mismatch');
    result.checks.program={status:program.status,bytes:program.bytes.length,sha256:programSha};result.checks.nativeManifest={status:native.status,bytes:native.bytes.length,sha256:nativeSha};
    const current=await api('/api/client-update');requireThat(current.status===200&&current.value.limitBytes===UPDATE_LIMIT&&current.value.releaseId===target.releaseId&&current.value.buildSha256===target.buildSha256,'public-current-release-mismatch');
    result.checks.current={status:current.status,limitBytes:current.value.limitBytes,releaseId:current.value.releaseId,buildSha256:current.value.buildSha256};
    stage('logout');logoutAttempted=true;const logout=await api('/api/logout',{method:'POST',body:{}});
    requireThat(logout.status===200,'ordinary-logout-failed');cookie=null;result.checks.logout={status:logout.status};result.success=true;stage('passed');
  }catch(error){result.success=false;result.failure={stage:result.stage,message:redact(error.message,secrets)};}
  finally{
    // A failed assertion after login still invalidates the session before only
    // these spawned child handles are stopped. No PID scanning/taskkill.
    if(cookie&&base){try{const response=await request(base,'/api/logout',{method:'POST',body:{},cleanup:true,timeout:10000});result.cleanup.logoutStatus=response.status;if(response.status!==200)result.success=false;}catch{result.cleanup.logoutFailed=true;result.success=false;}cookie=null;}
    result.cleanup.logoutAttempted=logoutAttempted||result.cleanup.logoutStatus!==undefined||result.cleanup.logoutFailed===true;
    result.cleanup.children=[];for(const child of children){try{result.cleanup.children.push(await stopOwned(child));}catch{result.cleanup.children.push({error:'owned-child-close-failed'});result.success=false;}}
    result.completedAt=new Date().toISOString();process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
    const safeLog=redact(logs.join(''),secrets);result.log={capturedBytes:logBytes,truncated:result.logTruncated===true,sha256:sha(Buffer.from(safeLog))};delete result.logTruncated;
    await writeFile(output+'.log',safeLog);await writeFile(output+'.json',JSON.stringify(result,null,2)+'\n');
  }
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [oldRoot,targetPointer,credentialFile,outputBase,expectedOldBuild,countArgument,...extra]=process.argv.slice(2);
  try{requireThat(extra.length===0,'exactly-six-arguments-required');const expectedAssetCount=parseExpectedAssetCount(countArgument);const result=await runOldClientUpdateProbe({oldRoot,targetPointer,credentialFile,outputBase,expectedOldBuild,expectedAssetCount});console.log(JSON.stringify(result));if(!result.success)process.exitCode=1;}
  catch{console.error(JSON.stringify({schemaVersion:1,success:false,error:'probe-arguments-or-output-preflight-failed',usage:'OLD_ROOT TARGET_POINTER CREDENTIAL_FILE OUTPUT_BASE EXPECTED_OLD_BUILD EXPECTED_ASSET_COUNT; count must come from the independently sealed manifest; copy and output must be physical task runtime paths'}));process.exitCode=1;}
}

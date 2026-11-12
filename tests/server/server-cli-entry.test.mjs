import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,symlink,unlink,lstat,realpath,rm,writeFile,access} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repository=fileURLToPath(new URL('../../',import.meta.url));
async function fixture(t){
  const temporary=await mkdtemp(path.join(os.tmpdir(),'rf-cli-entry-')),alias=path.join(temporary,'current');
  let child;
  t.after(async()=>{
    if(child&&child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill();await closed;}
    // Unlink the release alias first. Recursive removal must never encounter a
    // junction pointing at the real checkout or any production account data.
    assert.equal(path.dirname(path.resolve(alias)),path.resolve(temporary));
    const info=await lstat(alias).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(info){assert.equal(info.isSymbolicLink(),true);await unlink(alias);}
    await assert.rejects(lstat(alias),error=>error.code==='ENOENT');
    assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('rf-cli-entry-'));
    assert.equal((await lstat(temporary)).isSymbolicLink(),false);
    const source=await realpath(repository),target=await realpath(temporary);
    assert.notEqual(target,source);assert.ok(!source.startsWith(target+path.sep));
    await rm(target,{recursive:true,force:true});
  });
  await symlink(repository,alias,process.platform==='win32'?'junction':'dir');
  const env=accountRoot=>({...process.env,RF_ACCOUNT_ROOT:accountRoot,RF_ASSET_ROOT:path.join(temporary,'absent-assets'),
    RF_PUBLIC_ORIGIN:'',RF_ONLINE_EVENT_TRANSPORT:'sse',RF_RTC_ICE_SERVERS:'[]',RF_TRUST_LOOPBACK_PROXY:'0'});
  return {temporary,alias,entry:path.join(alias,'apps/server/dev-server.mjs'),env,
    launch(args,extraEnv={}){child=spawn(process.execPath,args,{cwd:temporary,env:{...env(path.join(temporary,'accounts')),...extraEnv},stdio:['ignore','pipe','pipe']});return child;}};
}
async function freePort(){
  const server=http.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
function get(url){return new Promise((resolve,reject)=>{const request=http.get(url,response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks).toString('utf8')}));});request.on('error',reject);request.setTimeout(2000,()=>request.destroy(Error('HTTP smoke timeout')));});}

test('CLI runs through a current release junction and actually serves the login page', {timeout:15000},async t=>{
  const f=await fixture(t),port=await freePort(),child=f.launch([f.entry],{RF_PORT:String(port)});
  let output='';child.stderr.on('data',chunk=>{output+=chunk.toString();});
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill();reject(Error('CLI did not start listening: '+output));},10000);
    const ended=(code,signal)=>{clearTimeout(timeout);reject(Error('CLI exited before listening ('+code+', '+signal+'): '+output));};
    child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',ended);
    child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('web pvp listening on 127.0.0.1 port '+port)){clearTimeout(timeout);child.removeListener('exit',ended);resolve();}});
  });
  const response=await get('http://127.0.0.1:'+port+'/');assert.equal(response.status,200);
  assert.match(response.body,/id="login-form"/);assert.match(response.body,/1v1 \/ 2v2 \/ 3v3/);
  assert.equal(await realpath(f.entry),await realpath(path.join(repository,'apps/server/dev-server.mjs')));
  await access(path.join(f.temporary,'accounts','account-roles.json'));
});

test('importing the aliased server module exports its factory without starting CLI or creating accounts', {timeout:10000},async t=>{
  const f=await fixture(t),script=path.join(f.temporary,'import-smoke.mjs'),accountRoot=path.join(f.temporary,'import-accounts');
  await writeFile(script,`import {createDevServer} from ${JSON.stringify(pathToFileURL(f.entry).href)};\nif(typeof createDevServer!=='function')throw Error('missing server factory');\nconsole.log('import-only-ok');\n`);
  const child=f.launch([script],{RF_ACCOUNT_ROOT:accountRoot,RF_PORT:String(await freePort())});let output='';
  child.stdout.on('data',chunk=>{output+=chunk.toString();});child.stderr.on('data',chunk=>{output+=chunk.toString();});
  const [code]=await once(child,'exit');assert.equal(code,0,output);assert.equal(output.trim(),'import-only-ok');
  await assert.rejects(access(accountRoot),error=>error.code==='ENOENT');
});

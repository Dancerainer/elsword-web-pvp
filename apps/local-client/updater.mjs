import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {resolveServerOrigin} from './server-config.mjs';
import {sha,digest,clientFile,validateManifest,UPDATE_LIMIT,UPDATE_LIMIT_MB} from './update-contract.mjs';

const WORK='.client-update';
async function exists(file){try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function destination(root,name){
  if(!clientFile(name))throw Error('unsafe-update-path');
  let current=root;
  for(const part of name.split('/')){
    current=path.join(current,part);
    try{if((await fs.lstat(current)).isSymbolicLink())throw Error('linked-update-path');}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return current;
}
const manifestId=manifest=>sha(Buffer.from(JSON.stringify(manifest)));
async function clean(root){await fs.rm(path.join(root,WORK),{recursive:true,force:true});}
async function readManifest(root){return validateManifest(JSON.parse((await fs.readFile(path.join(root,'client-manifest.json'),'utf8')).replace(/^\uFEFF/,'')));}

/** Write-ahead journal: either the old complete manifest or the new complete
 * manifest survives an interruption. No old files are removed on successful updates. */
export async function recoverClientUpdate(root){
  const work=path.join(root,WORK),journalFile=path.join(work,'journal.json');
  if(!await exists(work))return false;
  if((await fs.lstat(work)).isSymbolicLink())throw Error('linked-update-workspace');
  if(!await exists(journalFile)){await clean(root);return true;}
  const journal=JSON.parse(await fs.readFile(journalFile,'utf8'));
  if(!digest(journal.targetId)||!Array.isArray(journal.files)||journal.files.some(row=>!clientFile(row.file)||typeof row.existed!=='boolean'))throw Error('invalid-update-journal');
  const current=await readManifest(root);
  if(manifestId(current)===journal.targetId){
    for(const [name,hash]of Object.entries(current.files))if(sha(await fs.readFile(await destination(root,name)))!==hash)throw Error('committed-update-corrupt');
  }else{
    for(const row of [...journal.files].reverse()){
      const file=await destination(root,row.file),backup=path.join(work,'backup',row.file);
      if(await exists(backup)){await fs.rm(file,{force:true});await fs.rename(backup,file);}
      else if(!row.existed)await fs.rm(file,{force:true});
    }
    const backup=path.join(work,'manifest.before');
    if(await exists(backup))await fs.copyFile(backup,path.join(root,'client-manifest.json'));
  }
  await clean(root);return true;
}

async function install(root,plan,download,{beforeCommit=()=>{},afterReplace=()=>{}}={}){
  const work=path.join(root,WORK),staged=path.join(work,'staged');
  await fs.mkdir(staged,{recursive:true});
  const journal={targetId:plan.releaseId,files:[]};
  try{
    const changed=new Set(plan.changed.map(row=>row.file));
    for(const [name,hash]of Object.entries(plan.manifest.files)){
      const target=await destination(root,name);
      if(!changed.has(name)){
        if(sha(await fs.readFile(target))!==hash)throw Error('unchanged-local-file-corrupt');
        continue;
      }
      const row=plan.changed.find(row=>row.file===name);
      const encoded=await download(row);
      if(encoded.length!==row.gzipBytes||sha(encoded)!==row.gzipSha256)throw Error('download-hash-mismatch');
      const bytes=gunzipSync(encoded,{maxOutputLength:Math.max(1,row.bytes)});
      if(bytes.length!==row.bytes||sha(bytes)!==hash)throw Error('decoded-update-hash-mismatch');
      const file=path.join(staged,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes,{flag:'wx'});
    }
    await beforeCommit();
    await fs.copyFile(path.join(root,'client-manifest.json'),path.join(work,'manifest.before'));
    for(const row of plan.changed){
      const file=await destination(root,row.file),backup=path.join(work,'backup',row.file),hadFile=await exists(file);
      journal.files.push({file:row.file,existed:hadFile});
      // Replace the journal itself atomically before touching this target.
      const next=path.join(work,'journal.next');await fs.writeFile(next,JSON.stringify(journal));await fs.rename(next,path.join(work,'journal.json'));
      await fs.mkdir(path.dirname(file),{recursive:true});
      if(hadFile){await fs.mkdir(path.dirname(backup),{recursive:true});await fs.rename(file,backup);}
      await fs.rename(path.join(staged,row.file),file);await afterReplace(row.file);
    }
    await fs.writeFile(path.join(work,'manifest.next'),JSON.stringify(plan.manifest,null,2)+'\n');
    await fs.rename(path.join(work,'manifest.next'),path.join(root,'client-manifest.json'));
    await clean(root);
  }catch(error){await recoverClientUpdate(root);throw error;}
}

export function updateRequest(origin,endpoint,{body,limit=2*1024*1024}={}){
  const url=new URL(endpoint,origin);
  if(url.origin!==origin)throw Error('update-origin-changed');
  return new Promise((resolve,reject)=>{
    const bytes=body?Buffer.from(JSON.stringify(body)):null;
    const request=(url.protocol==='https:'?https:http).request(url,{method:bytes?'POST':'GET',headers:{'Accept-Encoding':'identity',...(bytes?{Origin:origin,'Content-Type':'application/json','Content-Length':bytes.length}:{})}},response=>{
      if(response.statusCode!==200){response.destroy();return resolve({status:response.statusCode,bytes:Buffer.alloc(0)});}
      let size=0,chunks=[];
      response.on('data',chunk=>{size+=chunk.length;if(size>limit){response.destroy(Error('update-transfer-too-large'));return;}chunks.push(chunk);});
      response.on('error',reject);response.on('end',()=>resolve({status:response.statusCode,bytes:Buffer.concat(chunks)}));
    });
    // Battle priority can deliberately pause a file's body. Its bytes cannot
    // contain keepalive padding because the gzip hash is immutable.
    request.setTimeout(['/api/client-update/file','/api/client-update/plan'].includes(url.pathname)?900_000:30_000,()=>request.destroy(Error('update-timeout')));request.on('error',reject);request.end(bytes);
  });
}

async function updateLocked({root,remoteOrigin,configPath=path.join(root,'server-config.json'),request=updateRequest,log=console.log,hooks}={}){
  await recoverClientUpdate(root);
  const before=await readManifest(root),baseId=manifestId(before);
  const origin=await resolveServerOrigin({remoteOrigin,configPath,manifest:before});
  const response=await request(origin,'/api/client-update/plan',{body:{baseReleaseId:baseId}});
  if(response.status===404||response.status===503||response.status===502)return {status:'unavailable'};
  if(response.status!==200)throw Error('update-check-failed');
  const plan=JSON.parse(response.bytes);
  if(['current','unavailable','full-client-required'].includes(plan.status))return plan;
  validateManifest(plan.manifest);
  if(plan.status!=='update-available'||plan.manifest.remoteOrigin!==before.remoteOrigin||!digest(plan.releaseId)||manifestId(plan.manifest)!==plan.releaseId||!Array.isArray(plan.changed))throw Error('invalid-update-plan');
  const required=Object.keys(plan.manifest.files).filter(name=>before.files[name]!==plan.manifest.files[name]);
  if(plan.changed.length!==required.length||new Set(plan.changed.map(row=>row.file)).size!==required.length)throw Error('incomplete-update-plan');
  let bytes=response.bytes.length;
  for(const row of plan.changed){
    if(!required.includes(row.file)||row.file==='runtime/node.exe'||row.sha256!==plan.manifest.files[row.file]||!digest(row.gzipSha256)
      ||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>256*1024*1024||!Number.isSafeInteger(row.gzipBytes)||row.gzipBytes<=0)throw Error('invalid-update-file');
    bytes+=row.gzipBytes;
  }
  // Both sides enforce the complete difference, including metadata, before a byte
  // of file payload is downloaded. A forged partial plan never bypasses the cap.
  if(bytes>UPDATE_LIMIT)return {status:'full-client-required',reason:'over-limit',bytes,limitBytes:UPDATE_LIMIT};
  if(bytes!==plan.bytes)throw Error('update-size-mismatch');
  log('Downloading a client update of about '+(bytes/1_000_000).toFixed(2)+' MB (limit '+UPDATE_LIMIT_MB+' MB). Active matches take priority. Downloads may pause while the server is busy.');
  await install(root,plan,async row=>{
    const query=new URLSearchParams({base:baseId,release:plan.releaseId,file:row.file});
    const result=await request(origin,'/api/client-update/file?'+query,{limit:row.gzipBytes});
    if(result.status!==200)throw Error('update-release-changed');
    return result.bytes;
  },hooks);
  return {status:'updated',bytes,files:required.length,releaseId:plan.releaseId};
}

export async function updateLocalClient(options){
  const file=path.join(options.root,'.client-update.lock');
  if(await exists(file)){
    if((await fs.lstat(file)).isSymbolicLink())throw Error('linked-update-lock');
    const owner=JSON.parse(await fs.readFile(file,'utf8'));
    if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw Error('invalid-update-lock');
    try{process.kill(owner.pid,0);throw Error('client-already-updating');}
    catch(error){if(error.code!=='ESRCH')throw error;}
    await fs.unlink(file);
  }
  const handle=await fs.open(file,'wx');
  try{await handle.writeFile(JSON.stringify({pid:process.pid}));await handle.close();return await updateLocked(options);}
  finally{await handle.close().catch(()=>{});await fs.unlink(file);}
}

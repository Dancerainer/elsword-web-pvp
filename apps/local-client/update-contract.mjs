import {createHash} from 'node:crypto';

export const UPDATE_LIMIT=100_000_000;
export const UPDATE_LIMIT_MB=UPDATE_LIMIT/1_000_000;
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const safeFile=name=>typeof name==='string'&&name.length<500&&!/[\\:\0<>"|?*]/.test(name)
  &&name.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[ .]$/.test(part)&&! /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
export const clientFile=name=>safeFile(name)&&(/^(assets|dist)\//.test(name)||/^(apps\/web|apps\/local-client|apps\/server)\/[A-Za-z0-9_-]+\.mjs$/.test(name)
  ||['apps/web/index.html','apps/web/login.css','runtime/node.exe','Start-Client.bat','Open-Client.ps1','NODE-LICENSE.txt','PLAYER-GUIDE.txt'].includes(name));
export function validateManifest(value){
  if(value?.schemaVersion!==1||!digest(value.buildSha256)||!value.files||!value.assets
    ||Array.isArray(value.files)||Array.isArray(value.assets)||Object.keys(value.files).length>20000)throw Error('invalid-update-manifest');
  for(const [file,hash]of Object.entries(value.files))if(!clientFile(file)||!digest(hash))throw Error('invalid-update-file');
  for(const [file,hash]of Object.entries(value.assets))if(!safeFile(file)||value.files['assets/'+file]!==hash)throw Error('invalid-update-asset');
  if(value.files['dist/game.js']!==value.buildSha256)throw Error('invalid-update-build');
  if(value.remoteOrigin !== undefined) {
    const origin=new URL(value.remoteOrigin);
    if(!['http:','https:'].includes(origin.protocol)||origin.origin!==value.remoteOrigin)throw Error('invalid-update-origin');
  }
  return value;
}
export function updatePlan(base,catalog){
  validateManifest(base);validateManifest(catalog.manifest);
  if(base.remoteOrigin!==catalog.manifest.remoteOrigin)throw Error('update-origin-changed');
  const changed=Object.entries(catalog.manifest.files).filter(([file,hash])=>base.files[file]!==hash).map(([file])=>file);
  let payloadBytes=0;
  for(const file of changed){
    const row=catalog.transport?.[file];
    if(file==='runtime/node.exe'||!row||!digest(row.gzipSha256)||!Number.isSafeInteger(row.gzipBytes)||row.gzipBytes<=0
      ||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>256*1024*1024)return {status:'full-client-required',reason:'unsupported-base',limitBytes:UPDATE_LIMIT};
    payloadBytes+=row.gzipBytes;
  }
  const plan={status:'update-available',releaseId:catalog.releaseId,manifest:catalog.manifest,
    changed:changed.map(file=>({file,sha256:catalog.manifest.files[file],...catalog.transport[file]})),bytes:Number.MAX_SAFE_INTEGER,limitBytes:UPDATE_LIMIT};
  // Count the entire JSON response, including per-file transport metadata and
  // the byte count's own digits, as well as all compressed file payloads.
  // Converge downward from a conservative digit count so a decimal boundary
  // (100,000,000) does not oscillate during exact-limit admission checks.
  for(let i=0;i<8;i++){
    const next=payloadBytes+Buffer.byteLength(JSON.stringify(plan));
    if(next===plan.bytes)break;plan.bytes=next;
  }
  if(!Number.isSafeInteger(plan.bytes)||plan.bytes>UPDATE_LIMIT)return {status:'full-client-required',reason:'over-limit',bytes:plan.bytes,limitBytes:UPDATE_LIMIT};
  return plan;
}

/** Opt-in diagnostic peer binding. Does not change OS routes or other processes. */
import http from 'node:http';
import https from 'node:https';
import {isIP} from 'node:net';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
export async function sealDispatcher(modulePath){
 const root=path.dirname(modulePath),files={};
 async function visit(dir){for(const row of (await readdir(path.join(root,dir),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  if(row.isSymbolicLink())throw Error('Linked diagnostic dispatcher dependency');
  const relative=dir?dir+'/'+row.name:row.name;
  if(row.isDirectory())await visit(relative);else if(row.isFile())files[relative]=createHash('sha256').update(await readFile(path.join(root,relative))).digest('hex');
 }}
 await visit('');return {files: Object.keys(files).length,sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex'),
  version:JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version};
}
if(process.env.RF_DIAGNOSTIC_LOCAL_ADDRESS){
 const address=process.env.RF_DIAGNOSTIC_LOCAL_ADDRESS,modulePath=process.env.RF_DIAGNOSTIC_UNDICI_MODULE;
 if(!isIP(address)||!path.isAbsolute(modulePath??''))throw Error('Explicit diagnostic source IP and installed dispatcher path required');
 const require=createRequire(pathToFileURL(modulePath)),{Agent}=require(modulePath),dispatcher=new Agent({localAddress:address}),nativeFetch=globalThis.fetch;
 globalThis.fetch=(url,options={})=>nativeFetch(url,{...options,dispatcher});
 http.globalAgent.options.localAddress=address;https.globalAgent.options.localAddress=address;
}

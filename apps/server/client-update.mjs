import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {digest,sha,updatePlan,UPDATE_LIMIT,validateManifest} from '../local-client/update-contract.mjs';
import {createUpdateBandwidth} from './update-bandwidth.mjs';

/** Separate, sealed small updates. The normal /assets download switch still applies. */
export function createClientUpdateDelivery({root,buildVersion,bandwidth=createUpdateBandwidth()}){
  let loaded;
  async function current(){
    if(!root)return null;
    // A same-browser-build release can change client resources or guides. Read
    // the small atomic pointer on every check; only its immutable catalog is cached.
    let pointer;try{pointer=JSON.parse(await readFile(path.join(root,'current.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(!digest(pointer.releaseId)||pointer.buildSha256!==buildVersion)return null;
    const key=pointer.releaseId+':'+pointer.buildSha256;
    if(loaded?.key!==key){
      const entry={key,promise:null};
      entry.promise=(async()=>{
        const value=JSON.parse(await readFile(path.join(root,pointer.releaseId,'catalog.json'),'utf8'));
        validateManifest(value.manifest);
        if(value.releaseId!==pointer.releaseId||sha(Buffer.from(JSON.stringify(value.manifest)))!==value.releaseId
          ||value.manifest.buildSha256!==buildVersion)throw Error('client-update-catalog-mismatch');
        return value;
      })();loaded=entry;
    }
    const entry=loaded;
    // Missing/mismatched pointers return uncached above. A failing catalog
    // must not discard a replacement entry installed by another request.
    try{
      return await entry.promise;
    }catch(error){if(loaded===entry)loaded=undefined;throw error;}
  }
  const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  async function plan(baseId,target){
    if(target===undefined)target=await current();if(!target)return {status:'unavailable',limitBytes:UPDATE_LIMIT};
    if(!digest(baseId))return {status:'full-client-required',reason:'unknown-base',limitBytes:UPDATE_LIMIT};
    let base;try{base=JSON.parse(await readFile(path.join(root,baseId,'catalog.json'),'utf8')).manifest;}catch(error){if(error.code==='ENOENT')return {status:'full-client-required',reason:'unknown-base',limitBytes:UPDATE_LIMIT};throw error;}
    if(sha(Buffer.from(JSON.stringify(base)))!==baseId)throw Error('client-update-base-mismatch');
    if(baseId===target.releaseId)return {status:'current',releaseId:baseId,limitBytes:UPDATE_LIMIT};
    return updatePlan(base,target);
  }
  return {async handle(req,res,url){
    if(!url.pathname.startsWith('/api/client-update'))return false;
    try{
      if(req.method==='GET'&&url.pathname==='/api/client-update'){
        const value=await current();send(res,value?200:404,value?{releaseId:value.releaseId,buildSha256:buildVersion,limitBytes:UPDATE_LIMIT}:{status:'unavailable'});return true;
      }
      if(req.method==='POST'&&url.pathname==='/api/client-update/plan'){
        let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>256)throw Error('update-plan-too-large');chunks.push(chunk);}
        const body=JSON.parse(Buffer.concat(chunks));if(!body||Object.keys(body).length!==1||!digest(body.baseReleaseId))throw Error('invalid-update-base');
        const value=await plan(body.baseReleaseId);
        if(value.status!=='update-available'){send(res,200,value);return true;}
        // The complete manifest can itself be hundreds of KB. It uses the same
        // best-effort budget as file payloads, rather than bypassing battle priority.
        const bytes=Buffer.from(JSON.stringify(value)),release=bandwidth.reserve(bytes.length);
        if(!release){res.setHeader('Retry-After','5');send(res,503,{error:'update-download-busy'});return true;}
        try{if(!res.destroyed){res.writeHead(200,{'Content-Type':'application/json','Content-Length':bytes.length,'Cache-Control':'no-store','X-Accel-Buffering':'no'});
          res.flushHeaders();await bandwidth.send(res,bytes,release);}}finally{release();}return true;
      }
      if(req.method==='GET'&&url.pathname==='/api/client-update/file'){
        const target=await current(),value=await plan(url.searchParams.get('base'),target);
        if(value.status!=='update-available'||url.searchParams.get('release')!==target.releaseId){send(res,409,{error:'update-not-allowed',...value,manifest:undefined,changed:undefined});return true;}
        const row=value.changed.find(row=>row.file===url.searchParams.get('file'));
        if(!row){send(res,404,{error:'update-file-not-in-plan'});return true;}
        // Reserve before reading so disconnected/concurrent clients cannot grow
        // an unbounded queue of whole, verified update blobs in server memory.
        const release=bandwidth.reserve(row.gzipBytes);
        if(!release){res.setHeader('Retry-After','5');send(res,503,{error:'update-download-busy'});return true;}
        try{
        const file=path.join(root,target.releaseId,'blobs',row.gzipSha256+'.gz');
        // Publication verifies every blob. Serve the immutable gzip bytes rather than
        // recompressing with another zlib version or ever exposing a filesystem path.
        const bytes=await readFile(file);if(bytes.length!==row.gzipBytes||sha(bytes)!==row.gzipSha256)throw Error('update-blob-corrupt');
        if(res.destroyed)return true;
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-store','X-Accel-Buffering':'no'});
        res.flushHeaders();await bandwidth.send(res,bytes,release);return true;
        }finally{release();}
      }
      send(res,405,{error:'method-not-allowed'});return true;
    }catch(error){if(res.headersSent){if(!res.destroyed)res.destroy();}else if(!res.destroyed)send(res,error.message.startsWith('invalid-')||error.message==='update-plan-too-large'?400:503,{error:'client-update-unavailable'});return true;}
  },close:()=>bandwidth.close()};
}

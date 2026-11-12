import {readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {staticResourceRevision} from './static-resource-cache.mjs';
const extension=/\.(?:json|json\.gz|glb|wasm|png|jpg|jpeg|webp|ogg|wav|mp3|ttf)$/i;
const proof=/^(?:source|sources|proof|proofs|evidence|receipt|receipts|contracts|superseded|generated)(?:$|[-_])/i;

/** Keep only bounded revision/digest strings outside the HTTP response LRU.
 * Every request still walks/stats files, including mutable development assets. */
export function createAssetVersionInventory(root,cache,{digestCacheLimit=16_384}={}){
  if(!Number.isSafeInteger(digestCacheLimit)||digestCacheLimit<0||digestCacheLimit>16_384)throw new RangeError('Invalid inventory digest cache limit');
  let pending=null,digests=new Map();
  return async()=>{
    if(pending)return pending;
    pending=(async()=>{
      const files=Object.create(null),nextDigests=new Map();
      async function walk(relative=''){
        let entries;try{entries=await readdir(path.join(root,relative),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
        for(const entry of entries){
          if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
          const name=(relative?relative+'/':'')+entry.name;
          if(entry.isDirectory()){if(!proof.test(entry.name))await walk(name);}
          else if(entry.isFile()&&extension.test(entry.name)){
            const filename=path.join(root,name),file=await stat(filename),signature=staticResourceRevision(file),previous=digests.get(name);
            let digest;
            if(previous?.signature===signature)digest=previous.digest;
            else {
              const record=cache.record(filename,file);
              await cache.etag(record,false);digest=await record.digest;
            }
            files[name]=digest;
            if(nextDigests.size<digestCacheLimit)nextDigests.set(name,{signature,digest});
          }
        }
      }
      // Publish cache changes only after a complete walk. Failed reads cannot
      // retain a partial generation; replacing the Map drops deleted paths.
      await walk();digests=nextDigests;return {schemaVersion:1,files};
    })().finally(()=>{pending=null;});return pending;
  };
}

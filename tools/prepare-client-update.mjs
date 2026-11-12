/** Seal bounded update blobs separately from game assets and account data. */
import path from 'node:path';
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyClientFiles} from '../apps/local-client/client.mjs';
import {validateManifest,sha,updatePlan} from '../apps/local-client/update-contract.mjs';

export async function prepareClientUpdate({clientRoot,outputRoot,baseFiles=[]}){
  const manifest=validateManifest(JSON.parse(await readFile(path.join(clientRoot,'client-manifest.json'),'utf8')));
  await verifyClientFiles(clientRoot,manifest);
  const bases=[];
  for(const file of baseFiles){const value=JSON.parse(await readFile(file,'utf8'));bases.push(validateManifest(value.manifest??value));}
  const releaseId=sha(Buffer.from(JSON.stringify(manifest))),folder=path.join(outputRoot,releaseId),transport={};
  await mkdir(folder,{recursive:true});await mkdir(path.join(folder,'blobs'),{recursive:true});
  for(const [file,hash]of Object.entries(manifest.files)){
    // No runtime replacement while its executable is running. A new runtime
    // requires a full package. Without a supported base, never stage all assets.
    if(file==='runtime/node.exe'||file.startsWith('assets/')&&!bases.some(base=>base.files[file]!==hash))continue;
    const target=path.join(clientRoot,file);if((await lstat(target)).isSymbolicLink())throw Error('linked-update-source');
    const bytes=await readFile(target);if(sha(bytes)!==hash)throw Error('update-source-changed');
    const compressed=gzipSync(bytes,{level:6}),gzipSha256=sha(compressed);
    transport[file]={bytes:bytes.length,gzipBytes:compressed.length,gzipSha256};
    await writeFile(path.join(folder,'blobs',gzipSha256+'.gz'),compressed);
  }
  const catalog={schemaVersion:1,releaseId,manifest,transport};
  await writeFile(path.join(folder,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
  for(const base of bases){
    const id=sha(Buffer.from(JSON.stringify(base)));if(id===releaseId)continue;
    await mkdir(path.join(outputRoot,id),{recursive:true});
    await writeFile(path.join(outputRoot,id,'catalog.json'),JSON.stringify({schemaVersion:1,releaseId:id,manifest:base})+'\n');
  }
  await writeFile(path.join(outputRoot,'current.json'),JSON.stringify({releaseId,buildSha256:manifest.buildSha256})+'\n');
  return {releaseId,buildSha256:manifest.buildSha256,blobs:Object.keys(transport).length,
    blobBytes:Object.values(transport).reduce((sum,row)=>sum+row.gzipBytes,0),bases:bases.map(base=>({baseBuildSha256:base.buildSha256,...updatePlan(base,catalog),manifest:undefined,changed:undefined}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [clientRoot,outputRoot,...baseFiles]=process.argv.slice(2);if(!clientRoot||!outputRoot)throw Error('Client root and task-local output root required');
  console.log(JSON.stringify(await prepareClientUpdate({clientRoot,outputRoot,baseFiles})));
}

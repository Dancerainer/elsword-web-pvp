import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
const raw=process.argv[2]??'asset_work/raw';
const manifest={schemaVersion:1,files:{}},files=[];
for(const name of ['Fight.ogg','Revival.ogg','Win.ogg','Lose.ogg']){
  const file='data/data070.kom/'+name,bytes=await readFile(path.join(raw,file)),sha256=createHash('sha256').update(bytes).digest('hex');
  await mkdir(path.join(root,'artifacts/audio/pvp'),{recursive:true});
  await copyFile(path.join(raw,file),path.join(root,'artifacts/audio/pvp',name));
  // Original Vorbis sample rate and final Ogg granule give decoded duration.
  const identification=bytes.indexOf(Buffer.from([1,...Buffer.from('vorbis')]));
  if(identification<0)throw Error('Missing Vorbis identification: '+name);
  const sampleRate=bytes.readUInt32LE(identification+12);let samples=0n;
  for(let offset=0;offset<bytes.length;){
    if(bytes.toString('ascii',offset,offset+4)!=='OggS')throw Error('Invalid Ogg page: '+name);
    const granule=bytes.readBigUInt64LE(offset+6),segments=bytes[offset+26];
    if(granule!==0xffffffffffffffffn)samples=granule;
    let size=27+segments;for(let i=0;i<segments;i++)size+=bytes[offset+27+i];offset+=size;
  }
  const durationSeconds=Number(samples)/sampleRate;
  if(!(durationSeconds>0&&Number.isFinite(durationSeconds)))throw Error('Invalid Vorbis duration: '+name);
  manifest.files[name]={file:'pvp/'+name,sha256,bytes:bytes.length,source:file,durationSeconds};files.push({source:file,output:'artifacts/audio/pvp/'+name,sha256,bytes:bytes.length,durationSeconds});
}
await writeFile(path.join(root,'artifacts/audio/pvp/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(path.join(root,'contracts/rf-pvp-audio-assets-v1.json'),JSON.stringify({schemaVersion:1,evidenceClass:'target2016-original-resource',originalClientMeasured:false,files},null,2)+'\n');
console.log(JSON.stringify({files:files.length}));

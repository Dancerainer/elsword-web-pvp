/** Copy verified generated inputs into this task; never write to the source. */
import {cp, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const input = process.argv.slice(2).find(arg=>!arg.startsWith('--'));
if (!input) throw Error('Supply a read-only project directory containing prepared artifacts.');
const source = path.resolve(input);
const refresh=process.argv.includes('--refresh');
if(path.resolve(root)===source)throw Error('Separate read-only asset source required');
const records=[];
async function copyTree(relative){
  const from=path.join(source,'artifacts',relative),to=path.join(root,'artifacts',relative);
  await mkdir(to,{recursive:true});
  for(const item of await readdir(from,{withFileTypes:true})){
    const file=path.posix.join(relative,item.name);
    if(item.isDirectory())await copyTree(file);
    else if(item.isFile()){
      const bytes=await readFile(path.join(from,item.name));
      // Default preserves task-specific closures. After a verified source update,
      // refresh replaces only matching files; additional local overlays survive.
      await cp(path.join(from,item.name),path.join(to,item.name),{force:refresh,errorOnExist:false});
      const output=await readFile(path.join(to,item.name));
      records.push({file,bytes:output.length,sha256:createHash('sha256').update(output).digest('hex'),
        matchesInput:bytes.equals(output)});
    }
  }
}
for(const folder of ['native','rf','scene','ui','audio'])await copyTree(folder);
for(const folder of ['native-d3dx','lk','vc','rs','bm','is','gm','bh','ca','lp','mm','de','common','common-buffs','battle-life','cast-display','costumes','map-mechanics']){
  try{await copyTree(folder);}catch(error){if(error.code!=='ENOENT')throw error;}
}
await mkdir(path.join(root,'runtime'),{recursive:true});
await writeFile(path.join(root,'runtime/online-inputs.json'),JSON.stringify({schemaVersion:1,sourceReadOnly:true,source,refresh,files:records},null,2)+'\n');
console.log(JSON.stringify({files:records.length,bytes:records.reduce((n,r)=>n+r.bytes,0),sourceReadOnly:true,refresh}));

/** Resolve generated VC runtime references to exact directory-entry casing.
 * Windows may read an incorrectly cased reference that Linux correctly rejects.
 * Only existing generated files are referenced; source names/hashes stay intact.
 */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export async function normalizeVcPathCase(root){
  const assetRoot=path.join(root,'artifacts'),names=[];
  async function walk(relative){for(const entry of await readdir(path.join(assetRoot,relative),{withFileTypes:true})){
    const name=path.posix.join(relative,entry.name);
    if(entry.isDirectory())await walk(name);else if(entry.isFile())names.push(name);
  }}
  await walk('');const actual=new Map();
  for(const name of names){const key=name.toLowerCase();if(actual.has(key)&&actual.get(key)!==name)throw Error('Ambiguous asset casing: '+name);actual.set(key,name);}
  const changes=[];
  function visit(value,file){if(!value||typeof value!=='object')return;
    for(const [key,item] of Object.entries(value)){
      if(typeof item==='string'&&['file','glb','poseData','runtimeGlb','runtimePose','sharedPose'].includes(key)){
        const target=path.posix.normalize(path.posix.join('vc',item)),canonical=actual.get(target.toLowerCase());
        if(canonical&&canonical!==target){const replacement=path.posix.relative('vc',canonical);value[key]=replacement;changes.push({file,from:item,to:replacement});}
      }else if(typeof item==='object')visit(item,file);
    }
  }
  for(const file of ['vc/fx/index.json','vc/manifest.json','vc/effect-assets.json']){
    const location=path.join(assetRoot,file);let text=await readFile(location,'utf8');
    const value=JSON.parse(text),before=changes.length;visit(value,file);
    for(const change of changes.slice(before))text=text.replaceAll(JSON.stringify(change.from),JSON.stringify(change.to));
    if(changes.length>before)await writeFile(location,text);
  }
  await writeFile(path.join(root,'contracts/vc-fx-index.json'),await readFile(path.join(assetRoot,'vc/fx/index.json')));
  return changes;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const root=fileURLToPath(new URL('../../',import.meta.url));
  console.log(JSON.stringify({changes:await normalizeVcPathCase(root)},null,2));
}

import {cp,mkdir,readdir,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const prefixes=['native-','native-reference','native-source-runtime','reference-combat-fixes','clock-source','commands-recovery','declarations','mana-source','rf-skills','rf-display','shield-declarations','skill-consumer','awakening-v17-source','matrix-source','input-manager-source','fx-matrix','fx-realcolor','pvp-source'];
/** Copy only task-local fixtures; the source worktree is never modified. */
export async function prepareOnlineFixtures({root=ROOT,source,refresh=false}={}){
  if(typeof source!=='string'||!source.length||path.resolve(source)===path.resolve(root))throw Error('Separate read-only fixture worktree required');
  source=path.resolve(source);
  await mkdir(path.join(root,'.cache'),{recursive:true});
  const copied=[];
  for(const item of await readdir(path.join(source,'.cache'),{withFileTypes:true}))if(item.isDirectory()&&prefixes.some(p=>item.name.startsWith(p))&&!/toolchain|SDK|probe|client-build/.test(item.name)){
    await cp(path.join(source,'.cache',item.name),path.join(root,'.cache',item.name),{recursive:true,force:refresh,errorOnExist:false,
      filter:from=>!/(?:^|[\\/])(?:zig-local|zig-global|zig-cache|zig-local-cache|zig-global-cache|\.zig-cache|global-cache|local-cache)(?:[\\/]|$)/.test(from)});copied.push(item.name);
  }
  const receipt={schemaVersion:1,sourceReadOnly:true,source,refresh,copied};
  await mkdir(path.join(root,'runtime'),{recursive:true});
  await writeFile(path.join(root,'runtime/online-fixtures.json'),JSON.stringify(receipt,null,2)+'\n');
  return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),source=args.find(value=>!value.startsWith('--'));
  if(args.some(value=>value.startsWith('--')&&value!=='--refresh'))throw Error('Use SOURCE_WORKTREE [--refresh]');
  const receipt=await prepareOnlineFixtures({source,refresh:args.includes('--refresh')});
  console.log(JSON.stringify({directories:receipt.copied.length,sourceReadOnly:true,refresh:receipt.refresh}));
}

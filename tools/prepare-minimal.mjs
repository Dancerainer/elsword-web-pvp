import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const input = process.argv[2];
if (!input) throw Error('Supply a read-only project directory containing prepared artifacts.');
const source = path.resolve(input);
if(source===path.resolve(root))throw Error('Read-only input must be another checkout');
const read=p=>readFile(path.join(source,'artifacts',p));
const hash=b=>createHash('sha256').update(b).digest('hex');
const native=JSON.parse(await read('native/manifest.json'));
const oldIndex=JSON.parse(await read('rf/effect-assets.json'));
const effectIndex={...oldIndex,templates:{Raven_WeaponDummy01:oldIndex.templates.Raven_WeaponDummy01}};
if(!effectIndex.templates.Raven_WeaponDummy01?.poseData)throw Error('Original Z helper missing');
const paths=['rf/rf-runtime.glb','rf/runtime-pose.json','rf/manifest.json',
 'scene/sander-garpai-rock-pvp/manifest.json','scene/sander-garpai-rock-pvp/collision.json','scene/sander-garpai-rock-pvp/scene.glb',
 'native/manifest.json',...Object.values(native.modules).map(m=>'native/'+m.file),
 'rf/'+effectIndex.templates.Raven_WeaponDummy01.poseData];
const records=[];
for(const relative of [...new Set(paths)]){
 const bytes=await read(relative),sha256=hash(bytes);
 const module=Object.values(native.modules).find(m=>'native/'+m.file===relative);
 if(module&&module.sha256!==sha256)throw Error('Frozen module mismatch: '+relative);
 const destination=path.join(root,'artifacts',relative);await mkdir(path.dirname(destination),{recursive:true});
 await writeFile(destination,bytes);records.push({path:relative,bytes:bytes.length,sha256});
}
await mkdir(path.join(root,'artifacts/minimal'),{recursive:true});
await writeFile(path.join(root,'artifacts/minimal/effect-index.json'),JSON.stringify(effectIndex));
await writeFile(path.join(root,'contracts/rf-minimal-assets-v1.json'),JSON.stringify({schemaVersion:1,sourceType:"operator-supplied-resource-tree",
 sourceReadOnly:true,targetClientMeasured:false,records,totalBytes:records.reduce((s,r)=>s+r.bytes,0)},null,2)+'\n');
// Existing dependency packages are read-only build inputs; generated output stays here.
const deps=path.resolve(process.argv[3]??path.join(source,'node_modules'));
const {build}=await import(pathToFileURL(path.join(deps,'esbuild/lib/main.js')));
await mkdir(path.join(root,'dist'),{recursive:true});
await build({entryPoints:[path.join(root,'apps/minimal/game.mjs')],bundle:true,format:'esm',target:'es2022',outfile:path.join(root,'dist/game.js'),
 nodePaths:[deps],sourcemap:true,loader:{'.json':'json'}});
await copyFile(path.join(root,'apps/minimal/game.css'),path.join(root,'dist/game.css'));
await writeFile(path.join(root,'artifacts/minimal/build.json'),JSON.stringify({programVersion:'rf-minimal-experiment-v1',
 programSha256:hash(await readFile(path.join(root,'dist/game.js'))),profileSha256:hash(await readFile(path.join(root,'packages/combat-core/rf-profile.json'))),
 assetsSha256:hash(await readFile(path.join(root,'contracts/rf-minimal-assets-v1.json')))},null,2)+'\n');
console.log(JSON.stringify({copiedFiles:records.length,assetBytes:records.reduce((s,r)=>s+r.bytes,0),build:'dist/game.js'}));

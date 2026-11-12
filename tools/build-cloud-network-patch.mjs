/** Reuse the live build's dependency path layout inside this task's runtime. */
import {build} from 'esbuild';
import {cp,mkdir,symlink,lstat,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const staging=path.join(root,'runtime/network-patch-build/worktrees');
const project=path.join(staging,'rf-render-camera-v2/elsword_2016_webpvp');
const dependencies=path.join(staging,'rf-local-pvp-ui/elsword_2016_webpvp/node_modules');
await mkdir(project,{recursive:true});
try{await lstat(dependencies);}catch(error){
  if(error.code!=='ENOENT')throw error;
  await cp(path.join(root,'node_modules'),dependencies,{recursive:true});
}
for(const directory of ['apps','packages','config','contracts'])
  await cp(path.join(root,directory),path.join(project,directory),{recursive:true});
await mkdir(path.join(project,'tools/assets/character'),{recursive:true});
await cp(path.join(root,'tools/assets/character/sample_pose.mjs'),path.join(project,'tools/assets/character/sample_pose.mjs'));
await cp(path.join(root,'package.json'),path.join(project,'package.json'));
try{await lstat(path.join(project,'node_modules'));}catch(error){
  if(error.code!=='ENOENT')throw error;
  await symlink(dependencies,path.join(project,'node_modules'),'junction');
}
await build({absWorkingDir:project,entryPoints:['apps/web/game.mjs'],bundle:true,
  format:'esm',target:'es2022',outdir:path.join(project,'dist'),entryNames:'game',
  sourcemap:true,splitting:true,minify:false,loader:{'.json':'json'}});
for(const file of await readdir(path.join(project,'dist')))
  if(file.endsWith('.js'))await cp(path.join(project,'dist',file),path.join(root,'dist',file));
const css=await Promise.all(['game.css','online.css','online-lobby.css','pvp-hud.css','key-bindings.css','buff-bar.css','guild-panel.css','window-theme.css']
  .map(file=>readFile(path.join(root,'apps/web',file),'utf8')));
await writeFile(path.join(root,'dist/game.css'),css.join('\n'));
console.log('Built program patch using a task-local copy of the live dependency layout.');

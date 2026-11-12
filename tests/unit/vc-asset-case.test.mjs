import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeVcPathCase} from '../../tools/assets/normalize-vc-path-case.mjs';

test('VC shared references use exact disk casing while source names and bytes stay unchanged',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'vc-case-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const folder of ['artifacts/rf/fx/textures','artifacts/vc/fx','contracts'])await mkdir(path.join(root,folder),{recursive:true});
  const texture=path.join(root,'artifacts/rf/fx/textures/Steam_Bp-fixed.png');await writeFile(texture,'immutable image fixture');
  const value={textures:{'Steam_BP.dds':{file:'../rf/fx/textures/Steam_BP-fixed.png',source:{name:'Steam_BP.dds',sha256:'source-seal'}}}};
  for(const file of ['fx/index.json','manifest.json','effect-assets.json'])await writeFile(path.join(root,'artifacts/vc',file),JSON.stringify(value));
  const changes=await normalizeVcPathCase(root);assert.equal(changes.length,3);
  const index=JSON.parse(await readFile(path.join(root,'contracts/vc-fx-index.json')));
  assert.equal(index.textures['Steam_BP.dds'].file,'../rf/fx/textures/Steam_Bp-fixed.png');
  assert.deepEqual(index.textures['Steam_BP.dds'].source,value.textures['Steam_BP.dds'].source);
  assert.equal(await readFile(texture,'utf8'),'immutable image fixture');
  assert.deepEqual(await normalizeVcPathCase(root),[],'idempotent');
});

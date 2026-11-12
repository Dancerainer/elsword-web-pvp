import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareOnlineFixtures} from '../../tools/prepare-online-fixtures.mjs';

test('fixture preparation includes v20 keyboard/matrix sources, creates runtime and refreshes only the destination',async t=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'rf-online-fixtures-')),source=path.join(base,'source'),root=path.join(base,'task');
  t.after(async()=>{assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(base,{recursive:true,force:true});});
  const sources={'input-manager-source-v19/KTDIManager.cpp':'original keyboard source',
    'fx-matrix-v19/matrix.cpp':'original matrix probe',
    'native-source-runtime/X2Lib/X2GUUser.cpp':'original user source',
    'native-source-runtime/zig-local-cache/skip.bin':'compiler cache',
    'native-sdk-probe/skip.bin':'SDK probe',
    'unrelated-work/skip.bin':'unrelated task'};
  for(const [file,contents] of Object.entries(sources)){
    await mkdir(path.dirname(path.join(source,'.cache',file)),{recursive:true});await writeFile(path.join(source,'.cache',file),contents);
  }
  const receipt=await prepareOnlineFixtures({root,source});
  assert.deepEqual(receipt.copied.sort(),['fx-matrix-v19','input-manager-source-v19','native-source-runtime']);
  for(const file of Object.keys(sources).filter(file=>!file.endsWith('skip.bin')))
    assert.equal(await readFile(path.join(root,'.cache',file),'utf8'),sources[file]);
  for(const file of Object.keys(sources).filter(file=>file.endsWith('skip.bin')))
    await assert.rejects(access(path.join(root,'.cache',file)),{code:'ENOENT'});
  assert.equal(JSON.parse(await readFile(path.join(root,'runtime/online-fixtures.json'),'utf8')).sourceReadOnly,true);
  const target=path.join(root,'.cache/input-manager-source-v19/KTDIManager.cpp');
  await writeFile(target,'old task fixture');await prepareOnlineFixtures({root,source});
  assert.equal(await readFile(target,'utf8'),'old task fixture','default preserves existing local fixtures');
  await prepareOnlineFixtures({root,source,refresh:true});
  assert.equal(await readFile(target,'utf8'),sources['input-manager-source-v19/KTDIManager.cpp']);
  assert.equal(JSON.parse(await readFile(path.join(root,'runtime/online-fixtures.json'),'utf8')).refresh,true);
  for(const [file,contents] of Object.entries(sources))assert.equal(await readFile(path.join(source,'.cache',file),'utf8'),contents);
});

test('fixture preparation rejects missing or self-referential source before modifying a worktree',async()=>{
  await assert.rejects(prepareOnlineFixtures({root:'task'}),/Separate read-only fixture worktree required/);
  await assert.rejects(prepareOnlineFixtures({root:'task',source:'task'}),/Separate read-only fixture worktree required/);
});

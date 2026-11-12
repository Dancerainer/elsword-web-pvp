import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { createDevServer, safePath } from '../../apps/server/dev-server.mjs';

test('game code and assets require an authenticated session, including after logout', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rf-auth-'));
  await mkdir(path.join(root, 'dist')); await mkdir(path.join(root, 'artifacts'));
  await writeFile(path.join(root, 'dist/game.js'), 'GAME_CODE'); await writeFile(path.join(root, 'artifacts/model.glb'), 'MODEL');
  await writeFile(path.join(root,'artifacts/geometry.wasm'),Buffer.from([0,97,115,109,1,0,0,0]));
  const { server } = await createDevServer({ root, credentials: { username: 'fixture', password: 'fixture-secret' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)); await rm(root, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/game/game.js', '/assets/model.glb', '/assets/geometry.wasm']) assert.equal((await fetch(url + route)).status, 401);
  let response = await fetch(url + '/api/login', { method: 'POST', body: JSON.stringify({ username: 'fixture', password: 'wrong' }) });
  assert.equal(response.status, 401);
  response = await fetch(url + '/api/login', { method: 'POST', body: JSON.stringify({ username: 'fixture', password: 'fixture-secret' }) });
  assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const session = await (await fetch(url + '/api/session',{headers:{cookie}})).json();
  assert.equal(session.buildVersion,createHash('sha256').update('GAME_CODE').digest('hex'));
  assert.match((await fetch(url + '/api/session',{headers:{cookie}})).headers.get('cache-control'),/no-store/);
  assert.equal(await (await fetch(url + '/game/game.js?v=' + session.buildVersion,{headers:{cookie}})).text(),'GAME_CODE');
  assert.equal(await (await fetch(url + '/game/game.js', { headers: { cookie } })).text(), 'GAME_CODE');
  for(const filename of ['deployment.json','game.js.map']){
    await writeFile(path.join(root,'dist',filename),'private build metadata');
    assert.equal((await fetch(url+'/game/'+filename,{headers:{cookie}})).status,404);
  }
  assert.equal((await fetch(url + '/assets/model.glb', { headers: { cookie } })).status, 200);
  const wasm=await fetch(url+'/assets/geometry.wasm',{headers:{cookie}});
  assert.equal(wasm.headers.get('content-type'),'application/wasm');
  assert.match(wasm.headers.get('content-security-policy'),/'wasm-unsafe-eval'/);
  await WebAssembly.instantiateStreaming(wasm);
  assert.equal((await fetch(url + '/api/logout', { method: 'POST', headers: { cookie, origin: 'http://foreign.invalid' } })).status, 403);
  assert.equal((await fetch(url + '/api/logout', { method: 'POST', headers: { cookie } })).status, 200);
  assert.equal((await fetch(url + '/assets/model.glb', { headers: { cookie } })).status, 401);
  assert.equal((await fetch(url + '/assets/geometry.wasm', { headers: { cookie } })).status, 401);
});
test('local trace export requires a GM session and preserves Unicode in the saved recording',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'rf-trace-'));
  const credentials={username:'fixture-gm', role:'gm',password:'fixture-secret'},ordinary={username:'fixture-player',password:'fixture-player-secret'};
  const {server}=await createDevServer({root,credentials,additionalCredentials:[ordinary]});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${server.address().port}`;
  const trace={schemaVersion:1,purpose:'current-simulation-trace-not-native-ground-truth',recordingReason:'\uac38\uac3e\uac0a\uac18',initial:{actors:[]},final:{actors:[]},inputs:[]};
  const post=cookie=>fetch(url+'/api/traces',{method:'POST',headers:cookie?{cookie}:{},body:JSON.stringify(trace)});
  assert.equal((await post()).status,401);
  const playerLogin=await fetch(url+'/api/login',{method:'POST',body:JSON.stringify(ordinary)});
  assert.equal(playerLogin.status,200);
  const playerCookie=playerLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await post(playerCookie)).status,403,'ordinary accounts cannot export server traces');
  await fetch(url+'/api/logout',{method:'POST',headers:{cookie:playerCookie}});
  const login=await fetch(url+'/api/login',{method:'POST',body:JSON.stringify(credentials)});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const response=await post(cookie);assert.equal(response.status,200);const saved=await response.json();
  assert.equal(saved.file,'runtime/traces/'+saved.filename);assert.deepEqual(JSON.parse(await readFile(path.join(root,saved.file),'utf8')),trace);
  assert.equal((await fetch(url+'/api/traces',{method:'POST',headers:{cookie},body:'{}'})).status,400);
  await fetch(url+'/api/logout',{method:'POST',headers:{cookie}});assert.equal((await post(cookie)).status,401);
});
test('file mapping rejects traversal and Windows path separators', () => {
  assert.equal(safePath('D:/test/assets', '../private'), null);
  assert.equal(safePath('D:/test/assets', '..\\private'), null);
  assert.equal(safePath('D:/test/assets', '\0model'), null);
  assert.ok(safePath('D:/test/assets', 'rf/model.glb'));
});

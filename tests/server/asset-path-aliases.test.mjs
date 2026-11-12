import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {canonicalAssetRequest} from '../../apps/server/asset-path-aliases.mjs';
import {createDevServer,safePath} from '../../apps/server/dev-server.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';

const alias='rf/fx/textures/Steam_BP-0430ebd489.png',canonical='rf/fx/textures/Steam_Bp-0430ebd489.png';
test('only the evidenced Steam declaration resolves to the exact Linux spelling',()=>{
  assert.equal(canonicalAssetRequest(alias),canonical);
  for(const name of [canonical,'rf/fx/textures/steam_bp-0430ebd489.png','other/'+alias,'../'+alias,'__proto__'])
    assert.equal(canonicalAssetRequest(name),name);
  assert.equal(safePath('/assets',canonicalAssetRequest('../private')),null);
});

test('Steam alias preserves authentication, image bytes, HEAD, ETag and version checks',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'rf-steam-alias-'));
  await mkdir(path.join(root,'artifacts/rf/fx/textures'),{recursive:true});
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]),digest=createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(root,'artifacts',canonical),bytes);
  const credentials={username:'texture-fixture',password:'texture-test-only'};
  const {server}=await createDevServer({root,credentials});await listenLoopback(server);
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
  const origin='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(origin+'/assets/'+alias)).status,401);
  const login=await fetch(origin+'/api/login',{method:'POST',body:JSON.stringify(credentials)});
  assert.equal(login.status,200);const headers={cookie:login.headers.get('set-cookie').split(';')[0]};
  const response=await fetch(origin+'/assets/'+alias,{headers});assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  const correct=await fetch(origin+'/assets/'+canonical,{headers});assert.equal(correct.headers.get('etag'),response.headers.get('etag'));await correct.arrayBuffer();
  const head=await fetch(origin+'/assets/'+alias,{method:'HEAD',headers});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal((await fetch(origin+'/assets/'+alias,{headers:{...headers,'if-none-match':response.headers.get('etag')}})).status,304);
  assert.equal((await fetch(origin+'/assets/'+alias+'?v='+digest,{headers})).status,200);
  assert.equal((await fetch(origin+'/assets/'+alias+'?v=wrong',{headers})).status,409);
});

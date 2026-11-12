import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createOnlineAccountStore} from '../../packages/online/account-store.mjs';
import {normalizeNickname} from '../../packages/online/nickname.mjs';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {DEFAULT_KEY_BINDINGS} from '../../packages/input/key-bindings.mjs';

const accounts=['account-a','account-b','account-c','account-d'].map((username,i)=>({username,password:'test-password-'+i,role:i===1?'player':'gm'}));
async function temporary(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'rf-nickname-'));
  t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});return root;
}
// Native HTTP avoids fetch's unrelated blocked-port list for ephemeral OS ports.
function request(base,route,{cookie,method='GET',body}={}){
  return new Promise((resolve,reject)=>{
    const data=body===undefined?null:JSON.stringify(body);
    const req=http.request(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data!==null?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{})}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>{
        try{resolve({status:res.statusCode,headers:res.headers,json:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(error){reject(error);}
      });
    });req.on('error',reject);req.end(data);
  });
}

test('nickname validation uses normalized Unicode code points and rejects invisible/control/invalid UTF16 names',()=>{
  assert.equal(normalizeNickname('  e\u0301\uac0f\uac36  '),'é\uac0f\uac36');assert.equal(normalizeNickname('🦅'.repeat(16)),'🦅'.repeat(16));
  for(const value of [null,{},'', '  ','🦅'.repeat(17),'a\nb','a\u202eb','a\u200bb','a\u0000b','a\ud800b'])assert.throws(()=>normalizeNickname(value),TypeError);
});
test('nickname preferences persist independently of credentials and preserve the last saved value after write failure',async t=>{
  const root=await temporary(t),credentialFile=path.join(root,'dev-accounts.json'),marker=JSON.stringify({schemaVersion:1,accounts});
  await writeFile(credentialFile,marker);
  let fail=false;
  const fileSystem={...fs,rename:async(source,target)=>{if(fail&&target.endsWith('account-profiles.json'))throw Object.assign(Error('disk fixture'),{code:'EIO'});return fs.rename(source,target);}};
  const store=createOnlineAccountStore({accountRoot:root,fileSystem});await store.initialize(accounts);
  assert.deepEqual(await store.profile('account-a'),{schemaVersion:1,nickname:'account-a'});
  await store.saveNickname('account-a','  \uac01\uac24\uac28\uac32  ');await store.saveNickname('account-b','\uac01\uac24\uac28\uac32');
  fail=true;await assert.rejects(store.saveNickname('account-a','\uac2a\uac05\uac1b'),/disk fixture/);assert.equal((await store.profile('account-a')).nickname,'\uac01\uac24\uac28\uac32');
  const reloaded=createOnlineAccountStore({accountRoot:root});await reloaded.initialize(accounts);
  assert.equal((await reloaded.profile('account-a')).nickname,'\uac01\uac24\uac28\uac32');assert.equal((await reloaded.profile('account-b')).nickname,'\uac01\uac24\uac28\uac32');
  assert.equal(await readFile(credentialFile,'utf8'),marker);
  const persisted=JSON.parse(await readFile(path.join(root,'account-profiles.json'),'utf8'));
  assert.ok(Object.keys(persisted.accounts).every(key=>/^[0-9a-f]{64}$/.test(key)));
  await assert.rejects(reloaded.saveNickname('not-an-account','\uac28\uac32'),/unknown-account/);
});
test('nickname HTTP saves validate, queue locks until cancel, and a match freezes saved nickname plus independent right Ctrl',async t=>{
  const root=await temporary(t);await mkdir(path.join(root,'dist'));await writeFile(path.join(root,'dist/game.js'),'nickname HTTP fixture');
  let clock=0;const matches=[];
  const instance=await createDevServer({root,credentials:accounts[0],additionalCredentials:accounts.slice(1),now:()=>clock,
    driverFactory:args=>{matches.push(args.match);return {submitInput(){},ready(){},disconnect(){},stop(){},snapshot:()=>null};}});
  await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{instance.closeStreams();await new Promise(resolve=>instance.server.close(resolve));});
  const base=`http://127.0.0.1:${instance.server.address().port}`,call=(route,options)=>request(base,route,options);
  const cookies=[];
  for(const account of accounts){const response=await call('/api/login',{method:'POST',body:account});assert.equal(response.status,200);cookies.push(response.headers['set-cookie'][0].split(';')[0]);}
  const cookie=cookies[0];assert.equal((await call('/api/nickname-preferences')).status,401);
  assert.equal((await call('/api/nickname-preferences',{cookie,method:'POST',body:{nickname:'\uac14\uac1a'}})).status,405);
  assert.equal((await call('/api/nickname-preferences',{cookie})).json.nickname,'account-a');
  for(const body of [{nickname:''},{nickname:'a\u202eb'},{nickname:'a'.repeat(17)},{nickname:'\uac14\uac1a',role:'gm'},[],{name:'\uac14\uac1a'}])assert.equal((await call('/api/nickname-preferences',{cookie,method:'PUT',body})).status,400);
  assert.deepEqual((await call('/api/nickname-preferences',{cookie,method:'PUT',body:{nickname:'  \uac28\uac32 A  '}})).json,{schemaVersion:1,nickname:'\uac28\uac32 A'});
  assert.equal((await call('/api/session',{cookie})).json.nickname,'\uac28\uac32 A');
  const bindings=structuredClone(DEFAULT_KEY_BINDINGS);bindings.bindings.special='ControlRight';
  assert.equal((await call('/api/key-preferences',{cookie,method:'PUT',body:bindings})).status,200);
  assert.equal((await call('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}})).status,200);
  const locked=await call('/api/nickname-preferences',{cookie,method:'PUT',body:{nickname:'\uac3f\uac1c\uac15\uac06\uac22'}});
  assert.equal(locked.status,409);assert.equal(locked.json.error,'preferences-locked');
  assert.equal((await call('/api/online/queue',{cookie,method:'DELETE'})).status,200);
  assert.equal((await call('/api/nickname-preferences',{cookie,method:'PUT',body:{nickname:'\uac29\uac33\uac28\uac32'}})).status,200);
  for(const value of cookies)assert.equal((await call('/api/online/queue',{cookie:value,method:'POST',body:{mode:'2v2'}})).status,200);
  clock=11_000;await instance.online.tick();assert.equal(matches.length,1);
  const player=matches[0].players.find(p=>p.id==='account-a');assert.equal(player.nickname,'\uac29\uac33\uac28\uac32');assert.equal(player.name,'\uac29\uac33\uac28\uac32');
  assert.equal(player.keyBindings.bindings.awaken,'ControlLeft');assert.equal(player.keyBindings.bindings.special,'ControlRight');
  const publicPlayer=(await call('/api/online/status',{cookie})).json.match.players.find(p=>p.id==='account-a');assert.equal(publicPlayer.nickname,'\uac29\uac33\uac28\uac32');
  assert.equal((await call('/api/nickname-preferences',{cookie,method:'PUT',body:{nickname:'\uac3c\uac07\uac15\uac06\uac22'}})).status,409);
});

test('last confirmed nickname follows the account through logout, a new browser session and server restart',async t=>{
  const root=await temporary(t),accountRoot=path.join(root,'accounts');await mkdir(path.join(root,'dist'));await writeFile(path.join(root,'dist/game.js'),'nickname restart fixture');
  let instance=null,base;
  const stop=async()=>{if(!instance)return;const old=instance;instance=null;old.closeStreams();await new Promise(resolve=>old.server.close(resolve));};
  t.after(stop);
  const start=async()=>{
    instance=await createDevServer({root,accountRoot,credentials:accounts[0],additionalCredentials:accounts.slice(1),
      driverFactory:()=>({submitInput(){},ready(){},disconnect(){},stop(){},snapshot:()=>null})});
    await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${instance.server.address().port}`;
  };
  const login=async account=>{const response=await request(base,'/api/login',{method:'POST',body:account});assert.equal(response.status,200);return response.headers['set-cookie'][0].split(';')[0];};
  const session=async cookie=>(await request(base,'/api/session',{cookie})).json;
  const save=async(cookie,nickname)=>request(base,'/api/nickname-preferences',{cookie,method:'PUT',body:{nickname}});
  await start();let a=await login(accounts[0]),b=await login(accounts[1]);
  assert.equal((await session(a)).nickname,'account-a');assert.equal((await session(b)).nickname,'account-b');
  assert.equal((await save(a,'  \uac30\uac1d\uac00\uac13 🦅  ')).json.nickname,'\uac30\uac1d\uac00\uac13 🦅');assert.equal((await save(b,'\uac40\uac12\uac03')).status,200);
  assert.equal((await request(base,'/api/logout',{cookie:a,method:'POST'})).status,200);
  assert.equal((await request(base,'/api/session',{cookie:a})).status,401);a=await login(accounts[0]);
  assert.equal((await session(a)).nickname,'\uac30\uac1d\uac00\uac13 🦅','fresh login restores the server profile without browser storage');
  assert.equal((await session(b)).nickname,'\uac40\uac12\uac03','another account keeps its own saved nickname');
  assert.equal((await save(a,'\uac29\uac25\uac28\uac32')).status,200);assert.equal((await save(a,'')).status,400);
  assert.equal((await session(a)).nickname,'\uac29\uac25\uac28\uac32','an invalid edit cannot replace the last confirmed nickname');
  await stop();await start();a=await login(accounts[0]);b=await login(accounts[1]);
  assert.equal((await session(a)).nickname,'\uac29\uac25\uac28\uac32','a new server process reloads the account profile');assert.equal((await session(b)).nickname,'\uac40\uac12\uac03');
  for(const mode of ['1v1','2v2','3v3']){
    const joined=await request(base,'/api/online/queue',{cookie:a,method:'POST',body:{mode}});assert.equal(joined.status,200);
    const rejected=await save(a,'\uac10\uac3d\uac15\uac22\uac14');assert.equal(rejected.status,409);assert.equal(rejected.json.error,'preferences-locked');
    assert.equal((await session(a)).nickname,'\uac29\uac25\uac28\uac32');assert.equal((await request(base,'/api/online/queue',{cookie:a,method:'DELETE'})).status,200);
  }
});

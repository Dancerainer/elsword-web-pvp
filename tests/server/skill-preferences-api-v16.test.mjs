import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {loopbackFetch as fetch} from '../helpers/loopback-fetch.mjs';
import profile from '../../packages/combat-core/rf-profile.json' with {type:'json'};
import preset from '../../config/rf-preset.json' with {type:'json'};

const origin='https://preferences-fixture.invalid';
const credentials={username:'fixture-a',password:'fixture-secret-a'};
const additionalCredentials=[{username:'fixture-b',password:'fixture-secret-b'}];
const active=profile.skillCatalog.filter(s=>s.unitClass===107&&s.supported&&!s.passive&&
  !preset.bannedSkillIds.includes(s.skillId)&&!profile.skillCatalog.some(t=>t.replacesSkillId===s.skillId));
const branched=active.filter(s=>s.branches?.some(b=>b.selectable!==false));
const branch=s=>String(s.branches.find(b=>b.selectable!==false).id??s.branches.find(b=>b.selectable!==false).branchId);
const choice=()=>({schemaVersion:1,loadout:[{skillId:branched[0].skillId,branchId:branch(branched[0])},...Array(7).fill(null)],
  branchChoices:{[branched[0].skillId]:branch(branched[0]),[branched[1].skillId]:branch(branched[1])}});
const hash=body=>createHash('sha256').update(body).digest('hex');
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'rf-skill-preferences-api-')),accountRoot=path.join(root,'accounts');
  await mkdir(accountRoot);await writeFile(path.join(accountRoot,'dev-account.json'),JSON.stringify(credentials));
  await writeFile(path.join(accountRoot,'dev-accounts.json'),JSON.stringify({schemaVersion:1,accounts:additionalCredentials}));
  let instance,base;
  const start=async()=>{instance=await createDevServer({root,accountRoot,publicOrigin:origin});
    await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+instance.server.address().port;};
  await start();
  t.after(async()=>{await new Promise(resolve=>instance.server.close(resolve));
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
  const login=async(account=credentials)=>{const response=await fetch(base+'/api/login',{method:'POST',headers:{Origin:origin},body:JSON.stringify(account)});
    assert.equal(response.status,200);await response.json();return response.headers.get('set-cookie').split(';')[0];};
  const request=(cookie,{method='GET',config,raw,requestOrigin=origin}={})=>fetch(base+'/api/skill-preferences',
    {method,headers:{...(cookie?{Cookie:cookie}:{}),Origin:requestOrigin,'Content-Type':'application/json'},
      ...(method==='PUT'?{body:raw??JSON.stringify(config)}:{})});
  return {root,accountRoot,login,request,get instance(){return instance;},
    restart:async()=>{await new Promise(resolve=>instance.server.close(resolve));await start();},
    logout:cookie=>fetch(base+'/api/logout',{method:'POST',headers:{Origin:origin,Cookie:cookie}})};
}

test('authenticated account preferences retain eight slots and unequipped branches across logout and server restart',async t=>{
  const f=await fixture(t),cookie=await f.login(),config=choice();
  const originalHashes=await Promise.all(['dev-account.json','dev-accounts.json'].map(async file=>hash(await readFile(path.join(f.accountRoot,file)))));
  const empty=await f.request(cookie);assert.equal(empty.headers.get('cache-control'),'no-store');assert.equal((await empty.json()).preferences,null);
  const saved=await f.request(cookie,{method:'PUT',config});assert.equal(saved.status,200);const expected=(await saved.json()).preferences;
  assert.deepEqual(expected.loadout,config.loadout);assert.equal(expected.branchChoices[branched[1].skillId],branch(branched[1]));
  assert.equal((await f.logout(cookie)).status,200);await f.restart();
  const again=await f.request(await f.login());assert.equal(again.status,200);assert.deepEqual((await again.json()).preferences,expected);
  assert.deepEqual(await Promise.all(['dev-account.json','dev-accounts.json'].map(async file=>hash(await readFile(path.join(f.accountRoot,file))))),originalHashes);
});

test('preferences are account-isolated; an all-empty loadout remains intentionally empty',async t=>{
  const f=await fixture(t),a=await f.login(),b=await f.login(additionalCredentials[0]);
  const response=await f.request(a,{method:'PUT',config:{...choice(),username:additionalCredentials[0].username}});assert.equal(response.status,200);await response.json();
  assert.equal((await (await f.request(b)).json()).preferences,null);
  const config={schemaVersion:1,loadout:Array(8).fill(null),branchChoices:{}};
  assert.equal((await f.request(b,{method:'PUT',config})).status,200);
  const restored=(await (await f.request(b)).json()).preferences;assert.deepEqual(restored.loadout,config.loadout);
  assert.equal((await (await f.request(a)).json()).preferences.loadout[0].skillId,branched[0].skillId);
});

test('anonymous, expired, logged-out and foreign-origin requests cannot read or overwrite preferences',async t=>{
  const f=await fixture(t),cookie=await f.login();
  assert.equal((await f.request(null)).status,401);
  assert.equal((await f.request(null,{method:'PUT',config:choice()})).status,401);
  assert.equal((await f.request(cookie,{method:'PUT',config:choice(),requestOrigin:'https://other.invalid'})).status,403);
  f.instance.sessions.values().next().value.expires=Date.now()-1;assert.equal((await f.request(cookie)).status,401);
  const fresh=await f.login();await f.logout(fresh);assert.equal((await f.request(fresh,{method:'PUT',config:choice()})).status,401);
});

test('invalid, banned, duplicate and malformed writes preserve the last valid configuration',async t=>{
  const f=await fixture(t),cookie=await f.login();const first=await f.request(cookie,{method:'PUT',config:choice()});const expected=(await first.json()).preferences;
  for(const config of [{...choice(),schemaVersion:99},{...choice(),loadout:[{skillId:900},...Array(7).fill(null)]},
    {...choice(),loadout:Array(8).fill({skillId:branched[0].skillId,branchId:branch(branched[0])})},
    {...choice(),branchChoices:{[branched[0].skillId]:'invalid-branch'}}]){
    const rejected=await f.request(cookie,{method:'PUT',config});assert.equal(rejected.status,400);await rejected.json();
  }
  assert.equal((await f.request(cookie,{method:'PUT',raw:'{broken'})).status,400);
  assert.equal((await f.request(cookie,{method:'PUT',raw:'x'.repeat(9000)})).status,400);
  assert.deepEqual((await (await f.request(cookie)).json()).preferences,expected);
});

test('damaged persisted configuration returns an error and is not treated as an empty account',async t=>{
  const f=await fixture(t),cookie=await f.login();await f.request(cookie,{method:'PUT',config:choice()});
  const folder=path.join(f.accountRoot,'skill-preferences'),files=await readdir(folder);assert.equal(files.length,1);
  const file=path.join(folder,files[0]);await writeFile(file,'{damaged');
  const response=await f.request(cookie);assert.equal(response.status,500);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{error:'skill-preferences-unavailable'});assert.equal(await readFile(file,'utf8'),'{damaged');
});

/** Real browser preference client against authenticated local HTTP/account files.
 * These are platform persistence/race tests, not native-client combat evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {createSkillPreferencesClient} from '../../apps/web/skill-preferences.mjs';
import {getProfessionProfile} from '../../packages/professions/profiles.mjs';
import {loopbackFetch} from '../helpers/loopback-fetch.mjs';
const origin='https://profession-switch-fixture.invalid';
const ids={RF:24027,LK:21219},branches={RF:'memo-21',LK:'memo-28'};
const config=(id,slot=0)=>({loadout:Array.from({length:8},(_,index)=>index===slot?{skillId:ids[id],branchId:branches[id]}:null),branchChoices:{[ids[id]]:branches[id]}});
const args=id=>{const profile=getProfessionProfile(id);return {username:'switch-player',professionId:id,defaults:config(id),
  definitions:profile.skillCatalog,supportFor:skillId=>profile.skillCatalog.find(s=>s.skillId===skillId)};};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'profession-switch-prefs-')),requests=[];
  let instance,base,cookie,gmCookie,intercept=null,clock=1000;const matches=[];
  async function stop(){if(!instance)return;const old=instance;instance=null;old.closeStreams();await new Promise(resolve=>old.server.close(resolve));}
  async function start(){
    gmCookie=null;
    instance=await createDevServer({root,accountRoot:path.join(root,'accounts'),publicOrigin:origin,
      credentials:{username:'switch-player',password:'fixture-only-password'},additionalCredentials:[{username:'fixture_admin',role:'gm',password:'fixture-gm-password'},{username:'switch-peer',password:'fixture-peer-password'}],
      now:()=>clock,driverFactory:({match})=>{matches.push(structuredClone(match));return {stop(){},snapshot:()=>null};}});
    await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+instance.server.address().port;
    const response=await loopbackFetch(base+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
      body:JSON.stringify({username:'switch-player',password:'fixture-only-password'})});
    assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];
  }
  t.after(async()=>{await stop();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
  await start();
  const request=async(url,options={})=>{
    const row={url,method:options.method??'GET',body:options.body?JSON.parse(options.body):undefined};requests.push(row);
    const response=await loopbackFetch(base+url,{...options,headers:{...options.headers,Cookie:cookie,Origin:origin}});
    await intercept?.(row,response);return response;
  };
  const select=async id=>{const response=await request('/api/preferences/profession',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({professionId:id})});
    assert.equal(response.status,200);assert.equal((await response.json()).professionId,id);};
  const client=createSkillPreferencesClient({fetch:request,storage:{getItem:()=>null}});
  const configureProfessions=async professions=>{
    if(!gmCookie){const login=await loopbackFetch(base+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
      body:JSON.stringify({username:'fixture_admin',password:'fixture-gm-password'})});assert.equal(login.status,200);gmCookie=login.headers.get('set-cookie').split(';')[0];}
    const response=await loopbackFetch(base+'/api/admin/professions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:gmCookie},
      body:JSON.stringify({professions})});assert.equal(response.status,200);return response.json();
  };
  const joinPeer=async()=>{
    const response=await loopbackFetch(base+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'switch-peer',password:'fixture-peer-password'})});
    assert.equal(response.status,200);const queued=await loopbackFetch(base+'/api/online/queue',{method:'POST',
      headers:{Origin:origin,'Content-Type':'application/json',Cookie:response.headers.get('set-cookie').split(';')[0]},body:JSON.stringify({mode:'1v1'})});assert.equal(queued.status,200);
  };
  return {client,request,select,requests,configureProfessions,matches,joinPeer,advance:async ms=>{clock+=ms;await instance.online.tick();},
    createClient:(storage={getItem:()=>null})=>createSkillPreferencesClient({fetch:request,storage}),
    setIntercept(fn){intercept=fn;},restart:async()=>{await stop();await start();}};
}

test('RF LK six continuous account switches keep each eight-slot config and branch on the real server after restart',async t=>{
  const f=await fixture(t),saved={RF:config('RF',2),LK:config('LK',5)};
  for(const id of ['RF','LK']){await f.select(id);assert.deepEqual(await f.client.load(args(id)),config(id));assert.deepEqual(await f.client.save(saved[id]),saved[id]);}
  for(const id of ['RF','LK','RF','LK','RF','LK']){await f.select(id);assert.deepEqual(await f.client.load(args(id)),saved[id]);}
  for(const row of f.requests.filter(row=>row.method==='PUT')){
    assert.equal(new URL(row.url,origin).searchParams.get('professionId'),row.body.professionId);
    assert.ok(row.body.loadout.filter(Boolean).every(slot=>slot.skillId===ids[row.body.professionId]));
  }
  await f.restart();const session=await f.request('/api/session');assert.equal((await session.json()).professionId,'LK');
  for(const id of ['RF','LK'])assert.deepEqual(await f.client.load(args(id)),saved[id]);
});

test('an old RF save may finish its own server write but cannot confirm or alter the active LK context',async t=>{
  const f=await fixture(t);await f.client.load(args('RF'));const release=deferred(),arrived=deferred();
  f.setIntercept(async row=>{if(row.method==='PUT'&&row.body?.professionId==='RF'){arrived.resolve();await release.promise;}});
  const writing=f.client.save(config('RF',6));const rejected=assert.rejects(writing,/Account changed/);await arrived.promise;
  const lk=await f.client.load(args('LK'));assert.deepEqual(lk,config('LK'));
  release.resolve();await rejected;f.setIntercept(null);assert.deepEqual(await f.client.save(config('LK',3)),config('LK',3));
  assert.deepEqual(await f.client.load(args('RF')),config('RF',6));assert.deepEqual(await f.client.load(args('LK')),config('LK',3));
});

test('an obsolete RF GET cannot trigger first-use migration or replace a newer LK configuration',async t=>{
  const f=await fixture(t),release=deferred(),arrived=deferred();
  f.setIntercept(async row=>{if(row.method==='GET'&&row.url.endsWith('professionId=RF')){arrived.resolve();await release.promise;}});
  const loading=f.client.load(args('RF'));const rejected=assert.rejects(loading,/Account changed/);await arrived.promise;
  const lk=await f.client.load(args('LK'));assert.deepEqual(lk,config('LK'));release.resolve();await rejected;f.setIntercept(null);
  assert.equal(f.requests.filter(row=>row.method==='PUT'&&row.body?.professionId==='RF').length,0,'abandoned first-use RF GET must not write defaults');
  assert.deepEqual(await f.client.save(config('LK',4)),config('LK',4));assert.deepEqual(await f.client.load(args('LK')),config('LK',4));
});

test('a retained RF config object cannot be submitted through the later LK context',async t=>{
  const f=await fixture(t),rf=await f.client.load(args('RF'));await f.client.load(args('LK'));
  const count=f.requests.length;await assert.rejects(f.client.save(rf),/Account changed/);assert.equal(f.requests.length,count);
  assert.deepEqual(await f.client.load(args('RF')),config('RF'));assert.deepEqual(await f.client.load(args('LK')),config('LK'));
});

test('all-disabled first boot reads both missing configurations without a forbidden write and reopening allows saving',async t=>{
  const f=await fixture(t);await f.select('LK');await f.configureProfessions({RF:false,LK:false});
  const clients={RF:f.createClient(),LK:f.createClient()};
  const loaded=await Promise.all(['RF','LK'].map(id=>clients[id].load({...args(id),persistDefaults:false})));
  assert.deepEqual(loaded,[config('RF'),config('LK')]);assert.equal(f.requests.filter(row=>row.method==='PUT').length,0);
  let session=await (await f.request('/api/session')).json();assert.equal(session.professionId,'RF');assert.equal(session.selectedProfessionId,'LK');
  assert.equal((await (await f.request('/api/skill-preferences?professionId=LK')).json()).preferences,null);
  await assert.rejects(clients.LK.save(config('LK',6)),/Skill setupsave failed/);
  await f.configureProfessions({RF:true,LK:true});session=await (await f.request('/api/session')).json();assert.equal(session.professionId,'LK');
  assert.deepEqual(await clients.LK.save(config('LK',6)),config('LK',6));
  assert.deepEqual(await clients.RF.save(config('RF',1)),config('RF',1));await f.restart();
  for(const [id,slot]of [['RF',1],['LK',6]])assert.deepEqual(await f.client.load(args(id)),config(id,slot));
});

test('preparing both missing configurations while queued performs only GET and editing resumes after cancellation',async t=>{
  const f=await fixture(t);const queued=await f.request('/api/online/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'1v1'})});
  assert.equal(queued.status,200);const clients={RF:f.createClient(),LK:f.createClient()};
  for(const id of ['RF','LK'])assert.deepEqual(await clients[id].load({...args(id),persistDefaults:false}),config(id));
  assert.equal(f.requests.filter(row=>row.method==='PUT').length,0);
  await assert.rejects(clients.RF.save(config('RF',7)),/Skill setupsave failed/);
  assert.equal((await f.request('/api/online/queue',{method:'DELETE'})).status,200);
  assert.deepEqual(await clients.RF.save(config('RF',7)),config('RF',7));
  assert.deepEqual(await clients.LK.save(config('LK',3)),config('LK',3));
});

test('one prepared client per profession can confirm independent saves when RF replies after LK',async t=>{
  const f=await fixture(t),rf=f.createClient(),lk=f.createClient();
  await Promise.all([rf.load({...args('RF'),persistDefaults:false}),lk.load({...args('LK'),persistDefaults:false})]);
  const arrived=deferred(),release=deferred();
  f.setIntercept(async row=>{if(row.method==='PUT'&&row.body?.professionId==='RF'){arrived.resolve();await release.promise;}});
  const savingRf=rf.save(config('RF',6));await arrived.promise;assert.deepEqual(await lk.save(config('LK',2)),config('LK',2));
  release.resolve();assert.deepEqual(await savingRf,config('RF',6));f.setIntercept(null);
  assert.deepEqual(await f.client.load(args('RF')),config('RF',6));assert.deepEqual(await f.client.load(args('LK')),config('LK',2));
});

test('the actual page queue action confirms read-only RF legacy traits before the server freezes the match configuration',async t=>{
  const f=await fixture(t),client=f.createClient({getItem:key=>key==='rf-picker-branches-v12:switch-player'?JSON.stringify({[ids.RF]:branches.RF}):null});
  const defaults={loadout:[{skillId:ids.RF,branchId:'none'},...Array(7).fill(null)],branchChoices:{}};
  const restored=await client.load({...args('RF'),defaults,persistDefaults:false});assert.equal(restored.loadout[0].branchId,branches.RF);
  assert.equal(f.requests.filter(row=>row.method==='PUT').length,0);
  const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8'),from=source.indexOf('async function queueWithConfirmedConfiguration('),to=source.indexOf('async function startFreePractice(',from);
  assert.ok(from>=0&&to>from,'run the production queue confirmation transaction');
  const locks=[],context={structuredClone,active:true,mode:'lobby',onlineTransportError:null,configurationLocked:false,slotPreparation:false,
    professionId:'RF',professionEpoch:0,skillPreferences:client,loadout:restored.loadout,branchChoices:restored.branchChoices,
    professionPreferences:new Map([['RF',{client,...restored}]]),professionSwitch:{flush(){},proof:()=>({pending:null})},updateModeControls(){locks.push(context.slotPreparation);},
    online:{async join(matchMode){assert.equal(context.slotPreparation,false);const response=await f.request('/api/online/queue',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:matchMode})});assert.equal(response.status,200);return response.json();}}};
  vm.createContext(context);vm.runInContext(source.slice(from,to)+'\nthis.queue=queueWithConfirmedConfiguration;',context);
  await context.queue('1v1');assert.deepEqual(locks,[true,false]);
  const writes=f.requests.filter(row=>row.method==='PUT'||row.url==='/api/online/queue');
  assert.deepEqual(writes.map(row=>[row.url,row.method]),[['/api/skill-preferences?professionId=RF','PUT'],['/api/online/queue','POST']]);
  assert.deepEqual(writes[0].body.branchChoices,{[ids.RF]:branches.RF});
  await f.joinPeer();await f.advance(5000);assert.equal(f.matches.length,1);
  const frozen=f.matches[0].players.find(player=>player.id==='switch-player');assert.equal(frozen.professionId,'RF');
  assert.deepEqual(frozen.loadout,restored.loadout);assert.deepEqual(frozen.branchChoices,restored.branchChoices);
});

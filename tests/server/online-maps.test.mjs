import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createOnlineService} from '../../packages/online/service.mjs';
import {createOnlineAccountStore} from '../../packages/online/account-store.mjs';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';

const maps=[{id:'map-first',name:'First',modes:['1v1','2v2','3v3'],manifestSha256:'a'.repeat(64)},
  {id:'map-second',name:'Second',modes:['1v1','2v2','3v3'],manifestSha256:'b'.repeat(64)}];
function fixture({saveMap}={}){
  let stamp=0,flags={};const drivers=[],events=[];
  const driverFactory=args=>{const driver={...args,stopCount:0,submitInput(){},stop(){this.stopCount++;}};drivers.push(driver);return driver;};
  driverFactory.maps=maps;driverFactory.mapVersions=id=>({mapManifestSha256:maps.find(row=>row.id===id).manifestSha256,resourceSha256:id+'-resources'});
  const accountStore={role:id=>id==='fixture-gm'?'gm':'player',mapFlags:()=>flags,
    saveMap:saveMap??(async(id,enabled)=>(flags={...flags,[id]:enabled})),recordMatch:async(_,result)=>({recorded:true,result})};
  const service=createOnlineService({driverFactory,accountStore,versions:{program:'frozen-program'},now:()=>stamp,random:()=>.99,
    onlineUsers:()=>['idle'],emit:(username,type,data)=>events.push({username,type,data})});
  return {service,drivers,events,advance:async seconds=>{stamp+=seconds*1000;await service.tick();}};
}
test('server randomly selects enabled map and freezes that map resources for each mode',async t=>{
  const f=fixture();t.after(()=>f.service.close());
  for(const [mode,count,wait] of [['1v1',2,5],['2v2',4,11],['3v3',6,11]]){
    for(let i=0;i<count;i++)await f.service.join(mode+i,'player',{},mode);
    await f.advance(wait);const match=f.drivers.at(-1).match;
    assert.equal(match.sceneId,'map-second');assert.equal(match.versions.sceneId,'map-second');
    assert.equal(match.versions.mapManifestSha256,'b'.repeat(64));assert.equal(match.versions.resourceSha256,'map-second-resources');
  }
  await f.service.setMap('fixture-gm','map-second',false);
  assert.equal(f.drivers[0].match.sceneId,'map-second');assert.equal(f.drivers[0].stopCount,0);
  await f.service.join('fresh-a','player',{},'1v1');await f.service.join('fresh-b','player',{},'1v1');await f.advance(5);
  assert.equal(f.drivers.at(-1).match.sceneId,'map-first');
});
test('BAN requires GM and known map, never touches a running match, and all banned maps release every pool',async t=>{
  const f=fixture();t.after(()=>f.service.close());
  for(const mode of ['1v1','2v2','3v3'])await f.service.join(mode,'player',{},mode);
  await assert.rejects(f.service.setMap('ordinary','map-first',false),error=>error.status===403);
  await assert.rejects(f.service.setMap('fixture-gm','../outside',false),error=>error.status===400);
  await f.service.setMap('fixture-gm','map-first',false);assert.equal(f.service.isLocked('1v1'),true);
  await f.service.setMap('fixture-gm','map-second',false);
  for(const mode of ['1v1','2v2','3v3']){
    const status=f.service.status(mode);assert.equal(status.queued,false);assert.equal(status.locked,false);
    assert.equal(status.mapsAvailable[mode],false);assert.equal(status.queueNotice.reason,'maps-disabled');
    await assert.rejects(f.service.join('new-'+mode,'player',{},mode),error=>error.code==='maps-disabled');
  }
  assert.ok(f.events.some(row=>row.username==='idle'&&row.data.maps?.every(map=>map.enabled===false)));
  await f.service.setMap('fixture-gm','map-first',true);assert.equal(f.service.status('1v1').queueNotice,null);
  await f.service.join('1v1','player',{},'1v1');assert.equal(f.service.isLocked('1v1'),true);
});
test('failed map persistence does not unlock queues or publish a changed pool',async t=>{
  const f=fixture({saveMap:async()=>{throw Error('disk-full');}});t.after(()=>f.service.close());
  await f.service.join('waiting','player',{},'3v3');f.events.length=0;
  await assert.rejects(f.service.setMap('fixture-gm','map-first',false),error=>error.code==='map-settings-unavailable'&&error.status===503);
  assert.equal(f.service.status('waiting').maps[0].enabled,true);assert.equal(f.service.isLocked('waiting'),true);assert.deepEqual(f.events,[]);
});
test('late map preparation cannot restore participants or publish a match after shutdown or queue departure',async()=>{
  for(const action of ['close','disconnect']){
    let stamp=0,release,entered;const reached=new Promise(resolve=>{entered=resolve;}),drivers=[],events=[];
    const factory=args=>{drivers.push(args);return {submitInput(){},stop(){}};};factory.maps=maps;
    factory.mapVersions=async()=>{entered();return new Promise(resolve=>{release=resolve;});};
    const service=createOnlineService({accountStore:{role:()=> 'player'},driverFactory:factory,versions:{},now:()=>stamp,
      emit:(username,type,data)=>events.push({username,type,data})});
    await service.join('a','player',{},'1v1');await service.join('b','player',{},'1v1');stamp=5000;
    const starting=service.tick();await reached;
    if(action==='close')service.close();else service.disconnect('a');events.length=0;
    release({});await starting;assert.equal(drivers.length,0);assert.equal(service.status('a').match,null);
    if(action==='close')assert.equal(events.length,0);else assert.equal(service.status('b').queued,true);
    service.close();
  }
});
test('account map bans are atomic and persist beside untouched credentials, nickname, mode flags and match history',async t=>{
  const accountRoot=await fs.mkdtemp(path.join(os.tmpdir(),'rf-map-store-'));
  t.after(async()=>{assert.ok(path.resolve(accountRoot).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(accountRoot,{recursive:true,force:true});});
  const credentials='private fixture credentials\n';await fs.writeFile(path.join(accountRoot,'dev-account.json'),credentials);
  let store=createOnlineAccountStore({accountRoot});await store.initialize([{username:'fixture-gm',role:'gm'},{username:'player'}]);
  await store.saveNickname('player','\uac2c\uac3a\uac28\uac32');await store.saveMode('1v1',false);
  await store.recordMatch({id:'untouched-result',players:[{id:'player',username:'player',team:0}],versions:{}},
    {winnerTeam:0,score:[4,0],players:[{id:'player',kills:4,assists:0,deaths:0}]});
  await Promise.all([store.saveMap('map-first',false),store.saveMap('map-second',false)]);
  store=createOnlineAccountStore({accountRoot});await store.initialize([{username:'fixture-gm',role:'gm'},{username:'player'}]);
  assert.deepEqual(store.mapFlags(),{'map-first':false,'map-second':false});assert.equal(store.modeFlags()['1v1'],false);
  assert.equal((await store.profile('player')).nickname,'\uac2c\uac3a\uac28\uac32');assert.equal((await store.summary('player')).wins,1);
  assert.equal(await fs.readFile(path.join(accountRoot,'dev-account.json'),'utf8'),credentials);
  const failed=createOnlineAccountStore({accountRoot,fileSystem:{...fs,rename:async(from,to)=>{if(to.endsWith('online-maps.json'))throw Object.assign(Error('denied'),{code:'EIO'});return fs.rename(from,to);}}});
  await failed.initialize([{username:'fixture-gm',role:'gm'}]);await assert.rejects(failed.saveMap('map-first',true));
  assert.equal(failed.mapFlags()['map-first'],false);
  assert.equal(JSON.parse(await fs.readFile(path.join(accountRoot,'online-maps.json'),'utf8')).maps['map-first'],false);
  assert.equal((await fs.readdir(accountRoot)).some(file=>file.endsWith('.tmp')),false);
});
test('HTTP map inventory is authenticated, GM switch is protected, forged queue map is rejected',async t=>{
  const accountRoot=await fs.mkdtemp(path.join(os.tmpdir(),'rf-map-api-'));
  const factory=args=>({submitInput(){},stop(){}});factory.maps=maps;
  const app=await createDevServer({accountRoot,credentials:{username:'fixture-gm', role:'gm',password:'fixture-secret'},additionalCredentials:[{username:'player',password:'fixture-secret'}],driverFactory:factory});
  const origin='http://127.0.0.1:'+await listenLoopback(app.server);
  t.after(async()=>{app.closeStreams();await new Promise(resolve=>app.server.close(resolve));assert.ok(path.resolve(accountRoot).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(accountRoot,{recursive:true,force:true});});
  const request=(route,{cookie,method='GET',body}={})=>fetch(origin+route,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const login=async username=>(await request('/api/login',{method:'POST',body:{username,password:'fixture-secret'}})).headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/online/maps')).status,401);const gm=await login('fixture-gm'),player=await login('player');
  assert.equal((await request('/api/online/maps',{cookie:player})).status,200);
  assert.equal((await request('/api/online/maps',{cookie:player,method:'POST',body:{mapId:'map-first',enabled:false}})).status,403);
  assert.equal((await request('/api/online/maps',{cookie:gm,method:'POST',body:{mapId:'map-first',enabled:false}})).status,200);
  const inventory=await(await request('/api/online/maps',{cookie:player})).json();assert.equal(inventory.maps[0].enabled,false);
  assert.equal((await request('/api/online/maps',{cookie:gm,method:'POST',body:{mapId:'map-first',enabled:true,extra:1}})).status,400);
  assert.equal((await request('/api/online/queue',{cookie:player,method:'POST',body:{mode:'1v1',sceneId:'map-first'}})).status,400);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createOnlineService} from '../../packages/online/service.mjs';
import {createOnlineAccountStore} from '../../packages/online/account-store.mjs';
import {DEFAULT_ROOM_CAPACITY,MAX_ROOMS_PER_MODE,normalizeRoomCapacity} from '../../packages/online/room-capacity.mjs';

const configuration={loadout:Array(8).fill(null),branchChoices:{}};
const settings=(one=3,two=3,three=2)=>({maxRoomsByMode:{'1v1':one,'2v2':two,'3v3':three}});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture({roomCapacity,storedCapacity=null,storedRevision=0,saveCapacity,factory,recordMatch,isActive=()=>true}={}){
  let clock=0;const rooms=[],events=[],saves=[];
  const driverFactory=async args=>{const driver=await(factory?.(args)??{submitInput(){},stop(){this.stopped=true;},ready(){return {ok:true};}});
    rooms.push({...args,driver});return driver;};
  const accountStore={role:id=>id==='fixture-gm'?'gm':'player',roomCapacity:()=>storedCapacity,roomCapacityRevision:()=>storedRevision,
    saveRoomCapacity:async value=>{saves.push(structuredClone(value));return saveCapacity?saveCapacity(value):structuredClone(value);},
    recordMatch:async(match,result)=>recordMatch?recordMatch(match,result):{recorded:true,result:{...result,finishedAt:clock}}};
  const online=createOnlineService({driverFactory,accountStore,versions:{},now:()=>clock,random:()=>.5,isActive,
    onlineUsers:()=>['fixture-gm','spectator'],...(roomCapacity===undefined?{}:{roomCapacity}),emit:(username,type,data)=>events.push({username,type,data})});
  return {online,rooms,events,saves,
    async join(prefix,count,mode){for(let i=0;i<count;i++)await online.join(prefix+i,'player',configuration,mode);},
    async advance(ms=20000){clock+=ms;await online.tick();},
  };
}

test('the room-capacity schema requires exactly three bounded integer limits and permits zero without an aggregate cap',()=>{
  assert.equal(MAX_ROOMS_PER_MODE,20);assert.deepEqual(DEFAULT_ROOM_CAPACITY,settings());
  const input=settings(0,20,2),normalized=normalizeRoomCapacity(input);input.maxRoomsByMode['2v2']=4;
  assert.deepEqual(normalized,settings(0,20,2));assert.notEqual(normalized.maxRoomsByMode,input.maxRoomsByMode);
  for(const invalid of [null,[],{},settings(-1),settings(21),settings(1.5),settings('3'),settings(Infinity),
    {maxRoomsByMode:{'1v1':3,'2v2':3}}, {maxRoomsByMode:{...settings().maxRoomsByMode,'4v4':1}},
    {...settings(),maxActivePlayers:12},JSON.parse('{"maxRoomsByMode":{"1v1":3,"2v2":3,"3v3":2,"__proto__":{}}}')])
    assert.throws(()=>normalizeRoomCapacity(invalid),/invalid-room-capacity/);
});

test('per-mode admission allows more than three total rooms and twelve players while holding a third 3v3 room',async t=>{
  const f=fixture({roomCapacity:settings(1,4,2)});t.after(()=>f.online.close());
  await f.join('six',18,'3v3');await f.join('four',20,'2v2');await f.join('two',4,'1v1');
  for(let i=0;i<5;i++)await f.advance();
  const status=f.online.roomCapacityStatus();assert.deepEqual(status.activeRoomsByMode,{'1v1':1,'2v2':4,'3v3':2});
  assert.equal(status.activeRooms,7);assert.equal(status.activePlayers,30);
  assert.equal(status.maxActiveRooms,null);assert.equal(status.maxActivePlayers,null);
  assert.equal(status.revision,0);
  const waiting=Array.from({length:18},(_,i)=>'six'+i).find(id=>f.online.status(id).queued);
  assert.equal(f.online.status(waiting).queue.size,6);assert.equal(f.online.status(waiting).roomCapacity.waitingForCapacity,true);
  assert.deepEqual(f.events.filter(row=>row.username==='fixture-gm').at(-1).data.roomCapacity.activeRoomsByMode,status.activeRoomsByMode,
    'an idle GM sees updated occupancy without joining the queue or writing the settings');
});

test('zero pauses new rooms without clearing queue age; lowering keeps old rooms and raising uses the existing deadline',async t=>{
  const f=fixture({roomCapacity:settings(0,2,0)});t.after(()=>f.online.close());
  await f.join('p',12,'2v2');await f.advance();await f.advance();assert.equal(f.rooms.length,2);
  const waiting=Array.from({length:12},(_,i)=>'p'+i).find(id=>f.online.status(id).queued),before=f.online.status(waiting);
  const stopped=f.rooms.map(row=>row.driver.stopped);
  await f.online.setRoomCapacity('fixture-gm',settings(0,0,0));await f.advance();
  assert.equal(f.rooms.length,2);assert.deepEqual(f.rooms.map(row=>row.driver.stopped),stopped);
  assert.equal(f.online.status(waiting).queue.joinedAt,before.queue.joinedAt);
  assert.equal(f.online.status(waiting).roomCapacity.waitingForCapacity,true);
  await f.online.setRoomCapacity('fixture-gm',settings(0,3,0));await f.advance(0);
  assert.equal(f.rooms.length,3);assert.equal(f.online.status(waiting).queued,false);
  assert.ok(f.events.some(row=>row.username==='spectator'&&row.data.roomCapacity?.maxRoomsByMode?.['2v2']===3));
});

test('starting and settling retain their mode slot; successful result persistence and failure release only that room',async t=>{
  const started=deferred(),entered=deferred(),saved=deferred();let calls=0;
  const f=fixture({roomCapacity:settings(0,1,1),factory:async()=>{if(++calls===1){entered.resolve();await started.promise;}return {submitInput(){},stop(){}};},recordMatch:()=>saved.promise});
  t.after(()=>f.online.close());await f.join('a',8,'2v2');const creating=f.advance();await entered.promise;
  assert.equal(f.online.roomCapacityStatus().activeRoomsByMode['2v2'],1);
  started.resolve();await creating;await f.advance();assert.equal(f.rooms.length,1);
  const settling=f.rooms[0].finish({players:[],winnerTeam:0});await f.advance();assert.equal(f.rooms.length,1);
  assert.equal(f.online.roomCapacityStatus().activeRoomsByMode['2v2'],1);
  saved.resolve({recorded:true,result:{finishedAt:60000,players:[],winnerTeam:0}});await settling;await f.advance(0);assert.equal(f.rooms.length,2);
  await f.join('b',6,'3v3');await f.advance();assert.equal(f.online.roomCapacityStatus().activeRoomsByMode['3v3'],1);
  f.rooms[1].emit('room-failed',{error:'room-worker-unavailable'});
  assert.deepEqual(f.online.roomCapacityStatus().activeRoomsByMode,{'1v1':0,'2v2':0,'3v3':1});
});

test('a failed room creation returns the players and releases its per-mode reservation',async t=>{
  let attempts=0;const f=fixture({roomCapacity:settings(0,0,1),factory:()=>{if(++attempts===1)throw Error('start-failed');return {submitInput(){},stop(){}};}});
  t.after(()=>f.online.close());await f.join('a',6,'3v3');await f.advance();
  assert.equal(f.online.roomCapacityStatus().activeRoomsByMode['3v3'],0);assert.equal(f.online.status('a0').queue.size,6);
  await f.advance();assert.equal(f.rooms.length,1);assert.equal(f.online.roomCapacityStatus().activeRoomsByMode['3v3'],1);
});

test('GM settings serialize with matching and stay unchanged on failed persistence',async t=>{
  const entered=deferred(),write=deferred(),f=fixture({roomCapacity:settings(0,1,0),saveCapacity:()=>{entered.resolve();return write.promise;}});
  t.after(()=>f.online.close());await f.join('a',4,'2v2');const before=f.online.status('a0');
  const changing=f.online.setRoomCapacity('fixture-gm',settings(0,0,0));await entered.promise;
  const matching=f.advance();await Promise.resolve();assert.equal(f.rooms.length,0);
  assert.deepEqual(f.online.roomCapacityStatus().maxRoomsByMode,settings(0,1,0).maxRoomsByMode);
  write.reject(Error('disk-full'));await assert.rejects(changing,error=>error.code==='room-capacity-settings-unavailable'&&error.status===503);
  await matching;assert.equal(f.rooms.length,1);assert.equal(f.rooms[0].match.players.length,4);
  assert.equal(f.online.roomCapacityStatus().revision,0);
  assert.equal(before.queue.joinedAt,0);assert.equal(f.online.roomCapacityStatus().maxRoomsByMode['2v2'],1);
});

test('queued GM transactions capture each complete choice before waiting for another save',async t=>{
  const firstWrite=deferred(),entered=deferred();let writes=0;
  const f=fixture({saveCapacity:async value=>{if(++writes===1){entered.resolve();await firstWrite.promise;}return value;}});t.after(()=>f.online.close());
  const first=f.online.setRoomCapacity('fixture-gm',settings(0,4,2));await entered.promise;
  const requested=settings(1,5,2),second=f.online.setRoomCapacity('fixture-gm',requested);requested.maxRoomsByMode['2v2']=20;
  firstWrite.resolve();const results=await Promise.all([first,second]);assert.deepEqual(results.map(row=>row.revision),[1,2]);
  assert.deepEqual(f.saves,[settings(0,4,2),settings(1,5,2)]);assert.deepEqual(f.online.roomCapacityStatus().maxRoomsByMode,settings(1,5,2).maxRoomsByMode);
  assert.equal(f.events.filter(row=>row.username==='spectator').at(-1).data.roomCapacity.revision,2);
});

test('GM saves replace legacy aggregate limits; persisted mode settings take precedence after restart',async t=>{
  const f=fixture({roomCapacity:{maxActivePlayers:4,maxActiveRooms:1}});t.after(()=>f.online.close());
  await f.online.setRoomCapacity('fixture-gm',settings(0,4,2));await f.join('a',16,'2v2');for(let i=0;i<4;i++)await f.advance();
  assert.equal(f.rooms.length,4);assert.equal(f.online.roomCapacityStatus().maxActivePlayers,null);
  const restarted=fixture({roomCapacity:{maxActivePlayers:4,maxActiveRooms:1},storedCapacity:settings(0,4,2),storedRevision:8});t.after(()=>restarted.online.close());
  assert.deepEqual(restarted.online.roomCapacityStatus().maxRoomsByMode,settings(0,4,2).maxRoomsByMode);
  assert.equal(restarted.online.roomCapacityStatus().maxActiveRooms,null);
  assert.equal(restarted.online.roomCapacityStatus().revision,8);
  assert.equal((await restarted.online.setRoomCapacity('fixture-gm',settings(0,5,2))).revision,9);
});

test('only an active GM can change valid capacity settings and late writes cannot reopen a closed service',async t=>{
  const f=fixture({isActive:id=>id!=='expired'});t.after(()=>f.online.close());
  await assert.rejects(f.online.setRoomCapacity('player',settings()),error=>error.status===403);
  await assert.rejects(f.online.setRoomCapacity('expired',settings()),error=>error.status===401);
  await assert.rejects(f.online.setRoomCapacity('fixture-gm',settings(21)),error=>error.status===400);
  assert.equal(f.saves.length,0);
  const write=deferred(),entered=deferred(),closing=fixture({saveCapacity:()=>{entered.resolve();return write.promise;}});
  const saving=closing.online.setRoomCapacity('fixture-gm',settings(0,0,0));await entered.promise;closing.online.close();
  write.resolve(settings(0,0,0));await saving;assert.deepEqual(closing.online.roomCapacityStatus().maxRoomsByMode,DEFAULT_ROOM_CAPACITY.maxRoomsByMode);
  assert.equal(closing.events.length,0);
});

async function storeFixture(t){
  const accountRoot=await fs.mkdtemp(path.join(tmpdir(),'rf-room-capacity-admin-'));
  t.after(async()=>{assert.ok(path.resolve(accountRoot).startsWith(path.resolve(tmpdir())+path.sep));await fs.rm(accountRoot,{recursive:true,force:true});});
  const store=createOnlineAccountStore({accountRoot});await store.initialize([{username:'fixture-gm'}]);
  return {accountRoot,store,file:path.join(accountRoot,'online-room-capacity.json')};
}

test('capacity storage creates no default file, persists atomically and reloads without modifying unrelated settings',async t=>{
  const f=await storeFixture(t);assert.equal(f.store.roomCapacity(),null);assert.equal(f.store.roomCapacityRevision(),0);await assert.rejects(fs.access(f.file),{code:'ENOENT'});
  await f.store.saveMode('3v3',false);const modes=await fs.readFile(path.join(f.accountRoot,'online-modes.json'));
  const first=settings(0,4,2),saving=f.store.saveRoomCapacity(first);first.maxRoomsByMode['2v2']=19;await saving;
  assert.deepEqual(f.store.roomCapacity(),settings(0,4,2));
  assert.equal(f.store.roomCapacityRevision(),1);
  const copy=f.store.roomCapacity();copy.maxRoomsByMode['2v2']=10;assert.deepEqual(f.store.roomCapacity(),settings(0,4,2));
  await Promise.all([f.store.saveRoomCapacity(settings(1,5,2)),f.store.saveRoomCapacity(settings(2,6,2))]);
  const stored=JSON.parse(await fs.readFile(f.file,'utf8'));assert.deepEqual(stored,{schemaVersion:1,revision:3,...settings(2,6,2)});
  assert.deepEqual(await fs.readFile(path.join(f.accountRoot,'online-modes.json')),modes);
  const next=createOnlineAccountStore({accountRoot:f.accountRoot});await next.initialize([{username:'fixture-gm'}]);assert.deepEqual(next.roomCapacity(),settings(2,6,2));
  assert.equal(next.roomCapacityRevision(),3);assert.equal((await next.saveRoomCapacity(settings(2,7,2))).revision,4);
  assert.equal((await fs.readdir(f.accountRoot)).some(name=>name.endsWith('.tmp')),false);
});

test('failed capacity persistence leaves the last durable and in-memory choice intact and removes its temporary file',async t=>{
  const f=await storeFixture(t);await f.store.saveRoomCapacity(settings());let fail=false;
  const broken=createOnlineAccountStore({accountRoot:f.accountRoot,fileSystem:{...fs,rename:async(from,to)=>{if(fail&&to===f.file)throw Error('write-failed');return fs.rename(from,to);}}});
  await broken.initialize([{username:'fixture-gm'}]);fail=true;
  await assert.rejects(broken.saveRoomCapacity(settings(0,9,0)),/write-failed/);
  assert.deepEqual(broken.roomCapacity(),settings());assert.equal(broken.roomCapacityRevision(),1);
  assert.deepEqual(JSON.parse(await fs.readFile(f.file,'utf8')),{schemaVersion:1,revision:1,...settings()});
  assert.equal((await fs.readdir(f.accountRoot)).some(name=>name.endsWith('.tmp')),false);
});

test('corrupt saved capacity settings fail explicitly instead of silently enabling more rooms',async t=>{
  const f=await storeFixture(t);
  for(const text of ['{bad',JSON.stringify(null),JSON.stringify({schemaVersion:2,...settings()}),JSON.stringify({schemaVersion:1,...settings(-1)}),
    JSON.stringify({schemaVersion:1,...settings(),maxActivePlayers:12}),JSON.stringify({schemaVersion:1,revision:-1,...settings()}),
    JSON.stringify({schemaVersion:1,revision:1.5,...settings()})]){
    await fs.writeFile(f.file,text);const store=createOnlineAccountStore({accountRoot:f.accountRoot});await assert.rejects(store.initialize([{username:'fixture-gm'}]));
    assert.equal(store.roomCapacity(),null);
  }
});

test('a valid older capacity file starts at revision zero without rewriting and gains a revision on its next successful save',async t=>{
  const f=await storeFixture(t),legacy=JSON.stringify({schemaVersion:1,...settings(2,5,2)});
  await fs.writeFile(f.file,legacy);const store=createOnlineAccountStore({accountRoot:f.accountRoot});await store.initialize([{username:'fixture-gm'}]);
  assert.equal(store.roomCapacityRevision(),0);assert.deepEqual(store.roomCapacity(),settings(2,5,2));assert.equal(await fs.readFile(f.file,'utf8'),legacy);
  assert.equal((await store.saveRoomCapacity(settings(2,6,2))).revision,1);
  assert.deepEqual(JSON.parse(await fs.readFile(f.file,'utf8')),{schemaVersion:1,revision:1,...settings(2,6,2)});
});

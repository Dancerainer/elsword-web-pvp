import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createOnlineService, validateInputBatch} from '../../packages/online/service.mjs';
import {createOnlineAccountStore} from '../../packages/online/account-store.mjs';

const config = () => ({loadout: Array(8).fill(null), branchChoices: {}, keyBindings: {schemaVersion: 1, bindings: {up: 'ArrowUp'}}});
const versions = {reference: 'source-fixture', preset: 'preset-fixture', program: 'program-fixture'};
test('loading progress is scoped to actual participants, monotonic, bounded and ready reaches100',async()=>{
 const f=fixture();try{
  for(const id of ['a','b','c','d'])await f.add(id);
  f.setClock(11000);await f.online.tick();const match=f.drivers[0].match;
  f.online.loadingProgress('a',{matchId:match.id,percent:35});
  f.online.loadingProgress('a',{matchId:match.id,percent:5});
  const events=f.events.filter(e=>e.type==='match');
  assert.equal(events.at(-1).data.players.find(p=>p.id==='a').loadingProgress,35);
  assert.equal(events.at(-1).data.players.find(p=>p.id==='b').loadingProgress,undefined);
  assert.throws(()=>f.online.loadingProgress('a',{matchId:match.id,percent:100}),/invalid-loading/);
  assert.throws(()=>f.online.loadingProgress('outsider',{matchId:match.id,percent:1}));
  await f.online.ready('a',match.id);
  assert.equal(f.events.filter(e=>e.type==='match').at(-1).data.players.find(p=>p.id==='a').loadingProgress,100);
 }finally{f.online.close();}
});
function fixture() {
  let clock = 0;
  const drivers = [], events = [], recorded = [];
  const online = createOnlineService({versions, now: () => clock, random: () => 0.5,
    emit: (username, type, data) => events.push({username, type, data}),
    accountStore: {recordMatch: async (match, result) => {recorded.push({match, result}); return {recorded: true, result: {...result, finishedAt: clock}};}},
    driverFactory: ({match, emit, finish}) => {
      const driver = {match, emit, finish, inputs: [], disconnected: [], readyIds: [], stopped: 0,
        submitInput(id, batch) {this.inputs.push({id, batch});}, disconnect(id) {this.disconnected.push(id);},
        ready(id) {this.readyIds.push(id);}, stop() {this.stopped++;}, snapshot: () => ({fixture: true})};
      drivers.push(driver); return driver;
    }});
  const add = async name => online.join(name, 'gm', config());
  return {online, add, drivers, events, recorded, setClock: value => {clock = value;}, advance: async milliseconds => {clock += milliseconds; await online.tick();}};
}
async function four(f) { for (const name of ['a', 'b', 'c', 'd']) await f.add(name); }
test('authenticated signaling orders generations within each match and rotates epochs across page identities',async()=>{
  const f=fixture();try{
    await four(f);await f.advance(11000);const matchId=f.drivers[0].match.id;
    const session={},page={session,pageToken:'first-page',pageGeneration:1};
    const signal=(generation,offerId='offer-00000002',extra={})=>({matchId,to:'b',type:'offer',payload:{type:'offer',sdp:'fixture'},signalVersion:1,generation,offerId,...extra});
    f.online.signal('a',signal(2,undefined,{sourceEpoch:99999}),page);assert.deepEqual(f.online.signal('a',signal(1,'offer-00000001'),page),{ok:true,stale:true});
    let events=f.events.filter(row=>row.type==='signal');assert.equal(events.length,1);assert.equal(events[0].data.sourceEpoch,1);
    f.online.signal('a',signal(2),page);assert.equal(f.events.filter(row=>row.type==='signal').length,2,'duplicate same identity may recover a dropped downstream signal');
    assert.throws(()=>f.online.signal('a',signal(2,'conflicting-offer'),page),/signal-generation-conflict/);
    f.online.signal('a',signal(900),page);
    const nextPage={session,pageToken:'replacement-page',pageGeneration:1};
    f.online.signal('a',signal(1,'new-page-offer'),nextPage);
    events=f.events.filter(row=>row.type==='signal');assert.equal(events.at(-1).data.sourceEpoch,2,'matched reload can rotate token while existing pageGeneration remains unchanged');
    assert.equal(events.at(-1).data.generation,1);
    assert.ok(events.every(row=>!Object.hasOwn(row.data,'pageToken')&&!Object.hasOwn(row.data,'session')));
    assert.throws(()=>f.online.signal('a',signal(2),null),/signal-page-required/);
    const legacy={matchId,to:'c',type:'offer',payload:{sdp:'legacy'}};f.online.signal('a',legacy);
    assert.equal(f.events.filter(row=>row.type==='signal').at(-1).data.signalVersion,undefined,'old-to-old routing remains unmodified');
    f.online.signal('a',signal(2,'candidate-first-offer',{to:'c',type:'candidate',payload:{candidate:'candidate-first'}}),nextPage);
    assert.throws(()=>f.online.signal('a',signal(2,'conflicting-offer',{to:'c'}),nextPage),/signal-generation-conflict/);
    f.online.signal('a',signal(2,'candidate-first-offer',{to:'c'}),nextPage);
    assert.equal(f.events.filter(row=>row.type==='signal').at(-1).data.offerId,'candidate-first-offer','candidate-first binds its fixed PC identity; conflicting same-generation offer cannot steal it');
    const oldMatch=matchId;await f.drivers[0].finish({winnerTeam:0,players:[]});
    assert.throws(()=>f.online.signal('a',{...signal(3),matchId:oldMatch},nextPage),/match-not-active/);
    await four(f);await f.advance(11000);const newMatch=f.drivers.at(-1).match.id;
    f.online.signal('a',{...signal(1,'brand-new-match-offer'),matchId:newMatch},nextPage);
    assert.equal(f.events.filter(row=>row.type==='signal').at(-1).data.sourceEpoch,1,'a new match has no retained former-page routing maps');
  }finally{f.online.close();}
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, decline) => {resolve = accept; reject = decline;});
  return {promise, resolve, reject};
}

test('countdown deadline publishes a loading preview before slow map/driver preparation, then seals the same match',async()=>{
 let clock=0;const events=[],map=deferred(),factory=deferred(),entered=deferred();
 const driverFactory=async({match})=>{entered.resolve(match);await factory.promise;return {submitInput(){},stop(){}};};
 driverFactory.mapVersions=()=>map.promise;
 const online=createOnlineService({versions,accountStore:{},now:()=>clock,emit:(username,type,data)=>events.push({username,type,data}),driverFactory});
 try{
  for(const name of ['a','b','c','d'])await online.join(name,'gm',config());
  clock=11000;const running=online.tick();await Promise.resolve();
  const previews=events.filter(e=>e.type==='match-preparing');assert.equal(previews.length,4);
  const preview=previews[0].data;assert.equal(preview.players.length,4);assert.equal(preview.versions,undefined);
  assert.equal(events.filter(e=>e.type==='match').length,0);
  assert.throws(()=>online.submitInput('a',{matchId:preview.id,sequence:1,frames:[]}),/match|input/);
  map.resolve({reference:'sealed-map'});const match=await entered.promise;
  assert.equal(match.id,preview.id);assert.equal(match.versions.reference,'sealed-map');
  assert.equal(events.filter(e=>e.type==='match').length,0,'input/loading acknowledgement waits for the real driver');
  factory.resolve();await running;
  assert.equal(events.filter(e=>e.type==='match').length,4);
  assert.ok(events.filter(e=>e.type==='match').every(e=>e.data.id===preview.id));
 }finally{map.resolve({});factory.resolve();online.close();}
});

for(const failure of ['map','driver'])test(`loading preview ends on ${failure} preparation failure and queue can retry`,async()=>{
 let clock=0;const events=[];
 const driverFactory=async()=>{if(failure==='driver')throw Error('fixture-driver');return {submitInput(){},stop(){}};};
 driverFactory.mapVersions=async()=>{if(failure==='map')throw Error('fixture-map');return {};};
 const online=createOnlineService({versions,accountStore:{},now:()=>clock,emit:(username,type,data)=>events.push({username,type,data}),driverFactory});
 try{for(const name of ['a','b','c','d'])await online.join(name,'gm',config());clock=11000;await online.tick();
  assert.equal(events.filter(e=>e.type==='match-preparing').length,4);
  assert.equal(events.filter(e=>e.type==='match-preparation-ended').length,4);
  assert.equal(online.status('a').match,null);assert.ok(online.status('a').queue.deadline>clock);
 }finally{online.close();}
});

test('closing during production service driver creation retires late success without publishing or keeping locks', async () => {
  let clock = 0, stops = 0, factoryCalls = 0, drops = 0, callbacks;
  const entered = deferred(), creation = deferred(), events = [];
  const online = createOnlineService({versions, now: () => clock, emit: (...args) => events.push(args), onDrop: () => drops++,
    accountStore: {recordMatch: async () => {throw Error('closed service must not record a new result');}},
    driverFactory: async args => {factoryCalls++; callbacks = args; entered.resolve(); return creation.promise;}});
  for (const name of ['a', 'b', 'c', 'd']) await online.join(name, 'gm', config());
  clock = 11_000; const ticking = online.tick(); await entered.promise;
  online.close(); events.length = 0;
  callbacks.emit('state', {matchId: callbacks.match.id, snapshot: {retired: true}});
  callbacks.emit('player-timeout', {playerId: 'a'});
  assert.equal(await callbacks.finish({winnerTeam: 0}), false);
  creation.resolve({submitInput() {}, stop() {stops++;}}); await ticking;
  online.close(); await online.tick();
  assert.equal(stops, 1); assert.equal(factoryCalls, 1); assert.equal(drops, 0); assert.deepEqual(events, []);
  assert.equal(online.isLocked('a'), false); assert.equal(online.matchSnapshot('a'), null);
  assert.deepEqual(online.status('a').queue, {mode:'2v2', size: 0, eligibleSize:0,loading:false, joinedAt: null, deadline: null, elapsedSeconds:null, remainingSeconds: null, paused: false});
  assert.equal(online.status('a').available, false); assert.equal(online.status('a').match, null);
  await assert.rejects(online.join('a', 'gm', config()), /online-driver-unavailable/);
});

test('late driver creation failure cannot requeue players or emit errors after service close', async () => {
  let clock = 0;
  const entered = deferred(), creation = deferred(), events = [];
  const online = createOnlineService({versions, now: () => clock, emit: (...args) => events.push(args),
    accountStore: {recordMatch: async () => {}},
    driverFactory: async () => {entered.resolve(); return creation.promise;}});
  for (const name of ['a', 'b', 'c', 'd']) await online.join(name, 'gm', config());
  clock = 11_000; const ticking = online.tick(); await entered.promise;
  online.close(); events.length = 0; creation.reject(Error('delayed asset failure')); await ticking;
  assert.deepEqual(events, []); assert.equal(online.status('a').queue.size, 0); assert.equal(online.isLocked('a'), false);
});

test('an atomic result write already started may finish after close without restoring match state or events', async () => {
  let clock = 0, finish, stops = 0;
  const entered = deferred(), persistence = deferred(), events = [];
  const online = createOnlineService({versions, now: () => clock, emit: (...args) => events.push(args),
    accountStore: {recordMatch: async () => {entered.resolve(); return persistence.promise;}},
    driverFactory: args => {finish = args.finish; return {submitInput() {}, stop() {stops++;}};}});
  for (const name of ['a', 'b', 'c', 'd']) await online.join(name, 'gm', config());
  clock = 11_000; await online.tick(); const result = {winnerTeam: 0, score: [4, 1], players: []};
  const settling = finish(result); await entered.promise; online.close(); events.length = 0;
  persistence.resolve({recorded: true, result: {...result, finishedAt: clock}});
  assert.equal(await settling, true); assert.equal(stops, 1); assert.deepEqual(events, []);
  assert.equal(online.status('a').match, null); assert.equal(online.status('a').lastResult, null);
  assert.equal(online.isLocked('a'), false);
});

test('failed delayed factory restores only connected participants and preserves a relogin new queue configuration', async () => {
  let clock = 0, factoryCalls = 0, secondMatch;
  const entered = deferred(), creation = deferred(), active = new Set(['a', 'b', 'c', 'd']), events = [];
  const online = createOnlineService({versions, now: () => clock, isActive: username => active.has(username),
    emit: (username, type) => events.push({username, type}),
    accountStore: {recordMatch: async () => {}}, driverFactory: async ({match}) => {
      if (++factoryCalls === 1) {entered.resolve(); return creation.promise;}
      secondMatch = match; return {submitInput() {}, stop() {}};
    }});
  for (const name of active) await online.join(name, 'gm', {...config(), marker: 'old'});
  clock = 11_000; const ticking = online.tick(); await entered.promise;
  active.delete('a'); online.disconnect('a', 'logout'); active.add('a');
  // The HTTP queue route uses this same transaction boundary while factory loading is in progress.
  const joining = online.transaction(() => online.join('a', 'player', {...config(), marker: 'new'}));
  creation.reject(Error('delayed asset failure')); await ticking; await joining;
  assert.equal(events.some(event => event.username === 'a' && event.type === 'server-error'), false);
  assert.equal(online.status('a').queued, true); assert.equal(online.status('a').queue.size, 4);
  clock = online.status('a').queue.deadline; await online.tick();
  const relogged = secondMatch.players.find(player => player.id === 'a');
  assert.equal(relogged.marker, 'new'); assert.equal(relogged.role, 'player');
  assert.ok(secondMatch.players.filter(player => player.id !== 'a').every(player => player.marker === 'old'));
  online.close();
});

test('queue grows without resetting its countdown; decreases above four do not delay a promised match', async () => {
  const f = fixture(); await four(f); assert.equal(f.online.status('a').queue.deadline, 11_000);
  await f.advance(4000); await f.add('e'); assert.equal(f.online.status('a').queue.deadline, 11_000);
  f.online.leaveQueue('e'); assert.equal(f.online.status('a').queue.deadline, 11_000);
  await f.advance(7000); assert.equal(f.drivers.length, 1); assert.equal(f.online.status('a').locked, true);
  assert.equal(f.drivers[0].match.players.length, 4); assert.deepEqual(f.drivers[0].match.players.map(p => p.team), [0, 0, 1, 1]);
  assert.deepEqual(f.drivers[0].match.versions, {...versions,sceneId:'sander-garpai-rock-pvp'});
});

test('scheduler publishes countdown only when the displayed remaining second changes', async () => {
  const f = fixture(); await four(f); f.events.length = 0;
  await f.advance(250); await f.advance(250); await f.advance(250); assert.equal(f.events.length, 0);
  await f.advance(250); assert.equal(f.events.filter(event => event.type === 'status').length, 4);
  assert.equal(Math.ceil(f.events[0].data.queue.remainingSeconds), 10);
  f.events.length = 0; await f.advance(250); assert.equal(f.events.length, 0);
});

test('queue elapsed metadata survives polling and paused pool waits, resets on rejoin and clears at match start',async t=>{
  const f=fixture();t.after(()=>f.online.close());assert.equal(f.online.status('a').queue.elapsedSeconds,null);
  f.setClock(100000);await f.add('a');assert.equal(f.online.status('a').queue.elapsedSeconds,0);
  await f.advance(62500);const restored=f.online.status('a');assert.equal(restored.queue.elapsedSeconds,62.5);
  assert.equal(restored.queue.joinedAt,100000);assert.equal(restored.queue.remainingSeconds,null,'elapsed wait is independent of match-ready countdown');
  for(const name of ['b','c','d'])await f.add(name);await f.advance(4000);f.online.leaveQueue('d');
  const deadline=f.online.status('a').queue.deadline;assert.equal(deadline,null);assert.equal(f.online.status('a').queue.paused,true);
  await f.advance(30000);assert.equal(f.online.status('a').queue.elapsedSeconds,96.5,'individual waiting continues while eligible-player countdown pauses');
  f.online.leaveQueue('a');assert.equal(f.online.status('a').queue.elapsedSeconds,null);await f.add('a');
  assert.equal(f.online.status('a').queue.elapsedSeconds,0);assert.equal(f.online.status('a').queue.joinedAt,196500);
  await f.add('e');f.setClock(f.online.status('a').queue.deadline);await f.online.tick();
  assert.equal(f.online.status('a').queued,false);assert.equal(f.online.status('a').queue.elapsedSeconds,null);
});

test('a loading queue entry keeps its frozen preferences and wait while only ready entries may be matched',async t=>{
  const f=fixture();t.after(()=>f.online.close());await four(f);await f.advance(4000);
  const before=f.online.status('a');assert.equal(f.online.beginPageLoad('a'),true);
  let value=f.online.status('a');assert.equal(value.queued,true);assert.equal(value.queue.loading,true);assert.equal(value.queue.size,4);assert.equal(value.queue.eligibleSize,3);
  assert.equal(value.queue.joinedAt,before.queue.joinedAt);assert.equal(value.queue.remainingSeconds,null);assert.equal(value.queue.paused,true);
  await f.advance(20000);assert.equal(f.drivers.length,0);assert.equal(f.online.status('a').queue.elapsedSeconds,24);
  await f.add('e');await f.advance(7000);assert.equal(f.drivers.length,1);
  assert.ok(f.drivers[0].match.players.every(player=>player.id!=='a'));assert.equal(f.online.status('a').queued,true);
  f.online.completePageLoad('a');value=f.online.status('a');assert.equal(value.queue.loading,false);assert.equal(value.queue.joinedAt,before.queue.joinedAt);
  assert.equal(value.queue.elapsedSeconds,31);assert.equal(f.online.beginPageLoad('b'),false,'already assigned players cannot suspend combat by declaring page initialization');
});

test('dropping below four pauses the remaining countdown and emptying the pool resets it', async () => {
  const f = fixture(); await four(f); await f.advance(4000); f.online.leaveQueue('d');
  assert.equal(f.online.status('a').queue.paused, true); assert.equal(f.online.status('a').queue.deadline, null);
  await f.advance(30_000); assert.equal(f.drivers.length, 0); await f.add('e');
  assert.equal(f.online.status('a').queue.deadline, 41_000); await f.advance(7000); assert.equal(f.drivers.length, 1);
  const other = fixture(); await four(other); await other.advance(3000);
  for (const name of ['a', 'b', 'c', 'd']) other.online.leaveQueue(name);
  await other.advance(30_000); await four(other); assert.equal(other.online.status('a').queue.deadline, 44_000);
});

test('fifteen queued players immediately yield four, with frozen configuration and no duplicate seats', async () => {
  const f = fixture(); const changed = config(); await f.online.join('0', 'gm', changed); changed.loadout[0] = {skillId: 99};
  for (let index = 1; index < 15; index++) await f.add(String(index));
  assert.equal(f.online.status('0').queue.deadline, 0); await f.online.tick();
  assert.equal(f.drivers.length, 1); assert.equal(new Set(f.drivers[0].match.players.map(p => p.id)).size, 4);
  assert.equal(f.online.status('14').queue.size, 11);
  const first = f.drivers[0].match.players.find(p => p.id === '0'); if (first) assert.equal(first.loadout[0], null);
});

test('disconnect removes one actor exactly once, unlocks login identity, and never replaces a slot mid-match', async () => {
  const f = fixture(); await four(f); await f.advance(11_000);
  f.online.disconnect('a', 'heartbeat-timeout'); f.online.disconnect('a', 'logout');
  assert.deepEqual(f.drivers[0].disconnected, ['a']); assert.equal(f.online.status('a').match, null);
  assert.equal(f.online.isLocked('a'), false); assert.equal(f.online.status('b').match.players.find(p => p.id === 'a').connected, false);
  await f.add('a'); assert.equal(f.online.status('a').queued, true);
});

test('only current players submit ordered, bounded action levels; outcome and simulation time cannot be supplied', async () => {
  const f = fixture(); await four(f); await f.advance(11_000); const matchId = f.drivers[0].match.id;
  const body = {matchId, sequence: 0, frames: [{held: ['Z'], pressed: ['Z'], sampledDevice: true, pureDouble: ['LEFT'], frameSeq: 0}]};
  assert.deepEqual(f.online.submitInput('a', body), {accepted: true, sequence: 0});
  assert.equal(f.drivers[0].inputs[0].batch.frames[0].held[0], 'Z');
  assert.equal(f.drivers[0].inputs[0].batch.frames[0].frameSeq, 0);
  assert.throws(() => f.online.submitInput('a', body), /input-sequence-rejected/);
  assert.throws(() => f.online.submitInput('outsider', {...body, sequence: 1}), /match-not-active/);
  for (const frames of [[{held: ['DASH']}], [{held: ['Z', 'Z']}], [{held: ['Z'], dt: 999}], [{held: ['Z'], hp: 0}],
    [{held: [], frameSeq: -1}], [{held: [], frameSeq: 1.5}], [{held: [], frameSeq: Number.MAX_SAFE_INTEGER + 1}], [{held: [], frameSeq: null}], []]) {
    assert.throws(() => validateInputBatch({...body, frames}), /invalid-input-batch/);
  }
  assert.throws(() => validateInputBatch({...body, winnerTeam: 0}), /invalid-input-batch/);
  for (let sequence = 1; sequence < 15; sequence++) f.online.submitInput('a', {matchId, sequence, frames: Array(8).fill({held: []})});
  assert.throws(() => f.online.submitInput('a', {matchId, sequence: 15, frames: Array(8).fill({held: []})}), /input-rate-exceeded/);
});

test('input frame sequence is optional, exact, and never lets the client supply simulation time', () => {
  const base = {matchId: 'fixture', sequence: 0, frames: [{held: []}]};
  assert.equal(Object.hasOwn(validateInputBatch(base).frames[0], 'frameSeq'), false);
  const sequenced = validateInputBatch({...base, frames: [{held: [], frameSeq: Number.MAX_SAFE_INTEGER}]});
  assert.equal(sequenced.frames[0].frameSeq, Number.MAX_SAFE_INTEGER);
  assert.throws(() => validateInputBatch({...base, frames: [{held: [], frameSeq: 1, dt: 1}]}), /invalid-input-batch/);
});

test('ready and signaling are authenticated to the frozen four; authoritative finish is idempotent and unlocks configurations', async () => {
  const f = fixture(); await four(f); await f.advance(11_000); const driver = f.drivers[0], matchId = driver.match.id;
  f.online.ready('a', matchId); assert.deepEqual(driver.readyIds, ['a']);
  f.online.signal('a', {matchId, to: 'b', type: 'offer', payload: {sdp: 'fixture'}});
  assert.equal(f.events.find(e => e.type === 'signal').username, 'b');
  assert.throws(() => f.online.signal('a', {matchId, to: 'outsider', type: 'offer', payload: {}}), /invalid-signal-target/);
  const result = {winnerTeam: 0, score: [4, 1], players: driver.match.players.map(player => ({id: player.id, kills: 1, assists: 0, deaths: 1}))};
  assert.equal(await driver.finish(result), true); assert.equal(await driver.finish(result), false); assert.equal(f.recorded.length, 1);
  assert.equal(f.online.isLocked('a'), false); assert.equal(f.online.status('a').lastResult.matchId, matchId);
  assert.equal(f.events.filter(e => e.type === 'result').length, 4);
});

test('a failed history write keeps the match settling and retries the same result', async () => {
  let clock = 0, attempts = 0, finish;
  const online = createOnlineService({versions, now: () => clock, accountStore: {recordMatch: async (_, result) => {
    if (++attempts === 1) throw Error('disk-failure'); return {recorded: true, result: {...result, finishedAt: clock}};
  }}, driverFactory: args => {finish = args.finish; return {submitInput() {}, stop() {}};}});
  for (const name of ['a', 'b', 'c', 'd']) await online.join(name, 'gm', config()); clock = 11_000; await online.tick();
  const result = {winnerTeam: 0, score: [4, 0], players: []};
  assert.equal(await finish(result), false); assert.equal(online.status('a').match.status, 'settling');
  clock += 1000; await online.tick(); assert.equal(attempts, 2); assert.equal(online.status('a').locked, false);
});

test('persistent KDA uses aggregate totals, isolates accounts, and settles a match once across restart', async t => {
  const accountRoot = await mkdtemp(path.join(os.tmpdir(), 'rf-online-history-'));
  t.after(async () => {assert.ok(path.resolve(accountRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(accountRoot, {recursive: true, force: true});});
  let store = createOnlineAccountStore({accountRoot}); await store.initialize([{username: 'a'}, {username: 'b', role: 'player'}, {username: '__proto__'}]);
  assert.equal(store.role('a'), 'player'); assert.equal(store.role('b'), 'player'); assert.equal(store.role('__proto__'), 'player');
  const match = {id: 'match-fixture', versions, players: [{id: 'a', username: 'a', team: 0}, {id: 'b', username: 'b', team: 1}]};
  const result = {winnerTeam: 0, reason: 'score', score: [4, 2], players: [{id: 'a', kills: 4, assists: 2, deaths: 2}, {id: 'b', kills: 2, assists: 0, deaths: 4}]};
  assert.equal((await store.recordMatch(match, result)).recorded, true); assert.equal((await store.summary('a')).kda, 3);
  assert.equal((await store.summary('a')).wins, 1); assert.equal((await store.summary('b')).losses, 1);
  const empty = await store.summary('never-played'); assert.equal(empty.kda, null); assert.equal(empty.kdaDisplay, '—');
  store = createOnlineAccountStore({accountRoot}); await store.initialize([{username: 'a'}, {username: 'b'}]);
  assert.equal(store.role('b'), 'player'); assert.equal((await store.recordMatch(match, result)).recorded, false); assert.equal((await store.summary('a')).games, 1);
  await assert.rejects(store.recordMatch({...match, id: 'bad'}, {...result, players: [{id: 'a', kills: 0, assists: 0, deaths: 0}, {id: 'a', kills: 0, assists: 0, deaths: 0}]}), /invalid-authoritative-result/);
  assert.equal((await store.summary('a')).games, 1);
  const raw = JSON.parse(await readFile(path.join(accountRoot, 'match-history.json'), 'utf8')); assert.ok(raw.matches['match-fixture']);
  await writeFile(path.join(accountRoot, 'match-history.json'), '{broken');
  await assert.rejects(createOnlineAccountStore({accountRoot}).initialize([{username: 'a'}]), SyntaxError);
});

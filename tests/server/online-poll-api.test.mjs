/** Real HTTP transport/lease tests with lifecycle-only driver substitutes.
 * These do not assert original-client combat or public tunnel measurements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {gunzipSync} from 'node:zlib';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';
import {OWNERSHIP_PROTOCOL} from '../../packages/online/owned-state.mjs';

const accounts = Array.from({length: 4}, (_, index) => ({username: `poll-${index}`, password: `fixture-secret-${index}`, role: index === 1 ? 'player' : 'gm'}));

test('queue HTTP accepts an explicit supported aura capability and rejects extra combat fields',async t=>{
  const f=await fixture(t),cookie=await f.login(accounts[0]);
  for(const body of [{mode:'2v2',continuousAuraVersion:3},{mode:'2v2',continuousAuraVersion:'1'},
    {mode:'2v2',ownerStatusVersion:2},{mode:'2v2',ownerStatusVersion:true},
    {mode:'2v2',continuousAuraVersion:1,actor:{hp:1}}]){
    const response=await f.request('/api/online/queue',{cookie,method:'POST',body});
    assert.equal(response.status,400);assert.equal((await response.json()).error,'invalid-queue-request');
  }
  const response=await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2',continuousAuraVersion:1}});
  assert.equal(response.status,200);assert.equal((await response.json()).queued,true);
});
test('real queue HTTP freezes supported aura v2 and status v1 into every selected owner room response',async t=>{
  const matches=[],driverFactory=Object.assign(({match})=>{
    matches.push(match);return {ownership:OWNERSHIP_PROTOCOL,submitInput(){return {accepted:true};},ready(){return {ok:true};},stop(){},snapshot(){return null;}};
  },{ownership:OWNERSHIP_PROTOCOL});
  const f=await fixture(t,{driverFactory}),cookies=await Promise.all(accounts.map(f.login));
  await Promise.all(cookies.map(cookie=>f.open(cookie)));
  for(const cookie of cookies){
    const response=await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2',continuousAuraVersion:2,ownerStatusVersion:1}});
    assert.equal(response.status,200);assert.equal((await response.json()).queued,true);
  }
  await f.advance(11000);assert.equal(matches.length,1);assert.equal(matches[0].continuousAuraVersion,2);assert.equal(matches[0].ownerStatusVersion,1);
  for(const cookie of cookies){const response=await f.request('/api/online/status',{cookie});assert.equal(response.status,200);
    const status=await response.json();assert.equal(status.match.id,matches[0].id);assert.equal(status.match.continuousAuraVersion,2);assert.equal(status.match.ownerStatusVersion,1);}
});
function controlledTimers() {
  const pending = new Set(), waiters = [];let latest=null;
  return {pending,get latest(){return latest;},
    setTimeout(callback, delay) {const timer = {callback, delay, unref() {}}; latest=timer;pending.add(timer); for (const done of waiters.splice(0)) done(timer); return timer;},
    clearTimeout(timer) {pending.delete(timer);},
    wait() {return pending.size ? Promise.resolve([...pending][0]) : new Promise(done => waiters.push(done));},
    fire() {for (const timer of [...pending]) if (pending.delete(timer)) timer.callback();},
  };
}
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rf-poll-http-')), drivers = [];
  await mkdir(path.join(root, 'dist')); await writeFile(path.join(root, 'dist/game.js'), 'poll fixture');
  let clock = 100_000;
  const disconnectTimers = controlledTimers(), pollTimers = controlledTimers();
  const instance = await createDevServer({root, credentials: accounts[0], additionalCredentials: accounts.slice(1),
    onlineEventTransport: 'poll', disconnectTimers, pollTimers, now: () => clock,
    driverFactory(args) {const driver = {...args, disconnected: [], submitInput() {}, disconnect(id) {this.disconnected.push(id);}, stop() {}, snapshot() {return null;}};
      drivers.push(driver); return driver;}, ...options});
  const base = `http://127.0.0.1:${await listenLoopback(instance.server)}`;
  t.after(async () => {instance.closeStreams(); await new Promise(done => instance.server.close(done));
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(root, {recursive: true, force: true});});
  const request = (route, {cookie, method = 'GET', body, signal, headers = {}} = {}) => fetch(base + route, {
    method, signal, headers: {'Content-Type': 'application/json', ...(cookie ? {cookie} : {}), ...headers},
    ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const login = async account => {const response = await request('/api/login', {method: 'POST', body: account});
    assert.equal(response.status, 200); await response.json(); return response.headers.get('set-cookie').split(';')[0];};
  const open = async (cookie,token) => {const response = await request('/api/online/poll/open', {cookie, method: 'POST', body: {},
    headers:token===undefined?{}:{'X-RF-Page-Init':token}});
    assert.equal(response.status, 200); return response.json();};
  const poll = (cookie, lease, after = lease.cursor, extras = {}) => request(`/api/online/poll?connectionId=${lease.connectionId}&after=${after}`, {cookie, ...extras});
  return {base, instance, drivers, disconnectTimers, pollTimers, request, login, open, poll,
    async advance(ms) {clock += ms; await instance.online.tick();},
    async match() {const cookies = await Promise.all(accounts.map(login)), leases = await Promise.all(cookies.map(cookie=>open(cookie)));
      for (const cookie of cookies) assert.equal((await request('/api/online/queue', {cookie, method: 'POST', body: {mode: '2v2'}})).status, 200);
      clock += 11_000; await instance.online.tick(); assert.equal(drivers.length, 1); return {cookies, leases, driver: drivers[0]};},
  };
}
async function pendingPoll(t, f, cookie, lease, after) {
  const abort = new AbortController();
  let observer;
  const seen = new Promise(done => {observer = (req, res) => {
    if (!req.url.startsWith('/api/online/poll?') || req.headers.cookie !== cookie) return;
    f.instance.server.off('request', observer); done(res);
  }; f.instance.server.on('request', observer);});
  const response = f.poll(cookie, lease, after, {signal: abort.signal}).catch(() => null), res = await seen;
  const closed = new Promise(done => res.once('close', done));
  t.after(() => {abort.abort(); f.instance.server.off('request', observer);});
  return {response, res, closed, async abort() {abort.abort(); await closed; await response;}};
}
async function completedPollTimer(f,cookie,lease,after=lease.cursor){
  const route=`/api/online/poll?connectionId=${lease.connectionId}&after=${after}`;
  let observer;
  const closed=new Promise((resolve,reject)=>{
    observer=(req,res)=>{
      if(req.url!==route||req.headers.cookie!==cookie)return;
      f.instance.server.off('request',observer);
      const before=f.disconnectTimers.latest;
      // The server registered its response-close listener before this observer.
      // Both listeners run synchronously in this specific response's close
      // event: latest therefore belongs to this cookie/lease, never a different
      // player's delayed close arriving elsewhere in the event loop.
      res.once('close',()=>{
        const timer=f.disconnectTimers.latest;
        if(!timer||timer===before||!f.disconnectTimers.pending.has(timer))reject(Error('Target poll close did not schedule its disconnect timer'));
        else resolve(timer);
      });
    };f.instance.server.on('request',observer);
  });
  closed.catch(()=>{});
  try{
    const response=await f.poll(cookie,lease,after);assert.equal(response.status,200);await response.json();
    return await closed;
  }finally{f.instance.server.off('request',observer);}
}
const close = (f, cookie, lease) => f.request('/api/online/poll/close', {cookie, method: 'POST', body: {connectionId: lease.connectionId}});

test('current-page worker heartbeat preserves a loading room across missed polls, then expires at the original20s liveness bound',async t=>{
  const f=await fixture(t),{cookies,leases,driver}=await f.match(),cookie=cookies[0],token='loading-worker-page-v49';
  assert.equal((await f.request('/api/session',{cookie,headers:{'X-RF-Page-Init':token}})).status,200);
  leases[0]=await f.open(cookie,token); // Fresh page owns a replacement lease.
  const beat=()=>f.request('/api/heartbeat',{cookie,method:'POST',headers:{'X-RF-Page-Init':token}});
  assert.equal((await beat()).status,200);let targetTimer=await completedPollTimer(f,cookie,leases[0]);
  const fireTarget=()=>{if(f.disconnectTimers.pending.delete(targetTimer))targetTimer.callback();targetTimer=f.disconnectTimers.latest;};
  for(let i=0;i<7;i++){
    await f.advance(5000);assert.equal((await beat()).status,200);
    for(const other of cookies.slice(1))await f.request('/api/heartbeat',{cookie:other,method:'POST'});
    fireTarget();assert.equal(f.instance.sessions.size,4);assert.deepEqual(driver.disconnected,[]);
  }
  await f.advance(19_999);fireTarget();assert.equal(f.instance.sessions.size,4);
  await f.advance(1);f.instance.expireSessions();f.disconnectTimers.fire();assert.equal(f.instance.sessions.size,0);
  assert.equal(driver.disconnected.filter(id=>id===accounts[0].username).length,1);
});
test('a retired heartbeat token cannot acquire loading recovery or evict the current page',async t=>{
  const f=await fixture(t),{cookies,leases,driver}=await f.match(),cookie=cookies[0];
  await f.request('/api/session',{cookie,headers:{'X-RF-Page-Init':'current-loading-page'}});
  leases[0]=await f.open(cookie,'current-loading-page');
  const rejected=await f.request('/api/heartbeat',{cookie,method:'POST',headers:{'X-RF-Page-Init':'retired-loading-page'}});
  assert.equal(rejected.status,409);assert.equal((await rejected.json()).error,'page-generation-retired');
  const deadline=await completedPollTimer(f,cookie,leases[0]);f.disconnectTimers.pending.delete(deadline);deadline.callback();assert.equal(f.instance.sessions.size,3);assert.deepEqual(driver.disconnected,[accounts[0].username]);
});

test('poll selection, authentication, origin, role boundaries, lease ownership, and SSE mutual exclusion remain enforced', async t => {
  const f = await fixture(t), cookie = await f.login(accounts[1]);
  assert.equal((await f.request('/api/online/poll/open', {method: 'POST', body: {}})).status, 401);
  assert.equal((await f.request('/api/online/poll/open', {cookie, method: 'POST', body: {}, headers: {Origin: 'https://wrong.example'}})).status, 403);
  assert.equal((await f.request('/api/session',{cookie})).status,200);
  assert.equal((await f.request('/api/admin/accounts', {cookie})).status, 403);
  assert.equal((await (await f.request('/api/session', {cookie})).json()).onlineEventTransport, 'poll');
  for (const body of [null, 1, [], {extra: true}]) assert.equal((await f.request('/api/online/poll/open', {cookie, method: 'POST', body})).status, 400);
  const lease = await f.open(cookie);
  assert.equal((await f.request(`/api/online/poll?connectionId=${lease.connectionId}&after=01`, {cookie})).status, 400);
  assert.equal((await f.poll(cookie, lease, Number.MAX_SAFE_INTEGER + 1)).status, 400);
  assert.equal((await f.request('/api/online/events', {cookie})).status, 409);
  const other = await f.login(accounts[0]);
  assert.equal((await f.poll(other, lease)).status, 409);
  const response = await f.poll(cookie, lease), batch = await response.json();
  assert.deepEqual(batch.events.map(event => event.type), ['status']); assert.equal(batch.cursor, 1);
  const wait = await pendingPoll(t, f, cookie, lease, batch.cursor);
  const duplicate = await f.poll(cookie, lease, batch.cursor);
  assert.equal(duplicate.status, 409); assert.equal((await duplicate.json()).error, 'poll-already-pending');
  assert.equal((await f.request('/api/online/poll/open', {cookie, method: 'POST', body: {}})).status, 409);
  await wait.abort();
});

test('queued empty poll holds ten seconds, then gaps and aborted requests receive the original 2.5-second grace', async t => {
  const f = await fixture(t), cookie = await f.login(accounts[0]);
  await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}}); const lease = await f.open(cookie);
  const seed = await (await f.poll(cookie, lease)).json();
  const wait = await pendingPoll(t, f, cookie, lease, seed.cursor);
  assert.equal(f.disconnectTimers.pending.size, 0);
  const timer = await f.pollTimers.wait(); assert.equal(timer.delay, 10_000); f.pollTimers.fire();
  const response = await wait.response; assert.deepEqual(await response.json(), {events: [], cursor: seed.cursor}); await wait.closed;
  const deadline = await f.disconnectTimers.wait(); assert.equal(deadline.delay, 2500);
  const retry = await pendingPoll(t, f, cookie, lease, seed.cursor);
  assert.equal(f.disconnectTimers.pending.size, 0); deadline.callback(); assert.equal(f.instance.sessions.size, 1);
  await retry.abort(); assert.equal((await f.disconnectTimers.wait()).delay, 2500);
  f.disconnectTimers.fire(); assert.equal(f.instance.sessions.size, 0);
  assert.equal((await f.request('/api/session', {cookie})).status, 401);
});

test('queued open without its first GET expires, and repeated open rotates ID without extending its original deadline', async t => {
  const f = await fixture(t), cookie = await f.login(accounts[0]);
  await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}}); const first = await f.open(cookie);
  const deadline = await f.disconnectTimers.wait(), second = await f.open(cookie);
  assert.notEqual(first.connectionId, second.connectionId); assert.equal([...f.disconnectTimers.pending][0], deadline);
  assert.equal((await close(f, cookie, first)).status, 200);
  assert.equal((await f.poll(cookie, first)).status, 409);
  f.disconnectTimers.fire(); assert.equal(f.instance.sessions.size, 0);
});

test('new lobby page can replace a pending lease; late abort and close of the old page cannot affect its replacement', async t => {
  const f = await fixture(t), cookie = await f.login(accounts[0]), first = await f.open(cookie);
  const seed = await (await f.poll(cookie, first)).json(), old = await pendingPoll(t, f, cookie, first, seed.cursor);
  assert.equal((await f.request('/api/session', {cookie})).status, 200);
  const second = await f.open(cookie); assert.notEqual(second.connectionId, first.connectionId);
  await old.closed; await old.response;
  assert.equal(f.disconnectTimers.pending.size,0);
  assert.equal((await close(f, cookie, first)).status, 200);
  assert.equal(f.disconnectTimers.pending.size,0);
  const newSeed = await (await f.poll(cookie, second)).json();
  assert.equal(newSeed.events[0].type, 'status'); f.disconnectTimers.fire(); assert.equal(f.instance.sessions.size, 1);
});

test('ordinary queued session reads and all matched page-init GETs keep the original gap deadline', async t => {
  for (const matched of [false, true]) {
    const f = await fixture(t);
    let cookies, leases;
    if (matched) {cookies = await Promise.all(accounts.map(f.login)); leases = await Promise.all(cookies.map(cookie=>f.open(cookie)));}
    else {cookies = [await f.login(accounts[0])]; leases = [await f.open(cookies[0])];}
    const cookie = cookies[0], lease = leases[0];
    await f.request('/api/session', {cookie});
    for (const member of cookies) await f.request('/api/online/queue', {cookie: member, method: 'POST', body: {mode: '2v2'}});
    if (matched) {await f.advance(11_000); assert.equal(f.drivers.length, 1);}
    const batch = await (await f.poll(cookie, lease)).json(), wait = await pendingPoll(t, f, cookie, lease, batch.cursor);
    const beforeClose = new Set(f.disconnectTimers.pending);
    await wait.abort(); const timer = [...f.disconnectTimers.pending].find(row => !beforeClose.has(row)); assert.ok(timer);
    const owned = [...f.disconnectTimers.pending];
    await f.request('/api/session', {cookie, headers: matched ? {'X-RF-Page-Init': 'matched-reload-1'} : {}});
    assert.deepEqual([...f.disconnectTimers.pending], owned);
    const replacement = await f.open(cookie,matched?'matched-reload-1':undefined); assert.notEqual(replacement.connectionId, lease.connectionId);
    assert.deepEqual([...f.disconnectTimers.pending], owned, 'open cannot postpone a queued/matched disconnect');
    timer.callback(); assert.equal((await f.request('/api/session', {cookie})).status, 401);
    if (matched) assert.deepEqual(f.drivers[0].disconnected, [accounts[0].username]);
    else assert.equal(f.instance.online.status(accounts[0].username).queued, false);
  }
});

test('queued page-init handoff before or after old close keeps six-second asset loading alive and preserves waiting', async t => {
  for(const closeFirst of [false,true]){
    const f=await fixture(t),cookie=await f.login(accounts[0]),first=await f.open(cookie);
    const queued=await (await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}})).json();
    await f.poll(cookie,first);const stale=await f.disconnectTimers.wait();
    await f.advance(3000);const before=f.instance.online.status(accounts[0].username);
    if(closeFirst)assert.equal((await close(f,cookie,first)).status,200);
    const headers={'X-RF-Page-Init':'queued-refresh-'+Number(closeFirst)};
    const session=await f.request('/api/session',{cookie,headers});assert.equal(session.status,200);
    const paused=(await session.json()).online;assert.equal(paused.queued,true);assert.equal(paused.locked,true);
    assert.equal(paused.queue.loading,true);assert.equal(paused.queue.eligibleSize,0);
    assert.equal(paused.queue.joinedAt,queued.queue.joinedAt);assert.equal(f.disconnectTimers.pending.size,0);
    // A GET belonging to the old generation cannot complete this page load.
    assert.equal((await f.poll(cookie,first)).status,409);
    if(!closeFirst)assert.equal((await close(f,cookie,first)).status,200);
    stale.callback();assert.equal(f.instance.sessions.size,1);assert.equal(f.disconnectTimers.pending.size,0);
    await f.advance(6000);f.instance.expireSessions();assert.equal(f.instance.sessions.size,1);
    const script=await f.request('/game/game.js',{cookie});assert.equal(script.status,200);assert.equal(await script.text(),'poll fixture');
    assert.equal((await f.request('/api/heartbeat',{cookie,method:'POST'})).status,200);
    // The page's second auth check has the same init token, so it neither
    // starts a new generation nor loses the preserved queue entry.
    assert.equal((await f.request('/api/session',{cookie,headers})).status,200);
    const second=await f.open(cookie,headers['X-RF-Page-Init']);assert.notEqual(second.connectionId,first.connectionId);
    const firstGetDeadline=await f.disconnectTimers.wait();assert.equal(firstGetDeadline.delay,2500);
    assert.equal((await close(f,cookie,first)).status,200);stale.callback();
    assert.equal([...f.disconnectTimers.pending][0],firstGetDeadline);
    const batch=await (await f.poll(cookie,second)).json();assert.ok(batch.events.some(event=>event.type==='status'));
    const resumed=f.instance.online.status(accounts[0].username);
    assert.equal(resumed.queued,true);assert.equal(resumed.queue.joinedAt,queued.queue.joinedAt);
    assert.equal(resumed.queue.loading,false);assert.equal(resumed.queue.eligibleSize,1);
    assert.ok(resumed.queue.elapsedSeconds>=before.queue.elapsedSeconds+6);
    firstGetDeadline.callback();assert.equal(f.instance.sessions.size,1);
    const currentGap=await f.disconnectTimers.wait();
    const repeat=await (await f.request('/api/session',{cookie,headers})).json();
    assert.equal(repeat.online.queue.loading,false,'same page token cannot pause the resumed queue again');
    assert.deepEqual([...f.disconnectTimers.pending],[currentGap]);
    assert.equal((await f.poll(cookie,second,0)).status,200,'same token cannot retire the current lease generation');
    assert.equal((await f.request('/api/nickname-preferences',{cookie,method:'PUT',body:{nickname:'still-frozen'}})).status,409);
  }
});

test('a queued loading page remains frozen and unselected while four other HTTP participants match',async t=>{
  const extra={username:'poll-extra',password:'fixture-secret-extra',role:'player'};
  const f=await fixture(t,{additionalCredentials:[...accounts.slice(1),extra]}),cookie=await f.login(accounts[0]),first=await f.open(cookie);
  assert.equal((await f.request('/api/nickname-preferences',{cookie,method:'PUT',body:{nickname:'\uac40\uac0c\uac09\uac34\uac28\uac32'}})).status,200);
  const queued=await (await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}})).json();
  await f.poll(cookie,first);const stale=await f.disconnectTimers.wait();
  const headers={'X-RF-Page-Init':'paused-load-one'};
  assert.equal((await f.request('/api/session',{cookie,headers})).status,200);
  assert.equal((await f.poll(cookie,first)).status,409);stale.callback();assert.equal(f.instance.sessions.size,1);
  await f.advance(6000);assert.equal((await f.request('/api/heartbeat',{cookie,method:'POST'})).status,200);
  const others=[...accounts.slice(1),extra],cookies=await Promise.all(others.map(f.login));
  for(const otherCookie of cookies){const lease=await f.open(otherCookie);
    assert.equal((await f.request('/api/online/queue',{cookie:otherCookie,method:'POST',body:{mode:'2v2'}})).status,200);
    assert.equal((await f.poll(otherCookie,lease)).status,200);
  }
  await f.advance(11_000);assert.equal(f.drivers.length,1);
  assert.deepEqual(new Set(f.drivers[0].match.players.map(p=>p.username)),new Set(others.map(a=>a.username)));
  const waiting=f.instance.online.status(accounts[0].username);assert.equal(waiting.queued,true);assert.equal(waiting.match,null);
  assert.equal(waiting.queue.loading,true);assert.equal(waiting.queue.eligibleSize,0);
  assert.equal(waiting.queue.joinedAt,queued.queue.joinedAt);assert.ok(waiting.queue.elapsedSeconds>=17);
  assert.equal((await f.request('/api/nickname-preferences',{cookie,method:'PUT',body:{nickname:'cannot-replace'}})).status,409);
  const second=await f.open(cookie,headers['X-RF-Page-Init']);assert.equal((await f.poll(cookie,second)).status,200);
  const restored=f.instance.online.status(accounts[0].username);assert.equal(restored.queue.joinedAt,queued.queue.joinedAt);
  assert.equal(restored.queue.loading,false);assert.equal(restored.queue.eligibleSize,1);
  assert.ok(restored.queue.elapsedSeconds>=waiting.queue.elapsedSeconds);
});

test('queued refresh still expires at twenty seconds without liveness and new-open still needs GET in2.5s',async t=>{
  for(const openReplacement of [false,true]){
    const f=await fixture(t),cookie=await f.login(accounts[0]),first=await f.open(cookie);
    await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}});await f.poll(cookie,first);
    const stale=await f.disconnectTimers.wait();await close(f,cookie,first);
    assert.equal((await f.request('/api/session',{cookie,headers:{'X-RF-Page-Init':'load-timeout-'+Number(openReplacement)}})).status,200);
    stale.callback();assert.equal(f.instance.sessions.size,1);
    if(openReplacement){
      await f.open(cookie,'load-timeout-'+Number(openReplacement));const deadline=await f.disconnectTimers.wait();assert.equal(deadline.delay,2500);
      f.disconnectTimers.fire();assert.equal(f.instance.sessions.size,0);
    }else{
      await f.advance(19_000);f.instance.expireSessions();assert.equal(f.instance.sessions.size,1);
      await f.advance(1000);f.instance.expireSessions();assert.equal(f.instance.sessions.size,0);
    }
    assert.equal(f.instance.online.status(accounts[0].username).queued,false);
    assert.equal((await f.request('/api/session',{cookie})).status,401);
  }
});

test('page-init handoff and queue selection serialize safely in either execution order',async t=>{
  for(const refreshFirst of [false,true]){
    const f=await fixture(t),cookies=await Promise.all(accounts.map(f.login)),leases=await Promise.all(cookies.map(cookie=>f.open(cookie)));
    let stale;
    for(let i=0;i<cookies.length;i++){
      assert.equal((await f.request('/api/online/queue',{cookie:cookies[i],method:'POST',body:{mode:'2v2'}})).status,200);
      const timer=await completedPollTimer(f,cookies[i],leases[i]);if(i===0)stale=timer;
    }
    const target=cookies[0],before=f.instance.online.status(accounts[0].username);assert.ok(stale);
    const refresh=()=>f.request('/api/session',{cookie:target,headers:{'X-RF-Page-Init':'queue-race-'+Number(refreshFirst)}});
    if(refreshFirst){
      assert.equal((await refresh()).status,200);await f.advance(11_000);assert.equal(f.drivers.length,0);
      assert.equal(f.instance.online.status(accounts[0].username).queue.joinedAt,before.queue.joinedAt);
      for(const cookie of cookies.slice(1))assert.equal((await f.request('/api/heartbeat',{cookie,method:'POST'})).status,200);
      const newLease=await f.open(target,'queue-race-'+Number(refreshFirst));assert.equal((await f.poll(target,newLease)).status,200);
      stale.callback();assert.equal(f.instance.sessions.size,4);
      await f.advance(11_000);assert.equal(f.drivers.length,1);
    }else{
      await f.advance(11_000);assert.equal(f.drivers.length,1);
      const current=[...f.disconnectTimers.pending];assert.equal((await refresh()).status,200);
      assert.deepEqual([...f.disconnectTimers.pending],current,'matched init cannot retire its original deadline');
      stale.callback();assert.equal(f.instance.sessions.size,3);assert.deepEqual(f.drivers[0].disconnected,[accounts[0].username]);
    }
  }
});

test('a delayed old-page poll/open body cannot acquire a replacement generation or renew its deadline',async t=>{
  const f=await fixture(t),cookie=await f.login(accounts[0]),tokenA='body-race-page-a',tokenB='body-race-page-b';
  const initial=await (await f.request('/api/session',{cookie,headers:{'X-RF-Page-Init':tokenA}})).json();
  assert.equal(initial.pageInitToken,tokenA);
  const queued=await (await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}})).json();
  assert.equal(queued.queue.loading,false);assert.equal(f.disconnectTimers.pending.size,0);
  let observe;
  const entered=new Promise(resolve=>{observe=(req,res)=>{
    if(req.url!=='/api/online/poll/open'||req.headers.cookie!==cookie||req.headers['x-rf-page-init']!==tokenA)return;
    f.instance.server.off('request',observe);resolve({req,res});
  };f.instance.server.on('request',observe);});
  let old;
  const finished=new Promise((resolve,reject)=>{
    old=http.request(f.base+'/api/online/poll/open',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','Content-Length':2,'X-RF-Page-Init':tokenA}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
    });old.on('error',reject);old.flushHeaders();
  });
  // Keep failed assertions from leaving an incomplete HTTP request in teardown.
  finished.catch(()=>{});
  try{
    const {req}=await entered;assert.equal(req.complete,false,'headers arrive before the old body is supplied');
    const current=await (await f.request('/api/session',{cookie,headers:{'X-RF-Page-Init':tokenB}})).json();
    assert.equal(current.pageInitToken,tokenB);assert.equal(current.online.queue.loading,true);
    assert.equal(current.online.queue.eligibleSize,0);assert.equal(current.online.queue.joinedAt,queued.queue.joinedAt);
    assert.equal(f.disconnectTimers.pending.size,0);
    old.end('{}');const rejected=await finished;
    assert.deepEqual(rejected,{status:409,body:{error:'page-generation-retired'}});
    assert.equal(f.disconnectTimers.pending.size,0,'the rejected body cannot install a lease/grace timer');
    const late=await f.request('/api/online/poll/open',{cookie,method:'POST',body:{},headers:{'X-RF-Page-Init':tokenA}});
    assert.equal(late.status,409);assert.equal((await late.json()).error,'page-generation-retired');
    assert.equal(f.disconnectTimers.pending.size,0);assert.equal(f.instance.online.status(accounts[0].username).queue.loading,true);
    const replacement=await f.open(cookie,tokenB),deadline=await f.disconnectTimers.wait();assert.equal(deadline.delay,2500);
    assert.equal(f.instance.online.status(accounts[0].username).queue.loading,true,'open alone cannot resume queued selection');
    assert.equal((await f.poll(cookie,replacement)).status,200);
    const resumed=f.instance.online.status(accounts[0].username);assert.equal(resumed.queue.loading,false);
    assert.equal(resumed.queue.eligibleSize,1);assert.equal(resumed.queue.joinedAt,queued.queue.joinedAt);
    deadline.callback();assert.equal(f.instance.sessions.size,1);
  }finally{f.instance.server.off('request',observe);old.destroy();}
});

test('a retired page-init token cannot take over again after the new page has opened and resumed its queue',async t=>{
  const f=await fixture(t),cookie=await f.login(accounts[0]),tokenA='retired-page-a',tokenB='retired-page-b';
  assert.equal((await f.request('/api/session',{cookie,headers:{'X-RF-Page-Init':tokenA}})).status,200);
  const queued=await (await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}})).json();
  const newPage=await (await f.request('/api/session',{cookie,headers:{'X-RF-Page-Init':tokenB}})).json();
  assert.equal(newPage.pageInitToken,tokenB);assert.equal(newPage.online.queue.loading,true);
  const lease=await f.open(cookie,tokenB);assert.equal((await f.poll(cookie,lease)).status,200);
  const gap=await f.disconnectTimers.wait(),before=f.instance.online.status(accounts[0].username);
  const late=await f.request('/api/session',{cookie,headers:{'X-RF-Page-Init':tokenA}});
  assert.equal(late.status,409);assert.deepEqual(await late.json(),{error:'page-initialization-retired'});
  assert.deepEqual(f.instance.online.status(accounts[0].username),before);assert.deepEqual([...f.disconnectTimers.pending],[gap]);
  const current=await (await f.request('/api/session',{cookie,headers:{'X-RF-Page-Init':tokenB}})).json();
  assert.equal(current.pageInitToken,tokenB);assert.equal(current.online.queue.loading,false);
  assert.equal(current.online.queue.joinedAt,queued.queue.joinedAt);assert.deepEqual([...f.disconnectTimers.pending],[gap]);
  assert.equal((await f.poll(cookie,lease,0)).status,200,'the current lease generation survives the retired GET');
});

test('lobby reload and absence of heartbeat keep local play alive beyond twenty seconds', async t => {
  const f = await fixture(t), cookie = await f.login(accounts[0]), lease = await f.open(cookie);
  await close(f, cookie, lease); assert.equal(f.disconnectTimers.pending.size,0);
  await f.request('/api/session', {cookie}); assert.equal(f.disconnectTimers.pending.size, 0);
  f.disconnectTimers.fire(); assert.equal(f.instance.sessions.size, 1);
  await f.advance(20_000); f.instance.expireSessions(); assert.equal(f.instance.sessions.size, 1);
});

test('lobby GET followed by queue on an already idle poll restores the combat gap without waiting for another GET or close', async t => {
  const f = await fixture(t), cookie = await f.login(accounts[0]), lease = await f.open(cookie);
  const batch = await (await f.poll(cookie, lease)).json(); assert.equal(batch.events[0].type, 'status');
  assert.equal(f.disconnectTimers.pending.size,0);
  await f.request('/api/session', {cookie}); assert.equal(f.disconnectTimers.pending.size, 0);
  await f.request('/api/online/queue', {cookie, method: 'POST', body: {mode: '2v2'}});
  const current = await f.disconnectTimers.wait(); assert.equal(current.delay, 2500);
  assert.equal(f.instance.sessions.size, 1); assert.equal([...f.disconnectTimers.pending][0], current);
  f.disconnectTimers.fire(); assert.equal(f.instance.sessions.size, 0);
  assert.equal(f.instance.online.status(accounts[0].username).queued, false);
});

test('playing poll leases survive old matching deadlines and login expiry while active, and an explicit lease close permits authenticated recovery',async t=>{
  const f=await fixture(t,{sessionSeconds:15}),{cookies,leases,driver}=await f.match();
  const stale=[...f.disconnectTimers.pending];assert.equal(stale.length,4);
  driver.emit('state',{matchId:driver.match.id,pvp:{phase:'intro'}});
  for(const cookie of cookies)await f.request('/api/heartbeat',{cookie,method:'POST'});
  await f.advance(15_000);f.instance.expireSessions();for(const timer of stale)timer.callback();f.disconnectTimers.fire();
  assert.equal(f.instance.sessions.size,4);assert.deepEqual(driver.disconnected,[]);assert.equal(f.disconnectTimers.pending.size,0);
  const closed=await close(f,cookies[0],leases[0]);assert.equal(closed.status,200);assert.match(closed.headers.get('set-cookie'),/Max-Age=15/);
  assert.equal(f.disconnectTimers.pending.size,0);
  assert.equal((await f.poll(cookies[0],leases[0])).status,409);
  const session=await f.request('/api/session',{cookie:cookies[0]});assert.equal(session.status,200);
  const replacement=await f.open(cookies[0]);assert.equal(f.disconnectTimers.pending.size,0);
  const batch=await(await f.poll(cookies[0],replacement)).json();assert.ok(batch.events.some(e=>e.type==='match'));
  assert.equal(f.disconnectTimers.pending.size,0);assert.deepEqual(driver.disconnected,[]);
});

test('opening after completed authoritative settlement seeds the missed result but opening a new match omits the old result', async t => {
  const f = await fixture(t), {cookies, leases, driver} = await f.match();
  const result = {winnerTeam: 0, score: [4, 1], reason: 'fixture-score', players: driver.match.players.map(player => ({id: player.id, kills: 1, assists: 1, deaths: 1}))};
  assert.equal(await driver.finish(result), true);
  await close(f, cookies[0], leases[0]);
  const resumed = await f.open(cookies[0]), batch = await (await f.poll(cookies[0], resumed)).json();
  assert.deepEqual(batch.events.map(event => event.type), ['status', 'result']);
  assert.equal(batch.events[1].data.matchId, driver.match.id); assert.equal(batch.events[1].data.result.winnerTeam, 0);
  await f.request('/api/session', {cookie: cookies[0]});
  for (const cookie of cookies) await f.request('/api/online/queue', {cookie, method: 'POST', body: {mode: '2v2'}});
  await f.advance(11_000); assert.equal(f.drivers.length, 2);
  await close(f, cookies[0], resumed);
  const next = await f.open(cookies[0]), nextBatch = await (await f.poll(cookies[0], next)).json();
  assert.deepEqual(nextBatch.events.slice(0, 2).map(event => event.type), ['status', 'match']);
  assert.equal(nextBatch.events.some(event => event.type === 'result'), false);
  assert.equal(nextBatch.events[1].data.id, f.drivers[1].match.id);
});

test('server shutdown cancels active polling and disconnect timers and releases all session state', async t => {
  const f = await fixture(t), cookie = await f.login(accounts[0]), lease = await f.open(cookie);
  const seed = await (await f.poll(cookie, lease)).json(), wait = await pendingPoll(t, f, cookie, lease, seed.cursor);
  f.instance.closeStreams(); await wait.closed; await wait.response;
  await new Promise(done => f.instance.server.close(done));
  assert.equal(f.instance.sessions.size, 0); assert.equal(f.disconnectTimers.pending.size, 0); assert.equal(f.pollTimers.pending.size, 0);
});

test('logout and old-login callbacks cannot close a new session; explicit close is idempotent and ends a pending response', async t => {
  const f = await fixture(t), cookie = await f.login(accounts[0]);
  await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}}); const lease = await f.open(cookie);
  const seed = await (await f.poll(cookie, lease)).json(), wait = await pendingPoll(t, f, cookie, lease, seed.cursor);
  assert.equal((await close(f, cookie, lease)).status, 200); await wait.closed; await wait.response;
  const stale = await f.disconnectTimers.wait();
  assert.equal((await close(f, cookie, lease)).status, 200); assert.equal([...f.disconnectTimers.pending][0], stale);
  await f.request('/api/logout', {cookie, method: 'POST'});
  const fresh = await f.login(accounts[0]); await f.request('/api/online/queue',{cookie:fresh,method:'POST',body:{mode:'2v2'}});
  const newLease = await f.open(fresh), current = await f.disconnectTimers.wait();
  stale.callback(); assert.equal(f.instance.sessions.size, 1); assert.equal([...f.disconnectTimers.pending][0], current);
  assert.equal((await close(f, fresh, lease)).status, 200);
  assert.equal((await f.poll(fresh, newLease)).status, 200);
});

test('HTTP state backlog keeps only the latest snapshot while match/result events survive and the gzip batch is complete', async t => {
  const f = await fixture(t), {cookies, leases, driver} = await f.match();
  for (let sequence = 0; sequence < 1000; sequence++) driver.emit('state', {matchId: driver.match.id, sequence, snapshot: {fixture: 'x'.repeat(1000)}});
  driver.emit('result', {matchId: driver.match.id, fixture: true});
  const raw = await new Promise((resolve, reject) => {
    http.get(`${f.base}/api/online/poll?connectionId=${leases[0].connectionId}&after=0`, {headers: {Cookie: cookies[0], 'Accept-Encoding': 'gzip'}}, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({res, body: Buffer.concat(chunks)})); res.on('error', reject);
    }).on('error', reject);
  });
  assert.equal(raw.res.statusCode, 200); assert.equal(raw.res.headers['content-encoding'], 'gzip');
  const batch = JSON.parse(gunzipSync(raw.body));
  assert.equal(batch.events.filter(event => event.type === 'state').length, 1);
  assert.equal(batch.events.find(event => event.type === 'state').data.sequence, 999);
  assert.ok(batch.events.some(event => event.type === 'match')); assert.equal(batch.events.at(-1).type, 'result');
  assert.ok(batch.events.length <= 129); assert.ok(raw.body.length < JSON.stringify(batch).length);
  assert.equal((await f.poll(cookies[0], leases[0], batch.cursor + 1)).status, 409);
  const plain = await f.poll(cookies[0], leases[0], 0, {headers: {'Accept-Encoding': 'gzip;q=0'}});
  assert.equal(plain.headers.get('content-encoding'), null); assert.deepEqual(await plain.json(), batch);
});

test('critical mailbox overflow closes the lease with bounded memory and invokes combat disconnect once after grace', async t => {
  const f = await fixture(t), {cookies, leases, driver} = await f.match();
  for (let sequence = 0; sequence < 150; sequence++) driver.emit('signal', {matchId: driver.match.id, sequence});
  const response = await f.poll(cookies[0], leases[0]); assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'poll-connection-not-active');
  f.disconnectTimers.fire(); assert.equal(f.instance.sessions.size, 0);
  assert.equal(driver.disconnected.filter(id => id === accounts[0].username).length, 1);
});

test('default remains SSE and an active SSE cannot be bypassed by poll/open', async t => {
  const f = await fixture(t, {onlineEventTransport: 'sse'}), cookie = await f.login(accounts[0]);
  assert.equal((await (await f.request('/api/session', {cookie})).json()).onlineEventTransport, 'sse');
  const abort = new AbortController(); t.after(() => abort.abort());
  const response = await f.request('/api/online/events', {cookie, signal: abort.signal}); assert.equal(response.status, 200);
  assert.equal((await f.request('/api/online/poll/open', {cookie, method: 'POST', body: {}})).status, 409);
  await response.body.cancel(); abort.abort();
});

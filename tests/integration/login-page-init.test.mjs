/** Execute the entry-point initialization with a transport substitute. The
 * dynamic game import is replaced solely to observe its timing and URL. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../apps/web/login.mjs',import.meta.url),'utf8');
test('one page initializes twice with the same handover token and starts heartbeat before heavy game import',async()=>{
  const calls=[],intervals=[],app={innerHTML:'',dataset:{}};let identities=0;
  const sandbox={crypto:{randomUUID:()=>{identities++;return 'page-identity-123';}},
    document:{querySelector:selector=>selector==='#app'?app:{addEventListener(){}},createElement:()=>({}),head:{append(){}}},
    window:{addEventListener(){}},location:{reload(){}},setInterval(fn,delay){calls.push('heartbeat-start');intervals.push({fn,delay});return 1;},clearInterval(){},
    fetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({buildVersion:'fixture-build'})};},
    loadedGame:async version=>calls.push({importVersion:version})};
  const observed=source.replace("await import('/game/game.js' + version);",'await loadedGame(version);');
  assert.notEqual(observed,source,'the real entry-point import remains the observed boundary');
  await new vm.Script('(async()=>{'+observed+'})()').runInNewContext(sandbox);
  const sessions=calls.filter(call=>call.url==='/api/session');assert.equal(sessions.length,2);assert.equal(identities,1);
  assert.equal(sessions[0].options.headers['X-RF-Page-Init'],'page-identity-123');assert.equal(sessions[1].options.headers['X-RF-Page-Init'],'page-identity-123');
  assert.equal(app.dataset.pageInitToken,'page-identity-123','the game reads the same page identity without changing its cache URL');
  assert.equal(intervals.length,1);assert.equal(intervals[0].delay,5000);
  assert.ok(calls.indexOf('heartbeat-start')<calls.findIndex(call=>call.importVersion));
  assert.equal(calls.find(call=>call.importVersion).importVersion,'?v=fixture-build');
  await intervals[0].fn();assert.equal(calls.at(-1).url,'/api/heartbeat');assert.equal(calls.at(-1).options.method,'POST');
});

test('an anonymous page never starts heartbeat or imports battle resources before session authentication succeeds',async()=>{
  const requests=[],app={dataset:{}};
  const sandbox={crypto:{randomUUID:()=> 'anonymous-page-123'},
    document:{querySelector:selector=>selector==='#app'?app:{addEventListener(){}},
      createElement(){assert.fail('anonymous pages cannot build the game stylesheet');},head:{append(){assert.fail('game resources require authentication');}}},
    window:{addEventListener(){}},setInterval(){assert.fail('anonymous heartbeat cannot start');},clearInterval(){},
    fetch:async(url,options)=>{requests.push({url,options});return {ok:false,status:401};},
    loadedGame(){assert.fail('anonymous game import cannot run');}};
  const observed=source.replace("await import('/game/game.js' + version);",'await loadedGame(version);');
  await new vm.Script('(async()=>{'+observed+'})()').runInNewContext(sandbox);
  assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/session');
  assert.equal(requests[0].options.headers['X-RF-Page-Init'],'anonymous-page-123');
});

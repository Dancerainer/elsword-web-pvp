import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../apps/web/login.mjs',import.meta.url),'utf8');
const workerSource=source.slice(source.indexOf('function sessionHeartbeatWorker()'),source.indexOf('function beginHeartbeat()'));
const mainSource=source.slice(source.indexOf('let heartbeat=null;'),source.indexOf('async function enter()'));
test('worker independently tags each5s heartbeat, allows no overlapping request and retires on401/409',async()=>{
  for(const status of [200,401,409]){
    const intervals=[],messages=[],requests=[];let resolve;
    const c={self:{postMessage:x=>messages.push(x)},AbortController,setTimeout:()=>1,clearTimeout(){},
      setInterval(fn,ms){intervals.push({fn,ms});return 1;},clearInterval(){},fetch:(url,options)=>{requests.push({url,options});return new Promise(r=>{resolve=r;});}};
    vm.runInNewContext(workerSource+'\nsessionHeartbeatWorker();',c);
    c.self.onmessage({data:{url:'http://fixture/api/heartbeat',pageInitToken:'page-a'}});
    assert.equal(requests.length,1);assert.equal(intervals[0].ms,5000);await intervals[0].fn();assert.equal(requests.length,1,'one bounded request only');
    resolve({status});for(let i=0;i<10;i++)await Promise.resolve();
    if(status===200){c.self.onmessage({data:{pageInitToken:'page-b'}});const sent=intervals[0].fn();assert.equal(requests.length,2);assert.equal(requests[1].options.headers['X-RF-Page-Init'],'page-b');resolve({status:200});await sent;}
    else assert.deepEqual(messages.map(x=>({...x})),[{expired:status===401,retired:status===409,pageInitToken:'page-a'}]);
  }
});
test('page lifecycle owns exactly one worker and forwards handoff token changes without reloading a retired page',()=>{
  const workers=[],events=new Map(),revoked=[],app={dataset:{pageInitToken:'page-a'}};let reloads=0;
  const c={app,location:{href:'http://fixture/',reload(){reloads++;}},Blob,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL:x=>revoked.push(x)},
    window:{addEventListener:(name,fn)=>events.set(name,fn)},setInterval(){assert.fail('worker available');},clearInterval(){},
    Worker:class{constructor(){this.messages=[];workers.push(this);}postMessage(x){this.messages.push(x);}terminate(){this.stopped=true;}}};
  c.URL=class extends URL {static createObjectURL(){return 'blob:fixture';}static revokeObjectURL(x){revoked.push(x);}};
  vm.createContext(c);vm.runInContext(mainSource+'\nbeginHeartbeat();beginHeartbeat();',c);assert.equal(workers.length,1);
  const worker=workers[0];assert.equal(worker.messages[0].pageInitToken,'page-a');app.dataset.pageInitToken='page-b';events.get('webpvp-page-identity')();
  assert.equal(worker.messages[1].pageInitToken,'page-b');worker.onmessage({data:{retired:true,pageInitToken:'page-b'}});assert.equal(worker.stopped,true);assert.equal(reloads,0);
  assert.equal(revoked.length,1);events.get('pagehide')();assert.equal(revoked.length,1);
  vm.runInContext('beginHeartbeat()',c);workers[1].onmessage({data:{expired:true}});assert.equal(reloads,1);assert.equal(workers[1].stopped,true);
});
test('an in-flight old-token409 cannot stop the worker after an acknowledged handoff supplies its new token',async()=>{
 const sends=[],messages=[],intervals=[];let finish;
 const c={self:{postMessage:x=>messages.push(x)},AbortController,setTimeout:()=>1,clearTimeout(){},setInterval:fn=>{intervals.push(fn);return 1;},clearInterval(){},
  fetch:(_url,options)=>{sends.push(options.headers['X-RF-Page-Init']);return new Promise(resolve=>{finish=resolve;});}};
 vm.runInNewContext(workerSource+'\nsessionHeartbeatWorker();',c);
 c.self.onmessage({data:{url:'http://fixture/api/heartbeat',pageInitToken:'before-handoff'}});
 c.self.onmessage({data:{pageInitToken:'after-handoff'}});finish({status:409});for(let i=0;i<10;i++)await Promise.resolve();
 assert.deepEqual(messages,[]);const next=intervals[0]();assert.deepEqual(sends,['before-handoff','after-handoff']);finish({status:200});await next;
});
test('an acknowledged new identity restarts a worker retired before its handoff ACK arrived',()=>{
 const workers=[],events=new Map(),app={dataset:{pageInitToken:'before-handoff'}};
 const c={app,location:{href:'http://fixture/',reload(){assert.fail('a retired page does not reload');}},Blob,
  URL:class extends URL{static createObjectURL(){return 'blob:fixture';}static revokeObjectURL(){}},
  window:{addEventListener:(name,fn)=>events.set(name,fn)},
  Worker:class{constructor(){this.messages=[];workers.push(this);}postMessage(x){this.messages.push(x);}terminate(){this.stopped=true;}}};
 vm.runInNewContext(mainSource+'\nbeginHeartbeat();',c);
 workers[0].onmessage({data:{retired:true,pageInitToken:'before-handoff'}});assert.equal(workers[0].stopped,true);
 app.dataset.pageInitToken='after-handoff';events.get('webpvp-page-identity')();
 assert.equal(workers.length,2);assert.equal(workers[1].messages[0].pageInitToken,'after-handoff');
 workers[0].onmessage({data:{expired:true}});assert.equal(workers[1].stopped,undefined,'late message from the old owner cannot terminate its replacement');
 events.get('pagehide')();assert.equal(workers[1].stopped,true);
});
test('a queued retirement from the old token cannot stop a worker after identity acceptance',()=>{
 const workers=[],events=new Map(),app={dataset:{pageInitToken:'before-handoff'}};
 const c={app,location:{href:'http://fixture/',reload(){assert.fail('no reload');}},Blob,
  URL:class extends URL{static createObjectURL(){return 'blob:fixture';}static revokeObjectURL(){}},
  window:{addEventListener:(name,fn)=>events.set(name,fn)},
  Worker:class{constructor(){this.messages=[];workers.push(this);}postMessage(x){this.messages.push(x);}terminate(){this.stopped=true;}}};
 vm.runInNewContext(mainSource+'\nbeginHeartbeat();',c);
 app.dataset.pageInitToken='after-handoff';events.get('webpvp-page-identity')();
 workers[0].onmessage({data:{retired:true,pageInitToken:'before-handoff'}});
 assert.equal(workers[0].stopped,undefined);assert.equal(workers[0].messages.at(-1).pageInitToken,'after-handoff');
 events.get('pagehide')();
});
test('a worker that already retired can restart when its acknowledged replacement token arrives',async()=>{
 const sends=[],messages=[];let finish;
 const c={self:{postMessage:x=>messages.push(x)},AbortController,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
  fetch:(_url,options)=>{sends.push(options.headers['X-RF-Page-Init']);return new Promise(resolve=>{finish=resolve;});}};
 vm.runInNewContext(workerSource+'\nsessionHeartbeatWorker();',c);
 c.self.onmessage({data:{url:'http://fixture/api/heartbeat',pageInitToken:'before-handoff'}});
 finish({status:409});for(let i=0;i<10;i++)await Promise.resolve();assert.equal(messages[0].retired,true);
 c.self.onmessage({data:{pageInitToken:'after-handoff'}});assert.deepEqual(sends,['before-handoff','after-handoff']);finish({status:200});
 for(let i=0;i<10;i++)await Promise.resolve();assert.equal(messages.length,1);
});
test('the first worker starts only after the authenticated session accepts its page identity',async()=>{
 const workers=[],app={dataset:{pageInitToken:'new-login'},replaceChildren(){}},events=new Map();let resolveSession;
 const c={app,sessionHeaders:{'X-RF-Page-Init':'new-login'},location:{href:'http://fixture/',reload(){assert.fail('no reload');}},Blob,
  URL:class extends URL{static createObjectURL(){return 'blob:fixture';}static revokeObjectURL(){}},
  window:{addEventListener:(name,fn)=>events.set(name,fn)},document:{createElement:()=>({}),head:{append(){}}},
  fetch:()=>new Promise(resolve=>{resolveSession=resolve;}),
  Worker:class{constructor(){workers.push(this);}postMessage(){}terminate(){}}};
 const enter=source.slice(source.indexOf('async function enter()'),source.indexOf("loginForm.addEventListener('submit'"));
 vm.createContext(c);vm.runInContext(mainSource+'\n'+enter+'\nconst entering=enter();',c);
 assert.equal(workers.length,0,'no tagged heartbeat before the server accepts the page');
 resolveSession({ok:true,json:async()=>({})});await vm.runInContext('entering',c);
 assert.equal(workers.length,1);events.get('pagehide')();
});
test('fallback heartbeats ignore an old-token409 after handoff and a response after their owner stopped',async()=>{
 const intervals=[],cleared=[],requests=[],events=new Map(),app={dataset:{pageInitToken:'before-handoff'}};let finish;
 const c={app,location:{reload(){assert.fail('a stopped request must not reload');}},window:{addEventListener:(name,fn)=>events.set(name,fn)},
  setInterval(fn){intervals.push(fn);return intervals.length;},clearInterval:id=>cleared.push(id),
  fetch:(_url,options)=>{requests.push(options.headers['X-RF-Page-Init']);return new Promise(resolve=>{finish=resolve;});}};
 vm.runInNewContext(mainSource+'\nbeginHeartbeat();',c);
 const old=intervals[0]();app.dataset.pageInitToken='after-handoff';events.get('webpvp-page-identity')();finish({status:409});await old;
 assert.deepEqual(cleared,[]);const next=intervals[0]();assert.deepEqual(requests,['before-handoff','after-handoff']);
 events.get('pagehide')();finish({status:401});await next;assert.deepEqual(cleared,[1]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
const response=(value,status=200)=>({ok:status<400,status,json:async()=>value});
const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};

test('SSE takeover immediately stops the current client and reports an explicit terminal reason',async()=>{
 const requests=[],errors=[];let source;
 class Source{constructor(){this.listeners=new Map();source=this;}addEventListener(type,listener){this.listeners.set(type,listener);}close(){this.closed=true;}}
 const client=createOnlineClient({EventSource:Source,WebSocket:null,RTCPeerConnection:null,pageInitToken:'client-old-v59',
  fetch:async(url,options)=>{requests.push({url,options});return response({queued:false});},onError:error=>errors.push(error)});
 try{await client.open();source.listeners.get('session-replaced')({data:'{"error":"session-replaced"}'});
  assert.equal(source.closed,true);assert.equal(errors.length,1);assert.equal(errors[0].code,'session-replaced');assert.equal(errors[0].status,401);assert.equal(errors[0].fatal,true);
  source.listeners.get('session-replaced')({data:'{}'});assert.equal(errors.length,1,'late events from the closed instance are ignored');
  assert.ok(requests.every(row=>row.options.headers['X-RF-Page-Init']==='client-old-v59'));assert.ok(!requests.some(row=>row.url==='/api/logout'));
 }finally{client.close();}
});

test('poll takeover preserves the server reason and cleanup never logs out the replacement cookie',async()=>{
 const requests=[],errors=[];let finish;
 const client=createOnlineClient({eventTransport:'poll',WebSocket:null,RTCPeerConnection:null,pageInitToken:'poll-client-v59',
  fetch:async(url,options)=>{requests.push({url,options});if(url==='/api/online/poll/open')return response({connectionId:'old-lease',cursor:0});
   if(url.startsWith('/api/online/poll?'))return new Promise(resolve=>{finish=resolve;});return response({ok:true});},onError:error=>errors.push(error)});
 try{await client.open();finish(response({error:'session-replaced'},401));await settle();
  assert.equal(errors.length,1);assert.equal(errors[0].code,'session-replaced');assert.match(errors[0].message,/signed in elsewhere/);
  assert.ok(!requests.some(row=>row.url==='/api/logout'));assert.ok(requests.every(row=>row.options.headers['X-RF-Page-Init']==='poll-client-v59'));
 }finally{client.close();}
});

const loginSource=await readFile(new URL('../../apps/web/login.mjs',import.meta.url),'utf8');
test('the kicked login page shows its reason without automatically acquiring the shared new cookie',async()=>{
 const app={dataset:{}},error={textContent:''},form={addEventListener(){}};const requests=[];
 const document={querySelector(selector){return selector==='#app'?app:selector==='#login-error'?error:form;}};
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 await new AsyncFunction('document','crypto','window','fetch',loginSource)(document,{randomUUID:()=> 'login-kicked-v59'},
  {location:{search:'?session=replaced'},addEventListener(){}},async(url)=>{requests.push(url);return response({},401);});
 assert.deepEqual(requests,[]);assert.match(error.textContent,/Your account signed in elsewhere/);
});

test('heartbeat fallback identifies takeover even when the terminal transport event was lost',async()=>{
 const source=loginSource.slice(loginSource.indexOf('function sessionHeartbeatWorker()'),loginSource.indexOf('function beginHeartbeat()'));
 const messages=[],c={self:{postMessage:value=>messages.push(value)},AbortController,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
  fetch:async()=>response({error:'session-replaced'},401)};
 vm.runInNewContext(source+'\nsessionHeartbeatWorker()',c);c.self.onmessage({data:{url:'http://fixture/api/heartbeat',pageInitToken:'worker-old-v59'}});await settle();
 assert.equal(messages.length,1);assert.equal(messages[0].replaced,true);assert.equal(messages[0].expired,true);
});

for(const reason of ['client-program-outdated','remote-resources-disabled'])test(`delayed ${reason} cleanup retains its old page identity after a same-origin login`,async()=>{
 const source=loginSource.slice(loginSource.indexOf('async function enter()'),loginSource.indexOf("loginForm.addEventListener('submit'"));
 const requests=[],app={replaceChildren(){}};let finishJson,currentCookie='old-cookie',newSessionActive=true;
 const context={app,sessionHeaders:{'X-RF-Page-Init':'old-page-v59'},stopHeartbeat(){},document:{createElement:()=>({})},
  fetch:async(url,options)=>{requests.push({url,options,cookie:currentCookie});
   if(url==='/api/session')return {ok:reason!=='client-program-outdated',json:()=>new Promise(resolve=>{finishJson=resolve;})};
   assert.equal(url,'/api/logout');if(options.headers?.['X-RF-Page-Init']!=='old-page-v59')newSessionActive=false;
   return response({error:'session-replaced'},401);}};
 vm.createContext(context);vm.runInContext(source+'\nconst entering=enter();',context);await settle();
 currentCookie='new-shared-cookie';finishJson(reason==='client-program-outdated'?{error:reason}:{resourceDelivery:{enabled:false}});
 await vm.runInContext('entering',context);assert.equal(requests.length,2);assert.equal(requests[1].cookie,'new-shared-cookie');
 assert.equal(requests[1].options.headers['X-RF-Page-Init'],'old-page-v59');assert.equal(newSessionActive,true);
});

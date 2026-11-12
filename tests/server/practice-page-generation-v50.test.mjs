/** A status read has no authority to replace an explicitly identified page. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {request as httpRequest} from 'node:http';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';
async function fixture(t){
 const root=await mkdtemp(path.join(tmpdir(),'webpvp-practice-generation-'));
 await mkdir(path.join(root,'dist'));await writeFile(path.join(root,'dist/game.js'),'sealed-fixture');
 const account={username:'generation-player',password:'private-fixture-password',role:'player'};
 const app=await createDevServer({root,credentials:account}),origin='http://127.0.0.1:'+await listenLoopback(app.server);
 let cookie;
 const request=async(route,{method='GET',body,headers={}}={})=>fetch(origin+route,{method,
  headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const login=await request('/api/login',{method:'POST',body:account});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 t.after(async()=>{app.closeStreams();app.server.closeAllConnections();await new Promise(done=>app.server.close(done));
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
 return {app,request,origin,cookie};
}
test('signaling captures authenticated page identity and fences a body delayed across page replacement',async t=>{
 const {app,request,origin,cookie}=await fixture(t),seen=[];
 t.mock.method(app.online,'signal',(username,body,page)=>{seen.push({username,body,page});return {ok:true};});
 const body={matchId:'fixture-match',to:'b',type:'offer',payload:{type:'offer',sdp:'fixture'},signalVersion:1,generation:1,offerId:'fixture-offer'};
 assert.equal((await request('/api/online/signal',{method:'POST',body})).status,200,'untagged session remains valid when no page lease exists');
 assert.equal(seen[0].page.pageToken,null);
 const token='signaling-current-page-v51';await request('/api/session',{headers:{'X-RF-Page-Init':token}});
 for(const headers of [{},{'X-RF-Page-Init':'wrong-page-v51'}]){
  const response=await request('/api/online/signal',{method:'POST',body,headers});
  assert.equal(response.status,409);assert.equal((await response.json()).error,'page-generation-retired');
 }
 assert.equal(seen.length,1);
 assert.equal((await request('/api/online/signal',{method:'POST',body,headers:{'X-RF-Page-Init':token}})).status,200);
 assert.equal(seen.at(-1).page.session,[...app.sessions.values()][0]);assert.equal(seen.at(-1).page.pageToken,token);
 const {signalVersion,generation,offerId,...legacy}=body;
 assert.equal((await request('/api/online/signal',{method:'POST',body:legacy})).status,200,'legacy clients may still use their coordinator path');
 let entered;const started=new Promise(resolve=>{entered=resolve;});
 const onRequest=req=>{if(req.url==='/api/online/signal'){app.server.off('request',onRequest);entered();}};app.server.on('request',onRequest);
 const text=JSON.stringify(body);let pending;
 const finished=new Promise((resolve,reject)=>{
  pending=httpRequest(origin+'/api/online/signal',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json',
   'Content-Length':Buffer.byteLength(text),'X-RF-Page-Init':token}},response=>{
    let text='';response.setEncoding('utf8');response.on('data',part=>{text+=part;});response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(text)}));});
  pending.on('error',reject);pending.write(text.slice(0,20));
 });
 t.after(()=>{pending.destroy();app.server.off('request',onRequest);});
 await started;
 assert.equal((await request('/api/session',{headers:{'X-RF-Page-Init':'signaling-replacement-page-v51'}})).status,200);
 const count=seen.length;pending.end(text.slice(20));const response=await finished;
 assert.equal(response.status,409);assert.equal(response.body.error,'page-generation-retired');assert.equal(seen.length,count,'retired body never reaches coordinator');
 assert.equal((await request('/api/online/signal',{method:'POST',body,headers:{'X-RF-Page-Init':token}})).status,409,'late POST cannot restore an old page epoch');
 assert.equal(seen.length,count);
 assert.equal((await request('/api/online/signal',{method:'POST',body,headers:{'X-RF-Page-Init':'signaling-replacement-page-v51'}})).status,200);
 assert.equal(seen.at(-1).page.pageToken,'signaling-replacement-page-v51');
});
for(const transport of ['sse','poll'])test(`ordinary session reads preserve current tagged ${transport} lobby and its battle handoff`,async t=>{
 const {app,request}=await fixture(t),token='explicit-live-page-generation-v50';
 assert.equal((await request('/api/session',{headers:{'X-RF-Page-Init':token}})).status,200);
 if(transport==='sse'){
  const events=await request('/api/online/events?pageInitToken='+token);assert.equal(events.status,200);
  const reader=events.body.getReader();await reader.read();t.after(()=>reader.cancel().catch(()=>{}));
 }else{
  const opened=await request('/api/online/poll/open',{method:'POST',body:{},headers:{'X-RF-Page-Init':token}});assert.equal(opened.status,200);await opened.json();
 }
 const user=[...app.sessions.values()][0],generation=user.pageGeneration;
 for(let i=0;i<3;i++)assert.equal((await request('/api/session')).status,200,'ordinary authenticated status query');
 const response=await request('/api/online/handoff',{method:'POST',body:{pageInitToken:token}});
 const ack=await response.json();assert.equal(response.status,200,JSON.stringify(ack));
 assert.equal(user.pageGeneration,generation+1,'only the acknowledged handoff replaces the page generation');
 assert.notEqual(ack.pageInitToken,token);
 assert.equal((await request('/api/heartbeat',{method:'POST',headers:{'X-RF-Page-Init':token}})).status,409,'genuinely retired identity still rejects');
 assert.equal((await request('/api/heartbeat',{method:'POST',headers:{'X-RF-Page-Init':ack.pageInitToken}})).status,200);
});

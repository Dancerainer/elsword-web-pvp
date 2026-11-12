import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createDevServer} from '../../apps/server/dev-server.mjs';

const credentials={username:'proxy-fixture',password:'proxy-fixture-password'};
async function fixture(t,options={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'rf-auth-proxy-'));
  const {server}=await createDevServer({root,credentials,additionalCredentials:[],driverFactory:null,...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    await rm(root,{recursive:true,force:true});
  });
  const post=(headers={},password='incorrect',localAddress)=>new Promise((resolve,reject)=>{
    const body=JSON.stringify({...credentials,password});
    const request=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api/login',method:'POST',
      localAddress,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),...headers}},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
    });
    request.on('error',reject);request.end(body);
  });
  return {server,post};
}

test('explicit loopback proxy separates visitor login limits using valid IPv4 and IPv6 X-Real-IP',async t=>{
  const f=await fixture(t,{trustLoopbackProxy:true});
  for(let i=0;i<10;i++)assert.equal((await f.post({'X-Real-IP':'203.0.113.10'})).status,401);
  assert.equal((await f.post({'X-Real-IP':'203.0.113.10'},credentials.password)).status,429);
  assert.equal((await f.post({'X-Real-IP':'2001:db8::20'},credentials.password)).status,200);
});

test('default server ignores forged X-Real-IP and X-Forwarded-For rather than allowing limit bypass',async t=>{
  const f=await fixture(t);
  for(let i=0;i<10;i++)assert.equal((await f.post({'X-Real-IP':`203.0.113.${i+1}`,'X-Forwarded-For':`198.51.100.${i+1}`})).status,401);
  const blocked=await f.post({'X-Real-IP':'203.0.113.50','X-Forwarded-For':'198.51.100.50'},credentials.password);
  assert.equal(blocked.status,429);assert.equal(blocked.body.error,'too-many-attempts');
});

test('trusted proxy rejects malformed addresses and never falls back to client-supplied CF or XFF',async t=>{
  const publicOrigin='https://proxy-fixture.invalid',f=await fixture(t,{trustLoopbackProxy:true,publicOrigin});
  const invalid=['not-an-ip','203.0.113.1:8080','203.0.113.1, 203.0.113.2','localhost','999.1.1.1','[2001:db8::1]','',
    ['203.0.113.1','203.0.113.2'],'2001:db8::zz','203.0.113.1/24'];
  for(const [index,value] of invalid.entries())assert.equal((await f.post({origin:publicOrigin,'X-Real-IP':value,
    'CF-Connecting-IP':`198.51.100.${index+1}`,'X-Forwarded-For':`192.0.2.${index+1}`})).status,401);
  assert.equal((await f.post({origin:publicOrigin,'X-Real-IP':'bad-address','CF-Connecting-IP':'198.51.100.50',
    'X-Forwarded-For':'192.0.2.50'},credentials.password)).status,429);
  assert.equal((await f.post({origin:publicOrigin,'X-Real-IP':'203.0.113.50'},credentials.password)).status,200);
});

test('a socket outside the exact trusted loopback list cannot supply the visitor IP',async t=>{
  const f=await fixture(t,{trustLoopbackProxy:true});
  const seen=[];f.server.on('request',request=>seen.push(request.socket.remoteAddress));
  // Bind an actual HTTP connection to another loopback address. It is outside
  // the configured exact whitelist, just as an external peer would be.
  for(let i=0;i<10;i++)assert.equal((await f.post({'X-Real-IP':`203.0.113.${i+1}`},'incorrect','127.0.0.2')).status,401);
  assert.equal((await f.post({'X-Real-IP':'203.0.113.50'},credentials.password,'127.0.0.2')).status,429);
  assert.ok(seen.every(address=>address==='127.0.0.2'));
  assert.equal((await f.post({'X-Real-IP':'203.0.113.50'},credentials.password,'127.0.0.1')).status,200);
});

test('proxy trust option must be a boolean rather than a truthy string',async()=>{
  await assert.rejects(createDevServer({credentials,driverFactory:null,trustLoopbackProxy:'1'}),/invalid-loopback-proxy-config/);
});

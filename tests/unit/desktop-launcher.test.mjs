import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {windowCommand,permittedNavigation,shellSender,listenLocalServer}=require('../../apps/desktop/policy.cjs');
const {requestUpdate}=require('../../apps/desktop/network.cjs');

test('occupied remembered port selects an empty local port; closing releases it for next retry',async()=>{
  const occupied=http.createServer(),client=http.createServer(),next=http.createServer();
  await listenLocalServer(occupied);
  try{
    const port=await listenLocalServer(client,occupied.address().port);
    assert.notEqual(port,occupied.address().port);assert.equal(occupied.listening,true);
    await new Promise(resolve=>client.close(resolve));
    assert.equal(await listenLocalServer(next,port),port);
    assert.equal(client.listenerCount('error'),0);
  }finally{for(const server of [next,client,occupied])if(server.listening)await new Promise(resolve=>server.close(resolve));}
});

test('Ctrl combinations are delivered to gameplay, never treated as window commands',()=>{
  for(const key of ['w','W','r','R','q','F5','F11','Control'])for(const location of [1,2]){
    assert.equal(windowCommand({type:'keyDown',key,control:true,location}),null);
    assert.equal(windowCommand({type:'keyUp',key,control:true,location}),null);
  }
  assert.equal(windowCommand({type:'keyDown',key:'F5'}),'refresh');
  assert.equal(windowCommand({type:'keyDown',key:'F11'}),'fullscreen');
  assert.equal(windowCommand({type:'keyDown',key:'F11',isAutoRepeat:true}),null);
  assert.equal(windowCommand({type:'keyUp',key:'F11'}),null);
});
test('game navigation stays on this instance, not a stale localhost client',()=>{
  const origin='http://127.0.0.1:49152';
  assert.equal(permittedNavigation(origin+'/game/?x=1',origin),true);
  for(const url of ['http://127.0.0.1:4376/','https://example.com/','file:///C:/secret','javascript:alert(1)','http://user@127.0.0.1:49152/'])assert.equal(permittedNavigation(url,origin),false);
});
test('privileged controls reject game renderer and subframes',()=>{
  const shellPath=path.resolve('launcher/index.html');
  const mainFrame={url:pathToFileURL(shellPath).href},shell={mainFrame};
  assert.equal(shellSender({sender:shell,senderFrame:mainFrame},shell,shellPath),true);
  assert.equal(shellSender({sender:{},senderFrame:mainFrame},shell,shellPath),false);
  assert.equal(shellSender({sender:shell,senderFrame:{...mainFrame}},shell,shellPath),false);
});
test('update transport validates origin, size, progress and cancellation',async()=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/wait')return;
    if(req.url==='/unavailable'){res.writeHead(503);res.end();return;}
    res.writeHead(200);res.write('abcd');setTimeout(()=>res.end('efgh'),15);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    const progress=[];
    const good=await requestUpdate(origin,'/file',{limit:8,onProgress:bytes=>progress.push(bytes)});
    assert.equal(good.bytes.toString(),'abcdefgh');assert.equal(progress.at(-1),8);
    await assert.rejects(requestUpdate(origin,'/file',{limit:7}),/update-transfer-too-large/);
    assert.throws(()=>requestUpdate(origin,'https://example.com/file'),/update-origin-changed/);
    assert.equal((await requestUpdate(origin,'/unavailable')).status,503);
    const abort=new AbortController(),pending=requestUpdate(origin,'/wait',{signal:abort.signal});abort.abort();
    await assert.rejects(pending,{name:'AbortError'});
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

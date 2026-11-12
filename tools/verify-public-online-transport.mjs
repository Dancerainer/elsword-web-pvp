/** Authenticated transport probe; does not queue a match or write battle history. */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const [base,origin,accountRoot]=process.argv.slice(2);
if(!base||!origin||!accountRoot)throw Error('Usage: verify-public-online-transport BASE PUBLIC_ORIGIN ACCOUNT_ROOT');
const account=JSON.parse((await readFile(path.join(accountRoot,'dev-account.json'),'utf8')).replace(/^\uFEFF/,''));
let cookie,connectionId,eventController,eventReader;
async function api(relative,method='GET',body){
  const response=await fetch(base+relative,{method,headers:{Origin:origin,'Accept-Encoding':'gzip',...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  if(relative==='/api/login')cookie=response.headers.get('set-cookie')?.split(';')[0];
  const value=await response.json();
  assert.equal(response.ok,true,relative+': HTTP '+response.status+' '+(value.error??''));
  return {value,response};
}
try{
  await api('/api/login','POST',account);
  assert.ok(cookie,'Missing authenticated cookie');
  const {value:session}=await api('/api/session');
  assert.ok(['poll','sse'].includes(session.onlineEventTransport),'Unknown online event transport');
  assert.equal(session.online?.available,true,'Headless online driver is unavailable');
  if(session.onlineEventTransport==='sse'){
    eventController=new AbortController();
    const deadline=setTimeout(()=>eventController.abort(),20000);
    try{
      const response=await fetch(base+'/api/online/events',{headers:{Origin:origin,Cookie:cookie},signal:eventController.signal});
      assert.equal(response.status,200,'SSE connection failed');
      assert.match(response.headers.get('content-type')??'',/^text\/event-stream/);
      eventReader=response.body.getReader();const decoder=new TextDecoder();let text='';
      while(!/^event: status$/m.test(text)){
        const part=await eventReader.read();assert.equal(part.done,false,'SSE closed before a named status event');
        text+=decoder.decode(part.value,{stream:true});
        assert.ok(text.length<256000,'Status event missing from SSE stream');
      }
      console.log(JSON.stringify({onlineTransportVerified:true,eventTransport:'sse',onlineAvailable:true,namedStatusReceived:true,
        proxyBuffering:response.headers.get('x-accel-buffering'),gzip:response.headers.get('content-encoding')==='gzip',buildVersion:session.buildVersion}));
    }finally{clearTimeout(deadline);eventController.abort();await eventReader?.cancel().catch(()=>{});}
  }else{
  const {value:lease}=await api('/api/online/poll/open','POST',{});connectionId=lease.connectionId;
  assert.equal(typeof connectionId,'string');
  const {value:batch,response}=await api('/api/online/poll?connectionId='+encodeURIComponent(connectionId)+'&after='+(lease.cursor??0));
  assert.ok(batch.events.some(event=>event.type==='status'),'Named status event did not arrive');
  assert.ok(Number.isSafeInteger(batch.cursor));
  console.log(JSON.stringify({onlineTransportVerified:true,eventTransport:session.onlineEventTransport,onlineAvailable:session.online.available,
    namedStatusReceived:true,gzip:response.headers.get('content-encoding')==='gzip',buildVersion:session.buildVersion}));
  }
}finally{
  if(cookie){
    if(connectionId)await api('/api/online/poll/close','POST',{connectionId}).catch(()=>{});
    await api('/api/logout','POST',{}).catch(()=>{});
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {setTimeout as delay} from 'node:timers/promises';
import {parseStunBindingRequest,createStunBindingResponse,createStunRateLimiter,stunFingerprint,STUN_MAGIC_COOKIE}
  from '../../packages/online/stun-binding.mjs';
import {createStunBindingServer,stunOptionsFromEnvironment} from '../../apps/server/stun-server.mjs';

const transactionId=Buffer.from('b7e7a701bc34d686fa87dfae','hex');
function request(attributes=Buffer.alloc(0)){
  const value=Buffer.alloc(20+attributes.length);value.writeUInt16BE(1,0);value.writeUInt16BE(attributes.length,2);
  value.writeUInt32BE(STUN_MAGIC_COOKIE,4);transactionId.copy(value,8);attributes.copy(value,20);return value;
}
function fingerprintedRequest(){
  const value=request(Buffer.from('8028000400000000','hex'));value.writeUInt32BE(stunFingerprint(value.subarray(0,20)),24);return value;
}
function mappedAddress(response){
  assert.equal(response.readUInt16BE(0),0x0101);assert.equal(response.readUInt16BE(2),response.length-20);
  assert.equal(response.readUInt32BE(4),0x2112a442);assert.deepEqual(response.subarray(8,20),transactionId);
  assert.equal(response.readUInt16BE(20),0x0020);
  const length=response.readUInt16BE(22),bytes=Buffer.alloc(length-4);
  for(let i=0;i<bytes.length;i++)bytes[i]=response[28+i]^response[4+i];
  return {family:response[25],port:response.readUInt16BE(26)^0x2112,bytes};
}
async function bindClient(t,family,host){
  const client=dgram.createSocket(family);t.after(()=>new Promise(resolve=>{try{client.close(resolve);}catch{resolve();}}));
  await new Promise((resolve,reject)=>{client.once('error',reject);client.bind(0,host,()=>{client.off('error',reject);resolve();});});
  return client;
}
async function exchange(client,serverAddress,value){
  return new Promise((resolve,reject)=>{
    const done=(error,response)=>{clearTimeout(timer);client.off('message',received);client.off('error',failed);error?reject(error):resolve(response);};
    const received=response=>done(null,response),failed=error=>done(error);
    const timer=setTimeout(()=>done(Error('stun-fixture-timeout')),1500);
    client.once('message',received);client.once('error',failed);
    client.send(value,serverAddress.port,serverAddress.address,error=>{if(error)done(error);});
  });
}
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await delay(5);}throw Error('stun-fixture-timeout');}

test('XOR-MAPPED-ADDRESS matches independent RFC 5769 IPv4 and IPv6 vectors',()=>{
  // RFC 5769 sections 2.2/2.3: only its independently published mapped-address
  // bytes are expected here; this fixture never derives them from our decoder.
  const ipv4=createStunBindingResponse(request(),{address:'192.0.2.1',port:32853});
  assert.equal(ipv4.toString('hex'),'0101000c2112a442b7e7a701bc34d686fa87dfae002000080001a147e112a643');
  const ipv6=createStunBindingResponse(request(),{address:'2001:db8:1234:5678:11:2233:4455:6677',port:32853});
  assert.equal(ipv6.toString('hex'),'010100182112a442b7e7a701bc34d686fa87dfae002000140002a1470113a9faa5d3f179bc25f4b5bed2b9d9');
  assert.equal(ipv4.length,32);assert.equal(ipv6.length,44);
  assert.deepEqual(createStunBindingResponse(request(),{address:'::ffff:192.0.2.1',port:32853}),ipv4);
});

test('compressed, full and scoped IPv6 addresses preserve network byte order',()=>{
  for(const address of ['::1','0:0:0:0:0:0:0:1','::1%loopback']){
    const value=mappedAddress(createStunBindingResponse(request(),{address,port:65535}));
    assert.equal(value.family,2);assert.equal(value.port,65535);assert.equal(value.bytes.toString('hex'),'00000000000000000000000000000001');
  }
  assert.equal(mappedAddress(createStunBindingResponse(request(),{address:'::',port:1})).bytes.toString('hex'),'00000000000000000000000000000000');
  for(const remote of [{address:'bad',port:1},{address:'127.0.0.1',port:0},{address:'127.0.0.1',port:65536}])
    assert.equal(createStunBindingResponse(request(),remote),null);
});

test('strict header, datagram and attribute boundaries drop non-discovery messages',()=>{
  const invalid=[Buffer.alloc(0),Buffer.alloc(19),Buffer.concat([request(),Buffer.alloc(4)]),Buffer.alloc(1204)];
  for(const type of [0x8001,0x0101,0x0111,0x0011,0x0003]){const value=request();value.writeUInt16BE(type,0);invalid.push(value);}
  {const value=request();value.writeUInt32BE(0,4);invalid.push(value);}
  {const value=request();value.writeUInt16BE(1,2);invalid.push(value);}
  invalid.push(request(Buffer.from('8022000500000000','hex'))); // Attribute exceeds body.
  invalid.push(request(Buffer.from('00060000','hex'))); // USERNAME: ICE/auth usage.
  invalid.push(request(Buffer.from('00240004ffffffff','hex'))); // ICE PRIORITY.
  invalid.push(request(Buffer.concat(Array.from({length:65},()=>Buffer.from('80010000','hex'))))); // Bound attribute traversal.
  for(const value of invalid){assert.equal(parseStunBindingRequest(value),null);assert.equal(createStunBindingResponse(value,{address:'127.0.0.1',port:12345}),null);}
  const optional=request(Buffer.from('8022000161ffffff80010000','hex'));
  assert.equal(parseStunBindingRequest(optional).fingerprint,false); // Padding may be arbitrary.
  const original=request(),parsed=parseStunBindingRequest(original);original[8]^=255;assert.deepEqual(parsed.transactionId,transactionId);
  const zeros=request();zeros.fill(0,8,20);assert.ok(parseStunBindingRequest(zeros)); // Transaction bits are echoed, not interpreted.
});

test('fingerprint uses published RFC 5769 CRC and verifies last-attribute integrity',()=>{
  const rfcRequestPrefix=Buffer.from('000100582112a442b7e7a701bc34d686fa87dfae802200105354554e207465737420636c69656e74002400046e0001ff80290008932ff9b151263b36000600096576746a3a68367659202020000800149aeaa70cbfd8cb56781ef2b5b2d3f249c1b571a2','hex');
  assert.equal(stunFingerprint(rfcRequestPrefix),0xe57a3bcf);
  const value=fingerprintedRequest();assert.equal(parseStunBindingRequest(value).fingerprint,true);
  for(const address of ['192.0.2.1','2001:db8::1']){
    const response=createStunBindingResponse(value,{address,port:12345}),offset=response.length-8;
    assert.equal(response.length,address.includes(':')?52:40);assert.equal(response.readUInt16BE(offset),0x8028);
    assert.equal(response.readUInt32BE(offset+4),stunFingerprint(response.subarray(0,offset)));
  }
  const corrupt=Buffer.from(value);corrupt[24]^=1;assert.equal(parseStunBindingRequest(corrupt),null);
  assert.equal(parseStunBindingRequest(request(Buffer.from('8028000000000000','hex'))),null);
  const misplaced=Buffer.concat([value,Buffer.from('80220000','hex')]);misplaced.writeUInt16BE(misplaced.length-20,2);
  assert.equal(parseStunBindingRequest(misplaced),null);
});

test('source buckets bound IPv4, IPv6 /64 and global reflection rates without per-port bypass',()=>{
  let now=0;const limiter=createStunRateLimiter({clock:()=>now,sourceRate:1,sourceBurst:2,globalRate:5,globalBurst:5,maxSources:4,idleMs:1000});
  assert.equal(limiter.allow('192.0.2.1'),true);assert.equal(limiter.allow('::ffff:192.0.2.1'),true);
  assert.equal(limiter.allow('192.0.2.1'),false);
  assert.equal(limiter.allow('2001:db8::1'),true);assert.equal(limiter.allow('2001:db8::2'),true);
  assert.equal(limiter.allow('2001:db8:1::1'),false);assert.equal(limiter.stats().globalLimited,1);
  assert.equal(limiter.stats().sources,2);assert.equal(limiter.stats().sourceLimited,1);
  now=1000;assert.equal(limiter.allow('2001:db8::ffff'),true);assert.equal(limiter.allow('2001:db8::abcd'),false);
  assert.equal(limiter.stats().sources,2);assert.equal(limiter.allow('invalid'),false);
  limiter.clear();assert.equal(limiter.stats().sources,0);
});

test('source capacity rejects fresh identities and only reclaims idle bounded entries',()=>{
  let now=0;const limiter=createStunRateLimiter({clock:()=>now,globalBurst:100,globalRate:100,maxSources:2,idleMs:1000});
  assert.ok(limiter.allow('192.0.2.1'));assert.ok(limiter.allow('192.0.2.2'));assert.equal(limiter.allow('192.0.2.3'),false);
  assert.equal(limiter.stats().sourceCapacityLimited,1);assert.equal(limiter.stats().sources,2);
  now=1001;assert.ok(limiter.allow('192.0.2.3'));assert.equal(limiter.stats().sources,1);
  for(const options of [{sourceRate:0},{globalBurst:Infinity},{maxSources:4097},{idleMs:0}])assert.throws(()=>createStunRateLimiter(options),/invalid-stun/);
});

test('native UDP IPv4 discovery is idempotent, ignores invalid payloads and closes cleanly',async t=>{
  const server=createStunBindingServer();t.after(()=>server.close());assert.equal(server.address(),null);
  const [address,repeated]=await Promise.all([server.start(),server.start()]);assert.deepEqual(address,repeated);
  const client=await bindClient(t,'udp4','127.0.0.1');
  const one=await exchange(client,address,request()),two=await exchange(client,address,request());assert.deepEqual(one,two);
  const mapped=mappedAddress(one);assert.equal(mapped.family,1);assert.equal(mapped.port,client.address().port);
  assert.equal(mapped.bytes.toString('hex'),'7f000001');
  client.send(Buffer.from('arbitrary combat payload'),address.port,address.address);
  await until(()=>server.stats().invalid===1);assert.equal(server.stats().replied,2);assert.equal(server.stats().responseBytes,64);
  await Promise.all([server.close(),server.close()]);assert.equal(server.address(),null);assert.equal(server.stats().closed,true);
  assert.equal(server.stats().rateLimits.sources,0);await assert.rejects(server.start(),/stun-server-closed/);
});

test('native UDP IPv6 discovery produces a valid reflexive ::1 endpoint',async t=>{
  const server=createStunBindingServer({host:'::1',ipv6Only:true});t.after(()=>server.close());
  let address;try{address=await server.start();}catch(error){if(['EAFNOSUPPORT','EADDRNOTAVAIL'].includes(error.code)){t.skip('IPv6 loopback unavailable');return;}throw error;}
  const client=await bindClient(t,'udp6','::1'),response=await exchange(client,address,fingerprintedRequest());
  const mapped=mappedAddress(response);assert.equal(mapped.family,2);assert.equal(mapped.port,client.address().port);
  assert.equal(mapped.bytes.toString('hex'),'00000000000000000000000000000001');assert.equal(response.length,52);
});

test('dual-stack UDP6 listener answers IPv4-mapped sources with an IPv4 address',async t=>{
  const server=createStunBindingServer({host:'::',ipv6Only:false});t.after(()=>server.close());
  let address;try{address=await server.start();}catch(error){if(['EAFNOSUPPORT','EADDRNOTAVAIL'].includes(error.code)){t.skip('Dual-stack UDP unavailable');return;}throw error;}
  const client=await bindClient(t,'udp4','127.0.0.1');
  const response=await exchange(client,{...address,address:'127.0.0.1'},request()),mapped=mappedAddress(response);
  assert.equal(mapped.family,1);assert.equal(mapped.port,client.address().port);assert.equal(mapped.bytes.toString('hex'),'7f000001');assert.equal(response.length,32);
});

test('native UDP rate limits stop replies and malformed traffic consumes the same budget',async t=>{
  let now=0;const server=createStunBindingServer({rateLimits:{clock:()=>now,sourceRate:1,sourceBurst:1,globalRate:20,globalBurst:20}});
  t.after(()=>server.close());const address=await server.start(),client=await bindClient(t,'udp4','127.0.0.1');
  client.send(Buffer.alloc(0),address.port,address.address);await until(()=>server.stats().invalid===1);
  client.send(request(),address.port,address.address);await until(()=>server.stats().rateLimits.sourceLimited===1);
  assert.equal(server.stats().replied,0);
  now=1000;assert.ok(await exchange(client,address,request()));assert.equal(server.stats().replied,1);
});

test('disabled environment and lifecycle errors never leave a listening handle',async()=>{
  assert.equal(stunOptionsFromEnvironment({}),null);assert.equal(stunOptionsFromEnvironment({RF_RTC_STUN_PORT:''}),null);
  assert.deepEqual(stunOptionsFromEnvironment({RF_RTC_STUN_PORT:'3478'}),{host:'127.0.0.1',port:3478});
  for(const value of ['0','65536','1.5','x',' 3478'])assert.throws(()=>stunOptionsFromEnvironment({RF_RTC_STUN_PORT:value}),/invalid-stun-env-port/);
  for(const options of [{host:'hostname.example'},{host:null},{host:'::1',family:'udp4'},{host:'127.0.0.1',family:'udp6'},
    {port:-1},{maxPendingSends:129}])assert.throws(()=>createStunBindingServer(options),/invalid-stun/);
  const neverStarted=createStunBindingServer();await neverStarted.close();await assert.rejects(neverStarted.start(),/closed/);
  const first=createStunBindingServer();await first.start();
  const other=createStunBindingServer({port:first.address().port});
  try{await assert.rejects(other.start(),{code:'EADDRINUSE'});await other.close();assert.equal(other.address(),null);}
  finally{await first.close();await other.close();}
});

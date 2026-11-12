import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateApiResolver,routeSocketClass,peerFinishGrace} from '../../tools/network-direct-route-v5.mjs';
const prefix='/__rf_rooms_'+'a'.repeat(24),origin='http://example.test';
test('HTTP, SSE and WebSocket use the same isolated API prefix and original query',()=>{
 const resolve=createPrivateApiResolver(origin,prefix);
 for(const api of ['/api/session','/api/online/events?ownedDelta=3&token=a%2Fb','/api/online/socket?session=xyz'])
  assert.equal(resolve(api),origin+prefix+api);
 class Socket{static OPEN=1;constructor(url,protocol){Object.assign(this,{url,protocol});}}
 const Routed=routeSocketClass(Socket,resolve),socket=new Routed('/api/online/socket?x=1','pvp');
 assert.equal(socket.url,origin+prefix+'/api/online/socket?x=1');assert.equal(socket.protocol,'pvp');assert.equal(Routed.OPEN,1);
});
test('private API routing refuses escape, redirects, credentials and normalized paths',()=>{
 const resolve=createPrivateApiResolver(origin,prefix);
 for(const api of ['/api/../session','/api/%2e%2e/session','/api/%252e/session','/api/x%2fy','//evil/api/x','http://evil/api/x','/assets/a','/api/\\x','/api/x#fragment','/api/x\n'])assert.throws(()=>resolve(api));
 for(const base of ['http://user:pass@example.test',origin+'/','file:///tmp',origin+'/api'])assert.throws(()=>createPrivateApiResolver(base,prefix));
 assert.throws(()=>createPrivateApiResolver(origin,'/api'));
});
test('late failure grace retains results only after every peer is near its scheduled finish',()=>{
 const options={starts:[1000,2000],players:2,seconds:180};
 assert.equal(peerFinishGrace({...options,now:171999}),null);
 assert.equal(peerFinishGrace({...options,now:172000}),202000);
 assert.equal(peerFinishGrace({...options,now:202000}),null);
 assert.equal(peerFinishGrace({...options,starts:[1000],now:181000}),null);
 assert.equal(peerFinishGrace({...options,starts:[NaN,2000],now:181000}),null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createLobbyHandoffRelease} from '../../apps/web/lobby-handoff.mjs';
const ack={ok:true,pageInitToken:'rotated-page-token-01234567'};
test('concurrent lobby release awaits one server acknowledgement, accepts token before closing and returns exact ACK',async()=>{
 let resolve,calls=0,closed=false;const order=[];
 const release=createLobbyHandoffRelease({requestHandoff:()=>{calls++;order.push('request');return new Promise(done=>resolve=done);},
  acceptToken:token=>order.push(token),closeLocal:()=>{closed=true;order.push('close');},isClosed:()=>closed});
 const first=release(),second=release();assert.equal(first,second);assert.equal(calls,1);assert.equal(closed,false);
 resolve(ack);assert.equal(await first,ack);assert.equal(await second,ack);
 assert.deepEqual(order,['request',ack.pageInitToken,'close']);assert.equal(await release(),ack);assert.equal(calls,1);
});
test('failed handoff preserves the old lobby and permits one explicit retry',async()=>{
 let calls=0,closes=0,tokens=0;
 const release=createLobbyHandoffRelease({requestHandoff:async()=>{if(++calls===1)throw Error('temporary network failure');return ack;},
  acceptToken:()=>tokens++,closeLocal:()=>closes++});
 await assert.rejects(release(),/temporary network failure/);assert.equal(closes,0);assert.equal(tokens,0);
 assert.equal(await release(),ack);assert.equal(calls,2);assert.equal(closes,1);assert.equal(tokens,1);
});
test('malformed handoff ACK cannot revoke the current connection or publish an unvalidated page token',async()=>{
 for(const value of [null,{ok:false,pageInitToken:ack.pageInitToken},{ok:true,pageInitToken:'short'},{ok:true,pageInitToken:'contains.invalid.dots'}]){
  let closes=0,tokens=0;const release=createLobbyHandoffRelease({requestHandoff:async()=>value,acceptToken:()=>tokens++,closeLocal:()=>closes++});
  await assert.rejects(release(),/Invalid lobby handoff/);assert.equal(closes,0);assert.equal(tokens,0);
 }
});
test('unloaded local lobby does not issue another server handoff',async()=>{
 let calls=0;const release=createLobbyHandoffRelease({requestHandoff:async()=>{calls++;return ack;},acceptToken:()=>{},closeLocal:()=>{},isClosed:()=>true});
 assert.equal(await release(),null);assert.equal(calls,0);
});

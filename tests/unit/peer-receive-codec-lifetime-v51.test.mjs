import test from 'node:test';
import assert from 'node:assert/strict';
import {createPeerControl} from '../../apps/web/online-peer-control.mjs';
import {NETWORK_BINARY_VERSION} from '../../packages/online/network-binary.mjs';

function fixture(){
  let now=0;const faults=[];
  const control=createPeerControl({matchId:'receive-codec',clock:()=>now,networkBinary:true,reliableTransport:true,
    send:()=>true,sendValue:()=>true,onFault:reason=>faults.push(reason)});
  return {control,faults,advance(ms){now+=ms;},hello(type='hello-ack',version=NETWORK_BINARY_VERSION){
    control.receiveText(JSON.stringify({v:1,matchId:'receive-codec',type,networkBinaryVersion:version}));},
    stage(){return control.stage({epoch:1,frameSeq:1,actor:{},effects:[],actions:[{id:1}]});}};
}
for(const type of ['hello','hello-ack'])test(`${type} preserves receive capability if its synchronous pump immediately times out`,()=>{
  const f=fixture();f.stage();f.advance(1501);f.hello(type);
  const state=f.control.performance();
  assert.deepEqual(f.faults,['control-ack-timeout']);assert.equal(state.failed,true);
  assert.equal(state.networkBinaryVersion,0,'failed control cannot advertise active send negotiation');
  assert.equal(state.receiveNetworkBinaryVersion,NETWORK_BINARY_VERSION,'wire bytes already negotiated on this connection stay decodable');
  assert.equal(f.stage(),false);assert.deepEqual(f.control.receipt(1),[]);
});
test('receive capability is never inferred for an unnegotiated, legacy or replacement control',()=>{
  const prior=fixture();prior.hello();prior.control.closed();
  assert.equal(prior.control.performance().receiveNetworkBinaryVersion,NETWORK_BINARY_VERSION);
  for(const setup of [f=>{},f=>f.hello('hello-ack',0),f=>f.control.closed()]){
    const fresh=fixture();setup(fresh);assert.equal(fresh.control.performance().receiveNetworkBinaryVersion,0);
  }
});

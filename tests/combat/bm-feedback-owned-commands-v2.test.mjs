/** Real sampled inputs, source geometry and JSON ownership protocol. These
 * receiving simulations are web-adapter evidence, not original-client packets. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bmSampledFixture} from '../helpers/bm-sampled-commands-v2.mjs';
import {bmFixture} from '../helpers/bm-fixture.mjs';
import {vcFixture} from '../helpers/vc-fixture.mjs';
import {dashZxFixture} from '../../tools/combat/rf_dash_zx_audit.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const dt=1/60;
const blackHoleSet='EffectSet_RBM_BLACKHOLE';
function transmit(sender,receiver,id='bm',frameSeq=1){
  const packet=JSON.parse(JSON.stringify(encodeOwnedState(sender.sim,id,{epoch:1,frameSeq})));
  validateOwnedState(packet);
  validateOwnedReferences(packet,receiver.sim.actor(id),receiver.sim.profileFor(receiver.sim.actor(id)),receiver.map,
    {profiles:receiver.sim.profiles,actors:receiver.sim.state.actors});
  applyOwnedState(receiver.sim,id,packet);
  return packet;
}
function assertMapped(receiver,packet,minId){
  const expected=packet.actor.sourceBladeMaster.blackHoleEffectIds.filter(id=>packet.effects.some(e=>e.id===id));
  const actual=receiver.a.sourceBladeMaster.blackHoleEffectIds;
  assert.equal(actual.length,expected.length);
  for(let i=0;i<actual.length;i++){
    const effect=receiver.sim.state.effects.find(e=>e.id===actual[i]);
    assert.ok(effect);assert.equal(effect.ownerId,'bm');assert.equal(effect.setName,blackHoleSet);
    assert.equal(effect.networkId,expected[i]);assert.ok(effect.id>=minId);assert.notEqual(effect.id,effect.networkId);
  }
}
for(const facing of [-1,1])test(`BM black-hole ${facing}: JSON round-trip maps local handles and retires damage/drag without touching a foreign effect`,()=>{
  const source=bmSampledFixture({facing,gap:150}),receiver=bmFixture({facing,gap:150}),echo=bmFixture({facing,gap:150});
  source.blackHole();assert.equal(source.a.sourceBladeMaster.blackHoleEffectIds.length,3,'real command creates damage and two original visual members');
  transmit(source,receiver,'target');
  // Another owner's legitimate effect deliberately occupies the sender's ID.
  const remoteIds=[...source.a.sourceBladeMaster.blackHoleEffectIds];
  receiver.sim.state.nextEffectId=remoteIds[0];
  const foreign=receiver.sim.createEffect(receiver.b,{NAME:'RBM_BLACKHOLE'},{clock:'custom',start:1000});
  assert.equal(foreign.id,remoteIds[0]);receiver.sim.state.nextEffectId=1000;echo.sim.state.nextEffectId=5000;
  const initial=transmit(source,receiver);assertMapped(receiver,initial,1000);
  const echoed=transmit(receiver,echo);assertMapped(echo,echoed,5000);
  assert.equal(echo.a.sourceBladeMaster.blackHoleEffectIds.length,3);
  let sawDrag=false,sawLocalHit=false,sawExplosion=false,maxMembers=0;
  const pressedSerials=new Set();
  for(let frame=1;frame<=420;frame++){
    const a=source.a;
    if(a.state==='RBM_COMBO_ZZZXZ'&&a.sourceBladeMaster.blackHoleCount<5&&a.animationTime>.12&&!pressedSerials.has(a.stateSerial)){
      source.down('Z');pressedSerials.add(a.stateSerial);
    }else source.up('Z');
    source.step();
    if(frame%3===0){const packet=transmit(source,receiver,'bm',frame);assertMapped(receiver,packet,1000);}
    receiver.sim.step(dt,{}, {snapshot:false});
    const effects=receiver.sim.state.effects;
    maxMembers=Math.max(maxMembers,effects.filter(e=>e.ownerId==='bm'&&e.setName===blackHoleSet&&!e.dead).length);
    sawDrag||=receiver.b.effectiveBlackHoleIds.some(id=>effects.some(e=>e.id===id&&e.ownerId==='bm'&&e.name==='RBM_BLACKHOLE'));
    for(const event of receiver.sim.drainEvents()){
      if(event.type==='hit'&&event.actorId==='bm'&&event.origin.kind==='effect')sawLocalHit=true;
      if(event.type==='effectStarted'&&event.actorId==='bm'&&event.name==='RBM_BLACKHOLE_EXPLOSION')sawExplosion=true;
    }
  }
  assert.equal(maxMembers,3,'cleanup retains the original visual members while their source set is live');
  assert.equal(sawDrag,true,'receiver must acquire a real hit-gated black-hole identity');
  assert.equal(sawLocalHit,true,'receiver computes hits with converted original helper geometry');
  assert.equal(sawExplosion,true,'receiver actually instantiates the finishing damage effect');
  assert.equal(source.a.state,'RSI_WAIT');assert.equal(receiver.a.state,'RSI_WAIT');
  assert.deepEqual(receiver.a.sourceBladeMaster.blackHoleEffectIds,[]);
  assert.deepEqual(receiver.b.effectiveBlackHoleIds,[]);assert.deepEqual(receiver.b.blackHoleDisplacement,[0,0,0]);
  assert.ok(!receiver.sim.state.effects.some(e=>e.ownerId==='bm'&&e.setName===blackHoleSet&&!e.dead));
  assert.ok(receiver.sim.state.effects.includes(foreign));assert.notEqual(foreign.dead,true);
  receiver.sim.drainEvents();const hp=receiver.b.hp;
  for(let frame=0;frame<120;frame++)receiver.sim.step(dt,{}, {snapshot:false});
  assert.equal(receiver.b.hp,hp);assert.deepEqual(receiver.b.effectiveBlackHoleIds,[]);
  assert.ok(!receiver.sim.drainEvents().some(e=>e.type==='hit'&&e.actorId==='bm'));
});

for(const profession of ['RF','VC'])for(const facing of [-1,1])test(`${profession} ${facing}: sampled public ZZXX still chains and hits after BM adapter changes`,async()=>{
  const original=profession==='RF'?await dashZxFixture({facing,gap:150}):vcFixture({facing,gap:150});
  const sim=original.sim??original.s,a=original.a,input=createInputBuffer({sampledLevels:true});
  const step=()=>{const packet=input.consume(sim.state.time+dt,dt);assert.equal(packet.sampledDevice,true);sim.step(dt,{[a.id]:packet});};
  const press=key=>{input.down(key,sim.state.time+.001);step();input.up(key,sim.state.time+.001);step();};
  const wait=state=>{for(let i=0;i<240&&a.state!==state;i++)step();assert.equal(a.state,state);};
  press('Z');press('Z');wait('RSI_COMBO_ZZ');press('X');wait('RSI_COMBO_ZZX');press('X');wait('RSI_COMBO_ZZXX');wait('RSI_WAIT');
  assert.ok(sim.state.events.some(e=>e.type==='hit'&&e.actorId===a.id&&e.origin.state==='RSI_COMBO_ZZXX'&&e.amount>0));
  assert.equal(a.sourceBladeMaster,undefined);
});

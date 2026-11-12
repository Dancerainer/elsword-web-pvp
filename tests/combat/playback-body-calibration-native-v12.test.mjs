/** Original Native runtime/pose helpers on the authored Garpai map. Source
 * anchors below deliberately create a large replacement pose correction;
 * they are fixture preparation, not fabricated collision/pass declarations.
 * These are receiver-local Web body semantics, not WAN or GPU measurements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPlaybackNativeAssets,playbackNativeOwner,nativeDt} from '../../tools/validation/measure-combat-playback-v12.mjs';

const assets=await loadPlaybackNativeAssets(),empty={held:[],pressed:[],released:[],sampledDevice:true};
const right={...empty,held:['RIGHT'],pressed:['RIGHT']};
function anchor(actor,x,y=3080,{air=false}={}){
  Object.assign(actor,{x,y,z:0,lineId:air?null:2,lastTouchLineId:2,grounded:!air,vx:0,vy:0,vz:0,landPosition:[x,3080,0]});
}
function pair(t,{state='RSI_WAIT',above=false,x=-100}={}){
  let now=0;
  const a=playbackNativeOwner(assets,'source',{clock:()=>now}),b=playbackNativeOwner(assets,'target',{clock:()=>now});
  t.after(()=>{a.clear();b.clear();});
  const y=above?3080+assets.profiles.RF.body.UNIT_HEIGHT+1000:3080;
  for(const ctx of [a,b]){
    for(const id of ['source','target','buddy','other']){
      const actor=ctx.sim.actor(id);actor.inputLock=0;actor.forceInvincible=0;actor.pvpPresentation=null;
      ctx.sim.enter(actor,id==='source'?state:'RSI_WAIT','explicit-native-body-calibration-fixture');
      anchor(actor,id==='source'?x:id==='target'?0:id==='buddy'?-1400:1400,id==='source'?y:3080,{air:id==='source'&&above});
    }
    ctx.sim.drainEvents();
  }
  function produce(input=empty){now+=1000/60;return a.step(input);}
  function receive(report){
    assert.ok(report,'the normal source producer must emit a report');
    const wire=structuredClone(report),local=structuredClone(b.sim.actor('target'));
    assert.equal(b.sync.receivePeer(b.sim,'source',report,'target'),true);
    b.sync.beforeStep(b.sim,'target');
    assert.deepEqual(b.sim.actor('target'),local,'calibration cannot change any field of the current local owner');
    assert.deepEqual(report,wire,'arrival and Native body projection cannot mutate the source wire report');
    // Native-phase calibration needs the receiver's corresponding positive
    // native prediction. The old fixture advanced only the sender and pulled
    // its future anchor into a receiver whose simulation never stepped.
    b.step(empty,{prepared:true});
    for(let frame=0;frame<16&&b.sync.combatPlaybackDiagnostics.receiver.owners.source.pendingPoses;frame++)b.step(empty);
    assert.equal(b.sync.combatPlaybackDiagnostics.receiver.owners.source.pendingPoses,0,'the matching prediction consumes the pose');
  }
  function start(input=empty){
    const report=produce(input).report;
    assert.ok(report.actions.some(action=>action.playback?.version===1&&action.playback.start),'actual negotiated cap1 producer supplies the controller start');
    receive(report);return report;
  }
  function replacement(input=empty){
    const serial=a.sim.actor('source').stateSerial;
    anchor(a.sim.actor('source'),1000,a.sim.actor('source').y,{air:above});
    let report;
    for(let frame=0;frame<6&&!report;frame++)report=produce(input).report;
    assert.ok(report,'ordinary replaceable pose cadence must publish the source anchor');
    assert.equal(report.actor.stateSerial,serial,'position calibration retains the admitted controller identity');
    // The airborne original root/physics can change the explicit 1000 anchor
    // before publication. Its real target must still require a full crossing.
    assert.ok(report.actor.x>900,`original movement must retain a far-side calibration target: ${report.actor.x}`);return report;
  }
  return {a,b,start,replacement,receive,produce};
}

test('same-controller replacement pose cannot blend an ordinary remote body across the current Native owner',t=>{
  const f=pair(t);f.start();const remote=f.b.sim.actor('source'),before=remote.x;
  assert.equal(before,-100);assert.equal(assets.profiles.RF.states[remote.state].raw.CAN_PASS_UNIT??0,0);
  const report=f.replacement();f.receive(report);
  for(let frame=0;frame<24;frame++)f.b.step(empty);
  assert.ok(remote.x>=before&&remote.x<0,'v34 continuous recovery approaches the body but original CheckPassUnit prevents crossing');
  assert.equal(report.actor.x,1000,'the projected observation does not rewrite the real source position');
});

test('actual vertical clearance permits replacement pose calibration above the current owner',t=>{
  const f=pair(t,{state:'RSI_JUMP_DOWN',above:true});f.start();
  const remote=f.b.sim.actor('source'),before=remote.x,report=f.replacement();f.receive(report);
  for(let frame=0;frame<20&&remote.x<=0;frame++)f.b.step(empty);
  assert.ok(remote.y>f.b.sim.actor('target').y+assets.profiles.RF.body.UNIT_HEIGHT,'real body heights still have vertical clearance');
  assert.ok(remote.x>0,'CheckPassUnit permits the above-body crossing');
  assert.ok(remote.x>before&&remote.x<report.actor.x,'ordinary blend remains bounded between the observed and source positions');
});

test('the authored RF forward-X CAN_PASS_UNIT state permits its calibration crossing',t=>{
  const state='RRF_COMBO_ZZXFRONTX';assert.equal(assets.profiles.RF.states[state].raw.CAN_PASS_UNIT,1);
  const f=pair(t,{state});f.start();const remote=f.b.sim.actor('source'),report=f.replacement();
  assert.equal(report.actor.state,state,'the wire carries an original admissible state, not a synthetic pass flag');
  f.receive(report);for(let frame=0;frame<20&&remote.x<=0;frame++)f.b.step(empty);
  assert.equal(remote.state,state);assert.ok(remote.x>0,'the actual current source state explicitly permits passage');
});

test('blocked pose calibration still allows ordinary positive-dt Native movement toward its target',t=>{
  const f=pair(t,{x:-500});f.start(right);
  const report=f.replacement({...right,pressed:[]});f.receive(report);
  const remote=f.b.sim.actor('source'),before=remote.x,local=f.b.sim.actor('target'),localPosition=[local.x,local.y,local.z];
  assert.ok(before<0,'the replacement correction cannot cross the owned body');
  assert.deepEqual(f.b.sync.remoteInputs(f.b.sim,'target').source.held,['RIGHT'],'real reliable held input survives pose projection');
  f.b.step(empty);
  assert.ok(remote.x>before,'normal Native dt advances movement rather than pinning the remote controller');
  assert.ok(remote.x<local.x,'the positive movement step also respects the current opposing body');
  assert.deepEqual([local.x,local.y,local.z],localPosition);assert.equal(nativeDt,1/60);
});

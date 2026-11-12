import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {activateVeteranOverheat} from '../../packages/combat-core/vc-skills.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
const tick=(f,input={})=>{f.sim.step(1/60,{vc:input},{snapshot:false});return f.sim.drainEvents();};
const geometry=anchor=>{const {evidence,evidenceClass,...value}=anchor;return value;};
function copyTo(source,target,frameSeq=1){const wire=encodeOwnedState(source.sim,'vc',{frameSeq});
  validateOwnedReferences(wire,target.a,vcProfile,target.map);applyOwnedState(target.sim,'vc',wire);return wire;}

test('VC source arm and two flame attachment identities survive repeated owner transfers',()=>{
  const source=vcFixture(),target=vcFixture();activateVeteranOverheat(source.sim,source.a);tick(source);
  const packet=copyTo(source,target);assert.ok(packet.effects.some(e=>e.sourceVeteranAttachment==='overheat-arm'));
  const names=['overheat-arm','overheat-forearm-fire','overheat-hand-fire'];
  for(const key of names){const local=source.sim.state.effects.find(e=>e.sourceVeteranAttachment===key),remote=target.sim.state.effects.find(e=>e.sourceVeteranAttachment===key);
    assert.deepEqual(remote.definition,local.definition);assert.deepEqual(geometry(remote.birthAnchor),geometry(local.birthAnchor));}
  copyTo(source,target,2);assert.equal(target.sim.state.effects.filter(e=>names.includes(e.sourceVeteranAttachment)).length,3);
  const bad=structuredClone(packet);bad.effects.find(e=>e.sourceVeteranAttachment==='overheat-arm').sourceVeteranAttachment='arbitrary-bone';
  assert.throws(()=>validateOwnedState(bad),/veteran-attachment/);
});

test('accepted overheat notice is delivered to a receiver once; stale notices never replay',()=>{
  const source=vcFixture({skillId:24034}),target=vcFixture({skillId:24034});
  for(let frame=0;frame<120&&!source.a.sourceVeteranCommander?.overheatNotice;frame++)tick(source,frame%2===0?{pressed:['A'],held:['A']}:{});
  assert.equal(source.a.sourceVeteranCommander.overheatNotice.size,0);
  source.sim.drainEvents();target.sim.drainEvents();const packet=copyTo(source,target);
  const first=target.sim.drainEvents().filter(e=>e.type==='overheatIcon');assert.equal(first.length,1);
  assert.deepEqual(first[0].position,source.a.sourceVeteranCommander.overheatNotice.position);
  copyTo(source,target,2);assert.equal(target.sim.drainEvents().filter(e=>e.type==='overheatIcon').length,0);
  const expired=structuredClone(packet);expired.actor.sourceVeteranCommander.overheatNotice.serial++;expired.actor.sourceVeteranCommander.overheatNotice.remaining=0;
  applyOwnedState(target.sim,'vc',expired);assert.equal(target.sim.drainEvents().filter(e=>e.type==='overheatIcon').length,0);
  const invalid=structuredClone(packet);invalid.actor.sourceVeteranCommander.overheatNotice.remaining=.6;
  assert.throws(()=>validateOwnedState(invalid),/actor-shape/);
});

test('Giga signed speed survives transfer without mirroring mesh orientation',()=>{
  const source=vcFixture({skillId:24021}),target=vcFixture({skillId:24021});
  for(const sign of [-1,1])source.sim.createEffect(source.a,{NAME:'RAVEN_GIGA_PROMINENCE_FINISH'},
    {sourceDirSpeedSign:sign,birthAnchor:{position:[-600,3080,0],rotation:[0,0,0],facing:1}});
  tick(source);copyTo(source,target);
  const remote=target.sim.state.effects.filter(e=>e.name==='RAVEN_GIGA_PROMINENCE_FINISH');assert.equal(remote.length,2);
  assert.deepEqual(remote.map(e=>e.initialDirSpeed).sort((a,b)=>a-b),[-2000,2000]);
  assert.deepEqual(remote.map(e=>e.sourceShadowMesh.dirSpeed).sort((a,b)=>a-b),[-2000,2000]);
  for(const e of remote)assert.deepEqual(e.birthAnchor.rotation,[0,0,0]);
});

test('Ground Impact receiver restores only its three source instance-scaled visual layers',()=>{
  const source=vcFixture({skillId:24216}),target=vcFixture({skillId:24216}),sync=createLocalOwnershipSync({reportEvery:1});let packet;
  const names=['UpLight_Raven_RRF_Ground_Impact01','Ground_ShockWave_Raven_RRF_Ground_Impact01','UpLight_Raven_RRF_Ground_Impact02'];
  const sourceBirths=[];
  for(let i=0;i<90;i++){
    sync.beforeStep(source.sim,'vc');const events=tick(source,i===0?{pressed:['A']}:{});
    sourceBirths.push(...events.filter(e=>e.type==='effectStarted'&&names.includes(e.name)));
    const report=sync.afterStep(source.sim,'vc',events);
    if(report?.actions.some(action=>action.effects.some(e=>e.name===names[0]))){packet=report;break;}
  }
  assert.ok(packet);packet.actions=packet.actions.map(({ageFrames,...action})=>({...action,frameSeq:packet.frameSeq-ageFrames}));
  validateOwnedState(packet);validateOwnedReferences(packet,target.a,vcProfile,target.map);
  assert.equal(sourceBirths.length,3);assert.equal(source.sim.state.effects.filter(e=>names.includes(e.name)).length,0,'pure visuals do not occupy live core/network slots');
  const consumer=createRemoteActionConsumer({clock:()=>1});
  consumer.receive('vc',packet.actions,packet.epoch,packet.frameSeq);consumer.consume(target.sim,'target',()=>0);
  const births=target.sim.drainEvents().filter(e=>e.type==='effectStarted'&&names.includes(e.name));assert.equal(births.length,3);
  for(const name of names){const e=births.find(e=>e.name===name),original=sourceBirths.find(e=>e.name===name);
    assert.equal(e.definition.SCALE_X,1.5);assert.equal(e.definition.SCALE_Y,1.5);assert.equal(e.definition.SCALE_Z,1.5);
    assert.deepEqual(geometry(e.birthAnchor),geometry(original.birthAnchor));}
  assert.equal(target.sim.state.effects.filter(e=>names.includes(e.name)).length,0,'historical replay leaves no persistent core identities');
  consumer.receive('vc',packet.actions.map(a=>({...a,id:a.id+1,frameSeq:a.frameSeq+1})),packet.epoch,packet.frameSeq+1);
  consumer.consume(target.sim,'target',()=>0);assert.equal(target.sim.drainEvents().filter(e=>e.type==='effectStarted'&&names.includes(e.name)).length,0,'the same source identities cannot birth twice');
});

test('BUFF removal transmits the source direct one-shot close-arm animation without a live slot',()=>{
  const source=vcFixture(),target=vcFixture(),sync=createLocalOwnershipSync({reportEvery:1});
  activateVeteranOverheat(source.sim,source.a);tick(source);source.a.buffs=[];
  sync.beforeStep(source.sim,'vc');const events=tick(source),report=sync.afterStep(source.sim,'vc',events);
  const local=events.find(e=>e.type==='effectStarted'&&e.name==='RVC_OverHeat_Object_End');assert.ok(local);
  report.actions=report.actions.map(({ageFrames,...a})=>a);validateOwnedState(report);validateOwnedReferences(report,target.a,vcProfile,target.map);
  assert.ok(report.actions.some(a=>a.effects.some(e=>e.name===local.name&&e.sourceVeteranAttachment==='overheat-arm')));
  const consumer=createRemoteActionConsumer({clock:()=>1});consumer.receive('vc',report.actions,report.epoch,report.frameSeq);consumer.consume(target.sim,'target',()=>0);
  const remote=target.sim.drainEvents().filter(e=>e.type==='effectStarted'&&e.name===local.name);assert.equal(remote.length,1);
  assert.deepEqual(remote[0].definition,local.definition);assert.deepEqual(geometry(remote[0].birthAnchor),geometry(local.birthAnchor));
  assert.equal(target.sim.state.effects.length,0);consumer.clear();
});

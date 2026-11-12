/** Real BM accepted-hit passive and Native positive steps. The optional fixture
 * root only reuses read-only original assets/helpers in a separate checkout;
 * the playback implementation remains the module under test in this checkout. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';
import {createCombatPlaybackProducer} from '../../packages/online/combat-playback.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
const fixtureRoot=process.env.RF_SHADOW_FIXTURE_ROOT;
const {bmFixture}=await import(fixtureRoot?pathToFileURL(resolve(fixtureRoot,'tests/helpers/bm-fixture.mjs')):new URL('../helpers/bm-fixture.mjs',import.meta.url));
const dt=1/60,empty={held:[],pressed:[],released:[],sampledDevice:true};
const hit={DAMAGE:{PHYSIC:.1},DAMAGE_TYPE:0,REACT_TYPE:1,BACK_SPEED_X:0,BACK_SPEED_Y:0,STOP_TIME_ATT:0,STOP_TIME_DEF:0,FORCE_DOWN:0};
function setup(t){
 const source=bmFixture({skillId:24217,passives:[24410]}),receiver=bmFixture({skillId:24217,passives:[24410]});
 source.sim.networkOwnerId='bm';receiver.sim.networkOwnerId='target';receiver.sim.networkCombatPlaybackVersion=1;
 const playback=createRemoteCombatPlayback({clock:()=>receiver.sim.state.time*1000}),producer=createCombatPlaybackProducer({version:1});
 playback.bind(receiver.sim,'target',()=>1);t.after(()=>{playback.clear();producer.clear();});
 for(const f of [source,receiver]){for(const a of f.sim.state.actors)a.inputLock=0;f.sim.drainEvents();}
 const localBefore=structuredClone(receiver.b);
 const packet=frame=>{
  const events=source.sim.drainEvents(),report=encodeOwnedState(source.sim,'bm',{epoch:1,frameSeq:frame,events});
  const action=producer.capture(source.sim,'bm',{epoch:1,frameSeq:frame,events,held:[],report});
  report.actions=action?[action]:[];validateOwnedState(report);validateOwnedReferences(report,receiver.a,receiver.profile,receiver.map);
  return report;
 };
 const receive=report=>{assert.equal(playback.receiveActions('bm',report.actions,1,report.frameSeq),true);playback.observeState(receiver.sim,'bm',report,'target');};
 const step=()=>{playback.beforeStep(receiver.sim,'target',()=>1);receiver.sim.step(dt,{...playback.remoteInputs(receiver.sim,'target'),target:empty},{snapshot:false});playback.afterStep(receiver.sim);};
 return {source,receiver,playback,producer,packet,receive,step,localBefore};
}
function activate(source){source.b.x=source.a.x-100;source.sim.rng=()=>0;source.sim.applyHit(source.b,source.a,hit,{kind:'character',powerMultiplier:1});
 assert.equal(source.a.sourceShadowStep?.key,null);assert.ok(source.a.sourceBladeMaster.escapeCooldown>0);}

test('a real BM passive escape stays strictly encodable after remote controller admission and a positive Native step',t=>{
 const f=setup(t);activate(f.source);const report=f.packet(1);assert.equal(report.actions[0].playback.start,true);
 assert.equal(f.receiver.a.sourceBladeMaster.escapeCooldown,0);f.receive(report);f.step();
 assert.equal(f.receiver.a.sourceShadowStep.key,null);assert.equal(f.receiver.a.skillId,24217);
 assert.doesNotThrow(()=>encodeOwnedState(f.receiver.sim,'bm',{epoch:1,frameSeq:1}),'remote witness/effect birth must retain the validated passive lifecycle');
 assert.ok(f.receiver.a.sourceBladeMaster.escapeCooldown>0);assert.equal(f.receiver.b.hp,f.localBefore.hp);
 t.diagnostic(JSON.stringify({sourceCooldown:report.actor.sourceBladeMaster.escapeCooldown,remoteCooldown:f.receiver.a.sourceBladeMaster.escapeCooldown,
  remoteState:f.receiver.a.state,remoteShadowKey:f.receiver.a.sourceShadowStep.key}));
 for(let frame=2;frame<=90;frame++){f.step();assert.doesNotThrow(()=>encodeOwnedState(f.receiver.sim,'bm',{epoch:1,frameSeq:frame}));}
 assert.equal(Object.hasOwn(f.receiver.a,'sourceShadowStep'),false,'the local Native escape must end without retaining a stale lifecycle');
});

test('duplicate starts and later controls cannot restart the locally advancing escape cooldown or other local cooldowns',t=>{
 const f=setup(t);activate(f.source);const report=f.packet(1);f.receiver.a.sourceBladeMaster.winCooldown=7;f.receiver.a.cooldowns[24033]=9;
 f.receive(report);f.step();const first=f.receiver.a.sourceBladeMaster.escapeCooldown;
 for(let i=0;i<3;i++)f.step();const before=f.receiver.a.sourceBladeMaster.escapeCooldown;
 assert.ok(before<first&&before>0);assert.equal(f.playback.receiveActions('bm',report.actions,1,1),true);
 const control=encodeCriticalAction(report,{id:5,frameSeq:5});control.playback={version:1,start:false,held:[]};
 assert.equal(f.playback.receiveActions('bm',[control],1,5),true);f.step();
 assert.ok(f.receiver.a.sourceBladeMaster.escapeCooldown<before,'a later control does not restore the source countdown');
 assert.ok(f.receiver.a.sourceBladeMaster.winCooldown>6);assert.ok(f.receiver.a.cooldowns[24033]>8);
 assert.doesNotThrow(()=>encodeOwnedState(f.receiver.sim,'bm',{epoch:1,frameSeq:5}));
});

test('an ordinary equipped Shadow Step does not import unrelated cooldown state',t=>{
 const f=setup(t);f.source.sim.step(dt,{bm:{...empty,held:['A'],pressed:['A']}},{snapshot:false});
 assert.equal(f.source.a.sourceShadowStep?.key,'A');const report=f.packet(1);
 f.receiver.a.sourceBladeMaster.escapeCooldown=4;f.receiver.a.sourceBladeMaster.winCooldown=7;
 f.receive(report);f.step();assert.equal(f.receiver.a.sourceShadowStep.key,'A');
 assert.ok(f.receiver.a.sourceBladeMaster.escapeCooldown<4&&f.receiver.a.sourceBladeMaster.escapeCooldown>3);
 assert.ok(f.receiver.a.sourceBladeMaster.winCooldown>6);assert.doesNotThrow(()=>encodeOwnedState(f.receiver.sim,'bm',{epoch:1,frameSeq:1}));
});

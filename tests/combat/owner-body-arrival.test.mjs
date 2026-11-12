import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
/** Native sampled movement/collision, controlled report arrival/body fixtures.
 * These assertions concern the Web network adapter, not target-client gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {nativeBodyOverlap} from '../../packages/combat-core/reaction-policy.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),assets=await loadServerCombatAssets({root,assetRoot:path.join(root,'artifacts')});
async function make(owner,positions=[1700,2023]){const {native,samplers}=await assets.createRuntime();
  const sim=createSimulation({profile:assets.profile,map:assets.map,preset:{...authoredEquipmentPreset(assets.preset),onlineMatch:true},seed:2016,networkOwnerId:owner,
    actors:[{id:'sender',team:0,position:[positions[0],2840,0],lineId:6,facing:1},{id:'receiver',team:1,position:[positions[1],2840,0],lineId:6,facing:-1}],...samplers,
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:assets.versions});
  for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','network-body-fixture');}sim.drainEvents();return sim;}
const room=(snapshot,epoch=1,owners={},recentActions={})=>({snapshot,ownership:{mode:'local-owner-v1',actors:{sender:{epoch},receiver:{epoch:1}}},owners,recentActions});
async function fixture(route='peer',positions){
  const source=await make('sender',positions),sim=await make('receiver',positions),sync=createLocalOwnershipSync();
  const initial=room(source.snapshot());sync.reconcile(sim,initial,'receiver');
  function receive(report){if(route==='peer')return sync.receivePeer(sim,'sender',report,'receiver');
    return sync.reconcile(sim,room(sim.snapshot(),report.epoch,{sender:report}),'receiver');}
  receive(encodeOwnedState(source,'sender',{epoch:1,frameSeq:0}));
  return {source,sim,sync,receive,initial};
}
const report=(f,frame=12)=>encodeOwnedState(f.source,'sender',{epoch:1,frameSeq:frame});
for(const route of ['peer','server'])test(`${route}: a stale body projection cannot pin three later separated owner endpoints forever`,async t=>{
  const f=await fixture(route);t.after(()=>f.sync.clear());f.sim.actor('receiver').x=1770;
  const local=structuredClone(f.sim.actor('receiver'));
  for(const frame of [12,15,18]){const wire=report(f,frame);wire.actor.x=1900;f.receive(wire);
    if(frame<18)assert.ok(f.sim.actor('sender').x<1770,'one or two contradictory reports retain temporary separation');}
  assert.equal(f.sim.actor('sender').x,1900);
  assert.equal(f.sync.bodyDiagnostics.crossingRecovered,1);
  assert.deepEqual(f.sim.actor('receiver'),local,'arrival recovery never moves the local owned body');
});
test('overlapping endpoints and duplicate source frames cannot unlock a projected crossing',async t=>{
  const f=await fixture();t.after(()=>f.sync.clear());f.sim.actor('receiver').x=1770;
  for(const frame of [12,15,18,21]){const wire=report(f,frame);wire.actor.x=1800;f.receive(wire);}
  assert.ok(f.sim.actor('sender').x<1770);assert.equal(f.sync.bodyDiagnostics.crossingRecovered,0);
  const wire=report(f,24);wire.actor.x=1900;
  for(let i=0;i<5;i++)f.receive(wire);
  assert.ok(f.sim.actor('sender').x<1770);assert.equal(f.sync.bodyDiagnostics.crossingRecovered,0);
});
async function walkingReport(f){for(let frame=1;frame<=12;frame++){f.source.step(1/60,{sender:{held:['RIGHT'],pressed:frame===1?['RIGHT']:[]}},{snapshot:false});f.source.drainEvents();}return report(f);}

for(const route of ['peer','server'])test(`${route}: native late Walk body cannot cross the local owner; raw packet and whole local actor stay intact`,async t=>{
  const f=await fixture(route);t.after(()=>f.sync.clear());const wire=await walkingReport(f);
  assert.equal(wire.actor.state,'RSI_WALK');assert.ok(wire.actor.x>1790&&wire.actor.x<1800);
  // This receiver position is the actual frame48 pose in the controlled
  // two-owner600ms audit; source packet itself is genuine native frame12.
  f.sim.actor('receiver').x=1770;const local=structuredClone(f.sim.actor('receiver')),raw=structuredClone(wire);
  f.receive(wire);assert.ok(f.sim.actor('sender').x<f.sim.actor('receiver').x);assert.deepEqual(f.sim.actor('receiver'),local);assert.deepEqual(wire,raw);
  assert.equal(f.sim.actor('sender').vx,wire.actor.vx,'guard never rewrites velocity or input');assert.equal(f.sync.bodyDiagnostics.crossingBlocked,1);
  const remote=structuredClone(f.sim.actor('sender'));wire.actor.x=1810;f.receive(wire);
  assert.deepEqual(f.sim.actor('sender'),remote,'same-frame reports are rejected before projection');assert.equal(f.sync.bodyDiagnostics.accepted,2);
});

test('fresh native Walk report preserves canonical pose; ordinary overlap can separate only the remote',async t=>{
  const f=await fixture();t.after(()=>f.sync.clear());const wire=await walkingReport(f),local=structuredClone(f.sim.actor('receiver'));
  f.receive(wire);assert.equal(f.sim.actor('sender').x,wire.actor.x);assert.equal(f.sync.bodyDiagnostics.crossingBlocked,0);assert.deepEqual(f.sim.actor('receiver'),local);
  f.sim.actor('receiver').x=1820;const next=report(f,15),before=structuredClone(f.sim.actor('receiver'));f.receive(next);
  const a=f.sim.actor('sender'),b=f.sim.actor('receiver'),shape=actor=>({position:[actor.x,actor.y,actor.z],width:70,height:150});
  assert.equal(nativeBodyOverlap(shape(a),shape(b)).overlaps,false);assert.deepEqual(b,before);assert.equal(f.sync.bodyDiagnostics.overlapProjected,1);
});

test('frozen CAN_PASS state and a recent source CAN_PASS sample permit a legal crossing; old samples cannot unlock later reports',async t=>{
  const f=await fixture();t.after(()=>f.sync.clear());f.sim.actor('receiver').x=1770;
  assert.equal(assets.profile.states.RRF_COMBO_ZZXFRONTX.raw.CAN_PASS_UNIT,1);
  f.source.enter(f.source.actor('sender'),'RRF_COMBO_ZZXFRONTX','pass-fixture');f.source.actor('sender').x=1800;
  f.receive(report(f));assert.equal(f.sim.actor('sender').x,1800);assert.equal(f.sync.bodyDiagnostics.canPass,1);
  // Return both states to an ordinary pose and establish its source frame.
  f.source.enter(f.source.actor('sender'),'RRF_COMBO_ZZXFRONTXX','pass-ended-fixture');f.source.actor('sender').x=1700;
  f.receive(report(f,15));f.sim.enter(f.sim.actor('sender'),'RRF_COMBO_ZZXFRONTXX','ordinary-receiver');
  const endpoint=report(f,18);endpoint.actor.x=1800;
  const passActor={...structuredClone(endpoint.actor),state:'RRF_COMBO_ZZXFRONTX'};
  endpoint.actions=[encodeCriticalAction({...endpoint,actor:passActor},{id:17,frameSeq:17})];
  f.receive(endpoint);assert.equal(f.sim.actor('sender').x,1800);assert.equal(f.sync.bodyDiagnostics.observedPass,1);
  f.source.actor('sender').x=1700;f.receive(report(f,21));
  const late=report(f,24);late.actor.x=1700;late.actions=structuredClone(endpoint.actions);f.receive(late);
  assert.ok(f.sim.actor('sender').x>1770,'frame17 proof cannot permit a new frame21→24 crossing');assert.equal(f.sync.bodyDiagnostics.observedPass,1);
});

test('observed local CAN_PASS or actual vertical clearance permits legitimate intermediate motion',async t=>{
  const f=await fixture();t.after(()=>f.sync.clear());f.sim.actor('receiver').x=1770;
  f.sim.enter(f.sim.actor('receiver'),'RRF_COMBO_ZZXFRONTX','local-pass');f.sync.beforeStep(f.sim,'receiver');
  f.sim.enter(f.sim.actor('receiver'),'RSI_WAIT','local-pass-ended');const wire=report(f);wire.actor.x=1800;
  f.receive(wire);assert.equal(f.sim.actor('sender').x,1800);assert.equal(f.sync.bodyDiagnostics.observedPass,1);
  f.source.actor('sender').x=1800;f.source.actor('sender').y=3040;f.source.actor('sender').grounded=false;f.source.actor('sender').lineId=null;
  f.receive(report(f,15));f.sync.beforeStep(f.sim,'receiver');const landed=report(f,18);landed.actor.x=1700;landed.actor.y=2840;landed.actor.grounded=true;landed.actor.lineId=6;
  f.receive(landed);assert.equal(f.sim.actor('sender').x,1700);assert.equal(f.sync.bodyDiagnostics.observedVertical,1);
  const ordinary={...structuredClone(landed),frameSeq:21};ordinary.actor.x=1800;f.receive(ordinary);
  assert.ok(f.sim.actor('sender').x<1770,'vertical-clearance permit expires after the accepted landing');assert.equal(f.sync.bodyDiagnostics.observedVertical,1);
});

test('source CAN_PUSH=false skips overlap displacement while full crossing remains blocked',async t=>{
  const f=await fixture();t.after(()=>f.sync.clear());f.sim.actor('receiver').x=1770;
  f.source.enter(f.source.actor('sender'),'RSI_DAMAGE_DOWN_FRONT','no-push-fixture');assert.equal(assets.profile.states.RSI_DAMAGE_DOWN_FRONT.raw.CAN_PUSH_UNIT,0);
  const crossing=report(f);crossing.actor.x=1800;f.receive(crossing);assert.equal(f.sim.actor('sender').x,1700);assert.equal(f.sync.bodyDiagnostics.crossingBlocked,1);
  const overlap=report(f,15);overlap.actor.x=1740;f.receive(overlap);assert.equal(f.sim.actor('sender').x,1740);assert.equal(f.sync.bodyDiagnostics.overlapProjected,0);
});

test('future source action first cannot hide an earlier legal pass; pending numeric permits stay bounded',async t=>{
  const f=await fixture();t.after(()=>f.sync.clear());f.sim.actor('receiver').x=1770;
  const ordinary=report(f,18);ordinary.actor.x=1800;const pass={...structuredClone(ordinary.actor),state:'RRF_COMBO_ZZXFRONTX'};
  const action=frame=>encodeCriticalAction({...ordinary,actor:pass},{id:frame,frameSeq:frame});
  f.sync.receiveActions('sender',[action(36)],1,36);f.sync.receiveActions('sender',[action(12)],1,12);
  f.receive(ordinary);assert.equal(f.sim.actor('sender').x,1800);assert.equal(f.sync.bodyDiagnostics.observedPass,1);assert.equal(f.sync.bodyDiagnostics.pendingPermits,1);
  const later=report(f,39);later.actor.x=1700;f.receive(later);assert.equal(f.sim.actor('sender').x,1700);assert.equal(f.sync.bodyDiagnostics.observedPass,2);
  for(let frame=60;frame<=240;frame+=3)f.sync.receiveActions('sender',[action(frame)],1,frame);
  assert.ok(f.sync.bodyDiagnostics.pendingPermits<=16,'no packet/event object is accumulated for body permits');
});

for(const route of ['peer','server'])test(`${route}: a native high-jump action between grounded reports permits one landing crossing, then expires`,async t=>{
  const f=await fixture(route);t.after(()=>f.sync.clear());f.sim.actor('receiver').x=1770;
  for(let frame=1;frame<=12;frame++){f.source.step(1/60,{sender:{held:['UP'],pressed:frame===1?['UP']:[]}},{snapshot:false});f.source.drainEvents();}
  const high=report(f);assert.ok(high.actor.y>2840+150,'real native jump sample clears the body height');assert.equal(high.actor.grounded,false);
  const action=encodeCriticalAction(high,{id:12});
  f.source.enter(f.source.actor('sender'),'RSI_WAIT','controlled-landing');Object.assign(f.source.actor('sender'),{x:1800,y:2840,grounded:true,lineId:6});
  const landed=report(f,18),raw=structuredClone(action),local=structuredClone(f.sim.actor('receiver'));
  if(route==='peer'){f.sync.receiveActions('sender',[action],1,18);f.receive(landed);}
  else f.sync.reconcile(f.sim,room(f.sim.snapshot(),1,{sender:landed},{sender:{epoch:1,frameSeq:18,actions:[action]}}),'receiver');
  assert.equal(f.sim.actor('sender').x,1800);assert.equal(f.sync.bodyDiagnostics.observedVertical,1);assert.deepEqual(action,raw);assert.deepEqual(f.sim.actor('receiver'),local);
  const next=report(f,21);next.actor.x=1700;next.actions=[action];f.receive(next);
  assert.ok(f.sim.actor('sender').x>1770,'the old high-jump action cannot unlock a later ordinary crossing');assert.equal(f.sync.bodyDiagnostics.observedVertical,1);
});

test('XZ crossing uses the literal body path; bodies on a different height do not gain a wall',async t=>{
  const f=await fixture();t.after(()=>f.sync.clear());const local=f.sim.actor('receiver'),remote=f.sim.actor('sender');
  local.x=1750;local.z=0;remote.x=1750;remote.z=-100;remote.grounded=false;
  const wire=report(f);Object.assign(wire.actor,{x:1750,z:100,grounded:false,lineId:null});const before=structuredClone(local);f.receive(wire);
  assert.equal(remote.z,-100,'depth crossing must be checked even when x does not change');assert.deepEqual(local,before);
  remote.y=3040;const above=report(f,15);Object.assign(above.actor,{x:1750,y:3040,z:100,grounded:false,lineId:null});f.receive(above);
  assert.equal(remote.z,100);assert.equal(remote.y,3040);
});

test('native map walls limit remote overlap projection and cannot move the local owner',async t=>{
  const f=await fixture('peer',[2190,2180]);t.after(()=>f.sync.clear());const local=structuredClone(f.sim.actor('receiver'));
  const wire=report(f);wire.actor.x=2195;f.receive(wire);
  assert.ok(f.sim.actor('sender').x<=2200,'line6 authored -2 wall is honored');assert.ok(f.sim.actor('sender').x>=2180,'wall fallback keeps the same side');
  assert.deepEqual(f.sim.actor('receiver'),local);assert.ok(f.sync.bodyDiagnostics.mapLimited>0);
});

test('new life resets body receipts; stale prior-life peer and server owner reports cannot alter respawn',async t=>{
  const f=await fixture();t.after(()=>f.sync.clear());const old=report(f,120),snapshot=f.sim.snapshot();snapshot.actors.find(actor=>actor.id==='sender').x=1800;
  f.sync.reconcile(f.sim,room(snapshot,2,{sender:old}),'receiver');assert.equal(f.sim.actor('sender').x,1800,'old epoch1 source is ignored at epoch2');
  assert.equal(f.sync.receivePeer(f.sim,'sender',old,'receiver'),false);
  const newLife=report(f,1);newLife.epoch=2;newLife.actor.x=1810;const local=structuredClone(f.sim.actor('receiver'));
  assert.equal(f.sync.receivePeer(f.sim,'sender',newLife,'receiver'),true);assert.equal(f.sim.actor('sender').x,1810);assert.deepEqual(f.sim.actor('receiver'),local);
  assert.equal(f.sync.bodyDiagnostics.trackedActors,2);f.sync.clear();assert.equal(f.sync.bodyDiagnostics.trackedActors,0);
});

test('projected visible body does not clamp historical native Z attack anchors or lose its accepted hit',async t=>{
  const f=await fixture('peer',[2022.98,1920]);t.after(()=>f.sync.clear());f.source.actor('sender').facing=-1;
  for(let frame=1;frame<=6;frame++){f.source.step(1/60,{sender:{held:frame===1?['Z']:[],pressed:frame===1?['Z']:[]}},{snapshot:false});f.source.drainEvents();}
  const wire=report(f,6);wire.actions=[encodeCriticalAction(wire,{id:6,effectIds:new Set(wire.effects.map(effect=>effect.id))})];
  f.sim.actor('sender').x=1900;const raw=structuredClone(wire),local=structuredClone(f.sim.actor('receiver'));f.receive(wire);
  assert.ok(f.sim.actor('sender').x<1920);assert.deepEqual(f.sim.actor('receiver'),local);assert.deepEqual(wire,raw);
  f.sync.beforeStep(f.sim,'receiver');const hits=f.sim.drainEvents().filter(event=>event.type==='hit'&&event.targetId==='receiver');
  assert.equal(hits.length,1,'native captured Z geometry still hits at its original source anchor');assert.equal(f.sim.actor('receiver').hp,local.hp-hits[0].amount);
  assert.equal(f.sim.actor('sender').x<1920,true,'temporary historical pose restores the projected visible body');
});

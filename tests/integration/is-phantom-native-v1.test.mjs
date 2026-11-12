/** Actual converted geometry + compiled common math, asserting Web behavior.
 * Source numeric expectations are separate in is-phantom-sword-v1.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
const root=resolve(import.meta.dirname,'../..'),assets=resolve(root,'artifacts/is'),read=p=>JSON.parse(readFileSync(p));
const profile=read(resolve(root,'packages/combat-core/is-profile.json')),preset=read(resolve(root,'config/is-preset.json'));
const map={...read(resolve(root,'artifacts/scene/sander-garpai-rock-pvp/manifest.json')),...read(resolve(root,'artifacts/scene/sander-garpai-rock-pvp/collision.json'))};
const index=mergeEffectIndexes(read(resolve(assets,'effect-assets.json')),read(resolve(assets,'fx/index.json')));
const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(resolve(assets,p))]));
const rawPose=read(resolve(assets,'runtime-pose.json')),characterPose=composeCharacterPose(rawPose,read(resolve(assets,rawPose.sharedPose)));
const native=await createNativeRuntime({manifest:read(resolve(root,'artifacts/native/manifest.json')),map,loadBinary:p=>readFileSync(resolve(root,'artifacts/native',p))});
function make({targetX=1858.11}={}){return createSimulation({profile,map,preset:{...preset,guildPassives:[],passives:[],
  loadout:[{skillId:21022,branchId:'none'},...Array(7).fill(null)]},seed:2016,
  actors:[{id:'is',professionId:'IS',team:0,position:[2022.98,2840,0],lineId:6,facing:-1,guildPassives:[],passives:[]},
    {id:'target',professionId:'IS',team:1,position:[targetX,2840,0],lineId:6,facing:1,guildPassives:[],passives:[],loadout:Array(8).fill(null)}],
  ...createNativeSamplers({profile,characterPose,effectIndex:index,effectPoses:poses}),
  nativeGeometry:native.geometry,nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeManaBreak:native.manaBreak});}
function blade(sim){const a=sim.actor('is');return sim.state.effects.find(e=>e.id===a.sourceInfinitySword.phantomSword.effectId);}
function restore(sim,report){validateOwnedState(report);validateOwnedReferences(report,sim.actor('is'),profile,map,{actors:sim.state.actors,profiles:{IS:profile}});applyOwnedState(sim,'is',report);}

test('actual Phantom cast owns delayed geometry, survives snapshot restore and retires both meshes at buff end',()=>{
  const sim=make({targetX:1960}),a=sim.actor('is');sim.step(1/60,{is:{pressed:['A'],held:['A']}});
  for(let i=0;i<160;i++)sim.step(1/60,{});
  assert.ok(a.sourceInfinitySword.phantomSword);assert.equal(a.skillId,null);
  const e=blade(sim);assert.equal(e.name,'THIRD_BLADE');assert.ok(sim.effectSampler(e,a).length);
  assert.ok(sim.state.events.some(event=>event.type==='hit'&&event.origin?.id===e.id),'summoned blade itself must hit using its original helpers');
  assert.ok(sim.state.events.some(event=>event.type==='effectStarted'&&event.name==='ThirdBladeCenter'&&event.sourcePhantomSword===true));
  assert.ok(e.sourcePosedAnchor.matrix.length===16);assert.ok(!sim.state.unsupported.some(n=>n.id==='is-phantom-sword-source'));
  const twin=make();twin.restore(sim.snapshot());
  sim.step(1/60,{});twin.step(1/60,{});assert.deepEqual(twin.snapshot(),sim.snapshot());
  a.buffs=[];sim.step(1/60,{});assert.equal(a.sourceInfinitySword.phantomSword,undefined);
  assert.equal(sim.state.effects.some(e=>['THIRD_BLADE','ThirdBladeCenter'].includes(e.name)),false);
});

test('late remote command reconstructs frozen damage and remaps persistent IDs without resetting the same attack receipt',()=>{
  const owner=make(),receiver=make(),a=owner.actor('is');owner.grantBuff(a,a,30,1,null);
  owner.enter(a,'ESSI_ETK_COMBO_XX','source-fixture');
  for(let i=0;i<39;i++)owner.step(1/60,{});
  const report=encodeOwnedState(owner,'is',{epoch:1,frameSeq:39}),persistent=report.actor.sourceInfinitySword.phantomSword;
  const attack=report.effects.find(e=>e.id===persistent.effectId);assert.ok(persistent.currentAttack);
  assert.equal(attack.damage,undefined,'sender supplies no mutable damage table');
  // Force different local allocation and verify both exact-instance links.
  receiver.state.nextEffectId=500;restore(receiver,report);
  const received=blade(receiver);assert.notEqual(received.id,attack.id);assert.equal(received.networkId,attack.id);
  assert.deepEqual(received.damage.DAMAGE_DATA,blade(owner).damage.DAMAGE_DATA);
  assert.deepEqual(received.sourcePosedAnchor,blade(owner).sourcePosedAnchor);
  assert.equal(receiver.state.effects.find(e=>e.id===receiver.actor('is').sourceInfinitySword.phantomSword.centerId).name,'ThirdBladeCenter');
  received.hits.target=42;restore(receiver,report);assert.equal(blade(receiver).hits.target,42);
  const sample=encodeCriticalAction(report,{id:39,effectIds:new Set([attack.id])});
  assert.equal(sample.actor.sourceInfinitySword.phantomSword.matrixQueue.length,0);
  assert.equal(sample.effects.filter(e=>e.sourcePhantomSword).length,2);
  const withHistory={...report,actions:[sample]};validateOwnedState(withHistory);validateOwnedReferences(withHistory,receiver.actor('is'),profile,map);
  for(const mutate of [
    packet=>packet.actor.sourceInfinitySword.phantomSword.currentAttack.state='RSI_WAIT',
    packet=>packet.effects.find(e=>e.sourcePhantomSword).sourcePhantomAttackSerial++,
    packet=>packet.effects.find(e=>e.sourcePhantomSword).sourcePosedAnchor.matrix[0]=NaN,
  ]){const bad=structuredClone(report);mutate(bad);assert.throws(()=>restore(receiver,bad),/owner|phantom/);}
});

test('actual copied XX segment deals its own delayed hit through original ThirdBlade helpers',()=>{
  const sim=make({targetX:1800}),a=sim.actor('is');sim.grantBuff(a,a,30,1,null);
  sim.enter(a,'ESSI_ETK_COMBO_XX','source-fixture');const e=blade(sim),serial=e.sourcePhantomAttackSerial;
  for(let i=0;i<120;i++)sim.step(1/60,{});
  const hits=sim.state.events.filter(event=>event.type==='hit'&&event.origin?.id===e.id);
  assert.equal(hits.length,1,'the copied command is one native effect hit, independent of the character hit');
  assert.ok(hits[0].amount>0);assert.equal(e.sourcePhantomAttackSerial,serial);
  assert.equal(e.powerMultiplier,1);assert.equal(e.damage.DAMAGE_DATA.FORCE_DOWN,0);assert.equal(e.damage.DAMAGE_DATA.HIT_ADD_MP,0);
});

test('receiver receipt ledger permits a new Phantom command but rejects replay of its prior accepted command',()=>{
  const owner=make(),receiver=make(),a=owner.actor('is');owner.grantBuff(a,a,30,1,null);
  owner.enter(a,'ESSI_ETK_COMBO_XX','source-fixture');const first=encodeOwnedState(owner,'is',{epoch:1,frameSeq:1});
  restore(receiver,first);receiver.networkOwnerId='target';
  const consumer=createRemoteActionConsumer();consumer.bind(receiver,'target',()=>1);
  const e=blade(receiver),receipt=receiver.receiverHitMemory({attacker:receiver.actor('is'),record:e,origin:{kind:'effect'},hits:e.hits,hitGaps:e.hitGaps});
  receipt.hits.target=123;consumer.remember(receiver,'target',()=>1);
  // Move the native queued row forward through its end, then start a fresh command.
  for(let i=0;i<100;i++)owner.step(1/60,{});owner.enter(a,'ESSI_ETK_COMBO_XX','source-fixture');
  const next=encodeOwnedState(owner,'is',{epoch:1,frameSeq:101});restore(receiver,next);
  const newEffect=blade(receiver),second=receiver.receiverHitMemory({attacker:receiver.actor('is'),record:newEffect,origin:{kind:'effect'},hits:newEffect.hits,hitGaps:newEffect.hitGaps});
  assert.equal(second.hits.target,undefined);
  restore(receiver,first);const oldEffect=blade(receiver),old=receiver.receiverHitMemory({attacker:receiver.actor('is'),record:oldEffect,origin:{kind:'effect'},hits:oldEffect.hits,hitGaps:oldEffect.hitGaps});
  assert.equal(old.hits.target,123);consumer.clear();
});

test('left-hand sheath keeps its exact matrix after follow release and validates the remote visual identity',()=>{
  const owner=make(),receiver=make(),a=owner.actor('is');owner.enter(a,'ESSI_ETK_COMBO_XX','source-fixture');
  owner.step(1/60,{});
  const e=owner.state.effects.find(row=>row.sourceISSheath);assert.ok(e);assert.equal(e.name,'ElswordSheath02');
  assert.equal(e.damage,null);assert.deepEqual(e.definition,{NAME:'ElswordSheath02'});
  assert.equal(e.sourceISSheathFollowing,true);
  for(const following of [true,false]){
    e.sourceISSheathFollowing=following;
    const report=encodeOwnedState(owner,'is',{epoch:1,frameSeq:1});restore(receiver,report);
    const actual=receiver.state.effects.find(row=>row.sourceISSheath);
    const withoutLocalEvidence=anchor=>{const {evidence,evidenceClass,...geometry}=anchor;return geometry;};
    assert.deepEqual(actual.sourcePosedAnchor,withoutLocalEvidence(e.sourcePosedAnchor));
    assert.deepEqual(actual.currentAnchor,withoutLocalEvidence(e.currentAnchor));
    assert.equal(actual.sourceISSheathFollowing,following);assert.deepEqual(actual.definition,{NAME:'ElswordSheath02'});
    const bad=structuredClone(report);bad.effects.find(row=>row.sourceISSheath).sourceISSheathFollowing=1;
    assert.throws(()=>validateOwnedState(bad),/invalid-owner-is-sheath/);
    const matrixBad=structuredClone(report);matrixBad.effects.find(row=>row.sourceISSheath).currentAnchor.matrix=[];
    assert.throws(()=>validateOwnedState(matrixBad),/invalid-owner-is-sheath/);
    const wrongName=structuredClone(report);wrongName.effects.find(row=>row.sourceISSheath).name='ThirdBladeCenter';
    assert.throws(()=>restore(receiver,wrongName),/invalid-owner-is-sheath/);
    const wrongClass=structuredClone(report);delete wrongClass.actor.sourceInfinitySword;
    assert.throws(()=>validateOwnedReferences(wrongClass,a,{...profile,target:{...profile.target,unitClass:100}},map),/invalid-owner-is-sheath/);
  }
  assert.ok(receiver.state.events.some(event=>event.type==='effectStarted'&&event.sourceISSheath===true));
});

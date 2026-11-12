/** Current Web ownership tests on real authored VC Buff634/Template545 and
 * native helpers. They do not claim target-client networking measurements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture} from '../helpers/vc-fixture.mjs';
import {encodeOwnedState,encodeCriticalAction,encodeEffectState,projectOwnedBuff,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {buildBuffRows} from '../../apps/web/buff-bar.mjs';
import {tickBuffs} from '../../packages/combat-core/buffs.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},PVP_RATE:1,REACT_TYPE:1,HIT_ADD_MP:5,FORCE_DOWN:0,STOP_TIME_ATT:0,STOP_TIME_DEF:0};
function mental(){
 const f=vcFixture({skillId:24214,gap:160});
 assert.ok(f.sim.grantBuff(f.a,f.b,634,1));return f;
}
function reset(f){for(const actor of [f.a,f.b]){actor.mp=0;actor.invincible=false;actor.forceInvincible=0;actor.hp=actor.hpMax;}f.sim.state.step++;}

for(const kind of ['character','effect'])test(`Mental Crash ${kind} keeps owner resource suppression while remote presentation omits its three private MP formulas`,()=>{
 const owner=mental(),full=vcFixture({skillId:24214,gap:160}),observer=vcFixture({skillId:24214,gap:160});
 const fullReport=encodeOwnedState(owner.sim,'target',{epoch:1,frameSeq:1});
 owner.sim.networkOwnerId='target';const original=structuredClone(owner.b.buffs),packet=validateOwnedState(encodeOwnedState(owner.sim,'target',{epoch:1,frameSeq:1}));
 assert.deepEqual(owner.b.buffs,original,'serialization does not touch owner formulas or timers');
 assert.deepEqual(packet.actor.buffs[0].behaviors,[24,25,26].map(type=>({type,kind:'empty'})));
 for(const [f,report]of [[full,fullReport],[observer,packet]]){
  f.sim.networkOwnerId='vc';validateOwnedReferences(report,f.b,f.profile,f.map,{actors:f.sim.state.actors,profiles:f.sim.profiles});applyOwnedState(f.sim,'target',report);
 }
 close(owner.b.stats.receivedMpMultiplier,.0001);assert.equal(observer.b.stats.receivedMpMultiplier,undefined);
 const visible=f=>buildBuffRows(f.b,{profile:f.profile}).map(({templateId,remaining,isDebuff})=>({templateId,remaining,isDebuff}));
 assert.deepEqual(visible(observer),visible(owner));
 reset(owner);const ownerHit=owner.sim.applyHit(owner.b,owner.a,data,{kind,powerMultiplier:1});assert.equal(ownerHit.accepted,true);close(owner.b.mp,5*.0001);
 owner.sim.state.step++;owner.b.invincible=owner.b.forceInvincible=0;owner.b.mp=0;
 owner.sim.applyHit(owner.a,owner.b,data,{kind,powerMultiplier:1});close(owner.b.mp,3*.0001);
 for(const direction of ['outgoing','incoming']){
  const hits=[];for(const f of [full,observer]){reset(f);hits.push(f.sim.applyHit(direction==='outgoing'?f.a:f.b,direction==='outgoing'?f.b:f.a,data,{kind,powerMultiplier:1}));}
  assert.deepEqual(hits[1],hits[0],'removing remote MP-only formulas cannot change damage/contact');
  close(observer.a.hp,full.a.hp);close(observer.a.mp,full.a.mp);assert.equal(observer.b.mp,0,'remote vitals remain owner-held');
 }
 observer.sim.advanceActorBuffs(observer.b,4);assert.deepEqual(visible(observer),[]);assert.deepEqual(observer.b.buffs,[]);
});

test('resource projection preserves list positions, lifetime, stat damage, defence, stun, armor and clearing identity',()=>{
 const source={schemaVersion:1,templateId:545,behaviors:[
  {type:1,kind:'hpInterval',sum:.5,interval:1,value:-10,changeType:1},
  {type:2,kind:'mpInterval',sum:.75,interval:1,value:-5,changeType:1},
  {type:3,kind:'stat',stat:'physicalAttack',value:1.2,changeType:3},
  {type:4,kind:'stat',stat:'finalDefenceMultiplier',value:.8,changeType:3},
  {type:5,kind:'stun',identityCleared:true},{type:6,kind:'superArmor'},
  {type:7,kind:'dashBlock'},{type:8,kind:'manaBreakBlock'}],finalizers:[{kind:'time',remaining:3,sourceDuration:3}],
  evidenceClass:'local-source-proof',displayer:{BDT_EFFECT_SET:['original-effect']}};
 const before=structuredClone(source),wire=projectOwnedBuff(source);
 assert.deepEqual(source,before);assert.deepEqual(wire.behaviors.slice(0,2),[{type:1,kind:'empty'},{type:2,kind:'empty'}]);
 assert.deepEqual(wire.behaviors.slice(2),source.behaviors.slice(2));assert.deepEqual(wire.finalizers,source.finalizers);assert.deepEqual(wire.displayer,source.displayer);
 assert.equal(Object.hasOwn(wire,'evidenceClass'),false);
});

for(const factor of [634,342])for(const legacy of [false,true])test(`remote Buff${factor} reapplication normalizes both ${legacy?'legacy full':'projected'} old and incoming behavior without weakening native merge`,()=>{
 const owner=vcFixture({skillId:24214,gap:160}),observer=vcFixture({skillId:24214,gap:160});
 assert.ok(owner.sim.grantBuff(owner.a,owner.b,factor,1));
 if(!legacy)owner.sim.networkOwnerId='target';
 const report=encodeOwnedState(owner.sim,'target',{epoch:1,frameSeq:1});observer.sim.networkOwnerId='vc';applyOwnedState(observer.sim,'target',report);
 const originalHp=observer.b.hp,originalMp=observer.b.mp;
 for(let i=0;i<8;i++){
  assert.doesNotThrow(()=>observer.sim.grantBuff(observer.a,observer.b,factor,1));
  assert.ok(observer.b.buffs[0].behaviors.every(row=>row.kind==='empty'));
  observer.sim.advanceActorBuffs(observer.b,.1);
 }
 assert.equal(observer.b.hp,originalHp);assert.equal(observer.b.mp,originalMp);
 assert.equal(observer.b.buffs.length,1);assert.ok(observer.b.buffs[0].finalizers[0].remaining>0);
 observer.sim.advanceActorBuffs(observer.b,30);assert.deepEqual(observer.b.buffs,[]);
 // The same reapplication on the owning actor keeps the sourced formula.
 owner.sim.networkOwnerId='target';assert.ok(owner.sim.grantBuff(owner.a,owner.b,factor,1));
 assert.ok(owner.b.buffs[0].behaviors.some(row=>row.kind!=='empty'));
});

test('remote interval observer does not execute native HP/MP arithmetic while normal-time status expiration still runs',()=>{
 let calls=0;const bridge={buffFixed(){},buffRelation(){},buffPercent(){},buffInterval(sum,interval,dt){calls++;return {sum:sum+dt-interval,triggered:true};}};
 const source={schemaVersion:1,templateId:37,behaviors:[{type:1,kind:'hpInterval',sum:.75,interval:1,value:-10,changeType:1}],finalizers:[{kind:'time',remaining:.5,sourceDuration:1}]};
 const targetActor={hp:100,hpMax:100,stateSerial:1};
 const observed=tickBuffs(null,[source],1,{targetActor,nativeValues:bridge,advanceIntervals:false});
 assert.equal(calls,0);assert.deepEqual(observed.buffs,[]);assert.deepEqual(observed.effects,[{kind:'buffFinished',templateId:37}]);
 const owned=tickBuffs(null,[source],1,{targetActor,nativeValues:bridge});assert.equal(calls,1);assert.ok(owned.effects.some(row=>row.kind==='hpDelta'&&row.delta===-10));
});

test('actual native owner actions and buff expiry round trip v3 exactly without bringing old debuffs back',()=>{
 const f=mental();f.sim.networkOwnerId='target';const p=createOwnedRelayDelta(),c=createOwnedRelayDelta();
 for(let frame=1;frame<=240;frame++){
  f.sim.step(1/60,{}, {snapshot:false});f.sim.drainEvents();
  if(frame%3)continue;
  const report=encodeOwnedState(f.sim,'target',{epoch:1,frameSeq:frame}),packet=p.encodeSplit('target',report,{deltaVersion:3});
  if(packet.baseline)c.decode(packet.baseline);
  // Only the latest ordinary update is necessary. Reliable critical samples
  // are still retained and reproduce the complete source sample each time.
  if(frame===240){assert.deepEqual(c.decode(packet.value),report);assert.deepEqual(report.actor.buffs,[]);}
  const event={matchId:'fixture',playerId:'target',epoch:1,frameSeq:frame,actions:[encodeCriticalAction(report,{id:frame})]};
  assert.deepEqual(c.decodeActions(p.encodeActions('target',event)),event);
 }
});

test('source provenance remains local while effect geometry and control are copied without mutation',()=>{
 const source={id:4,name:'fixture',effectName:'fixture',birthActorPose:{x:99,animationTime:1},ownerId:'vc',elapsed:.3,sourceCommit:'fixed-reference',
  birthAnchor:{position:[1,2,3],facing:-1,evidence:'native reference'},currentAnchor:{position:[4,5,6],evidenceClass:'local proof'},
  active:true,targetClientMeasured:false};const before=structuredClone(source),wire=encodeEffectState(source,{});
 assert.deepEqual(source,before);assert.deepEqual(wire,{id:4,name:'fixture',elapsed:.3,birthAnchor:{position:[1,2,3],facing:-1},currentAnchor:{position:[4,5,6]},active:true});
});

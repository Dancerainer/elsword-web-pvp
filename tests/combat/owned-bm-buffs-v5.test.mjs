import test from 'node:test';
import assert from 'node:assert/strict';
import {bmFixture} from '../helpers/bm-fixture.mjs';
import rsProfile from '../../packages/combat-core/rs-profile.json' with {type:'json'};
import rsPreset from '../../config/rs-preset.json' with {type:'json'};
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {bladeMasterAcceptedHit} from '../../packages/combat-core/bm-skills.mjs';
import {runeSlayerAcceptedHit} from '../../packages/combat-core/rs-skills.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';

test('passive BM Shadow Step permits its native absent slot key only with an eligible passive lifecycle',()=>{
 const owner=bmFixture({skillId:24033,passives:[24410]}),receiver=bmFixture({skillId:24217,passives:[]});
 owner.b.x=owner.a.x-100;owner.sim.rng=()=>0;
 owner.sim.applyHit(owner.b,owner.a,{DAMAGE:{PHYSIC:.1},DAMAGE_TYPE:0,REACT_TYPE:1,BACK_SPEED_X:0,BACK_SPEED_Y:0,STOP_TIME_ATT:0,STOP_TIME_DEF:0,FORCE_DOWN:0},{kind:'character',powerMultiplier:1});
 const packet=encodeOwnedState(owner.sim,'bm',{epoch:1,frameSeq:1});
 assert.equal(packet.actor.sourceShadowStep.key,null);
 assert.throws(()=>validateOwnedReferences(packet,receiver.a,receiver.sim.profileFor(receiver.a),receiver.map),/unconfigured-owner-passive-shadow-step/);
 for(const mutate of [p=>p.actor.sourceShadowStep.key=0,p=>p.actor.sourceShadowStep.skillId=24033,
  p=>p.actor.sourceShadowStep.enhanced=false,p=>p.actor.skillContext.key='A',p=>p.actor.sourceBladeMaster.escapeCooldown=0]){
  const invalid=structuredClone(packet);mutate(invalid);assert.throws(()=>validateOwnedState(invalid),/actor-shape:sourceShadowStep/);
 }
});

for(const legacy of [false,true])test(`BM native three-stack bleeding reapplication keeps its relation value for ${legacy?'legacy':'projected'} observers without executing remote damage`,()=>{
 const owner=bmFixture({passives:[]}),observer=bmFixture({passives:[]});
 for(const f of [owner,observer])f.sim.rng=()=>0;
 assert.ok(owner.sim.grantBuff(owner.a,owner.b,146,1));
 if(!legacy)owner.sim.networkOwnerId='target';
 const report=validateOwnedState(encodeOwnedState(owner.sim,'target',{epoch:1,frameSeq:1}));
 assert.equal(report.actor.buffs[0].behaviors[0].kind,'hpInterval');
 observer.sim.networkOwnerId='bm';applyOwnedState(observer.sim,'target',report);owner.sim.networkOwnerId='target';
 const remoteHp=observer.b.hp;
 for(let i=0;i<7;i++){
  assert.ok(owner.sim.grantBuff(owner.a,owner.b,146,1));
  assert.ok(observer.sim.grantBuff(observer.a,observer.b,146,1));
  const full=owner.b.buffs.find(b=>b.templateId===99),remote=observer.b.buffs.find(b=>b.templateId===99);
  assert.equal(remote.accumulationCount,Math.min(3,i+2));
  assert.equal(remote.behaviors[0].value,full.behaviors[0].value);
 }
 const before=owner.b.hp;owner.sim.advanceActorBuffs(owner.b,1.01);observer.sim.advanceActorBuffs(observer.b,1.01);
 assert.ok(owner.b.hp<before);assert.equal(observer.b.hp,remoteHp);
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta();
 const transfer=frame=>{
  const source=encodeOwnedState(owner.sim,'target',{epoch:1,frameSeq:frame}),packet=p.encodeSplit('target',source,{deltaVersion:3});
  if(packet.baseline)c.decode(packet.baseline);assert.deepEqual(c.decode(packet.value),source);return source;
 };
 transfer(2);owner.sim.advanceActorBuffs(owner.b,10);observer.sim.advanceActorBuffs(observer.b,10);
 assert.deepEqual(transfer(3).actor.buffs,[]);assert.deepEqual(observer.b.buffs,[]);assert.equal(observer.b.hp,remoteHp);
});

test('combined BM and RS on-hit callbacks preserve each original factor kind and apply the wound/fire once',()=>{
 const bm=bmFixture({passives:[]});bm.sim.rng=()=>0;
 const rs=createSimulation({profile:rsProfile,map:bm.map,preset:rsPreset,nativeSkillValues:bm.native.skillValues,
  actors:[{id:'rs',professionId:'RS',team:0,position:[1800,2840,0],lineId:6,facing:1,passives:[],guildPassives:[],loadout:Array(8).fill(null)},
   {id:'target',professionId:'RS',team:1,position:[2000,2840,0],lineId:6,facing:-1,passives:[],guildPassives:[],loadout:Array(8).fill(null)}]});rs.rng=()=>0;
 for(const [sim,a,b,factor,kind]of [[bm.sim,bm.a,bm.b,31,'normalHitBuff'],[rs,rs.actor('rs'),rs.actor('target'),44,'onHitBuffFactor']]){
  const buff=sim.grantBuff(a,a,factor,1,null);assert.ok(buff);
  assert.equal(buff.behaviors.filter(row=>row.kind===kind).length,1);
  const incoming=buff.behaviors.find(row=>row.kind===kind).factorId;
  const expected=sim.profileFor(a).buffFactors[incoming].raw.BUFF_TEMPLET_ID;
  const data={ATTACK_TYPE:0},origin={kind:'character',state:'RSI_COMBO_Z',skillId:null};
  const start=sim.state.events.length;
  runeSlayerAcceptedHit(sim,a,b,data,origin);bladeMasterAcceptedHit(sim,a,b,data,1000,origin,true);
  assert.equal(b.buffs.filter(row=>row.templateId===expected).length,1);
  assert.equal(sim.state.events.slice(start).filter(event=>event.type==='buffApplied'&&event.targetId===b.id&&event.templateId===expected).length,1);
  b.buffs=[];
  runeSlayerAcceptedHit(sim,a,b,{ATTACK_TYPE:1},origin);bladeMasterAcceptedHit(sim,a,b,{ATTACK_TYPE:1},1000,origin,true);
  assert.deepEqual(b.buffs,[],'special attack remains outside each original normal-hit gate');
 }
});

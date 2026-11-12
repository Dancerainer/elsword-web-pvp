/** Actual RS source factors and native MP arithmetic; no renderer is needed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import profile from '../../packages/combat-core/rs-profile.json' with {type:'json'};
import preset from '../../config/rs-preset.json' with {type:'json'};
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {vcFixture} from '../helpers/vc-fixture.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
const nativeFixture=vcFixture();
function make(owner='target'){
 return createSimulation({profile,map:nativeFixture.map,preset,seed:2016,networkOwnerId:owner,
  nativeSkillValues:nativeFixture.native.skillValues,
  actors:[{id:'rs',professionId:'RS',team:0,position:[1800,2840,0],lineId:6,facing:1,passives:[],guildPassives:[],loadout:Array(8).fill(null)},
   {id:'target',professionId:'RS',team:1,position:[2000,2840,0],lineId:6,facing:-1,passives:[],guildPassives:[],loadout:Array(8).fill(null)}]});
}
const factors={97:profile.damageEffects.DAMAGE_EFFECT_ERS_Luna_Buster_Loophit.raw.DAMAGE_DATA.BUFF_FACTOR,98:117};
function grant(sim,id){assert.ok(sim.grantBuff(sim.actor('rs'),sim.actor('target'),factors[id]));}
function transfer(p,c,sim,frameSeq,epoch=1){
 const source=validateOwnedState(encodeOwnedState(sim,'target',{frameSeq,epoch}));
 const packet=p.encodeSplit('target',source,{deltaVersion:3});if(packet.baseline)c.decode(packet.baseline);
 const decoded=c.decode(packet.value);assert.deepEqual(decoded,source);
 const event={playerId:'target',matchId:'rs-native',epoch,frameSeq,actions:[encodeCriticalAction(source,{id:frameSeq})]};
 const action=p.encodeActions('target',event);assert.deepEqual(c.decodeActions(action),event);
 return {source,packet,action};
}

for(const id of [97,98])test(`RS immediate Buff${id} duplicate source applications survive ordinary/actions and expire once without changing owner MP`,()=>{
 const sim=make(),observer=make('rs'),b=sim.actor('target');b.mp=b.mpMax;
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta();
 transfer(p,c,sim,1);
 grant(sim,id);grant(sim,id);
 assert.equal(b.buffs.length,2);assert.ok(b.buffs.every(buff=>buff.accumulationLimit===0));
 const before=b.mp,{source,packet,action}=transfer(p,c,sim,2);
 assert.ok(packet.value.fullBuffs);assert.equal(packet.value.buffs,undefined);
 assert.ok(action.actions[0].actor.fields.buffs);assert.equal(action.actions[0].buffs,undefined);
 assert.ok(b.buffs.every(buff=>buff.behaviors.some(row=>row.kind==='mpInterval')),'serialization retains owner formulas');
 assert.ok(source.actor.buffs.every(buff=>buff.behaviors.every(row=>row.kind==='empty')));
 applyOwnedState(observer,'target',source);const remoteMp=observer.actor('target').mp;
 observer.advanceActorBuffs(observer.actor('target'),1/60);assert.equal(observer.actor('target').mp,remoteMp);
 assert.deepEqual(observer.actor('target').buffs,[]);
 sim.advanceActorBuffs(b,1/60);
 const expected=id===97?before-20:before-b.mpMax*.6;
 assert.ok(Math.abs(b.mp-expected)<.0001);assert.deepEqual(b.buffs,[]);
 const end=transfer(p,c,sim,3);assert.deepEqual(end.source.actor.buffs,[]);assert.equal(end.packet.value.fullBuffs,undefined);
 sim.advanceActorBuffs(b,1/60);assert.ok(Math.abs(b.mp-expected)<.0001,'expired immediate resources cannot repeat');
 grant(sim,id);const single=transfer(p,c,sim,4);assert.equal(single.packet.value.fullBuffs,undefined);
 grant(sim,id);transfer(p,c,sim,1,2); // First packet of a new life can itself be a full list.
});

test('RS mixed repeated immediate identities retain order and reject invalid full-list injection without poisoning action baselines',()=>{
 const sim=make(),p=createOwnedRelayDelta(),c=createOwnedRelayDelta();
 for(const id of [97,98,97,98])grant(sim,id);
 const {source,packet,action}=transfer(p,c,sim,1);
 assert.deepEqual(source.actor.buffs.map(buff=>buff.templateId),[97,98,97,98]);
 for(const change of [
  value=>{value.fullBuffs[2].accumulationLimit=1;},
  value=>{value.fullBuffs[2].finalizers=[];},
  value=>{value.buffs=[];},
  value=>{value.fullBuffs[0].templateId=value.fullBuffs[2].templateId=545;},
 ]){const bad=structuredClone(packet.value);change(bad);assert.throws(()=>c.decode(bad),/buff/);}
 assert.deepEqual(c.decode(packet.value),source);
 const invalid=structuredClone(action);invalid.actions[0].actor.fields.buffs[2].accumulationLimit=1;
 assert.throws(()=>c.decodeActions(invalid),/buff/);
 const simultaneous=structuredClone(action);simultaneous.actions[0].buffs=[];
 assert.throws(()=>c.decodeActions(simultaneous),/buff/);
 assert.deepEqual(c.decodeActions(action).actions[0].actor.buffs,source.actor.buffs);
});

/** Real authored field/poses and native geometry, then full production owner
 * reports. This tests deterministic Web delivery, not client runtime timing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
function receive(f,id,p,options){
 validateOwnedState(p);validateOwnedReferences(p,f.sim.actor(id),f.sim.profileFor(f.sim.actor(id)),f.sim.map,{actors:f.sim.state.actors,profiles:f.sim.profiles});
 applyOwnedState(f.sim,id,p,options);
}
const report=(f,id,epoch,frameSeq)=>JSON.parse(JSON.stringify(encodeOwnedState(f.sim,id,{epoch,frameSeq})));
function prepare(stack){
 const source=originalAddFixture('DE',{skillId:29024}),victim=originalAddFixture('DE',{skillId:29024});
 // A room life exists before its first contact. Switching ownership below
 // must not turn an already-hit recipient:0 into a new recipient:2 life.
 for(const f of [source,victim])f.sim.networkEpochFor=key=>key==='add'?1:2;
 source.a.mp=source.a.mpMax;source.b.x=115;
 // A shared starting checkpoint is produced by the actual original zone.
 for(let i=0;i<350;i++){
  source.sim.step(1/60,{add:{pressed:i===0?['A']:[],held:i===0?['A']:[]}});
  if(source.b.buffs.some(b=>b.templateId===439&&b.accumulationCount===stack))break;
 }
 assert.equal(source.b.buffs.find(b=>b.templateId===439)?.accumulationCount,stack);
 victim.sim.restore(structuredClone(source.sim.snapshot()));
 for(const[f,id]of [[source,'add'],[victim,'target']])f.sim.networkOwnerId=id;
 victim.sim.state.nextEffectId=500000;
 for(let i=0;i<25;i++){
  source.sim.step(1/60,{add:{pressed:i===0?['Z']:[],held:i===0?['Z']:[]}});
  if(source.sim.state.effects.some(e=>e.name==='DamageEffect_AN_Combo_Z'&&e.active))break;
 }
 const p=report(source,'add',1,100),sourceId=p.effects.find(e=>e.name==='DamageEffect_AN_Combo_Z').id;
 receive(victim,'add',p);
 const remapped=victim.sim.state.effects.find(e=>e.name==='DamageEffect_AN_Combo_Z');assert.notEqual(remapped.id,sourceId);
 for(let i=0;i<12&&!victim.sim.actor('target').sourceAddMoonlightNotice;i++)victim.sim.tickEffects(1/60);
 const recipient=victim.sim.actor('target'),notice=report(victim,'target',2,101);
 assert.equal(recipient.sourceAddMoonlightNotice?.receipts[0].effectId,sourceId);
 assert.equal(recipient.sourceAddMoonlightNotice.receipts[0].stack,stack);
 assert.equal(victim.sim.state.events.some(e=>e.type==='addMoonlightExplosion'),false,'recipient never creates a foreign-owned attack');
 return {source,victim,notice};
}
for(const stack of [1,2,3])test(`Moonlight${stack}: actual remote Z → defender receipt → attacker explosion → native mesh damages recipient`,()=>{
 const {source,victim,notice}=prepare(stack),before=structuredClone(source.sim.actor('target'));
 receive(source,'target',notice);
 const explosion=source.sim.state.events.find(e=>e.type==='addMoonlightExplosion');assert.equal(explosion.stack,stack);
 assert.equal(source.sim.actor('target').hp,notice.actor.hp,'report installs HP; receipt adds no foreign damage');
 assert.equal(source.sim.actor('target').mp,notice.actor.mp);assert.equal(before.sourceAdd.dp,source.sim.actor('target').sourceAdd.dp);
 const hp=victim.sim.actor('target').hp;
 receive(victim,'add',report(source,'add',1,102));
 const received=victim.sim.state.effects.find(e=>e.networkId===explosion.effectId);assert.ok(received);
 for(let i=0;i<12;i++)victim.sim.tickEffects(1/60);
 const hits=victim.sim.state.events.filter(e=>e.type==='hit'&&e.origin?.id===received.id);
 assert.equal(hits.length,1);assert.ok(hits[0].amount>0);assert.equal(hits[0].data.DAMAGE.MAGIC,[4.65,9.3,13.95][stack-1]);
 assert.ok(victim.sim.actor('target').hp<hp);assert.equal(victim.sim.actor('target').buffs.some(b=>b.templateId===439),false);
 const count=source.sim.state.events.filter(e=>e.type==='addMoonlightExplosion').length;
 receive(source,'target',notice);assert.equal(source.sim.state.events.filter(e=>e.type==='addMoonlightExplosion').length,count);
 source.sim.restore(structuredClone(source.sim.snapshot()));receive(source,'target',notice);
 assert.equal(source.sim.state.events.filter(e=>e.type==='addMoonlightExplosion').length,count);
});
test('actual Moonlight owner notice rejects a peer power/amount even inside a captured critical action',()=>{
 const {source,notice}=prepare(1);
 for(const field of ['power','amount']){
  const p=structuredClone(notice);p.actor.sourceAddMoonlightNotice.receipts[0][field]=999;
  assert.throws(()=>receive(source,'target',p),TypeError);
  const q=structuredClone(notice);q.actions=[encodeCriticalAction(p,{id:1,effectIds:new Set()})];
  assert.throws(()=>receive(source,'target',q),TypeError);
 }
 assert.equal(source.sim.state.events.some(e=>e.type==='addMoonlightExplosion'),false);
});

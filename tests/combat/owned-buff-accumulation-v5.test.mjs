/** Actual five-profession declarations and native Buff math. These compare
 * owner/observer continuation, not original-client network golden traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bmFixture} from '../helpers/bm-fixture.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {bladeMasterAcceptedHit} from '../../packages/combat-core/bm-skills.mjs';
import {encodeOwnedState,applyOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
const ids=['RF','LK','VC','RS','BM'],read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const profiles=Object.fromEntries(ids.map(id=>[id,read('packages/combat-core/'+id.toLowerCase()+'-profile.json')]));
const presets=Object.fromEntries(ids.map(id=>[id,read('config/'+id.toLowerCase()+'-preset.json')]));
const {native,map}=bmFixture({passives:[]});
function fixture(profession,owner){
 const sim=createSimulation({profile:profiles[profession],profiles,preset:presets[profession],presets,map,
  nativeSkillValues:native.skillValues,networkOwnerId:owner,
  actors:[{id:'subject',professionId:profession,team:0,position:[1800,2840,0],lineId:6,facing:1,
   loadout:Array(8).fill(null),passives:profession==='BM'?[24409]:[],guildPassives:[]},
   {id:'observer',professionId:'VC',team:1,position:[4000,2840,0],lineId:6,facing:-1,loadout:Array(8).fill(null),passives:[],guildPassives:[]}]});
 sim.rng=()=>0;return {sim,a:sim.actor('subject'),b:sim.actor('observer')};
}
const cases=ids.flatMap(id=>Object.values(profiles[id].buffTemplates).filter(row=>row.raw.ACCUMULATION_LIMIT>1).flatMap(row=>
 Object.entries(profiles[id].buffFactors).filter(([,factor])=>factor.raw.BUFF_TEMPLET_ID===row.raw.BUFF_TEMPLET_ID).map(([factor])=>({
  profession:id,factor:Number(factor),templateId:row.raw.BUFF_TEMPLET_ID,limit:row.raw.ACCUMULATION_LIMIT}))));
test('all deployed stackable templates have an exercised original factor',()=>{
 assert.deepEqual(cases.map(row=>[row.profession,row.templateId,row.factor,row.limit]),[['LK',232,229,5],['VC',250,217,2],['BM',99,146,3],['BM',546,635,5]]);
});
for(const row of cases)for(const legacy of [false,true])test(`${row.profession} Buff${row.factor} native accumulation survives ${legacy?'legacy':'projected'} owner transfer, saturation and expiry`,()=>{
 const owner=fixture(row.profession,'subject'),remote=fixture(row.profession,'observer');
 assert.ok(owner.sim.grantBuff(owner.a,owner.a,row.factor,1));
 if(legacy)owner.sim.networkOwnerId=null;
 const first=encodeOwnedState(owner.sim,'subject',{epoch:1,frameSeq:1});owner.sim.networkOwnerId='subject';
 applyOwnedState(remote.sim,'subject',first);
 const producer=createOwnedRelayDelta(),consumer=createOwnedRelayDelta();
 for(let stack=2;stack<=row.limit+3;stack++){
  assert.ok(owner.sim.grantBuff(owner.a,owner.a,row.factor,1));
  assert.ok(remote.sim.grantBuff(remote.a,remote.a,row.factor,1));
  assert.equal(remote.a.buffs[0].accumulationCount,Math.min(stack,row.limit));
  const expected=encodeOwnedState(owner.sim,'subject',{epoch:1,frameSeq:stack});
  assert.deepEqual(encodeOwnedState(remote.sim,'subject',{epoch:1,frameSeq:stack}).actor.buffs,expected.actor.buffs);
  const split=producer.encodeSplit('subject',expected,{deltaVersion:3});if(split.baseline)consumer.decode(split.baseline);
  assert.deepEqual(consumer.decode(split.value),expected);
  const action={matchId:'stack-fixture',playerId:'subject',epoch:1,frameSeq:stack,actions:[encodeCriticalAction(expected,{id:stack})]};
  assert.deepEqual(consumer.decodeActions(producer.encodeActions('subject',action)),action);
 }
 for(const f of [owner,remote])f.sim.advanceActorBuffs(f.a,30);
 assert.deepEqual(owner.a.buffs,[]);assert.deepEqual(remote.a.buffs,[]);
});
test('VC observer replays the real BM five-command Winning Strategy trigger after a synchronized first stack',()=>{
 const owner=fixture('BM','subject'),remote=fixture('BM','observer');
 const command={kind:'character',state:'RSI_COMBO_Z',skillId:null};
 const hit=f=>bladeMasterAcceptedHit(f.sim,f.a,f.b,{ATTACK_TYPE:0},100,command,true);
 // This callback-only fixture supplies an elapsed cooldown explicitly.
 // Original Winning Strategy requires strictly below zero, so initial0
 // cannot serve as the ready input when no actor clock has advanced.
 owner.a.sourceBladeMaster.winCooldown=-1/60;
 for(let i=0;i<5;i++)hit(owner);
 assert.equal(owner.a.buffs[0].templateId,546);
 applyOwnedState(remote.sim,'subject',encodeOwnedState(owner.sim,'subject',{epoch:1,frameSeq:1}));
 const vitals={hp:remote.a.hp,mp:remote.a.mp};
 for(let stack=2;stack<=7;stack++){
  for(const f of [owner,remote]){f.a.sourceBladeMaster.winCooldown=-1/60;f.a.sourceBladeMaster.winHits=0;for(let i=0;i<5;i++)hit(f);}
  assert.equal(remote.a.buffs[0].accumulationCount,Math.min(stack,5));
  assert.deepEqual(remote.a.buffs[0].behaviors,owner.a.buffs[0].behaviors.map(({evidenceClass,...behavior})=>behavior));
  for(const stat of ['criticalRate','hitMeleeMpMultiplier','hitRangeMpMultiplier','receivedMpMultiplier'])assert.equal(remote.a.stats[stat],owner.a.stats[stat]);
 }
 assert.deepEqual({hp:remote.a.hp,mp:remote.a.mp},vitals,'remote resources remain owned by the BM browser');
 assert.equal(remote.b.professionId,'VC');
});

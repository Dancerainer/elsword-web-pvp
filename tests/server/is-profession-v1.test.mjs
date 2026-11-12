/** Actual native mixed room; assertions concern Web registration/ownership. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createBattleDriverFactory} from '../../apps/server/battle-driver.mjs';
import {getProfessionProfile,getProfessionPreset} from '../../packages/professions/profiles.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import {normalize} from '../../apps/server/skill-preferences.mjs';

test('RF LK VC IS owner room freezes distinct versions, starts IS HA21605 and rejects crossed states, classes and counters',async t=>{
  const root=resolve(import.meta.dirname,'../..'),factory=await createBattleDriverFactory({root,assetRoot:root+'/artifacts'});
  assert.deepEqual(factory.professions,{RF:true,LK:true,VC:true,RS:true,BM:true,IS:true,GM:true,BH:true,CA:true,LP:true,MM:true,DE:true});
  const players=['RF','LK','VC','IS'].map((professionId,i)=>({id:'p'+i,username:'p'+i,team:i<2?0:1,professionId,
    unitClass:getProfessionProfile(professionId).target.unitClass,...normalize({loadout:[{skillId:[24025,21027,24034,21033][i]},...Array(7).fill(null)],branchChoices:{}},getProfessionProfile(professionId),getProfessionPreset(professionId))}));
  const match={id:'is-mixed',mode:'2v2',players,seed:20161011,sceneId:factory.maps[0].id,versions:{...factory.versions,...factory.mapVersions(factory.maps[0].id)}};
  const driver=await factory({match,emit(){},finish(){}});t.after(()=>driver.stop());
  for(const player of players)driver.ready(player.id);
  const initial=driver.snapshot(),is=initial.snapshot.actors.find(actor=>actor.id==='p3');
  assert.equal(is.professionId,'IS');assert.equal(is.core.phase,'absent');assert.deepEqual(is.wayOfSword,{point:0,state:0});
  assert.equal(is.cooldowns[21605],180);assert.equal(is.cooldowns[21603],undefined);assert.equal(is.cooldowns[24605],undefined);
  assert.equal(initial.pvp.players.find(player=>player.id==='p3').professionId,'IS','portrait identity survives before actor presentation arrives');
  assert.ok(getProfessionProfile('IS').presentation.pvpPoses.start.some(p=>p.state===is.pvpPresentation.state));
  for(const id of ['RF','LK','VC','IS'])for(const field of ['profile','preset','reference'])assert.match(factory.versions.professions[id][field],/^[a-f0-9]{64}$/);
  assert.notEqual(factory.versions.professions.IS.profile,factory.versions.professions.LK.profile);
  driver.tick(10);driver.tick(1);assert.equal(driver.snapshot().pvp.phase,'fight');
  const packet=(id,patch={})=>{const current=driver.snapshot(),actor=current.snapshot.actors.find(actor=>actor.id===id),profile=getProfessionProfile(actor.professionId);
    const report=encodeOwnedState({state:current.snapshot,profileFor:()=>profile},id,{epoch:current.ownership.actors[id].epoch,frameSeq:(current.ownership.actors[id].frameSeq??0)+1});
    Object.assign(report.actor,patch);return report;};
  const submit=report=>driver.submitInput('p3',{frames:[{held:[],frameSeq:report.frameSeq}],owner:report});
  for(const player of players){const report=packet(player.id);assert.equal(driver.submitInput(player.id,{frames:[{held:[],frameSeq:report.frameSeq}],owner:report}).accepted,true);}
  const counters={comboLoops:0,cruelHits:0,cruelCooldown:0,suddenCooldown:0,brutalCooldown:0,lightningTime:0};
  assert.equal(submit(packet('p3',{sourceInfinitySword:counters})).accepted,true);
  for(const value of [-1,Infinity,NaN])assert.throws(()=>submit(packet('p3',{sourceInfinitySword:{...counters,cruelHits:value}})),/owner/);
  for(const value of [NaN,Infinity,-1])assert.throws(()=>submit(packet('p3',{sourceInfinitySword:{...counters,lightningTime:value}})),/owner/);
  assert.throws(()=>submit(packet('p3',{state:'RSI_SA_RRF_NUCLEAR'})),/owner/);
  const forged=packet('p1',{sourceInfinitySword:counters});assert.throws(()=>driver.submitInput('p1',{frames:[{held:[],frameSeq:forged.frameSeq}],owner:forged}),/infinity/);
  for(const field of ['profile','preset','reference']){
    const versions=structuredClone(match.versions);versions.professions.IS[field]='0'.repeat(64);
    await assert.rejects(factory({match:{...match,versions},emit(){},finish(){}}),/match-profession-version-mismatch/);
  }
  await assert.rejects(factory({match:{...match,players:players.map(p=>p.professionId==='IS'?{...p,unitClass:100}:p)},emit(){},finish(){}}),/match-profession-class-mismatch/);
  assert.throws(()=>normalize({loadout:[{skillId:900},...Array(7).fill(null)],branchChoices:{}},getProfessionProfile('IS'),getProfessionPreset('IS')),/not an available profession active skill/);
});
